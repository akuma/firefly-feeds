"use client";

import {
  Bookmark as BookmarkIcon,
  Clock as ClockIcon,
  Layers,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { clsx } from "./clsx";
import type { Edition } from "@/lib/edition";
import { AddSource } from "./add-source";
import { ArticlePane } from "./article-pane";
import { IconButton, Wordmark } from "./brand";
import { NavRail } from "./nav-rail";
import { SearchPalette } from "./search-palette";
import { Shortcuts } from "./shortcuts";
import { StreamColumn } from "./stream-column";
import { editionFor } from "@/lib/edition";
import { ReaderContext, useKeyboardShortcuts, useReader, useReaderState } from "@/lib/store";

/* ------------------------------------------------------------ mobile */

function MobileTopBar() {
  const r = useReader();
  return (
    <div className="flex min-h-[54px] shrink-0 items-center justify-between border-b border-rule bg-canvas pt-[env(safe-area-inset-top)] pr-2 pl-4 lg:hidden">
      <Wordmark size="sm" onClick={() => r.setView("today")} />
      <div className="flex items-center gap-0.5">
        <IconButton icon={Plus} label="Add a feed" onClick={() => r.setAddOpen(true)} />
        <IconButton icon={Search} label="Search" onClick={() => r.setSearchOpen(true)} />
        <IconButton
          icon={r.theme === "dark" ? Sun : Moon}
          label="Theme"
          onClick={() => r.setTheme(r.theme === "dark" ? "light" : "dark")}
        />
        <IconButton icon={Layers} label="Feeds" onClick={() => r.setMobileFeeds(true)} />
      </div>
    </div>
  );
}

function MobileTabBar() {
  const r = useReader();
  const items = [
    {
      key: "stream",
      label: "Stream",
      icon: PanelLeft,
      active: !r.view.startsWith("saved") && !r.view.startsWith("later"),
      on: () => r.setView("today"),
    },
    {
      key: "saved",
      label: "Saved",
      icon: BookmarkIcon,
      active: r.view === "saved",
      on: () => r.setView("saved"),
    },
    {
      key: "later",
      label: "Later",
      icon: ClockIcon,
      active: r.view === "later",
      on: () => r.setView("later"),
    },
    {
      key: "search",
      label: "Search",
      icon: Search,
      active: false,
      on: () => r.setSearchOpen(true),
    },
  ];

  return (
    <nav className="flex min-h-[58px] shrink-0 items-stretch border-t border-rule bg-canvas pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          onClick={it.on}
          className={clsx(
            "relative flex flex-1 flex-col items-center justify-center gap-1.5 transition-colors",
            i > 0 && "border-l border-rule",
            it.active ? "text-spark" : "text-ink3 active:bg-hoverc",
          )}
        >
          {it.active && <span className="absolute top-0 left-0 h-[2px] w-full bg-spark" />}
          <it.icon size={16} strokeWidth={1.6} />
          <span className="mono text-[8.5px] tracking-[0.14em] uppercase">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------- shell */

export function Shell({ edition }: { edition?: Edition }) {
  const r = useReaderState(edition ?? editionFor(new Date()));
  useKeyboardShortcuts(r);

  const readerClasses = clsx(
    "min-h-0 flex-col bg-reader",
    r.immersive
      ? "fixed inset-0 z-40 flex"
      : clsx(
          "lg:flex lg:min-w-0 lg:flex-1",
          r.mobileReading ? "fixed inset-0 z-50 flex lg:static lg:z-auto" : "hidden",
        ),
  );

  return (
    <ReaderContext.Provider value={r}>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-canvas lg:flex-row">
        {r.navOpen && !r.immersive && (
          <div
            data-col="nav"
            className="hidden min-h-0 w-[254px] shrink-0 border-r border-rule lg:block"
          >
            <NavRail />
          </div>
        )}

        {!r.immersive && (
          <div
            data-col="stream"
            className="flex min-h-0 min-w-0 flex-1 flex-col lg:w-[468px] lg:flex-none lg:border-r lg:border-rule xl:w-[500px]"
          >
            <MobileTopBar />
            <div className="min-h-0 flex-1">
              <StreamColumn />
            </div>
            <MobileTabBar />
          </div>
        )}

        <div data-col="reader" className={readerClasses}>
          <ArticlePane />
        </div>
      </div>

      {/* ------------------------------------------- mobile feed drawer */}
      {r.mobileFeeds && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => r.setMobileFeeds(false)}
            className="absolute inset-0 cursor-default bg-ink/35"
          />
          <div className="ff-drawer absolute inset-y-0 left-0 w-[86%] max-w-[330px] border-r border-rule bg-canvas">
            <NavRail variant="drawer" onNavigate={() => r.setMobileFeeds(false)} />
          </div>
        </div>
      )}

      {r.searchOpen && <SearchPalette />}
      {r.addOpen && <AddSource />}
      {r.shortcutsOpen && <Shortcuts />}
    </ReaderContext.Provider>
  );
}
