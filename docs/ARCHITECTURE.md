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

Requests are bounded: a 12-second timeout, a 4MB ceiling, and only `http`/`https`
addresses are accepted.

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
type Block =
  | { kind: "p" | "h2" | "note" | "code"; text: string }
  | { kind: "quote"; text: string; cite?: string }
  | { kind: "list"; items: string[] }
  | { kind: "figure"; caption: string; seed: number; src?: string };
```

Three things follow from this. There is no `dangerouslySetInnerHTML` and no
sanitiser dependency. Fetched stories inherit exactly the same typography as
everything else, instead of smuggling in a publisher's stylesheet. And the block
model is what `lib/reading.ts` can measure.

Bodies are capped at **60 blocks / 8,000 characters**, and 20 entries per
source. A body that was cut says so — _Excerpt · Continues at …_ — rather than
pretending to be the whole piece.

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

## Suggested sources

Six publications — BBC News, NPR, Smithsonian Magazine, NASA, Ars Technica and
Aeon — offered in the navigation while the reader has subscribed to nothing.
They span news, science, technology, culture and long-form writing, because a
list of six technology feeds is not a general-interest edition.

They are public broadcasters, a museum, an agency and two independent
publications. **Nothing is promoted, sponsored or partnered**, the descriptions
are plain, and being listed subscribes you to nothing: every one is a button the
reader has to press. `lib/shaping.test.ts` asserts the spread, the count, and
that no blurb contains partnership or superlative language.

Clicking one opens the subscribe dialog with the feed already queued _and the
folder it belongs in preselected_, so a news feed is not filed under whatever
the dialog happened to default to.

`lib/sources.ts` is also where the folders live. They lead with News rather than
Design, which is the same statement the source list makes.

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
  api/feed/route.ts    feed intake — the only server-side network access
components/
  shell.tsx            the responsive three-column frame and mobile chrome
  nav-rail.tsx         navigation, sources, colophon
  stream-column.tsx    edition header, filter rail, five story layouts
  article-pane.tsx     reader: toolbar, progress, block renderer
  add-source.tsx       the subscribe dialog
  search-palette.tsx   ⌘K overlay
  shortcuts.tsx        the key legend
  plate.tsx            generative SVG artwork and the firefly
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
- **`app/api/feed/route.ts` is the only place that talks to the network on the
  server.**
- **Feed bodies are never injected as HTML.**
