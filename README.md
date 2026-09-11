# FireflyReader

An editorial RSS reader for people who read slowly and often. Built with **vinext + React + Tailwind CSS + lucide-react**, run with **bun**.

> Not a dashboard. A weekly publication that happens to know your subscriptions.

## Running it

```bash
bun install
bun run dev      # dev server (HMR)
bun run build    # production build
bun run start    # production server
```

## Design system

### Surface

Three paper tones stacked inside hairline rules — no cards, no shadows, no glass.

| Token    | Light     | Dark      | Role                |
| -------- | --------- | --------- | ------------------- |
| `canvas` | `#e9e4d9` | `#0b0a09` | navigation / chrome |
| `stream` | `#f4f1e9` | `#131210` | the story column    |
| `reader` | `#fcfaf5` | `#1b1a17` | the reading surface |

The ink ramp is calibrated so **every** tier clears 4.5:1 contrast against the darkest paper tone, including 9.5px mono captions: `ink #17150f` → `ink2 #433e35` → `ink3 #5b5647` → `ink4 #6a6353`.

### Type

Two families, each with one job.

- **Newsreader** — the entire editorial voice: the logotype at 600, section titles and the edition date at 500, every headline and all reading text at 400. Its optical-size axis draws 20px and 64px differently, which is what lets one family cover both a masthead and 19px body text.
- **IBM Plex Mono** — navigation, kickers, timestamps, counts, captions. Everything that is _metadata_ is monospace, uppercase, and widely tracked.

Both are self-hosted from `public/fonts` as variable subsets and preloaded,
so there is no font CDN in the request path and the type renders identically
offline. Newsreader's `opsz` and `wght` axes are both retained — verified by
measuring the same string at `opsz 6` (770.7px) and `opsz 72` (674.8px).

> There is no separate display face. Instrument Serif held the masthead and date
> and looked thin at the sizes a masthead actually runs at; Newsreader at weight
> lays down about 40% more ink for the same word at the same size, which is the
> measurement that settled it.

Body measure is held at **600px / ~62 characters** at the default step, with four
reader steps from 17.5px to 23.5px.

### Rhythm

The stream deliberately does not render every story the same way. Five layouts are mixed by editorial judgement:

| Layout     | Use                                                      |
| ---------- | -------------------------------------------------------- |
| `feature`  | one per edition — full-bleed plate, 30px headline        |
| `standard` | headline + standfirst + 84px plate                       |
| `compact`  | headline + two-line standfirst, no artwork               |
| `quote`    | a pull quote _is_ the story, marked by a 2px accent rule |
| `brief`    | table-of-contents row with a dotted leader               |

Plates are generative SVG compositions (halftone, arcs, stripes, bands, grid, hatch, horizon, numeral), deterministic per story — so the product ships with artwork that is designed rather than borrowed.

### Firefly

The brand is a single point of light: a small accent dot with a soft halo, reused as the unread marker, the nav logotype, the article end mark, and the empty-state ornament. It pulses slowly, and stops entirely under `prefers-reduced-motion`.

## Subscribing to feeds

Feeds are read on the server, so publishers never have to send CORS headers and
the page makes no third-party requests until you choose to subscribe.

```
GET /api/feed?url=daringfireball.net          → preview (first 5 entries)
GET /api/feed?url=daringfireball.net&full=1   → every entry, with bodies
```

`url` may be a feed address **or any site address** — the route looks for
`<link rel="alternate" type="application/rss+xml">` and follows it. RSS 2.0,
Atom and RDF are all normalised to one shape.

Reach it from **Sources → Add** in the navigation, from the **+** in the stream
header, or from the **+** in the mobile masthead. Paste an address (or tap a
suggestion), the route reports the feed's title, host, format and entry count
plus its five most recent headlines; choose a folder and subscribe.

Feed bodies are translated into the reader's own block model rather than
sanitised and injected. So there is no `dangerouslySetInnerHTML` and no
sanitiser dependency, fetched stories inherit exactly the same typography as the
rest of the product instead of smuggling in a publisher's stylesheet, and
`<blockquote>`, `<h2>`, `<ul>`, `<pre>` and `<img>` all land as the same blocks
the sample edition uses. Bodies are capped at 60 blocks / 8,000 characters and
20 entries per source, and a cut-off body says so — _Excerpt · Continues at …_
rather than pretending to be the whole piece.

Each source row in the navigation carries **refresh** and **unsubscribe** on
hover (always visible on touch), and a refresh that fails marks the row with a
`!` and a tooltip rather than silently doing nothing.

## Real and invented content

The project contains exactly one kind of fabricated content, and it is fenced
off in `lib/sample/`.

**Suggested sources are real.** `lib/sources.ts` lists seven publications with
their actual feed URLs — Kottke, Simon Willison, Dense Discovery, Aeon, The
Verge, Creative Boom, Stratechery — each verified to resolve. They are _not_
subscriptions: nothing is fetched until you ask, and the navigation presents
them as offers, never as facts.

**The sample edition is invented, all the way down.** It exists so the reader
has something to show on first open: the five story layouts, the type scale,
the rhythm of a real edition. Every publication in it is invented and sits on a
reserved `.example` host that by RFC 2606 can never resolve, every byline is an
invented writer, and sample stories carry **no outbound link at all** — so
"open original" stays disabled rather than pointing at a real homepage and
implying the piece exists there.

**Its artwork is generated, and it is the only artwork that is.** The plates in
`components/plate.tsx` are SVG drawn from the story id — halftone, arcs,
stripes, bands, grid, hatch, horizon, numeral. They are the sample edition's
illustrations, so they appear when a story has no `src` and the sample edition
is what you are reading.

A _fetched_ article never gets one. If the publisher's feed supplied a picture,
that picture is shown; if it did not, the story renders without artwork and the
stream falls back to its text-only layouts. An earlier version drew a plate for
every image-less article and captioned it _"Illustration · Firefly Studio"_ — a
credit for a studio that does not exist, on a picture that does not exist, under
a real article. Same failure as the fabricated bylines, so it got the same
treatment. A publisher image that fails to load says _Image unavailable_ rather
than quietly becoming a generated one.

It retires itself the moment you subscribe to anything, so invented stories can
never mix with real ones. The masthead date is the real date, decided per
request on the server (`app/page.tsx`) so the client cannot disagree with it.

> An earlier draft attributed these essays to real, named writers at real
> publications. That is misattribution whatever the intent, and it is the reason
> the sample is fenced off rather than left masquerading as subscriptions.
> `lib/shaping.test.ts` now fails the build if a real name reappears in it.

## Opening the original

An RSS reader should not be a roach motel. Every story has a canonical URL, and
it is reachable three ways:

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| Keyboard       | `O` (or `V`) opens the original in a new tab            |
| Reader toolbar | the ⧉ button, a real `<a target="_blank">`              |
| Stream row     | the ⧉ button on hover, which does _not_ open the reader |

For a fetched story the canonical URL is the entry's own `<link>`; for a seeded
source it falls back to the site. All three paths carry
`rel="noopener noreferrer"`, and the stream row's controls stop propagation so
a click on ⧉ never falls through to "open this story here".

## Storage

Everything below the interface goes through `lib/storage/`, and **nothing above
it imports `idb` or knows that IndexedDB exists**. That seam is the point: the
next step — a remote adapter, or SQLite on the server for real cross-device
sync — is a change to one directory, not a rewrite.

```
lib/store.tsx                  →  repository.ts  →  db.ts  →  IndexedDB
   (in-memory mirror)              (domain API)     (schema)
```

### Three stores, three lifetimes

The v0 design kept everything in one localStorage blob per concern. That was
the actual problem, and it is worth being precise about _why_: it conflated
things with completely different lifetimes.

| Store      | Holds                            | Size                  | Synced?                                       |
| ---------- | -------------------------------- | --------------------- | --------------------------------------------- |
| `sources`  | the subscription registry        | tiny, durable         | **yes**                                       |
| `reading`  | read / saved / later per article | tiny, high write rate | **yes** — and the most valuable thing you own |
| `articles` | cached bodies                    | large, disposable     | **never**                                     |

Cached prose is re-fetchable; your read/saved/later state is not. Keeping them
in separate stores means a future sync uploads a few kilobytes of state instead
of megabytes of somebody else's writing — and a new device re-fetches rather
than downloading a corpus. `articles` is a cache with an eviction rule:
**anything you saved or queued is exempt**, so pruning can never take something
you deliberately kept.

### Why IndexedDB and not localStorage

localStorage is synchronous, string-only, capped at about 5 MB, and has no
indexes — so every keystroke-scale write serialises the entire corpus on the
main thread, and reading one source means parsing all of them. The v0 blobs hit
roughly 200 KB per source, which is a handful of subscriptions away from the
ceiling. IndexedDB gives asynchronous writes, structured records, real indexes
(we query articles by `sourceId`), transactions, and a quota measured as a
fraction of free disk.

### Why `theme` is still in localStorage

The colour scheme is read by an inline script in `<head>` **before first
paint**, and IndexedDB is asynchronous — reading it there would flash the wrong
theme on every load. So `firefly.reader.v1` survives, holding four scalars and
never article content. This is a deliberate exception, not an oversight.

### Shaped for replication

Every mutable record carries `updatedAt`, and deletions are **tombstones**
(`deletedAt`) rather than removals, so a delete can propagate. Article and
source ids are derived from stable inputs (`hash(feedUrl)`,
`${sourceId}~${itemId}`), so two devices agree on identity without coordination.
The repository already exposes the two primitives a sync client needs:

```ts
changesSince(watermark)   → { sources, reading }   // everything mutated since
mergeChangeset(changeset) → void                   // last write wins, ties → deletion
```

They are unused by the interface today and are not dead code — they are the
contract. Conflict resolution is deliberately last-write-wins on a single
timestamp: correct enough for read flags, and honest about not being a CRDT.

### Upgrading

A v0 install is migrated on first open: both legacy blobs are read, written
into the new stores in **one transaction**, and only then is the legacy data
discarded — a failed upgrade can never lose the original.

Two bugs found while building this, both fixed:

- The preferences write ran before loading finished, so it wrote defaults over
  the stored blob _while the migration was still reading it_ — silently
  dropping every read/saved/later flag. Prefs now only persist once loading has
  completed.
- Cleanup originally happened during the read rather than after the commit,
  which would have destroyed the legacy data if the transaction failed.

If IndexedDB is unavailable (private mode, storage disabled) the edition still
reads — it simply does not remember anything, and says so in the console.

## Interaction

| Action                | Pointer                         | Key                  |
| --------------------- | ------------------------------- | -------------------- |
| Next / previous story | click                           | `J` / `K`, `↓` / `↑` |
| Save                  | bookmark icon                   | `S`                  |
| Read later            | clock icon                      | `L`                  |
| Toggle read           | check icon                      | `M`                  |
| Search                | search icon                     | `/` or `⌘K`          |
| Immersive reading     | maximise icon                   | `F`                  |
| Theme                 | sun / moon                      | `T`                  |
| Text size             | `Aa` menu                       | `[` / `]`            |
| Add a source          | `+` in the stream header        | —                    |
| Open original         | ⧉ in the reader or a stream row | `O`                  |
| Close overlay         | —                               | `Esc`                |

Press **`?`** — or the keyboard button in the navigation footer — for the whole
key set. It is set as a printer's key: two columns, key caps on the left,
plain-language labels beside them, and a third group for the pointer
affordances that have no shortcut. `components/shell.test.tsx` presses every key
the legend documents and requires an observable change, so the reference cannot
drift from the bindings.

State (read / saved / later / theme / text size / nav) persists in `localStorage`. The colour scheme is written by an inline boot script before hydration, so there is no light-mode flash.

## Mobile

Mobile is not the desktop stack squashed. It is a different structure:

- a compact masthead with the drawer, theme and search,
- the same editorial edition header at reduced scale,
- a touch-density stream,
- **the article as a full-screen sheet** with its own toolbar and a four-action bottom bar,
- and a four-item tab bar for collections.

## Files

```
app/globals.css          design tokens, type kit, motion
app/layout.tsx           font preloads + theme boot script
app/api/feed/route.ts    feed intake: discovery, fetch, parse
lib/sources.ts           real suggested publications + folders
lib/sample/              the invented sample edition (delete it and the app runs)
lib/reading.ts           age + reading-time helpers
lib/edition.ts           the masthead date, decided per request on the server
lib/feed-server.ts       RSS / Atom / RDF normalisation, HTML→blocks entry point
lib/feed-html.ts         HTML→block translation, entity decoding, budgeting
lib/hash.ts              shared deterministic hash + monogram
components/add-source.tsx  the subscribe dialog
lib/storage/types.ts     record shapes, designed for replication
lib/storage/db.ts        IndexedDB schema, seeding, v0 migration
lib/storage/repository.ts  the storage contract — the only sync surface
lib/storage/prefs.ts     the four scalars that must stay synchronous
lib/shaping.ts           records → the Feed / Story view model
lib/articles.ts          18 stories with full bodies + derived reading time
lib/store.tsx            state, derived counts, keyboard shortcuts
components/shell.tsx     responsive shell + mobile chrome
components/nav-rail.tsx  left navigation + colophon
components/stream-column.tsx  edition header, filter rail, story layouts
components/article-pane.tsx   reader: toolbar, progress, block renderer
components/plate.tsx     generative SVG artwork + the firefly
components/search-palette.tsx
components/shortcuts.tsx   the key legend
```
