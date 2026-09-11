"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { clsx } from "./clsx";
import { FOLDERS } from "@/lib/sources";
import { useReader } from "@/lib/store";
import type { FolderId } from "@/lib/types";

/**
 * Rename a source and re-file it, in one place.
 *
 * A small dialog rather than an inline field: the row is 30px tall and holds a
 * name plus three controls, which leaves no room to also choose a folder. The
 * name and the folder are the same decision — "what is this and where does it
 * live" — so they are edited together.
 */
export function EditSource() {
  const r = useReader();
  const feed = r.editingId ? r.feedById(r.editingId) : undefined;
  const [name, setName] = useState(feed?.name ?? "");
  const [folder, setFolder] = useState<FolderId | null>(feed?.folder ?? null);
  const [saving, setSaving] = useState(false);

  if (!feed) return null;

  const save = async () => {
    setSaving(true);
    try {
      await r.editSource(feed.id, { name, folder });
      r.setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={() => r.setEditingId(null)}
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in oklab, var(--c-canvas) 94%, transparent)" }}
      />

      <div
        role="dialog"
        aria-label="Edit source"
        className="ff-rise relative flex w-full max-w-[520px] flex-col border border-rule bg-reader shadow-[0_30px_60px_-40px_rgba(0,0,0,0.5)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-3">
          <span className="label text-ink4">Edit source</span>
          <button
            type="button"
            onClick={() => r.setEditingId(null)}
            className="mono flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-ink4 uppercase transition-colors hover:text-ink"
          >
            <X size={11} strokeWidth={1.8} />
            Esc
          </button>
        </div>

        <div className="px-6 pt-6 pb-7">
          <div className="flex items-center gap-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              aria-label="Feed name"
              spellCheck={false}
              autoFocus
              className="min-w-0 flex-1 border-b border-rulestrong bg-transparent pb-1 text-[21px] leading-[1.15] tracking-[-0.016em] text-ink outline-none focus:border-ink"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
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

          <div className="mt-7 flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={() => r.setEditingId(null)}
              className="mono text-[10px] tracking-[0.16em] text-ink3 uppercase transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="mono bg-ink px-4 py-2.5 text-[10px] tracking-[0.16em] text-canvas uppercase transition-opacity disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
