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

### The storage keys are frozen

```ts
const DB_NAME = "firefly"; // lib/storage/db.ts
export const PREFS_KEY = "firefly.reader.v1"; // lib/storage/prefs.ts
```

**These still say "firefly.reader" and must keep saying it**, even though the
product is called Firefly Feeds. They are not names, they are addresses:

- renaming `DB_NAME` orphans every subscription, cached body and read flag;
- renaming `PREFS_KEY` loses the theme, text size and last view — and breaks the
  v0 migration, which reads that exact key to recover read/saved/later.

Nothing user-facing depends on them. Leave them alone.

**Nothing above `lib/storage/` imports `idb` or mentions IndexedDB.** A remote
adapter, or SQLite on a server for real cross-device sync, is a change to one
directory rather than a rewrite.

## Three stores, three lifetimes

The mistake a reader's storage usually makes is keeping these in one record.

| Store      | Holds                            | Size                          | Synced?                                       |
| ---------- | -------------------------------- | ----------------------------- | --------------------------------------------- |
| `sources`  | the subscription registry        | tiny, durable, low write rate | **yes**                                       |
| `reading`  | read / saved / later per article | tiny, high write rate         | **yes** — and the most valuable thing you own |
| `articles` | cached bodies                    | large, disposable             | **never**                                     |
| `meta`     | seeding and migration flags      | —                             | no                                            |

Cached prose is re-fetchable; your reading state is not. Keeping them apart means
a future sync uploads a few kilobytes of state rather than megabytes of somebody
else's writing, and a new device re-fetches instead of downloading a corpus.

**`articles` is a cache with an eviction rule: anything saved or queued is
exempt** (`replaceArticles(sourceId, items, keep)`). Pruning can never remove
something you deliberately kept.

## Why IndexedDB, and why localStorage survives anyway

localStorage is synchronous, string-only, capped at about 5MB, and has no
indexes — so every write serialises the whole corpus on the main thread, and
reading one source means parsing all of them. IndexedDB gives asynchronous
writes, structured records, real indexes (articles are queried by `sourceId`),
transactions, and a quota measured as a fraction of free disk.

**One thing stays in localStorage**: `firefly.reader.v1`, holding exactly four
scalars.

```ts
type Prefs = {
  theme?: "light" | "dark";
  font?: number; // reader text size, 0-3
  navOpen?: boolean;
  view?: ViewId; // which column you were last in
};
```

The colour scheme is read by an inline script in `<head>` **before first paint**,
and IndexedDB is asynchronous — reading it there would flash the wrong theme on
every load. That is a deliberate exception, not an oversight: this blob never
holds article content.

> **Prefs are written only after the store has finished loading.** Until then
> the app is holding defaults, and persisting them would overwrite whatever the
> migration is still reading.

## Records are shaped for replication

Every mutable record carries `updatedAt`, and deletions are **tombstones**
(`deletedAt`) rather than removals, so a delete can propagate. Ids derive from
stable inputs — `sourceId` from `hash(feedUrl)`, an article from
`${sourceId}~${itemId}` — so two devices agree on identity without
coordination.

The repository exposes the two primitives a sync client needs:

```ts
changesSince(watermark)   → { sources, reading }   // everything mutated since
mergeChangeset(changeset) → void                   // last write wins, ties → deletion
```

They are unused by the interface today and are not dead code — they are the
contract. `articles` is absent from both by design, because cached bodies are
re-fetchable rather than user data.

Conflict resolution is deliberately **last-write-wins on a single timestamp**:
correct enough for read flags, and honest about not being a CRDT.

## Migration

A v0 install is folded in on first open. Both legacy localStorage blobs are read
_purely_ — nothing is mutated during the read — written into the new stores in a
single transaction, and only then is the legacy data discarded. A failed upgrade
can never lose the original.

Afterwards the legacy blob keeps serving the pre-paint theme, with the migrated
buckets stripped out.

## Failure

If IndexedDB is unavailable — private mode, storage disabled — `loadAll()`
rejects, the shell logs it once and continues with an empty snapshot. The reading
experience still works; it simply does not remember anything.

## Verified by tests

`lib/storage/repository.test.ts` opens a real database. Its `freshRepository()`
helper closes the previous connection, resets the module registry and deletes the
store — all three are needed, because the module memoises its connection and the
database outlives the module graph. Reuse it rather than writing new setup.

The suite covers the v0 migration (including that it prefers real flags over the
curated demo state, and that it does not run twice), cache eviction with the
`keep` exemption, tombstones, and the last-write-wins and tie-break rules.
