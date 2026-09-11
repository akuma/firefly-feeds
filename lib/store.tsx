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
import { SEED_STORIES, readingTime } from "./articles";
import { SEED_FEEDS, FOLDERS } from "./feeds";
import { feedFromSource, readingFlags, storyFromArticle } from "./shaping";
import * as repo from "./storage/repository";
import { loadPrefs, savePrefs } from "./storage/prefs";
import type { ArticleRecord, ReadingRecord, SourceRecord } from "./storage/types";
import type { Feed, FeedId, FolderId, Story, StoryLayout, ViewId } from "./types";

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
  folder: FolderId;
  items: {
    id: string;
    title: string;
    link?: string;
    author?: string;
    publishedMs?: number;
    summary: string;
    body: ArticleRecord["body"];
    image?: string;
    minutes: number;
    layout: StoryLayout;
    truncated?: boolean;
  }[];
};

type Ctx = {
  ready: boolean;
  stories: Story[];
  story: (id: string) => Story | undefined;
  feeds: Feed[];
  feedById: (id: FeedId) => Feed | undefined;
  /** Canonical URL for a story: its own link, else its source's site. */
  originalUrl: (story: Story) => string | undefined;
  /** Canonical URL for whatever the reader currently has open. */
  currentUrl: () => string | undefined;

  sources: SourceRecord[];
  subscribe: (input: SubscribeInput) => Promise<void>;
  unsubscribe: (id: string) => Promise<void>;
  refreshing: string | null;
  refresh: (id: string) => Promise<void>;

  addOpen: boolean;
  setAddOpen: (v: boolean) => void;

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

  selectedId: string;
  select: (id: string) => void;
  step: (dir: 1 | -1) => void;

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

export function useReaderState(): Ctx {
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [reading, setReading] = useState<ReadingRecord[]>([]);

  const [view, setViewRaw] = useState<ViewId>("today");
  const [query, setQuery] = useState("");
  const [streamFilter, setStreamFilter] = useState<"all" | "unread">("all");
  const [selectedId, setSelectedId] = useState("quiet-return");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [immersive, setImmersive] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [font, setFont] = useState<ReaderFont>(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileReading, setMobileReading] = useState(false);
  const [mobileFeeds, setMobileFeeds] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  // relative timestamps for fetched stories need a clock, not a constant
  const [now, setNow] = useState(() => Date.now());

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
      setSources(snapshot.sources);
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
            (SEED_FEEDS.some((f) => f.id === feedId) ||
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
   * Prefs are only written once loading has finished. Before that we are still
   * holding defaults, and writing them would overwrite the stored values —
   * including the v0 reading flags the migration is about to consume.
   */
  useEffect(() => {
    if (!ready) return;
    savePrefs({ theme, font, navOpen, view });
  }, [ready, theme, font, navOpen, view]);

  /* ------------------------------------------------------ derive views */

  const feeds = useMemo<Feed[]>(() => [...SEED_FEEDS, ...sources.map(feedFromSource)], [sources]);

  const feedIndex = useMemo(() => {
    const map = new Map<FeedId, Feed>();
    for (const feed of feeds) map.set(feed.id, feed);
    return map;
  }, [feeds]);

  const feedById = useCallback((id: FeedId) => feedIndex.get(id), [feedIndex]);

  const state = useMemo(() => readingFlags(reading), [reading]);

  const stories = useMemo<Story[]>(
    () =>
      [...articles.map((a) => storyFromArticle(a, now)), ...SEED_STORIES].toSorted(
        (a, b) => a.minutesAgo - b.minutesAgo,
      ),
    [articles, now],
  );

  const originalUrl = useCallback(
    (target: Story) => {
      if (target.link) return target.link;
      const feed = feedIndex.get(target.feedId);
      if (feed?.siteUrl) return feed.siteUrl;
      if (feed?.host) return `https://${feed.host}`;
      return undefined;
    },
    [feedIndex],
  );

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
      return source && !source.deletedAt ? [...next, source] : next;
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
        folder: input.folder,
        addedAt: at,
        fetchedAt: at,
        error: null,
        updatedAt: at,
      };
      const items: ArticleRecord[] = input.items.slice(0, MAX_ARTICLES).map((item) => ({
        id: `${input.id}~${item.id}`,
        sourceId: input.id,
        title: item.title,
        link: item.link,
        author: item.author,
        publishedAt: item.publishedMs ?? at,
        fetchedAt: at,
        summary: item.summary,
        body: item.body,
        image: item.image,
        minutes: item.minutes,
        layout: item.layout,
        truncated: item.truncated,
      }));

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

  const refresh = useCallback(
    async (id: string) => {
      const source = sources.find((s) => s.id === id);
      if (!source) return;
      setRefreshing(id);
      try {
        const res = await fetch(`/api/feed?url=${encodeURIComponent(source.url)}&full=1`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error ?? "failed");

        const at = Date.now();
        const items: ArticleRecord[] = data.items
          .slice(0, MAX_ARTICLES)
          .map((item: SubscribeInput["items"][number]) => ({
            id: `${id}~${item.id}`,
            sourceId: id,
            title: item.title,
            link: item.link,
            author: item.author,
            publishedAt: item.publishedMs ?? at,
            fetchedAt: at,
            summary: item.summary,
            body: item.body,
            image: item.image,
            minutes: item.minutes,
            layout: item.layout,
            truncated: item.truncated,
          }));

        // anything the reader kept is exempt from cache eviction
        const keep = new Set(reading.filter((r) => r.saved || r.later).map((r) => r.id));
        await repo.putSource({ ...source, fetchedAt: at, error: null, updatedAt: at });
        await repo.replaceArticles(id, items, keep);
        await reloadSource(id);
        setNow(Date.now());
      } catch (error) {
        await repo.putSource({
          ...source,
          error: error instanceof Error ? error.message : "failed",
          updatedAt: Date.now(),
        });
        await reloadSource(id);
      } finally {
        setRefreshing(null);
      }
    },
    [sources, reading, reloadSource],
  );

  /* ------------------------------------------------------------- filter */

  const filtered = useMemo(() => {
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
    if (streamFilter === "unread") {
      list = list.filter((s) => !state.read[s.id]);
    }
    return list.toSorted((a, b) => a.minutesAgo - b.minutesAgo);
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
    return filtered[0]?.id ?? selectedId;
  }, [filtered, selectedId]);

  const currentStory = useMemo(() => stories.find((s) => s.id === activeId), [stories, activeId]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      markRead(id);
    },
    [markRead],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = filtered;
      if (!list.length) return;
      const idx = list.findIndex((candidate) => candidate.id === activeId);
      const next = idx === -1 ? 0 : Math.min(list.length - 1, Math.max(0, idx + dir));
      select(list[next].id);
    },
    [filtered, activeId, select],
  );

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
    stories,
    story,
    feeds,
    feedById,
    originalUrl,
    currentUrl,
    sources,
    subscribe,
    unsubscribe,
    refreshing,
    refresh,
    addOpen,
    setAddOpen,
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
    selectedId: activeId,
    select,
    step,
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
    mobileReading,
    setMobileReading,
    mobileFeeds,
    setMobileFeeds,
  };
}

export { ReaderContext, FONT_SIZES };

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
        else if (c.searchOpen) c.setSearchOpen(false);
        else if (c.immersive) c.setImmersive(false);
        else if (c.mobileReading) c.setMobileReading(false);
        return;
      }
      // the subscribe dialog owns the keyboard while it is open
      if (c.addOpen) return;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          c.step(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          c.step(-1);
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
