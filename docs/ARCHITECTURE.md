# Architecture

How a feed becomes a page, and where the seams are. Storage has its own file:
[STORAGE.md](STORAGE.md).

---

## The shape of a request

```
                    ┌───────────────────────────────┐
  you paste a URL ─▶ │  app/api/feed/route.ts        │  the only server-side
                    │  discover → fetch → parse     │  network access
                    └───────────────┬───────────────┘
                                    │  ParsedFeed
                                    ▼
                    ┌───────────────────────────────┐
                    │  lib/feed-server.ts           │  XML → one normalised
                    │  RSS · Atom · RDF             │  shape
                    └───────────────┬───────────────┘
                                    │  ParsedItem[]
                                    ▼
                    ┌───────────────────────────────┐
                    │  lib/feed-html.ts             │  HTML → Block[]
                    │  no HTML reaches the DOM      │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
   lib/store.tsx ──▶ lib/storage/repository.ts ──▶ lib/storage/db.ts ──▶ IndexedDB
   in-memory mirror        the storage contract        the only module
                                                       that knows IndexedDB
```

Nothing above `lib/storage/` imports `idb` or mentions IndexedDB. That seam is
what makes a different backend a swap rather than a rewrite.

## Feed intake

Everything network-facing runs on the server, for two reasons: publishers should
not have to send CORS headers, and the reading page should make no third-party
requests at all until the reader chooses to subscribe.

```
GET /api/feed?url=daringfireball.net          → preview (first 5 entries)
GET /api/feed?url=daringfireball.net&full=1   → every entry, with bodies
```

**`url` may be a feed address or any site address.** If the response is HTML, the
route looks for `<link rel="alternate" type="application/rss+xml">` (or an Atom
or RDF equivalent), resolves it against the document, and follows it. Candidates
are tried in document order and stop at the first that parses.

### It is a public endpoint that fetches a URL somebody else chose

That is the feature, so it cannot be an allowlist. It does mean the route has to
be a poor proxy to abuse and must not become somebody else's backend. Three
things, in order of how much they actually do:

**A 2MB ceiling, enforced while reading.** `readCapped` checks `content-length`
first and refuses before the body is touched, then reads the stream and aborts
the transfer the moment the ceiling is crossed. Buffering with `arrayBuffer()`
first — as it did — means a declared cap only fires after the megabytes have
already arrived. The heaviest real feed measured here is Pluralistic at 137KB.

**A rate limit**, `FEED_FETCH` in `wrangler.jsonc`: 40 requests a minute per
address. Know what it is. Cloudflare describes the binding as _permissive,
eventually consistent, and intentionally not an accurate accounting system_ —
each request consults a locally cached counter. Measured against the deployment:
a trickle of two requests a second never trips it; a 300-request burst in eight
seconds drew 20 rejections and left the window saturated afterwards. It damps
abuse; the hard ceiling is a zone-level rate limiting rule in front of the
Worker.

**A same-origin check.** A request from another site's page is refused, so the
Worker cannot be quietly embedded as somebody else's feed API. Requests with no
`Origin` at all — curl, a native client, a same-origin GET — are allowed, and the
rate limit is what covers those.

Requests are bounded by a 12-second timeout and only `http`/`https` addresses are
accepted.

## Keeping the edition fresh

The app is a local reader: the Worker cannot push into the browser's IndexedDB,
so nothing updates while the page is closed. Freshness is therefore the
client's job, and follows a stale-while-revalidate sweep (`lib/refreshing.ts`,
driven from `lib/store.tsx`):

- A source is **stale** when its `fetchedAt` is older than 30 minutes
  (`STALE_MS`). The view renders the cached copy immediately, never waiting.
- Once after the edition loads, and then every 30 minutes while the tab is open
  and whenever a hidden tab becomes visible again, every stale source is
  re-fetched in the background, **one at a time** — polite to publishers and
  clear of the intake route's per-address rate limit.
- A source currently being fetched is skipped, so the scheduled sweep, a
  visibility change and a manual press can never duplicate a request. A failed
  fetch leaves `fetchedAt` untouched (so the failure is visible) but is
  throttled by an in-memory last-attempt timestamp, so a dead feed is not
  retried on every tick.
- The Sources section also offers a manual **refresh all**, which ignores the
  staleness window but still skips in-flight sources.

A refresh **reconciles, it does not rebuild** (`reconcileArticles` in
`lib/refreshing.ts`), so pressing refresh on an unchanged feed changes nothing
visible:

- Entry identity never includes the entry's position. The identifier is the
  publisher's own stable id (Atom `<id>`, RSS `<guid>`, RDF `rdf:about`), then
  the article URL, then the title and published time, then the content itself.
  A feed that inserts a new entry used to shift every later index and hand the
  same stories new ids, which remounted the whole list and orphaned their
  reading state. The article URL is stored separately, so identity — “is this
  the same article?” — never depends on where the page is fetched from.
- A body fetched from the original page is kept: a source refresh may update
  the fallback metadata but will not throw the extracted text away. A failure is
  remembered with the time it happened so the retry window can throttle it, and
  is cleared if the feed starts shipping the full piece itself.
- Entries with no published date keep their first-seen timestamp rather than
  inheriting the fetch time, which used to make them jump up the list.
- When the reconciled feed is identical to the cache — compared field by field,
  ignoring `fetchedAt` and looking inside blocks rather than at their fresh
  object identities (`articlesUnchanged`) — the article store is not written
  and the list state is not replaced, so an unchanged refresh causes zero
  article I/O and zero list re-render. The source's own `fetchedAt` still
  advances, since the fetch genuinely happened.

While the app is fully closed nothing can be fetched; that would require a
server-side subscription store and is deliberately out of scope.

## Parsing

RSS 2.0, Atom and RDF (RSS 1.0) all normalise into one `ParsedFeed`. The
differences that actually bite:

- **Author.** Atom carries the byline on the feed rather than on each entry, so
  the entry's author falls back to the channel's.
- **Links.** Atom has a _list_ of links. `rel="alternate"` wins over
  `rel="self"`; RSS entries have a plain string.
- **RDF.** Metadata lives on `<channel>` inside `<rdf:RDF>`, not on the root.
- **Relative URLs.** Feeds routinely publish `src="/photo.jpg"` and
  `href="/entry"`. Every URL is resolved against the document it came from
  _before_ it is judged safe — testing safety first silently discards both.

## Bodies become blocks

Feed HTML is translated into the reader's own model rather than sanitised and
injected:

```ts
type Inline = { text: string; href?: string };

type Block =
  | { kind: "p"; text: string; inline?: Inline[] }
  | { kind: "h2"; text: string; inline?: Inline[] }
  | { kind: "quote"; text: string; cite?: string; inline?: Inline[] }
  | { kind: "list"; items: string[]; inlineItems?: Inline[][] }
  | { kind: "figure"; caption: string; seed: number; src?: string }
  | { kind: "video"; provider: "youtube" | "vimeo"; id: string; title?: string }
  | { kind: "note" | "code"; text: string };
```

Three things follow from this. There is no `dangerouslySetInnerHTML` and no
sanitiser dependency. Fetched stories inherit exactly the same typography as
everything else, instead of smuggling in a publisher's stylesheet. And the block
model is what `lib/reading.ts` can measure.

**Links are kept.** A paragraph, heading or list item stores its plain `text`
for measuring and searching, plus an `inline` breakdown only when the page made
part of it a link. Publisher links open in a new tab, so a reader following a
reference never loses their place in the piece.

Feed bodies are capped at **60 blocks / 8,000 characters**, and 20 entries per
source. Bodies extracted from the original page get their own, much higher
budget — **200 blocks / 50,000 characters** — so a real feature is not cut at
the feed ceiling. A body cut by our own budget is stored as `truncated` and says
so — _Excerpt · Continues at …_ — rather than pretending to be complete.

Two things feeds do that a naive pipeline gets wrong:

- **They repeat themselves.** Many publications open every entry with the same
  subscription pitch or house note. It belongs in the article, but as a summary
  it says nothing — a column of rows that all read the same. `sharedOpening()`
  finds the longest opening every entry shares, cuts back to a sentence boundary
  (full-width stops included, since that is where CJK sentences end), and removes
  it from the summaries only.
- **They are not all in Latin script.** Reading time counts CJK characters at
  about 400 a minute and space-delimited words at about 225, and handles both in
  one body.

## The original page, and the feed as fallback

The content model has two cases, and they turn on the article URL, not on what
the feed happened to include.

**With an article URL**, the original page is the preferred and authoritative
body. The feed's own text is shown immediately and used as the fallback while
the original is fetched, or if it never arrives. Whether the feed field was
`<content:encoded>` or `<description>` no longer decides whether to fetch — the
URL does. Opening a story never waits on the network:

| Cached state                           | On open                                                  |
| -------------------------------------- | -------------------------------------------------------- |
| never fetched                          | show the feed body, fetch the original in the background |
| fetched and fresh (`ARTICLE_STALE_MS`) | use the cached original; no request                      |
| fetched but stale                      | show the cached original, revalidate silently            |

A cached body also records the extractor generation that produced it
(`EXTRACTOR_VERSION`). A body from an older generation is re-fetched regardless
of its age, so an extractor change reaches caches that would otherwise look
fresh. A revalidated body is written to storage and shown the next time the
article is opened, never swapped in under a reader mid-scroll.

**Without an article URL**, the feed content is canonical: no original to
fetch, no article-level revalidation, and no “Open original”.

`GET /api/article?url=…` runs `fetch → linkedom → Defuddle` on the server and
returns the same `Block[]` model, so the reading surface is unchanged and no
publisher HTML reaches the DOM. `linkedom` rather than `jsdom`: the deployment
is a Worker, and jsdom does not run there. Defuddle resolves the page's own
metadata (title, byline, date, site, main image) and cleans the body; the
reader still converts it to its own blocks.

Images are filtered before they become figures: tracking pixels, logos,
author avatars and byline headshots are dropped, whether the signal is in the
`class`/`alt` or only in a thumbnail size baked into the URL. A `<figure>` with
no usable image is not dropped — its inner markup flows on, so a pull quote or
code sample wrapped in one is not lost.

The article's cover is its metadata image when it has one, otherwise any
reasonable body picture. When the piece does not already open with a picture,
that cover is shown above the body; when it does open with one, that first
figure is the cover and the metadata image is only the stream thumbnail. A body
picture is never lifted out of its place: if the body's first figure is the same
photograph as the cover, that duplicate copy is dropped, and otherwise it stays
exactly where the piece put it.

A page's own video is read from standard metadata (schema.org `VideoObject`,
Open Graph/Twitter player meta, or a real `<iframe>`) and stored as
`{ provider, id }` for an allowlisted host only. The reader renders it as a
sandboxed `youtube-nocookie.com` / `player.vimeo.com` frame; arbitrary
publisher iframes are never embedded.

A stale page is revalidated with a **conditional GET** — `If-None-Match` when an
ETag is stored, else `If-Modified-Since` — never a HEAD followed by a GET. A
`304` moves only the checked-at time; a `200` re-parses the page and replaces the
whole body, keeping the article id and the reader's read/saved/later state. A
revalidation writes storage but does not swap the body out from under the open
article, because that would move the reader's place — the new version appears the
next time the piece is opened.

A failure is recorded with the time it happened, and is not permanent: after
`EXTRACTION_RETRY_MS` the original may be tried again, because a failure is
often a timeout or a temporary CDN problem. While it lasts, the feed's text
stays and the reader keeps the link to the original. It does not defeat
paywalls, logins or JavaScript challenges: a page that will not offer its text
is a page we keep the feed's text for.

`lib/url-safety.ts` is the target's safety contract — http/https only, no
loopback or private ranges, re-checked after every redirect. It is deliberately
separate from the same-origin guard, because an article URL is normally a
different origin from ours.

### Comparing extractors

`/lab/compare` (development only) fetches one page and runs both Mozilla
Readability and Defuddle over the same HTML, side by side with a paragraph diff.
It is how the Defuddle choice was made, and how a future one should be; the API
route returns 404 in a production build.

## Suggested sources

Six publications — The New York Times, NPR, Smithsonian Magazine, NASA, Ars
Technica and Aeon — offered in the navigation while the reader has subscribed
to nothing. They span news, science, technology, culture and long-form writing,
because a list of six technology feeds is not a general-interest edition.

They are a newspaper, public radio, a museum, an agency and two independent
publications. **Nothing is promoted, sponsored or partnered**, the descriptions
are plain, and being listed subscribes you to nothing: every one is a button the
reader has to press. `lib/shaping.test.ts` asserts the spread, the count, and
that no blurb contains partnership or superlative language.

Clicking one opens the subscribe dialog with the feed already queued _and the
folder it belongs in preselected_, so a news feed is not filed under whatever
the dialog happened to default to.

`lib/sources.ts` is also where the folders live: News, Science, Technology, AI,
Culture, Design, Ideas. The general categories lead and the
technology-adjacent ones sit together — the same statement the source list makes.

**The navigation lists only folders with something in them.** A folder with
nothing filed in it is a dead end, so it is not offered; it appears the moment
you file a feed into it. The taxonomy itself is fixed, and the subscribe dialog
always offers every folder, so nothing becomes unreachable — the sample edition
simply says nothing about news or science, and the navigation does not pretend
otherwise.

## Article classification

Folders file a publication; a topic describes a single story. A technology feed
publishes pieces about policy, and a culture feed publishes pieces about books,
so the two are kept apart: `SourceRecord.folder` stays exactly what it was, and
an article's topics live in their own stores (`topics` / `classifications` in
`lib/storage/types.ts`).

Classification is opt-in and local-first. When it is on, `lib/store.tsx` walks
the stories that have no answer yet — or whose title/summary changed since they
were classified — and sends each one's title and summary to `POST /api/classify`.
The route makes the one outbound call, with a **closed** choice question built
from the reader's own topic set; the browser never reaches the classifier
directly. This is never a background crawl: the input is the stored summary, or
an already-cached body, and a story is never fetched in order to classify it.

**Which classifier is the reader's choice, made in Settings.** There is no
server-side configuration and no secret in the repository: the reader picks a
transport, fills in what it asks for, and that configuration travels with the
request. `CLASSIFY_PROVIDERS` in `lib/classify.ts` is the whole list, ordered by
how widely used each one is, and each entry states what the reader fills in and
where the call goes — the Settings dialog renders the list, the descriptions and
the fields straight from the table, so a new decision API is one entry and no UI
change.

| Transport             | The reader fills in       | Notes                                                                                                         |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| OpenAI                | base URL, model, API key  | The Decisions API, in limited preview. The only one that answers in its own format rather than System One's.  |
| Cloudflare Workers AI | model, account ID + token | `@cf/cloudflare/clef-flash` (9B, fast) or `@cf/cloudflare/clef` (27B, accurate), in the reader's own account. |
| TypeSafe (Jev)        | API key                   | `https://www.jevai.org/api/v1/decisions`, the hosted decision API.                                            |
| Ollama                | model, then address       | Free, no key, and the title and summary never leave the machine.                                              |

Three of the four speak the System One wire format — a state plus one closed
choice question in, one slug and a confidence out — so the route, the shared
parser and the confidence floor do not care which of them answered. OpenAI
answers the same decision in its own shape: the state as one string, the question
as an entry in a list, and the answer's probabilities as pairs. A transport that
differs supplies its own `read` on its table entry, which is all the route needs
to know. The default is still a local Ollama, because it is the one that needs no
key and sends nothing anywhere; the order of the list is what a reader browses,
not what a reader gets.

**Two decisions, one shape.** A story gets a topic from the reader's own topic
set; a publication gets a folder from the app's own seven. Both are one closed
choice over a set that already exists, so they differ only in the prompt the
server writes and the set they are asked over — the request names which one it
wants, and the server still writes every word of the question. The folder
decision is what files a feed in the subscribe dialog: when a classifier is
configured, the pick is preselected and labelled as a suggestion, and a folder
the reader has already chosen outranks it. Below the confidence floor, or with no
classifier at all, nothing is offered — a weak guess is worse than an empty field.

**Nothing about a local model is presumed.** Ollama reports what each pulled model
can do in its `capabilities`, so `GET /api/classify/models` asks it and hands back
only the ones that answer a decision — `clef-flash`, `clef`, `nimble`, whatever the
reader happens to have. The Settings picker is built from that answer, so a reader
with nothing pulled is told so rather than offered a model that would fail, and
the model is a required field: there is no default to fall back on. The browser
asks our own origin because Ollama's CORS policy only admits localhost origins.

**A local model is called straight from the browser.** Everything above still
holds for the hosted APIs, whose credentials must not reach the page. A local
Ollama is the exception: it takes no credential, so there is nothing to keep off
the page, and it is the one transport our own server cannot reach on the reader's
behalf. So when the Ollama address is on the reader's network the browser calls
Ollama itself — same request the server would have built, same parser, one fewer
hop.

Where the page was served from is not a condition. The request leaves from the
reader's machine either way, so a page on a deployed domain reaches `localhost`
exactly as a locally served one does; what the origin decides is only whether
Ollama's CORS policy admits the page.

The deployed site reaches a local model, but only once the reader has admitted it:
Ollama answers a loopback origin and refuses a page on a domain, so
`OLLAMA_ORIGINS` has to name the site. Without it the picker says it could not
ask Ollama and names that setting, rather than reporting a model list the reader
does have as missing — an unreachable Ollama and an Ollama with no decision
models are different problems, and only one of them is fixed by `ollama pull`. On
the macOS app that is `launchctl setenv OLLAMA_ORIGINS
"https://feeds.fireflylabs.studio"` followed by quitting and reopening Ollama,
since a new value only reaches a new process. And a direct call passes neither the Worker's rate
limiter nor its origin guard; the client-side pacing is what throttles it, and
Ollama's own CORS policy is what stops anyone else's page from doing the same.

When the page is _not_ served beside the reader, a local address can never answer
and the picker says so rather than reporting a model list the reader does have as
missing. The address field stays editable, which is the way out: point it at an
Ollama that is publicly reachable.

A transport the reader has not finished setting up is refused by the route with
the names of the missing fields rather than called half-built. The configuration
lives in local prefs only: it is the one piece of reading state that is a secret,
and it is sent to this app's own endpoint rather than to the service itself.

Whichever transport answered replies with a slug and a confidence.
**A topic is not printed on a row.** It used to sit in the kicker with an icon
for the doubt, which is the right shape for scanning a column of dozens and the
wrong shape for anything else: on a row it reads as more of the publication's
name than as a category, and a tag beside a story's own summary is noise beside
it. A topic narrows the column and describes the open story; those two places
carry it.

Above `CONFIDENCE_THRESHOLD` (0.6) the topic is stored as `auto`; below it the
same topic is stored as `needs_review`, shown to the reader as a question rather
than a fact — judged on the model's own `confidence`, not on the winning option's
probability, because a twelve-way choice spreads probability thin even when the
model is sure. The reader can correct the answer, which
stores a `confirmed` record — and a confirmed or rejected record is never
overwritten by a later automatic pass, however the story's text changes. A
classification is therefore user state, kept in its own stores rather than on
the disposable article cache record (see [STORAGE.md](STORAGE.md)).

The sweep is serial and paced — one request at a time, with a minimum gap
between calls and a ceiling per rolling minute — and stops at the first
failure, because a hosted classifier rate-limits per key and a reader's page
should not hammer it. Order within it puts the story the reader has open first,
because a missing topic on that one is the only one they can see is missing;
behind it, newest first, so the stories they are likely to open next get an
answer soonest. Enabling classification on a large library is therefore a slow
background trickle, not a burst; a failure is surfaced in Settings with a Retry
rather than swallowed. Classification does not change a stream row's `layout`.

Privacy: while classification is on, the only thing that leaves the device is a
story's title and summary. It goes to this app's own endpoint, and then to the
transport the reader chose — nowhere at all when that is a local Ollama, and to a
hosted service that bills per story otherwise. No reading history, no
subscription list, no full text, no Firefly account.

## Today's briefing

The briefing answers the one question folders and topics cannot: _which of
today's stories are worth my time?_ It is opt-in and off by default, for the same
reason classification is — it is the other part of the app that sends any of the
reader's data off the device.

**One edition a day, written from what is already here, and only when the reader
asks.** Nothing is written on their behalf: opening the page writes nothing, a
new day writes nothing. The call spends their key and their machine's time, and
"spending it for you" and "deciding for you" are the same thing. When the reader
asks, `lib/store.tsx`
sends the day's unread stories — real subscriptions only, never the sample
edition, judged on the title and the article's own opening words already stored —
never on a feed's teaser alone, which is what a publisher says about a piece and
not the piece: a gist written from a paraphrase is a paraphrase of a paraphrase.
to the model chosen in Settings. Nothing is fetched to make the prompt better.
The answer is up to five stories, each with one line on what it is and one on
why it might be worth reading. Then it is left alone: stories arriving later
mark the edition stale with a count of what is new, and only a reader who asks
rewrites it. There is no ceiling on how often: it is the reader's key and
their money, and what stands between them and a stray click is that one
edition writes at a time and calls are paced apart. A daily allowance was
tried and only ever got in the way of somebody improving the thing.

**The briefing is a page, not a banner.** It is a view of its own — a row under
"Edition" in the navigation, and a tab on mobile — because it answers a
different question from the stream: the stream is what arrived, the briefing is
what is worth reading. The row appears only once the reader has switched the
feature on, and the page lists its own picks rather than the day's stories, so
`j` and `k` step through the edition.

**The prompt is written in one place.** `buildDigestMessages` in `lib/digest.ts`
holds every word of the instructions, and both ways of reaching a model use it —
`POST /api/digest` builds the messages server-side, exactly as `/api/classify`
writes its question, and a local Ollama is called from the browser with the same
function because our own server cannot see the reader's machine. A request that
brought its own instructions would be a general LLM proxy with our domain on it.

**The model is the reader's own.** There is no server-side configuration and no
secret in the repository: the reader picks a service in Settings, fills in what it
asks for, and that configuration travels with the request. `LLM_SERVICES` in
`lib/llm.ts` is the whole list — a local Ollama, and a short set of services that
carry their own address (OpenAI, Anthropic, DeepSeek, Moonshot, Qwen, GLM), so a
reader picks one and types only a model and a key. Everything else goes through
"custom", where the reader chooses which of the two wire formats the address
speaks — OpenAI-compatible `/chat/completions`, or Anthropic-compatible
`/v1/messages` — and types the address. One entry covers every compatible
service, which is a cheaper promise than keeping a dozen addresses current.

Two details of the formats are worth knowing before touching the table: an
Anthropic call carries the system prompt as a top-level field rather than as a
message and requires `max_tokens`, and its answer comes back as blocks of which
only some are prose. A local Ollama speaks the OpenAI shape under `/v1` while the
address a reader points at is its root, which is why that one entry carries its
own path. Everything else about the two formats is the same request.

**A model that thinks is told not to, wherever it can be told.** A thinking
model bills its deliberation against the same `max_tokens` as its answer, so an
allowance that fits the answer can lose all of it to the reasoning before the
answer: the call succeeds and `content` comes back empty. This feature needs no
reasoning — five choices and ten short lines. DeepSeek's switch is documented as
`thinking.type`, defaults to `enabled`, and is sent by its entry; a service that
cannot be told is left to the budget and to an error that says which kind of
empty it was. The switch is declared per service rather than guessed at, because
every provider spells it differently and an unknown field is a risk taken for
nothing.

**The answer is checked before it is shown.** The model is given ids and asked
to copy them back, and a reply is accepted only where every id is one it was
given, each line is a sentence within its limit, and at least one line survives.
That is what keeps a gist a summary of a real story rather than a plausible
sentence about nothing: the words are the model's, the facts are the summary's,
and the id is what ties the two together. A gist is deliberately one sentence —
enough to decide whether to open the story, not enough to read in its place.

**Cost is capped on the way in, which is why the endpoint has no rate limiter.**
At most fifty candidates of three hundred characters each, at most three
thousand tokens out, sixty seconds at most: what a request can cost is knowable
in advance, and there is no legitimate burst to throttle — one edition a day is
the whole traffic. The output ceiling is as high as it is because a thinking
model bills its deliberation against it — measured on a three-story prompt, about
two thirds of the completion was reasoning — and a budget that only fits the
answer is one the thinking eats, leaving an empty `content` behind a call that
succeeded. An empty answer therefore says which kind of empty it was: out of
room, or actually nothing. The daily cap on manual rewrites is on the client, where the
mistake is made. A local Ollama is called straight from the browser — it takes no
key, so there is nothing to keep off the page — and everything else goes through
this app's own endpoint.

Privacy: while a briefing is on, the only thing that leaves the device is the
title and summary of the day's unread stories, up to fifty at a time, once a day
and on the reader's own request. It goes to this app's own endpoint, and then to
the service the reader chose — nowhere at all when that is a local Ollama. No
reading history, no subscription list, no full text, no Firefly account.

**The briefing speaks the reader's language; the application keeps its own.** A
"Written in" setting in Settings decides the language of the gists and reasons
and of the briefing page's own words, from a closed set — the story's own
language by default, or one of ten named ones. A language travels as a name in
the request and never as an instruction, so the prompt is still ours to write;
names of people, companies, products and code are asked for untranslated. The
ceiling on one line is per language, because a sentence carries more per
character where characters are words. What is deliberately not translated is
the rest of the application: navigation, the stream, the reader, Settings, the
masthead date and the relative timestamps. A half-translated application is
worth less than an English one, and this page is the only one a reader scans
rather than reads. CJK text sets in the reader's own system fonts — the three
faces here are Latin subsets, and bundling CJK would cost megabytes for glyphs
the device already has.

**The edition is chosen for one reader, and by taste rather than by subject.** A
"Reading taste" field takes the reader's own words and quotes them to the model
as fact about them. It is taste, not a topic list: what the reader says they
skip rules a story out however big it is, what they like outranks what is merely
important, and a subject they name is only a bonus — taste applies to tomorrow's
stories whatever they turn out to be about, where a list of subjects welds the
edition to a list of places. The edition is never padded to reach five; if
fewer pass, fewer are printed. With the field empty, the old job stands:
guessing at somebody's tastes is worse than an edition that makes no claim to
know them. There is no inferred profile of
what was read and for how long; the explicit sentence is more accurate, is
editable, and needs no explaining. The writing is told to be specific with the
same hand — a gist states the number or the claim rather than restating the
title, and a reason names the interest it touches rather than calling the piece
interesting.

**A day is an edition, and the editions abut.** Each day is one record, which
is what makes a history worth looking back at: the briefing page lists earlier
editions at its foot, opens one on a click, and prints that day's date in the
masthead while it is open — a header that says today while showing last
Tuesday's edition is lying about what it is showing.

One edition covers the day it is dated for: stories published since local
midnight. A story is published on one day and not on two, so two editions can
never share one — which is how one day's briefing is guaranteed to differ from
the next: the date does it. Nothing is excluded for having been picked before,
because there is nothing to exclude; a rule like that turned rewriting today
into a lottery of whatever had not been drawn yet. A rewrite draws from the
same day again, whatever the last one chose; the reader asked for today's
edition again, not for a different five.

The Today column reaches back to the same midnight rather than through the last
twenty-four hours. A sliding window looks the same at ten in the morning and is
not: it carries yesterday's stories, so yesterday's Today and today's Today
overlap and the two counts stop being comparable. The built-in sample edition
is the one exception, being not news and undated — it fills its column the same
way at midnight and at noon.

## Reading state

**Reaching the end of a story marks it read. Nothing else does automatically.**
Selecting a story only selects it — treating the two as the same quietly
consumes anything you meant to glance at.

`readSignal` in `lib/reading.ts` returns one of three answers from the three
numbers a scroll container reports:

| Signal  | When                                        | Why                                                                                                                                       |
| ------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `now`   | scrolled to the end of something scrollable | the scrolling is the evidence; waiting would lose the credit when someone reaches the bottom and moves on                                 |
| `dwell` | the story fits the pane                     | its end is on screen from the moment it appears, so being on screen proves nothing — otherwise flipping through a column would consume it |
| `none`  | mid-story                                   | not read                                                                                                                                  |

The dwell branch is the common case, not an edge one: on Kottke, ten of twelve
recent entries fit the reading pane. The rule is a pure function so it can be
unit-tested at every branch — jsdom has no layout and cannot exercise it through
the DOM.

**The Unread filter is the default, and it does not move the reader.** Crediting
the open story removes it from the column, but the pane stays on the page:
dropping to the next story under someone who is still reading it is the jump the
filter would otherwise cause. `j`/`k` and the "Next up" link anchor on the column
the filter was applied to (`listed` in `lib/store.tsx`), so a step continues from
the story on screen instead of restarting at the top. When the initial real story
is displayed through a fallback selection, crediting it also anchors that real id
before the filter changes. Changing the view, a search or a collection still
carries the reader to the new column.

## Sample content

`lib/sample/` holds the only fabricated content in the project, and it is fenced
off:

- every publication is invented, on a reserved `.example` host that by RFC 2606
  can never resolve;
- every byline is an invented writer;
- sample stories carry **no outbound link**, so "open original" stays disabled
  rather than pointing somewhere plausible and wrong;
- it is active only while you have subscribed to nothing, and retires itself the
  moment a real source exists, so invented and real stories can never mix;
- `originalUrl` falls back to the feed's site for real sources, and returns
  nothing at all for a sample one — there is deliberately nothing to open.

Never attribute sample content to a real person or publication, in a byline, a
blurb or a pull quote. `lib/shaping.test.ts` asserts this and names the offenders.

## Directory

```
app/
  layout.tsx           font preloads and the pre-paint theme script
  page.tsx             resolves the edition date, renders the shell
  api/feed/route.ts    feed intake — server-side, so publishers need no CORS
  api/article/route.ts original-page extraction and revalidation
  api/classify/route.ts    the only route that calls a classifier; holds no keys
  api/classify/models/     the decision models a local Ollama has, for Settings
components/
  shell.tsx            the responsive three-column frame and mobile chrome
  nav-rail.tsx         navigation, sources, colophon
  stream-column.tsx    edition header, filter rail, five story layouts
  article-pane.tsx     reader: toolbar, progress, block renderer
  add-source.tsx       the subscribe dialog
  settings.tsx         classification switch, the classifier picker, the topic set
  hint.tsx             a one-line explanation for a small icon, on hover or click
  search-palette.tsx   ⌘K overlay
  shortcuts.tsx        the key legend
  plate.tsx            generative SVG artwork
lib/
  store.tsx            all application state — one context, one hook
  classify.ts          the classifier rules, and the transport table behind them
  sources.ts           real suggested publications and folders
  sample/              the invented sample edition
  feed-server.ts       XML → ParsedFeed
  feed-html.ts         HTML → Block[]
  reading.ts           age, reading time, the read trigger
  edition.ts           the masthead date
  shaping.ts           stored records → the Feed / Story view model
  storage/             IndexedDB — see STORAGE.md
```

## Layering rules

- **`lib/store.tsx` is the only state container.** Components read it through
  `useReader()`. No second context, no reducer, no store library.
- **Nothing above `lib/storage/` may import `idb` or mention IndexedDB.**
- **`app/api/**` is the only place that talks to the network on the server.**
- **Feed bodies are never injected as HTML.**
