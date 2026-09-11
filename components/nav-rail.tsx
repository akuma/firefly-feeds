"use client";

import { Command, Moon, Plus, RefreshCw, Search, Sun, X } from "lucide-react";
import { clsx } from "./clsx";
import { IconButton, Wordmark } from "./brand";
import { Firefly } from "./plate";
import { useEffect, useState } from "react";
import { EDITION, FOLDERS } from "@/lib/feeds";
import { estimate } from "@/lib/storage/repository";
import { useReader } from "@/lib/store";
import type { Feed, FeedId, FolderId, ViewId } from "@/lib/types";

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between pr-3 pl-5">
      <span className="label text-ink4">{children}</span>
      {right}
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
  count,
  dot,
  serif,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  dot?: boolean;
  serif?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group relative flex h-[30px] w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors duration-150",
        active ? "bg-activec text-ink" : "text-ink2 hover:bg-hoverc hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "absolute top-0 left-0 h-full w-[2px] transition-colors duration-150",
          active ? "bg-spark" : "bg-transparent group-hover:bg-rule",
        )}
      />
      {dot !== undefined && (
        <span className="flex w-[7px] shrink-0 justify-start">
          {dot ? <Firefly size={5} glow={false} pulse={active} /> : null}
        </span>
      )}
      <span
        className={clsx(
          "min-w-0 flex-1 truncate",
          serif
            ? "text-[15px] leading-none tracking-[-0.006em]"
            : "mono text-[11.5px] leading-none",
        )}
      >
        {children}
      </span>
      {count !== undefined && count > 0 && (
        <span
          className={clsx(
            "mono tnum shrink-0 text-[10px] leading-none",
            active ? "text-spark" : "text-ink4 group-hover:text-ink3",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * A source row is a whole-row hit target plus two small controls that only
 * appear on hover — so refresh and unsubscribe are reachable without turning
 * the navigation into a list of buttons.
 */
function SourceRow({
  feed,
  active,
  count,
  refreshing,
  error,
  onSelect,
  onRefresh,
  onRemove,
}: {
  feed: Feed;
  active: boolean;
  count: number;
  refreshing: boolean;
  error?: string | null;
  onSelect: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={clsx(
        "group relative flex h-[30px] items-center gap-2.5 pr-2.5 pl-5 transition-colors duration-150",
        active ? "bg-activec text-ink" : "text-ink2 hover:bg-hoverc hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "absolute top-0 left-0 h-full w-[2px] transition-colors duration-150",
          active ? "bg-spark" : "bg-transparent group-hover:bg-rule",
        )}
      />
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        aria-label={count > 0 ? `${feed.name}, ${count} unread` : feed.name}
        className="absolute inset-0 cursor-pointer"
      />

      <span
        aria-hidden="true"
        className="pointer-events-none relative flex w-[7px] shrink-0 justify-start"
      >
        {count > 0 ? <Firefly size={5} glow={false} pulse={active} /> : null}
      </span>
      <span
        aria-hidden="true"
        title={error ? `Last refresh failed: ${error}` : undefined}
        className={clsx(
          "pointer-events-none relative min-w-0 flex-1 truncate font-mono text-[11.5px] leading-none",
          error && "text-ink4",
        )}
      >
        {feed.name}
      </span>

      <span aria-hidden="true" className="relative flex shrink-0 items-center gap-1.5">
        {refreshing ? (
          <Firefly size={5} pulse />
        ) : error ? (
          <span
            title={error}
            className="mono text-[10px] leading-none text-spark"
            aria-label={`Last refresh failed: ${error}`}
          >
            !
          </span>
        ) : (
          count > 0 && (
            <span
              className={clsx(
                "mono tnum text-[10px] leading-none",
                active ? "text-spark" : "text-ink4 group-hover:text-ink3",
              )}
            >
              {count}
            </span>
          )
        )}
        {feed.subscribed && (
          <span className="pointer-events-none flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 max-lg:pointer-events-auto max-lg:opacity-100">
            <IconButton
              icon={RefreshCw}
              label={`Refresh ${feed.name}`}
              size={20}
              iconSize={11}
              onClick={onRefresh}
            />
            <IconButton
              icon={X}
              label={`Unsubscribe from ${feed.name}`}
              size={20}
              iconSize={12}
              onClick={onRemove}
            />
          </span>
        )}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Colophon() {
  const r = useReader();
  const [usage, setUsage] = useState<number | null>(null);
  const ready = r.ready;
  const storedRecords = r.sources.length + r.stories.length;

  // `storedRecords` is a deliberate trigger, not a read: the browser's storage
  // estimate is only meaningful once something has been written to it.
  /* oxlint-disable react/exhaustive-effect-dependencies */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void estimate().then((value) => {
      if (!cancelled && value) setUsage(value.usage);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, storedRecords]);
  /* oxlint-enable react/exhaustive-effect-dependencies */

  return (
    <div className="px-5 pt-4 pb-5">
      <div className="label text-ink4">Colophon</div>
      <div className="mono mt-2.5 flex flex-col gap-1.5 text-[9.5px] leading-none tracking-[0.12em] text-ink4 uppercase">
        <span>
          Ed. {EDITION.slug} · Vol. {EDITION.volume}
        </span>
        <span className="text-ink3">
          {r.counts.all} unread · {r.feeds.length} sources
        </span>
        <span>
          {r.counts.saved} kept · {r.counts.later} queued
        </span>
        <span className="text-ink4">{usage === null ? "—" : formatBytes(usage)} on device</span>
      </div>
    </div>
  );
}

export function NavRail({
  variant = "desktop",
  onNavigate,
}: {
  variant?: "desktop" | "drawer";
  onNavigate?: () => void;
}) {
  const r = useReader();

  const go = (v: ViewId) => {
    r.setView(v);
    onNavigate?.();
  };

  const views: { id: ViewId; name: string; count: number }[] = [
    { id: "today", name: "Today", count: r.counts.today },
    { id: "all", name: "All Stories", count: r.counts.all },
    { id: "saved", name: "Saved", count: r.counts.saved },
    { id: "later", name: "Later", count: r.counts.later },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-[68px] shrink-0 items-center justify-between px-5">
        <Wordmark onClick={() => go("today")} />
        {variant === "drawer" && (
          <button
            type="button"
            onClick={onNavigate}
            className="mono text-[9.5px] tracking-[0.16em] text-ink4 uppercase transition-colors hover:text-ink"
          >
            Close
          </button>
        )}
      </div>
      <div className="h-px w-full shrink-0 bg-rule" />

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="pt-5">
          <SectionLabel>Reading</SectionLabel>
          <div className="flex flex-col">
            {views.map((v) => (
              <Row key={v.id} active={r.view === v.id} onClick={() => go(v.id)} count={v.count}>
                {v.name}
              </Row>
            ))}
          </div>
        </div>

        <div className="mt-5 mb-5 ml-5 h-px w-[calc(100%-40px)] bg-rule" />

        <SectionLabel>Folders</SectionLabel>
        <div className="flex flex-col">
          {FOLDERS.map((f) => (
            <Row
              key={f.id}
              serif
              active={r.view === `folder:${f.id}`}
              onClick={() => go(`folder:${f.id}`)}
              count={r.counts.folders[f.id as FolderId]}
            >
              {f.name}
            </Row>
          ))}
        </div>

        <div className="mt-5 mb-5 ml-5 h-px w-[calc(100%-40px)] bg-rule" />

        <div className="pb-2">
          <SectionLabel
            right={
              <button
                type="button"
                onClick={() => {
                  r.setAddOpen(true);
                  onNavigate?.();
                }}
                title="Add a feed or site"
                className="mono flex items-center gap-1 text-[9px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-spark"
              >
                <Plus size={11} strokeWidth={2} />
                Add
              </button>
            }
          >
            Sources
          </SectionLabel>
          <div className="flex flex-col">
            {r.feeds.map((feed) => (
              <SourceRow
                key={feed.id}
                feed={feed}
                active={r.view === `feed:${feed.id}`}
                count={r.counts.feeds[feed.id as FeedId] ?? 0}
                refreshing={r.refreshing === feed.id}
                error={r.sources.find((x) => x.id === feed.id)?.error}
                onSelect={() => go(`feed:${feed.id}`)}
                onRefresh={() => void r.refresh(feed.id)}
                onRemove={() => r.unsubscribe(feed.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="h-px w-full shrink-0 bg-rule" />
      <Colophon />
      <div className="h-px w-full shrink-0 bg-rule" />
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1">
          <IconButton
            icon={Sun}
            label="Light"
            size={24}
            active={r.theme === "light"}
            onClick={() => r.setTheme("light")}
          />
          <IconButton
            icon={Moon}
            label="Dark"
            size={24}
            active={r.theme === "dark"}
            onClick={() => r.setTheme("dark")}
          />
          <IconButton
            icon={Search}
            label="Search"
            size={24}
            onClick={() => r.setSearchOpen(true)}
          />
        </div>
        <button
          type="button"
          onClick={() => r.setSearchOpen(true)}
          className="mono flex items-center gap-1.5 text-[9px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink"
        >
          <Command size={10} strokeWidth={1.6} />K
        </button>
      </div>
    </div>
  );
}
