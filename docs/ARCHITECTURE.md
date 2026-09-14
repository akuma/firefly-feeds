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
the story on screen instead of restarting at the top. Changing the view, a search
or a collection still carries the reader to the new column.

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
  api/feed/route.ts    feed intake — one of the two server-side network routes
  api/article/route.ts original-page extraction and revalidation
components/
  shell.tsx            the responsive three-column frame and mobile chrome
  nav-rail.tsx         navigation, sources, colophon
  stream-column.tsx    edition header, filter rail, five story layouts
  article-pane.tsx     reader: toolbar, progress, block renderer
  add-source.tsx       the subscribe dialog
  search-palette.tsx   ⌘K overlay
  shortcuts.tsx        the key legend
  plate.tsx            generative SVG artwork
lib/
  store.tsx            all application state — one context, one hook
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
