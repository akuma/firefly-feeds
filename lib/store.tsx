"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Edition } from "./edition";
import { readingTime } from "./reading";
import {
  articlesUnchanged,
  EXTRACTOR_VERSION,
  needsArticleRefresh,
  reconcileArticles,
  STALE_MS,
  staleSourceIds,
  type IncomingItem,
} from "./refreshing";
import { SAMPLE_FEEDS, SAMPLE_STORIES } from "./sample";
import { FOLDERS, SUGGESTED_BY_ID, SUGGESTED_SOURCES, type SuggestedSource } from "./sources";
import { feedFromSource, readingFlags, storyFromArticle } from "./shaping";
import * as repo from "./storage/repository";
import { loadPrefs, savePrefs } from "./storage/prefs";
import type { ArticleRecord, ReadingRecord, SourceRecord } from "./storage/types";
import type { Feed, FeedId, FolderId, Story, ViewId } from "./types";
/**
 * The theme is written by an inline boot script before React hydrates, so the
 * first apply pass must run before paint to avoid a light-mode flash.
 */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* ------------------------------------------------------------------ types */

export type State = {
  read: Record<string, boolean>;
  saved: Record<string, boolean>;
  later: Record<string, boolean>;
};

export type ReaderFont = 0 | 1 | 2 | 3;

export type SubscribeInput = {
  id: string;
  title: string;
  host: string;
  feedUrl: string;
  siteUrl: string;
  /** Absent when the reader subscribes without filing it under a folder. */
  folder?: FolderId;
  items: IncomingItem[];
};

type Ctx = {
  ready: boolean;
  edition: Edition;
  /** True while the invented sample edition is standing in for real sources. */
  sample: boolean;
  suggested: SuggestedSource[];
  /** Open the subscribe dialog with a source already queued up. */
  suggest: (id: string) => void;
  /** Set when a suggestion was clicked, so the dialog can file it correctly. */
  pendingSource: SuggestedSource | null;
  clearPendingSource: () => void;
  stories: Story[];
  story: (id: string) => Story | undefined;
  feeds: Feed[];
  feedById: (id: FeedId) => Feed | undefined;
  /** Canonical URL for a story: its own link, else its source's site. */
  originalUrl: (story: Story) => string | undefined;
  /** The article's own URL, or nothing for a feed-native entry. */
  articleUrl: (story: Story) => string | undefined;
  /** Canonical URL for whatever the reader currently has open. */
  currentUrl: () => string | undefined;

  sources: SourceRecord[];
  subscribe: (input: SubscribeInput) => Promise<void>;
  unsubscribe: (id: string) => Promise<void>;
  /**
   * Rename a source, re-file it, and/or point it at a different feed URL.
   * `folder: null` leaves it unfiled; a changed URL is fetched immediately.
   */
  editSource: (
    id: string,
    patch: { name: string; folder: FolderId | null; feedUrl?: string },
  ) => Promise<void>;
  /** Sources with a refresh in flight; per-row spinners key off this set. */
  refreshing: ReadonlySet<string>;
  refresh: (id: string) => Promise<void>;
  /** Refresh every stale source; force refreshes even recently fetched ones. */
  refreshAll: (options?: { force?: boolean }) => Promise<void>;

  /** The story whose full text is being fetched, if any. */
  extracting: string | null;

  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  /** The source whose name and folder are being edited, if any. */
  editingId: FeedId | null;
  setEditingId: (id: FeedId | null) => void;

  state: State;
  toggle: (kind: keyof State, id: string) => void;
  markRead: (id: string) => void;
  markAllRead: (ids: string[]) => void;

  view: ViewId;
  setView: (v: ViewId) => void;
  query: string;
  setQuery: (q: string) => void;
  streamFilter: "all" | "unread";
  setStreamFilter: (f: "all" | "unread") => void;
  filtered: Story[];
  /** The story `j` and "Next up" would open from the one on screen. */
  upNext: Story | undefined;

  selectedId: string;
  select: (id: string) => void;
  step: (dir: 1 | -1) => void;
  /** Scroll the reading pane. Owns the arrow keys, wherever they are pressed. */
  scrollReading: (direction: 1 | -1) => void;
  registerReaderScroll: (element: HTMLDivElement | null) => void;

  counts: {
    all: number;
    today: number;
    saved: number;
    later: number;
    folders: Record<FolderId, number>;
    feeds: Record<FeedId, number>;
  };
  todayMinutes: number;
  todayTotal: number;

  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  immersive: boolean;
  setImmersive: (v: boolean) => void;
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  font: ReaderFont;
  setFont: (f: ReaderFont) => void;

  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
  toggleShortcuts: () => void;

  mobileReading: boolean;
  setMobileReading: (v: boolean) => void;
  mobileFeeds: boolean;
  setMobileFeeds: (v: boolean) => void;
};

const ReaderContext = createContext<Ctx | null>(null);

export function useReader(): Ctx {
  const ctx = useContext(ReaderContext);
  if (!ctx) throw new Error("useReader must be used inside <ReaderProvider>");
  return ctx;
}

/* --------------------------------------------------------------- provider */

const FONT_SIZES = ["17.5px", "19.5px", "21.5px", "23.5px"];
const FONT_LEADING = ["1.8", "1.76", "1.72", "1.66"];
const MAX_ARTICLES = 20;

export function useReaderState(edition: Edition): Ctx {
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  /** The story whose full text is being fetched, if any. */
  const [extracting, setExtracting] = useState<string | null>(null);
  const [reading, setReading] = useState<ReadingRecord[]>([]);

  const [view, setViewRaw] = useState<ViewId>("today");
  const [query, setQuery] = useState("");
  const [streamFilter, setStreamFilter] = useState<"all" | "unread">("unread");
  const [selectedId, setSelectedId] = useState("quiet-return");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [immersive, setImmersive] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [font, setFont] = useState<ReaderFont>(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileReading, setMobileReading] = useState(false);
  const [mobileFeeds, setMobileFeeds] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<FeedId | null>(null);
  const [pendingSource, setPendingSource] = useState<SuggestedSource | null>(null);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  // Sources currently being fetched, so a second trigger (manual + scheduled)
  // never issues the same request twice.
  const refreshingIds = useRef(new Set<string>());
  // Last automatic-attempt time per source. A failed fetch leaves fetchedAt
  // untouched, so without this the sweep would retry a dead feed on every tick.
  const lastAttempt = useRef(new Map<string, number>());
  // relative timestamps for fetched stories need a clock, not a constant
  const [now, setNow] = useState(() => Date.now());
  const readerScroll = useRef<HTMLDivElement | null>(null);

  const shapedOwnNav = useRef(false);

  /* ------------------------------------------------------- load once */

  useBeforePaint(() => {
    const prefs = loadPrefs();
    if (prefs.font !== undefined) setFont(prefs.font as ReaderFont);
    if (prefs.theme) setTheme(prefs.theme);
    shapedOwnNav.current = typeof prefs.navOpen === "boolean";
    if (typeof prefs.navOpen === "boolean") setNavOpen(prefs.navOpen);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let snapshot: repo.Snapshot = { sources: [], articles: [], reading: [] };
      try {
        snapshot = await repo.loadAll();
      } catch (error) {
        // IndexedDB can be unavailable (private mode, disabled storage). The
        // edition still reads; it just will not remember anything.
        console.error("[firefly] storage unavailable — running without persistence", error);
      }
      if (cancelled) return;
      setSources(snapshot.sources.toSorted(byAddedDesc));
      setArticles(snapshot.articles);
      setReading(snapshot.reading);

      // A remembered view is restored only if its source still exists.
      const remembered = loadPrefs().view;
      if (remembered) {
        const feedId = remembered.startsWith("feed:") ? remembered.slice(5) : "";
        const known =
          remembered === "all" ||
          remembered === "today" ||
          remembered === "saved" ||
          remembered === "later" ||
          remembered.startsWith("folder:") ||
          (!!feedId &&
            (SAMPLE_FEEDS.some((f) => f.id === feedId) ||
              snapshot.sources.some((s) => s.id === feedId)));
        if (known) setViewRaw(remembered);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * Prefs are written only once loading has finished. Before that the app is
   * holding defaults, and persisting them would write those over whatever is
   * actually stored.
   */
  useEffect(() => {
    if (!ready) return;
    savePrefs({ theme, font, navOpen, view });
  }, [ready, theme, font, navOpen, view]);

  /* ------------------------------------------------------ derive views */

  /*
   * The sample edition stands in only while the reader has subscribed to
   * nothing. The moment a real source exists it disappears, so invented
   * stories can never mix with real ones.
   */
  const sample = ready && sources.length === 0;

  const feeds = useMemo<Feed[]>(
    () => [...(sample ? SAMPLE_FEEDS : []), ...sources.map(feedFromSource)],
    [sample, sources],
  );

  const feedIndex = useMemo(() => {
    const map = new Map<FeedId, Feed>();
    for (const feed of feeds) map.set(feed.id, feed);
    return map;
  }, [feeds]);

  const feedById = useCallback((id: FeedId) => feedIndex.get(id), [feedIndex]);

  const state = useMemo(() => readingFlags(reading), [reading]);

  const stories = useMemo<Story[]>(
    () =>
      [
        ...articles.map((a) => storyFromArticle(a, now)),
        ...(sample ? SAMPLE_STORIES : []),
      ].toSorted((a, b) => a.minutesAgo - b.minutesAgo),
    [articles, now, sample],
  );

  /**
   * The article's own URL — the one an original page can be fetched from, and
   * the one Open original points at. Deliberately separate from the source's
   * homepage: a feed-native entry has no original, and a homepage is not it.
   */
  const articleUrl = useCallback((target: Story) => target.link, []);

  /**
   * The best URL for source-level links: the article when there is one, else
   * the publication's own site. Sample stories are invented, so they return
   * nothing — a plausible homepage would imply the piece exists there.
   */
  const originalUrl = useCallback(
    (target: Story) => {
      if (target.link) return target.link;
      const feed = feedIndex.get(target.feedId);
      if (feed?.sample) return undefined;
      if (feed?.siteUrl) return feed.siteUrl;
      if (feed?.host) return `https://${feed.host}`;
      return undefined;
    },
    [feedIndex],
  );

  const suggest = useCallback((id: string) => {
    const source = SUGGESTED_BY_ID.get(id);
    if (!source) return;
    // the folder travels with the suggestion, so a news feed is not filed
    // under whatever the dialog happened to default to
    setPendingSource(source);
    setAddOpen(true);
  }, []);

  const clearPendingSource = useCallback(() => setPendingSource(null), []);

  /* ------------------------------------------------------------ reading */

  const persistReading = useCallback((records: ReadingRecord[]) => {
    setReading((current) => {
      const map = new Map(current.map((r) => [r.id, r]));
      for (const record of records) map.set(record.id, record);
      return [...map.values()];
    });
    void repo.putReadingMany(records);
  }, []);

  const patchReading = useCallback(
    (ids: string[], patch: (record: ReadingRecord) => ReadingRecord) => {
      const at = Date.now();
      const byId = new Map(reading.map((r) => [r.id, r]));
      const next: ReadingRecord[] = [];
      for (const id of ids) {
        const existing = byId.get(id) ?? { id, updatedAt: at };
        next.push({ ...patch(existing), id, updatedAt: at });
      }
      persistReading(next);
    },
    [reading, persistReading],
  );

  const toggle = useCallback(
    (kind: keyof State, id: string) => {
      patchReading([id], (record) => ({ ...record, [kind]: !record[kind] }));
    },
    [patchReading],
  );

  const markRead = useCallback(
    (id: string) => {
      const existing = reading.find((r) => r.id === id);
      if (existing?.read) return;
      // The first real story can be displayed through `activeId` while the raw
      // selection still holds the sample id. Anchor the story being credited
      // before Unread removes it, so the fallback cannot advance the reader.
      setSelectedId(id);
      patchReading([id], (record) => ({ ...record, read: true }));
    },
    [reading, patchReading],
  );

  const markAllRead = useCallback(
    (ids: string[]) => {
      const unread = ids.filter((id) => !reading.find((r) => r.id === id)?.read);
      if (unread.length) patchReading(unread, (record) => ({ ...record, read: true }));
    },
    [reading, patchReading],
  );

  /* ------------------------------------------------------------ sources */

  const reloadSource = useCallback(async (id: string) => {
    const [source, items] = await Promise.all([repo.getSource(id), repo.getArticles(id)]);
    setSources((current) => {
      const next = current.filter((s) => s.id !== id);
      return source && !source.deletedAt ? [...next, source].toSorted(byAddedDesc) : next;
    });
    setArticles((current) => [...current.filter((a) => a.sourceId !== id), ...items]);
  }, []);

  const subscribe = useCallback(
    async (input: SubscribeInput) => {
      const at = Date.now();
      const source: SourceRecord = {
        id: input.id,
        url: input.feedUrl,
        siteUrl: input.siteUrl,
        title: input.title,
        host: input.host,
        addedAt: at,
        fetchedAt: at,
        error: null,
        updatedAt: at,
      };
      if (input.folder) source.folder = input.folder;
      const items = reconcileArticles(input.id, input.items.slice(0, MAX_ARTICLES), [], at);

      await repo.putSource(source);
      await repo.replaceArticles(input.id, items);
      await reloadSource(input.id);

      setNow(Date.now());
      setViewRaw(`feed:${input.id}`);
      setQuery("");
      setMobileFeeds(false);
    },
    [reloadSource],
  );

  const unsubscribe = useCallback(async (id: string) => {
    await repo.removeSource(id);
    setSources((current) => current.filter((s) => s.id !== id));
    setArticles((current) => current.filter((a) => a.sourceId !== id));
    setViewRaw((current) => (current === `feed:${id}` ? "today" : current));
  }, []);

  /*
   * Refresh reads the latest sources/reading through refs so that the scheduled
   * sweep and a manual press share one implementation without stale closures.
   */
  const sourcesRef = useRef(sources);
  const readingRef = useRef(reading);
  // refs are synced after commit, never written during render
  useEffect(() => {
    sourcesRef.current = sources;
    readingRef.current = reading;
  });

  const refreshSource = useCallback(
    async (id: string, override?: SourceRecord) => {
      if (refreshingIds.current.has(id)) return;
      const source = override ?? sourcesRef.current.find((s) => s.id === id);
      if (!source || source.deletedAt) return;
      refreshingIds.current.add(id);
      setRefreshing((current) => new Set(current).add(id));
      try {
        const res = await fetch(`/api/feed?url=${encodeURIComponent(source.url)}&full=1`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error ?? "failed");

        const at = Date.now();
        const cachedArticles = await repo.getArticles(id);
        const items = reconcileArticles(
          id,
          (data.items as IncomingItem[]).slice(0, MAX_ARTICLES),
          cachedArticles,
          at,
        );

        // The source fetch itself succeeded, so its watermark always advances;
        // the article cache is rewritten only when the feed actually changed,
        // which is what keeps an unchanged "refresh all" off the screen. The
        // feed's own metadata is authoritative after a URL edit.
        const feed = data.feed as { host?: string; siteUrl?: string } | undefined;
        const refreshedSource = {
          ...source,
          ...(feed?.host ? { host: feed.host } : {}),
          ...(feed?.siteUrl ? { siteUrl: feed.siteUrl } : {}),
          fetchedAt: at,
          error: null,
          updatedAt: at,
        };
        await repo.putSource(refreshedSource);
        if (articlesUnchanged(cachedArticles, items)) {
          setSources((current) => current.map((s) => (s.id === id ? refreshedSource : s)));
        } else {
          // anything the reader kept is exempt from cache eviction
          const keep = new Set(
            readingRef.current.filter((r) => r.saved || r.later).map((r) => r.id),
          );
          await repo.replaceArticles(id, items, keep);
          await reloadSource(id);
          setNow(Date.now());
        }
      } catch (error) {
        const latest = override ?? sourcesRef.current.find((s) => s.id === id);
        if (latest) {
          await repo.putSource({
            ...latest,
            error: error instanceof Error ? error.message : "failed",
            updatedAt: Date.now(),
          });
          await reloadSource(id);
        }
      } finally {
        lastAttempt.current.set(id, Date.now());
        refreshingIds.current.delete(id);
        setRefreshing((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [reloadSource],
  );

  const refresh = useCallback((id: string) => refreshSource(id), [refreshSource]);

  /*
   * Editing a source is mostly metadata, but a changed feed URL has to take
   * effect: the new address is fetched straight away, so the reader sees the
   * feed it just pointed at rather than yesterday's entries under a new URL.
   */
  const editSource = useCallback(
    async (id: string, patch: { name: string; folder: FolderId | null; feedUrl?: string }) => {
      const source = sources.find((s) => s.id === id);
      if (!source) return;
      const next: SourceRecord = {
        ...source,
        // an empty field is not a name; keeping the old one is the lesser surprise
        title: patch.name.trim() || source.title,
        updatedAt: Date.now(),
      };
      if (patch.folder) next.folder = patch.folder;
      else delete next.folder;

      const requested = patch.feedUrl?.trim();
      const urlChanged = Boolean(requested) && requested !== source.url;
      if (requested && urlChanged) {
        next.url = requested;
        // Host is display-only and the fetch below corrects it and the site URL.
        try {
          next.host = new URL(requested).hostname.replace(/^www\./, "");
        } catch {
          /* a malformed address is rejected by the fetch that follows */
        }
      }

      await repo.putSource(next);
      await reloadSource(id);
      if (urlChanged) await refreshSource(id, next);
    },
    [sources, reloadSource, refreshSource],
  );

  /*
   * The scheduled sweep. Sources are fetched one at a time — a personal reader
   * has no reason to hammer the publishers, and the intake route rate-limits by
   * address. A forced sweep is what the manual button asks for.
   */
  const refreshAll = useCallback(
    async (options?: { force?: boolean }) => {
      const at = Date.now();
      const ids = options?.force
        ? sourcesRef.current.filter((s) => !s.deletedAt).map((s) => s.id)
        : staleSourceIds(sourcesRef.current, at).filter(
            (id) => at - (lastAttempt.current.get(id) ?? 0) >= STALE_MS,
          );
      // serial on purpose: a personal reader fetches politely, one publisher
      // at a time, and the intake route rate-limits per address
      /* oxlint-disable no-await-in-loop */
      for (const id of ids) {
        await refreshSource(id);
      }
      /* oxlint-enable no-await-in-loop */
    },
    [refreshSource],
  );

  /*
   * Opening the edition must not present yesterday's copy as today's. Once after
   * load, and then whenever the tab comes back or the staleness window elapses,
   * stale sources are re-fetched in the background. The existing stories stay on
   * screen until replacements arrive.
   */
  const initialSweep = useRef(false);
  useEffect(() => {
    if (!ready || initialSweep.current) return;
    initialSweep.current = true;
    void refreshAll();
  }, [ready, refreshAll]);

  useEffect(() => {
    if (!ready) return;
    const sweepIfVisible = () => {
      if (!document.hidden) void refreshAll();
    };
    const timer = window.setInterval(sweepIfVisible, STALE_MS);
    document.addEventListener("visibilitychange", sweepIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sweepIfVisible);
    };
  }, [ready, refreshAll]);

  /* ------------------------------------------------------------- filter */

  /*
   * The column, before and after the Unread filter.
   *
   * `listed` is what the current view, search and collections admit; `filtered`
   * is what the column actually shows. The reader needs both: marking the open
   * story read removes it from the Unread column, and the pane still has to know
   * the story belongs to the view so it is not yanked to the next one.
   */
  const { filtered, listed } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = stories;
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.dek.toLowerCase().includes(q) ||
          (feedIndex.get(s.feedId)?.name ?? "").toLowerCase().includes(q),
      );
    } else if (view === "today") {
      list = list.filter((s) => s.minutesAgo < 60 * 24);
    } else if (view === "saved") {
      list = list.filter((s) => state.saved[s.id]);
    } else if (view === "later") {
      list = list.filter((s) => state.later[s.id]);
    } else if (view.startsWith("folder:")) {
      const id = view.slice(7) as FolderId;
      list = list.filter((s) => feedIndex.get(s.feedId)?.folder === id);
    } else if (view.startsWith("feed:")) {
      const id = view.slice(5) as FeedId;
      list = list.filter((s) => s.feedId === id);
    }
    const column = list.toSorted((a, b) => a.minutesAgo - b.minutesAgo);
    const visible = streamFilter === "unread" ? column.filter((s) => !state.read[s.id]) : column;
    return { filtered: visible, listed: column };
  }, [stories, view, query, state.saved, state.later, state.read, streamFilter, feedIndex]);

  const story = useCallback((id: string) => stories.find((s) => s.id === id), [stories]);

  /* ------------------------------------------------------------ counts */

  const counts = useMemo(() => {
    const folders = {} as Record<FolderId, number>;
    for (const f of FOLDERS) folders[f.id] = 0;
    const feedCounts = {} as Record<FeedId, number>;

    let all = 0;
    let today = 0;
    let saved = 0;
    let later = 0;
    for (const s of stories) {
      if (!state.read[s.id]) {
        all += 1;
        feedCounts[s.feedId] = (feedCounts[s.feedId] ?? 0) + 1;
        const folder = feedIndex.get(s.feedId)?.folder;
        if (folder) folders[folder] += 1;
        if (s.minutesAgo < 60 * 24) today += 1;
      }
      // Saved and Later list everything in those collections, so the badge
      // counts must match what the column actually shows.
      if (state.saved[s.id]) saved += 1;
      if (state.later[s.id]) later += 1;
    }
    return { all, today, saved, later, folders, feeds: feedCounts };
  }, [stories, state, feedIndex]);

  const { todayMinutes, todayTotal } = useMemo(() => {
    const todays = stories.filter((s) => s.minutesAgo < 60 * 24);
    return {
      todayMinutes: todays.reduce((n, s) => n + readingTime(s.body), 0),
      todayTotal: todays.length,
    };
  }, [stories]);

  /* ----------------------------------------------------------- routing */

  const toggleShortcuts = useCallback(() => setShortcutsOpen((open) => !open), []);

  /*
   * Arrow keys scroll the article rather than moving between stories.
   *
   * The reading surface is the product, and arrows are the keys people reach
   * for while reading a page — binding them to "next story" meant a long piece
   * could not be scrolled from the keyboard at all. `j` and `k` are the
   * navigation keys, and they always mean the same thing in every mode.
   */
  const registerReaderScroll = useCallback((element: HTMLDivElement | null) => {
    readerScroll.current = element;
  }, []);

  const scrollReading = useCallback((direction: 1 | -1) => {
    // roughly three lines at the default text size: enough to feel like a step,
    // small enough to keep your place
    readerScroll.current?.scrollBy({ top: direction * 90 });
  }, []);

  const setView = useCallback((v: ViewId) => {
    setViewRaw(v);
    setQuery("");
    setMobileFeeds(false);
  }, []);

  /*
   * When the visible column changes underneath the reader — a new view, a
   * filter, a search — the open story follows it rather than lingering on
   * something that is no longer listed. This is derived rather than corrected
   * in an effect, so there is no second render pass and no flash of the wrong
   * article. Selection only: nothing is silently marked read by a view switch.
   */
  const activeId = useMemo(() => {
    if (filtered.some((candidate) => candidate.id === selectedId)) return selectedId;
    /*
     * A story leaves the column for two different reasons. A changed column —
     * another view, a search, a collection toggle — carries the reader with it.
     * Being marked read under the Unread filter does not: the reader is still on
     * the page, and moving them to another story is the jump this avoids.
     * `listed` is the column minus the Unread filter, so membership there tells
     * the two apart.
     */
    if (listed.some((candidate) => candidate.id === selectedId)) return selectedId;
    return filtered[0]?.id ?? selectedId;
  }, [filtered, listed, selectedId]);

  const currentStory = useMemo(() => stories.find((s) => s.id === activeId), [stories, activeId]);

  /*
   * Original page, on demand and stale-while-revalidate.
   *
   * With an article URL the original is the preferred body: opening a story
   * shows whatever is cached immediately and, in the background, fetches or
   * revalidates it. A first fetch is what the reader is waiting for, so it
   * updates the open story; a revalidation only writes storage, because
   * replacing the body underneath a reader would move their place. Without an
   * article URL there is nothing to fetch and the feed body is canonical.
   */
  const extractingRef = useRef(new Set<string>());
  // A body that was revalidated while the reader was elsewhere. The article is
  // not disturbed mid-read; the newer body is swapped in the next time it is
  // opened, which is the whole point of revalidating in the background.
  const pendingBodies = useRef(new Map<string, ArticleRecord>());

  const loadArticle = useCallback(async (record: ArticleRecord) => {
    const url = record.link;
    if (!url) return;
    // A fresh body from the current extractor is revalidated. Anything else —
    // never fetched, produced by an older extractor, or a legacy record with
    // no version at all — is fetched as if for the first time, so the open
    // copy is allowed to change.
    const revalidation =
      typeof record.contentFetchedAt === "number" && record.extractorVersion === EXTRACTOR_VERSION;
    extractingRef.current.add(record.id);
    if (!revalidation) setExtracting(record.id);

    const at = Date.now();
    const params = new URLSearchParams({ url });
    // Conditional GET is only useful when the cached body came from this same
    // extractor. After a version bump the page may be unchanged while the body
    // still has to be rebuilt, and a `304` would leave no HTML to rebuild from.
    if (revalidation) {
      if (record.etag) params.set("etag", record.etag);
      else if (record.lastModified) params.set("lastModified", record.lastModified);
    }
    // The source's own title, so the page can trim a site name it glued to the
    // headline (“Article - Site”).
    const sourceTitle = sourcesRef.current.find((s) => s.id === record.sourceId)?.title;
    if (sourceTitle) params.set("site", sourceTitle);

    try {
      const res = await fetch(`/api/article?${params.toString()}`);
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "failed");

      if (data.notModified) {
        await repo.putArticle({ ...record, contentCheckedAt: at });
        setArticles((current) =>
          current.map((a) => (a.id === record.id ? { ...a, contentCheckedAt: at } : a)),
        );
        return;
      }

      const article = data.article as {
        title?: string;
        author?: string;
        blocks: ArticleRecord["body"];
        truncated?: boolean;
        image?: string;
        hasCover?: boolean;
        imageCaption?: string;
        videoPage?: boolean;
        etag?: string;
        lastModified?: string;
      };
      const next: ArticleRecord = {
        ...record,
        title: article.title || record.title,
        author: article.author || record.author,
        body: article.blocks,
        image: article.image ?? record.image,
        hasCover: article.hasCover ?? record.hasCover,
        imageCaption: article.imageCaption ?? record.imageCaption,
        videoPage: article.videoPage ?? record.videoPage,
        // Only a body that was not cut by our own budget may call itself full.
        contentState: article.truncated ? "truncated" : "full",
        extractionState: "success",
        contentFetchedAt: at,
        contentCheckedAt: at,
        etag: article.etag ?? record.etag,
        lastModified: article.lastModified ?? record.lastModified,
        extractorVersion: EXTRACTOR_VERSION,
      };
      await repo.putArticle(next);
      if (revalidation) {
        pendingBodies.current.set(next.id, next);
        setArticles((current) =>
          current.map((a) =>
            a.id === next.id
              ? { ...a, contentCheckedAt: at, etag: next.etag, lastModified: next.lastModified }
              : a,
          ),
        );
      } else {
        setArticles((current) => current.map((a) => (a.id === next.id ? next : a)));
      }
    } catch {
      // A failure keeps whatever body is already there. The checked time moves,
      // so the retry window — not a permanent lockout — decides the next try.
      const hasOriginal = typeof record.contentFetchedAt === "number";
      await repo.putArticle({
        ...record,
        extractionState: hasOriginal ? record.extractionState : "failed",
        contentCheckedAt: at,
        // Stamp the attempt so a version change does not retrigger every render.
        extractorVersion: EXTRACTOR_VERSION,
      });
      setArticles((current) =>
        current.map((a) =>
          a.id === record.id
            ? {
                ...a,
                extractionState: hasOriginal ? a.extractionState : "failed",
                contentCheckedAt: at,
                extractorVersion: EXTRACTOR_VERSION,
              }
            : a,
        ),
      );
    } finally {
      extractingRef.current.delete(record.id);
      setExtracting((current) => (current === record.id ? null : current));
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const record = articles.find((a) => a.id === activeId);
    if (!record || !record.link) return;
    if (extractingRef.current.has(record.id)) return;
    if (!needsArticleRefresh(record, Date.now())) return;
    // Starting the fetch is the effect's job; the spinner is its visible state.
    /* oxlint-disable-next-line react/set-state-in-effect */
    void loadArticle(record);
  }, [ready, activeId, articles, loadArticle]);

  useEffect(() => {
    const pending = pendingBodies.current.get(activeId);
    if (!pending) return;
    pendingBodies.current.delete(activeId);
    // Applying a background revalidation when the article is opened again.
    /* oxlint-disable-next-line react/set-state-in-effect */
    setArticles((current) => current.map((a) => (a.id === pending.id ? pending : a)));
  }, [activeId]);

  /*
   * Selecting is not reading. Marking on selection quietly consumes anything
   * you only meant to glance at, and it makes the unread count a record of what
   * you clicked rather than what you read — see `readSignal` in `lib/reading.ts`
   * for the trigger that does set it.
   */
  const select = useCallback((id: string) => setSelectedId(id), []);

  /*
   * The story a step lands on, in the order the column reads.
   *
   * `filtered` is what is visible, but the open story can have dropped out of
   * it — read, under the Unread filter — while `listed` is the column before
   * that filter. Anchoring on `listed` lets a step continue from where the
   * reader actually is instead of restarting at the top.
   */
  const neighbour = useCallback(
    (dir: 1 | -1, fromId: string): Story | undefined => {
      const list = filtered;
      if (!list.length) return undefined;
      const idx = list.findIndex((candidate) => candidate.id === fromId);
      if (idx !== -1) return list[idx + dir];
      const positions = new Map(listed.map((candidate, i) => [candidate.id, i]));
      const anchor = positions.get(fromId);
      if (anchor === undefined) return dir === 1 ? list[0] : list[list.length - 1];
      const inOrder = list.filter((candidate) => {
        const at = positions.get(candidate.id) ?? 0;
        return dir === 1 ? at > anchor : at < anchor;
      });
      return dir === 1 ? inOrder[0] : inOrder[inOrder.length - 1];
    },
    [filtered, listed],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const target = neighbour(dir, activeId);
      if (target) select(target.id);
    },
    [neighbour, activeId, select],
  );

  /** What "Next up" and `j` would open from the story on screen. */
  const upNext = useMemo(() => neighbour(1, activeId), [neighbour, activeId]);

  /* ---------------------------------------------------------- appearance */

  useBeforePaint(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);

  /*
   * Three columns need roughly 1320px to hold a 600px reading measure. Below
   * that the navigation steps aside automatically — unless the reader has
   * already expressed a preference, which we never override.
   */
  useEffect(() => {
    if (shapedOwnNav.current) return;
    // one read of an external system on mount, not a state correction
    // oxlint-disable-next-line react/set-state-in-effect
    if (window.matchMedia("(max-width: 1319px)").matches) setNavOpen(false);
  }, []);

  useBeforePaint(() => {
    const root = document.documentElement;
    root.style.setProperty("--reader-size", FONT_SIZES[font]);
    root.style.setProperty("--reader-leading", FONT_LEADING[font]);
  }, [font]);

  const currentUrl = useCallback(
    () => (currentStory ? originalUrl(currentStory) : undefined),
    [currentStory, originalUrl],
  );

  return {
    ready,
    edition,
    sample,
    suggested: SUGGESTED_SOURCES,
    suggest,
    pendingSource,
    clearPendingSource,
    stories,
    story,
    feeds,
    feedById,
    originalUrl,
    articleUrl,
    currentUrl,
    sources,
    subscribe,
    unsubscribe,
    editSource,
    refreshing,
    refresh,
    refreshAll,
    extracting,
    addOpen,
    setAddOpen,
    editingId,
    setEditingId,
    state,
    toggle,
    markRead,
    markAllRead,
    view,
    setView,
    query,
    setQuery,
    streamFilter,
    setStreamFilter,
    filtered,
    upNext,
    selectedId: activeId,
    select,
    step,
    scrollReading,
    registerReaderScroll,
    counts,
    todayMinutes,
    todayTotal,
    theme,
    setTheme,
    immersive,
    setImmersive,
    navOpen,
    setNavOpen,
    font,
    setFont,
    searchOpen,
    setSearchOpen,
    shortcutsOpen,
    setShortcutsOpen,
    toggleShortcuts,
    mobileReading,
    setMobileReading,
    mobileFeeds,
    setMobileFeeds,
  };
}

export { ReaderContext, FONT_SIZES };

/**
 * The source list reads newest first, and "newest" is when it was added.
 *
 * Without this the order is whatever the last write left behind: a rename or a
 * refresh re-appends its source, while a reload hands back IndexedDB key order,
 * so a source would jump to the bottom and then jump back.
 */
function byAddedDesc(a: SourceRecord, b: SourceRecord): number {
  return b.addedAt - a.addedAt;
}

/* -------------------------------------------------------------- helpers */

export function useKeyboardShortcuts(ctx: Ctx) {
  const ref = useRef(ctx);
  // assigned after commit rather than during render — a render-phase write
  // would tear under concurrent rendering
  useEffect(() => {
    ref.current = ctx;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const c = ref.current;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        c.setSearchOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (c.addOpen) c.setAddOpen(false);
        else if (c.editingId) c.setEditingId(null);
        else if (c.shortcutsOpen) c.setShortcutsOpen(false);
        else if (c.searchOpen) c.setSearchOpen(false);
        else if (c.immersive) c.setImmersive(false);
        else if (c.mobileReading) c.setMobileReading(false);
        return;
      }
      // a dialog owns the keyboard while it is open
      if (c.addOpen || c.editingId) return;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          c.step(1);
          break;
        case "k":
          e.preventDefault();
          c.step(-1);
          break;
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          c.scrollReading(e.key === "ArrowDown" ? 1 : -1);
          break;
        case "m":
          c.toggle("read", c.selectedId);
          break;
        case "s":
          c.toggle("saved", c.selectedId);
          break;
        case "l":
          c.toggle("later", c.selectedId);
          break;
        case "o":
        case "v": {
          const url = c.currentUrl();
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          break;
        }
        case "f":
          c.setImmersive(!c.immersive);
          break;
        case "t":
          c.setTheme(c.theme === "dark" ? "light" : "dark");
          break;
        case "/":
          e.preventDefault();
          c.setSearchOpen(true);
          break;
        // Shift+/ on most layouts, but the legend is what makes it findable
        case "?":
          e.preventDefault();
          c.toggleShortcuts();
          break;
        case "[":
          c.setFont(Math.max(0, c.font - 1) as ReaderFont);
          break;
        case "]":
          c.setFont(Math.min(3, c.font + 1) as ReaderFont);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
