# AGENTS.md

Firefly Feeds — an editorial RSS reader. Next.js App Router running on **vinext** (Vite 8 / Rolldown), React 19, Tailwind CSS v4, lucide-react. Bun is the package manager.

---

## Commands

```bash
bun run dev          # dev server with HMR
bun run build        # production build
bun run start        # production server

bun run good         # format → lint → typecheck → test   (run before committing)
bun run check        # format:check → lint → typecheck → test → build   (CI gate, writes nothing)
```

|                             |                                                            |
| --------------------------- | ---------------------------------------------------------- |
| `bun run format`            | prettier over everything, including Tailwind class sorting |
| `bun run format:check`      | same, without writing                                      |
| `bun run lint` / `lint:fix` | oxlint, `--deny-warnings`                                  |
| `bun run typecheck`         | `tsc --noEmit`                                             |
| `bun run test`              | vitest, single run                                         |
| `bun run test:watch`        | vitest, watch                                              |
| `bun run test:coverage`     | vitest with v8 coverage                                    |

**`good` and `check` must both be green before you claim anything works.** `good` formats first, so running it will touch files; `check` never writes.

`bun run test -- lib/feed-html.test.ts` runs one file. `bun run test -- -t "budget"` runs one case.

---

## Architecture

```
app/
  layout.tsx          font preloads + the pre-paint theme script
  page.tsx            → components/shell.tsx
  api/feed/route.ts   feed intake: discovery, fetch, parse  (server only)
components/
  shell.tsx           the responsive three-column frame + mobile chrome
  nav-rail.tsx        navigation, sources, colophon
  stream-column.tsx   edition header, filter rail, five story layouts
  article-pane.tsx    reader: toolbar, progress, block renderer
  add-source.tsx      the subscribe dialog
  search-palette.tsx  ⌘K overlay
  shortcuts.tsx       the key legend
  plate.tsx           generative SVG artwork + the firefly mark
docs/
  DESIGN.md           the visual language, and why it is that way
  preview-*.webp      screenshots, captured reading NASA's feed (public domain)
  ARCHITECTURE.md     how a feed becomes a page
  STORAGE.md          the three stores and the repository contract
lib/
  store.tsx           all application state, one context, one hook
  sources.ts          suggested publications, folders, blurbs
  sample/             the invented sample edition (18 stories)
  reading.ts          age and reading-time helpers
  edition.ts          the masthead date
  feed-server.ts      RSS / Atom / RDF → one normalised shape
  feed-html.ts        feed HTML → the reader's own block model
  shaping.ts          stored records → Feed / Story view model
  storage/            IndexedDB. See below.
```

### Layering rules

- **`lib/store.tsx` is the only state container.** Components read it through `useReader()`. Do not introduce a second context, a reducer, or a store library without a reason you can defend.
- **Storage names are addresses, not names.** `DB_NAME = "firefly-feeds"` and
  `PREFS_KEY = "firefly.feeds.v1"`. Change either and the app opens an empty
  store and appears to have forgotten every subscription and read flag. A rename
  would be a migration — copy the old database across in one transaction, carry
  the prefs before removing the old key, keep reading the old names as a
  fallback — but there is none to write, because there is nothing to migrate
  from.
- **Nothing has shipped, so there is no compatibility surface.** No migration
  code, no legacy key fallbacks, no version shims. Do not add one for a
  hypothetical earlier install.
- **Nothing above `lib/storage/` may import `idb` or mention IndexedDB.** The storage contract is `lib/storage/repository.ts`; that seam is what makes a future remote adapter a swap rather than a rewrite.
- **`app/api/feed/route.ts` is the only place that talks to the network on the server.** Feed fetching lives there so publishers never need CORS headers and the page makes no third-party requests until the reader subscribes.
- **The sample edition in `lib/sample/` is the only fabricated content in the
  project, and it stays fenced off.** Every publication in it is invented on a
  reserved `.example` host, every byline is an invented writer, and its stories
  carry no outbound link — "open original" stays disabled rather than pointing
  somewhere plausible and wrong. It retires itself once any real subscription
  exists, so invented and real stories can never mix. **Never attribute sample
  content to a real person or publication**, in a byline, a blurb or a pull
  quote; `lib/shaping.test.ts` asserts this and names the offenders.
- **Read state has two triggers, and neither is scroll depth alone.** Selecting
  a story marks it read at once; _reaching the end_ of one also marks it read,
  which exists for stories that were shown rather than chosen (first load, view
  switch, search). A story that fits the pane is exempt, and the end rule fires
  once per story so it never argues with `M`. Scroll depth as the only trigger
  would make the unread count a completion log instead of a queue — see
  `reachedEnd` in `lib/reading.ts` for the full reasoning.
- **Reading time is per-character for CJK and per-word for everything else.**
  Counting whitespace alone reports a 2,160 character Chinese article as
  "1 min read", because it is one "word" — which is what every entry in a
  Chinese-language feed looked like. `readingTime` in `lib/reading.ts` handles
  both units; keep it that way.
- **A summary that is identical in every row is not a summary.** Publications
  routinely open every entry with the same subscription pitch or house note.
  `sharedOpening()` strips whatever a feed repeats from the summaries — the
  article keeps it, since it is genuinely part of the article. Measured cost of
  not doing this: 96 shared characters, and one distinct summary across six
  entries.
- **Never invent artwork for a real article.** A fetched story carries a
  picture only if the publisher's feed supplied one; otherwise it renders with
  no artwork and the stream falls back to its text-only layouts. The generated
  plates in `components/plate.tsx` belong to the sample edition alone. A plate
  in a photograph's slot reads as the article's own image and does not exist on
  the page the story links to — `components/shell.test.tsx` asserts a fetched
  article gets no plate, and that no "Firefly Studio" credit reappears.
- **Feed bodies are never injected as HTML.** `lib/feed-html.ts` translates them into `Block[]`. No `dangerouslySetInnerHTML`, no sanitiser dependency, and no publisher stylesheet leaking into the reading surface. Keep it that way.

### Storage

Three IndexedDB stores with deliberately different lifetimes:

| Store      | Holds                            | Synced?                  |
| ---------- | -------------------------------- | ------------------------ |
| `sources`  | the subscription registry        | yes                      |
| `reading`  | read / saved / later per article | yes — the valuable part  |
| `articles` | cached bodies                    | **never**; it is a cache |

Rules that are easy to break by accident:

- Every mutable record carries `updatedAt`. Deletions are **tombstones** (`deletedAt`), never removals — a delete has to be able to replicate.
- `articles` is a cache with an eviction rule: **anything saved or queued is exempt** (`replaceArticles(..., keep)`). Pruning must never remove something the reader deliberately kept.
- `lib/storage/prefs.ts` is the one thing that stays in localStorage, because the inline script in `<head>` must read the theme _synchronously before first paint_. Do not move it.
- Prefs are only written once `ready` is true. Writing them earlier overwrites stored values with defaults.

---

### Where a control lives

A control belongs to the column it acts on, and an action gets **one** control.
The stream header's add, search and theme buttons are a fallback for the
collapsed navigation, so they render only while `navOpen` is false — the rest of
the time they are a second entry point for something already on screen.
Immersive reading acts on the reader, so it lives in the reader's toolbar and
nowhere else. The `⌘K` chip in the navigation is a hint, not a button.

### Folders

Seven, in `lib/sources.ts`: News, Science, Technology, AI, Culture, Design,
Independent Web. The navigation shows only the ones with something filed in them
— an empty folder is a dead end — but the taxonomy is fixed and the subscribe
dialog always offers all seven, so nothing is unreachable.

### Suggested sources

Six real publications, offered in the navigation while nothing is subscribed.
They are spread across news, science, technology, culture and long-form writing
on purpose — a list of technology feeds is not a general-interest edition.
**Nothing is promoted or partnered**, blurbs stay plain and factual, and listing
is an offer: the reader presses the button. A suggestion carries the folder it
belongs in, so clicking one pre-files it. `lib/shaping.test.ts` guards the
spread, the count, and the absence of pitch language.

## Documentation

`README.md` is the front door: what this is, what it does, how to run it.
`docs/` is the depth — read the relevant file before changing anything it
describes, and update it in the same change.

|                        |                                                    |
| ---------------------- | -------------------------------------------------- |
| `docs/DESIGN.md`       | surfaces, type, rhythm, the firefly                |
| `docs/ARCHITECTURE.md` | the feed pipeline, reading state, sample isolation |
| `docs/STORAGE.md`      | IndexedDB, the repository seam, replication        |

## Design system

The visual language is not decoration; it is the product. Before changing anything that renders, read `app/globals.css` — it is the source of truth.

- **Surface** — three paper tones (`canvas` / `stream` / `reader`), separated by 1px hairlines. No cards, no shadows on surfaces, no gradients, no glass. The single exception is the popover, which needs a tight shadow to separate from text underneath.
- **Ink ramp** — `ink` → `ink2` → `ink3` → `ink4`, calibrated so **every tier clears 4.5:1 against the darkest paper tone**, including 9.5px mono captions. Any new colour must clear it too.
- **Type** — two families, one job each. **Newsreader** carries the whole editorial voice: the logotype (`600`), section titles and the edition date (`500`), and every headline and body (`400`), using its `opsz` axis to draw small and large text differently. **IBM Plex Mono** is for anything that is metadata: navigation, kickers, timestamps, counts, captions. Metadata is uppercase and widely tracked; reading text never is.
- **There is no separate display face, on purpose.** Instrument Serif was used for the masthead and date and read hairline-thin at 21–33px — which is what a high-contrast display face does when it is set at text sizes. Weight, not a third family, is what a logotype needs. If you are tempted to add one back, measure the ink first.
- **Measure** — body is held at 600px / ~62 characters. Four reader steps, 17.5px → 23.5px.
- **Rhythm** — the stream does not render every story the same way, but **a row's shape must be earned by the story, never by its position in the feed**. `standard` means the entry has a picture; `brief` means it has nothing to summarise; `compact` is the default; `feature` and `quote` are authored treatments for the sample edition. A positional rule (`index % 7`) once forced every seventh entry into the bare contents-page row, which rendered the same story two ways depending on when it was published and hid the one thing that tells a reader whether to open it. If you add a layout, it must carry the same row controls as every other layout, and it must never hide a summary that exists.
- **The firefly** is one point of light: unread marker, logotype, article end mark, empty state. Not an illustration.

Third-column rule: three columns need about **1320px**. Below that the navigation steps aside — unless the reader has chosen a nav width themselves, which is never overridden.

---

## Conventions

- **Prettier owns formatting.** Double quotes, semicolons, 100 columns, trailing commas. `prettier-plugin-tailwindcss` sorts Tailwind classes — never hand-order them, and expect a reorder if you paste a class list in.
- **oxlint runs with `--deny-warnings`.** Warnings are failures. Where a rule genuinely does not apply, disable it _on the line_ with a comment that explains why — do not weaken the config.
- Comments explain **why**, not what. A comment that restates the code is noise; a comment that records a constraint, a non-obvious ordering, or a bug that was fixed is the point.
- **TypeScript strict.** No `any`. `FeedId` is a `string` on purpose — subscribed feeds get generated ids.
- Server-only code lives in `app/api/**`. Everything under `components/` and `lib/` runs in the browser unless it is imported only by a route handler (`lib/feed-server.ts`).
- `components/clsx.ts` is a local two-line helper deliberately not the `clsx` package. Leave it.

---

## Testing

Vitest with jsdom and `fake-indexeddb`. Tests live beside the code as `*.test.ts(x)`.

| File                             | Covers                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| `lib/feed-html.test.ts`          | entity decoding, URL safety, block extraction, budgets, boilerplate |
| `lib/feed-server.test.ts`        | RSS 2.0 / Atom / RDF parsing, author fallback, link picking         |
| `lib/shaping.test.ts`            | records → view model, the seeded edition's invariants               |
| `lib/storage/repository.test.ts` | seeding, cache eviction, tombstones, the sync primitives            |
| `components/shell.test.tsx`      | the whole shell: state, storage and layout together                 |

**Scope every DOM query to a column.** The three-column layout renders desktop _and_ mobile chrome into the same tree, one hidden by CSS, so an unscoped `getByText` finds the same control twice and proves nothing. Use the `nav()` / `stream()` / `reader()` helpers in `shell.test.tsx`.

`lib/shaping.test.ts` guards the sample edition: reserved hosts, no outbound
URLs, and no real names anywhere in it. If you add sample content, those tests
are the contract.

`lib/storage/repository.test.ts` opens a real database. Its `freshRepository()` helper closes the previous connection, resets the module registry and deletes the store — you need all three, because the module memoises its connection and the database outlives the module graph. Reuse that helper rather than writing your own setup.

Tests are the reason four real bugs were found in the feed pipeline (relative URLs being discarded, `rel="self"` winning over `rel="alternate"`, RDF channel metadata read from the wrong node, and controls missing from one story layout). Write tests for parsing, seeding and eviction — that is where the sharp edges are.

---

## Adding a feed feature

1. Network and parsing changes go in `lib/feed-server.ts` (or `lib/feed-html.ts` for body handling). Add a fixture-based test.
2. Persistence changes go in `lib/storage/repository.ts`; keep the record shapes replication-friendly and add a test using `freshRepository()`.
3. Add the binding to `components/shortcuts.tsx` in the same change. The legend
   is hand-written, so a key that is not listed there does not exist as far as
   anyone can tell; the test that presses every documented key is what keeps it
   honest.
4. Give a user-visible reason to the operation. A silent failure in a reader is indistinguishable from a broken feed — surface it in the navigation, the way a failed refresh does.
5. Run `bun run good`, then `bun run check`.
