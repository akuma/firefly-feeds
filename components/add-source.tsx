"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "./clsx";
import { FOLDERS } from "@/lib/sources";
import { useReader } from "@/lib/store";
import type { Block, FolderId, StoryLayout } from "@/lib/types";

type ApiItem = {
  id: string;
  title: string;
  link?: string;
  author?: string;
  publishedMs?: number;
  summary: string;
  body: Block[];
  image?: string;
  minutes: number;
  layout: StoryLayout;
};

type ApiFeed = {
  id: string;
  title: string;
  host: string;
  siteUrl: string;
  feedUrl: string;
  description: string;
  kind: string;
  count: number;
};

type ApiResponse = { ok: true; feed: ApiFeed; items: ApiItem[] } | { ok: false; error: string };

/**
 * Four publications to try, shown while the dialog is idle. Pressing one runs a
 * lookup, so each carries the host to show and the feed address to fetch.
 */
const QUICK_PICKS: { host: string; feedUrl: string }[] = [
  { host: "bbc.co.uk", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml" },
  { host: "smithsonianmag.com", feedUrl: "https://www.smithsonianmag.com/rss/articles/" },
  { host: "quantamagazine.org", feedUrl: "https://www.quantamagazine.org/feed/" },
  { host: "aeon.co", feedUrl: "https://aeon.co/feed.rss" },
];

function shortDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
}

export function AddSource() {
  const r = useReader();
  /** A suggestion clicked in the navigation arrives pre-queued. */
  const queued = r.pendingSource;
  const [url, setUrl] = useState(queued?.feedUrl ?? "");
  const booted = useRef(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ feed: ApiFeed; items: ApiItem[] } | null>(null);
  const [name, setName] = useState("");
  // no folder is chosen by default; a suggestion arrives with its own preselected
  const [folder, setFolder] = useState<FolderId | null>(queued?.folder ?? null);
  const [saving, setSaving] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    r.clearPendingSource();
    r.setAddOpen(false);
  };

  const look = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) {
      inputRef.current?.focus();
      return;
    }
    setStatus("loading");
    setError("");
    setPreview(null);
    setFaviconFailed(false);
    try {
      const res = await fetch(`/api/feed?url=${encodeURIComponent(value)}`);
      const data = (await res.json()) as ApiResponse;
      if (!data.ok) {
        setError(data.error);
        setStatus("error");
        return;
      }
      setPreview({ feed: data.feed, items: data.items });
      setName(data.feed.title);
      setStatus("ready");
    } catch {
      setError("Could not reach the reader's feed service.");
      setStatus("error");
    }
  }, []);

  // mounted only while open, so every field starts clean by construction
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  // a suggestion from the navigation goes straight to lookup, no second tap
  useEffect(() => {
    if (booted.current || !queued) return;
    booted.current = true;
    void look(queued.feedUrl);
  }, [queued, look]);

  const commit = async () => {
    if (!preview) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/feed?url=${encodeURIComponent(preview.feed.feedUrl || preview.feed.siteUrl)}&full=1`,
      );
      const data = (await res.json()) as ApiResponse;
      if (!data.ok) {
        setError(data.error);
        setStatus("error");
        setSaving(false);
        return;
      }
      await r.subscribe({
        id: data.feed.id,
        title: name.trim() || data.feed.title,
        host: data.feed.host,
        feedUrl: data.feed.feedUrl,
        siteUrl: data.feed.siteUrl,
        folder: folder ?? undefined,
        items: data.items,
      });
      r.setAddOpen(false);
    } catch {
      setError("Could not save that subscription.");
      setStatus("error");
      setSaving(false);
    }
  };

  const favicon = preview ? `${new URL(preview.feed.siteUrl).origin}/favicon.ico` : "";

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[7vh] sm:pt-[10vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in oklab, var(--c-canvas) 94%, transparent)" }}
      />

      <div
        role="dialog"
        aria-label="Add source"
        className="ff-rise relative flex max-h-[86vh] w-full max-w-[640px] flex-col border border-rule bg-reader shadow-[0_30px_60px_-40px_rgba(0,0,0,0.5)]"
      >
        {/* ------------------------------------------------------ header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-3">
          <span className="label text-ink4">Add source</span>
          <button
            type="button"
            onClick={close}
            className="mono flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-ink4 uppercase transition-colors hover:text-ink"
          >
            <X size={11} strokeWidth={1.8} />
            Esc
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-7">
          <h2 className="display text-[25px] leading-[1.12] font-medium tracking-[-0.016em] text-ink">
            Subscribe to a feed
          </h2>
          <p className="mt-2.5 max-w-[52ch] text-[14.5px] leading-[1.5] text-ink3">
            Paste a feed address, or any site address — Firefly will look for one on the page.
          </p>

          {/* ------------------------------------------------------- input */}
          <div className="mt-6 flex items-center gap-3 border-b border-rulestrong pb-2.5">
            <Search size={15} strokeWidth={1.6} className="shrink-0 text-spark" />
            <input
              ref={inputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void look(url);
                }
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://example.com/feed.xml"
              className="min-w-0 flex-1 bg-transparent text-[17px] leading-[1.4] tracking-[-0.01em] text-ink outline-none placeholder:text-ink4"
            />
            <button
              type="button"
              onClick={() => void look(url)}
              disabled={status === "loading" || !url.trim()}
              className="mono shrink-0 bg-ink px-3 py-1.5 text-[9px] tracking-[0.16em] text-canvas uppercase transition-opacity disabled:opacity-25"
            >
              Find
            </button>
          </div>

          {status === "idle" && (
            <div className="mono mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
              <span>Try</span>
              {QUICK_PICKS.map((pick) => (
                <button
                  key={pick.feedUrl}
                  type="button"
                  onClick={() => void look(pick.feedUrl)}
                  className="text-ink3 underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-spark"
                >
                  {pick.host}
                </button>
              ))}
            </div>
          )}

          {/* ------------------------------------------------------ states */}
          {status === "loading" && (
            <div className="flex items-center gap-3 py-7">
              <span className="mono text-[9.5px] tracking-[0.16em] text-ink3 uppercase">
                Looking for a feed…
              </span>
            </div>
          )}

          {status === "error" && (
            <div className="mt-5 flex items-start gap-3 border-l-2 border-spark py-1 pl-4">
              <p className="text-[14.5px] leading-[1.5] text-ink2">{error}</p>
            </div>
          )}

          {status === "ready" && preview && (
            <div className="ff-fade mt-6">
              <div className="flex items-start gap-4 border-t border-rule pt-5">
                <span className="mt-[3px] flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden border border-rule">
                  {favicon && !faviconFailed ? (
                    <img
                      src={favicon}
                      alt=""
                      width={18}
                      height={18}
                      referrerPolicy="no-referrer"
                      onError={() => setFaviconFailed(true)}
                      className="h-[18px] w-[18px] object-contain"
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="Feed name"
                    title="Rename this feed"
                    spellCheck={false}
                    className="w-full min-w-0 border-b border-transparent bg-transparent text-[21px] leading-[1.15] tracking-[-0.016em] text-ink transition-colors outline-none hover:border-rule focus:border-rulestrong"
                  />
                  <p className="mono mt-1.5 flex flex-wrap items-center gap-2 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                    <span className="text-ink3">{preview.feed.host}</span>
                    <span aria-hidden>·</span>
                    <span>{preview.feed.kind}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {preview.feed.count} {preview.feed.count === 1 ? "entry" : "entries"}
                    </span>
                  </p>
                  {preview.feed.description && (
                    <p className="mt-3 max-w-[56ch] text-[14px] leading-[1.5] text-ink3 italic">
                      {preview.feed.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-rule pt-4">
                <span className="label text-ink4">Most recent</span>
                <ul className="mt-3 flex flex-col">
                  {preview.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-baseline gap-3 border-b border-rulesoft py-2 last:border-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.35] text-ink2">
                        {item.title}
                      </span>
                      <span className="mono shrink-0 text-[9px] tracking-[0.14em] text-ink4 uppercase">
                        {shortDate(item.publishedMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/*
         * The commit bar is pinned, not scrolled. A feed with a long title, a
         * long description and five entries can be taller than the window, and
         * an action that scrolls out of view is an action the reader cannot
         * find. Both decisions live here — which folder, and go.
         */}
        {status === "ready" && preview && (
          <div className="shrink-0 border-t border-rule px-6 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="label text-ink4">File under</span>
              <button
                type="button"
                onClick={() => setFolder(null)}
                className={clsx(
                  "mono px-2 py-1 text-[9.5px] leading-none tracking-[0.14em] uppercase transition-colors",
                  folder === null
                    ? "bg-ink text-canvas"
                    : "text-ink3 ring-1 ring-rule ring-inset hover:bg-hoverc hover:text-ink",
                )}
              >
                Unfiled
              </button>
              {FOLDERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFolder((current) => (current === f.id ? null : f.id))}
                  className={clsx(
                    "mono px-2 py-1 text-[9.5px] leading-none tracking-[0.14em] uppercase transition-colors",
                    folder === f.id
                      ? "bg-ink text-canvas"
                      : "text-ink3 ring-1 ring-rule ring-inset hover:bg-hoverc hover:text-ink",
                  )}
                >
                  {f.name}
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-[13.5px] leading-[1.5] text-spark">{error}</p>}

            <div className="mt-4 flex items-center justify-between gap-4">
              <span className="mono text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                Kept on this device · IndexedDB
              </span>
              <button
                type="button"
                onClick={() => void commit()}
                disabled={saving}
                className="mono group flex items-center gap-2 bg-ink px-4 py-2.5 text-[10px] tracking-[0.16em] text-canvas uppercase transition-opacity disabled:opacity-40"
              >
                {saving ? "Subscribing…" : "Subscribe"}
                <ArrowRight size={12} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
