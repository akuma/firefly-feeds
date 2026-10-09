# Storage

Reading state is the only thing in this product you cannot get back. Feeds can be
re-fetched; what you read, saved and queued cannot. The storage layer is built
around that asymmetry.

---

## The seam

```
lib/store.tsx  ──▶  lib/storage/repository.ts  ──▶  lib/storage/db.ts  ──▶  IndexedDB
in-memory mirror      the storage contract            the schema, and the
                      (the only sync surface)          only file that names it
```

### The names are addresses

```ts
const DB_NAME = "firefly-feeds"; // lib/storage/db.ts
export const PREFS_KEY = "firefly.feeds.v1"; // lib/storage/prefs.ts
```

**Do not rename either.** They are not decorative: `DB_NAME` is how the browser
finds your subscriptions, cached bodies and read flags, and `PREFS_KEY` is how
the pre-paint script finds the theme. Change one and the app opens an empty store
and looks like it forgot everything.

If a rename is ever genuinely necessary it is a migration, not a
find-and-replace: copy the old database into the new one in a single
transaction, carry the prefs across before removing the old key, and keep reading
the old names as a fallback. The app is live, so this is a real obligation rather
than a hypothetical — existing installs hold subscriptions and read state, and a
rename or shape change has to carry them across.

The two use different conventions deliberately. An IndexedDB name is a top-level
resource, listed in DevTools beside every other site's, so it takes the
kebab-case of the package: `firefly-feeds`. A localStorage key is a flat
namespace shared with anything else on the origin, so it takes the dotted,
versioned form: `firefly.feeds.v1`.

## Six stores, six lifetimes

The mistake a reader's storage usually makes is keeping these in one record.

| Store             | Holds                            | Size                          | Synced?                                       |
| ----------------- | -------------------------------- | ----------------------------- | --------------------------------------------- |
| `sources`         | the subscription registry        | tiny, durable, low write rate | **yes**                                       |
| `reading`         | read / saved / later per article | tiny, high write rate         | **yes** — and the most valuable thing you own |
| `articles`        | cached bodies                    | large, disposable             | **never**                                     |
| `topics`          | the reader's article topics      | tiny, durable                 | **yes**                                       |
| `classifications` | one topic per story              | small, low write rate         | **yes**                                       |
| `digests`         | one edition of Today's briefing  | tiny, derived                 | **never**                                     |
| `meta`            | the seeding flag                 | —                             | no                                            |

Cached prose is re-fetchable; your reading state is not. Keeping them apart means
a future sync uploads a few kilobytes of state rather than megabytes of somebody
else's writing, and a new device re-fetches instead of downloading a corpus.

**Article classification is user state, not cache.** A topic the classifier
guessed and a topic the reader corrected both belong to the reader, and the
correction is worth carrying to another device — so they live in `topics` and
`classifications`, never on the disposable `articles` record. That also means a
source refresh, which rewrites the article cache wholesale, can never touch
them. Removing a topic or a classification is a tombstone, like every other
mutable record, so the removal can replicate.

**`articles` is a cache with an eviction rule: anything saved or queued is
exempt** (`replaceArticles(sourceId, items, keep)`). Pruning can never remove
something you deliberately kept.

**`digests` is derived state, not user state.** A briefing is written again from
stories the device already has, so it is worth keeping between sessions and not
worth replicating: a new device writes its own edition rather than downloading
somebody else's prose. It is keyed by the reader's own calendar day and written
over the previous edition for that day — no tombstone, because there is nothing
to propagate.

## Why IndexedDB, and why localStorage survives anyway

localStorage is synchronous, string-only, capped at about 5MB, and has no
indexes — so every write serialises the whole corpus on the main thread, and
reading one source means parsing all of them. IndexedDB gives asynchronous
writes, structured records, real indexes (articles are queried by `sourceId`),
transactions, and a quota measured as a fraction of free disk.

**One thing stays in localStorage**: `firefly.feeds.v1`, holding a handful of
scalars and no article content.

```ts
type Prefs = {
  theme?: "light" | "dark";
  font?: number; // reader text size, 0-3
  navOpen?: boolean;
  view?: ViewId; // which column you were last in
  classify?: boolean; // article classification, opt-in
  classifyConfig?: ClassifyConfig; // the reader's classifier, and its key
  digest?: boolean; // Today's briefing, opt-in
  llmConfig?: LlmConfig; // the reader's model, and its key
  digestRuns?: { day: string; count: number }; // manual rewrites used today
};
```

The colour scheme is read by an inline script in `<head>` **before first paint**,
and IndexedDB is asynchronous — reading it there would flash the wrong theme on
every load. That is a deliberate exception, not an oversight: this blob never
holds article content.

> **Prefs are written only after the store has finished loading.** Until then
> the app is holding defaults, and persisting them would write those defaults
> over whatever is actually stored.

## Records are shaped for replication

Every mutable record carries `updatedAt`, and deletions are **tombstones**
(`deletedAt`) rather than removals, so a delete can propagate. Ids derive from
stable inputs — `sourceId` from `hash(feedUrl)`, and `itemId` from the
publisher's own id (Atom `<id>`, RSS `<guid>`), then the article URL, then the
title and published time — so two devices agree on identity without
coordination, and a feed that renumbers its entries does not renumber ours. The
article's URL is a separate field, used only to fetch the original.

Cached bodies also carry when the original page was last fetched and last
checked, its `etag` and `lastModified`, and the `extractorVersion` that produced
the body. These are additive optional fields: an older record simply reads as
“never checked / older extractor” and is fetched on open, so the evolution needs
no migration and never clears a store.

The repository exposes the two primitives a sync client needs:

```ts
changesSince(watermark)   → { sources, reading, topics, classifications } // since
mergeChangeset(changeset) → void                   // last write wins, ties → deletion
```

They are unused by the interface today and are not dead code — they are the
contract. `articles` is absent from both by design, because cached bodies are
re-fetchable rather than user data, and `digests` is absent for the same reason:
a briefing is written again from what a device already has. `topics` and
`classifications` are present for the same reason `reading` is: they are the
reader's own, not a cache.

Conflict resolution is deliberately **last-write-wins on a single timestamp**:
correct enough for read flags, and honest about not being a CRDT.

## Failure

If IndexedDB is unavailable — private mode, storage disabled — `loadAll()`
rejects, the shell logs it once and continues with an empty snapshot. The reading
experience still works; it simply does not remember anything.

## Verified by tests

`lib/storage/repository.test.ts` opens a real database. Its `freshRepository()`
helper closes the previous connection, resets the module registry and deletes the
store — all three are needed, because the module memoises its connection and the
database outlives the module graph. Reuse it rather than writing new setup.

The suite covers seeding, cache eviction with the `keep` exemption, tombstones,
and the last-write-wins and tie-break rules. Schema changes so far have been
additive optional fields, which need no migration — `lib/refreshing.ts` treats a
missing freshness field as “never checked”. A future change that moves or
renames data belongs here, tested against a store that already holds it.
