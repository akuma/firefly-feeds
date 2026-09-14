"use client";

/* The lab renders fixed, read-only result lists, so their order never changes
   between renders and an index key is stable here. */
/* oxlint-disable react/no-array-index-key */

import { useCallback, useMemo, useState } from "react";
import {
  blockText,
  diffParagraphs,
  paragraphTexts,
  type CompareResponse,
  type ExtractOutput,
} from "@/lib/lab-types";

/**
 * Extractor comparison lab — development only.
 *
 * Runs Readability and Defuddle over the same fetched page and lays the two
 * results side by side, so the difference in what each keeps is the only thing
 * on screen. It is deliberately plain: a dev tool, not part of the reader.
 */

type Library = "both" | "readability" | "defuddle";

type Options = {
  charThreshold: number;
  keepClasses: boolean;
  removeLowScoring: boolean;
  removeHiddenElements: boolean;
  removeSmallImages: boolean;
  includeReplies: boolean;
  standardize: boolean;
};

const DEFAULT_OPTIONS: Options = {
  charThreshold: 500,
  keepClasses: false,
  removeLowScoring: true,
  removeHiddenElements: true,
  removeSmallImages: true,
  includeReplies: false,
  standardize: true,
};

function queryFor(url: string, options: Options): string {
  const params = new URLSearchParams({ url });
  params.set("charThreshold", String(options.charThreshold));
  if (options.keepClasses) params.set("keepClasses", "1");
  if (!options.removeLowScoring) params.set("removeLowScoring", "0");
  if (!options.removeHiddenElements) params.set("removeHiddenElements", "0");
  if (!options.removeSmallImages) params.set("removeSmallImages", "0");
  if (options.includeReplies) params.set("includeReplies", "1");
  if (!options.standardize) params.set("standardize", "0");
  return `/api/lab/compare?${params.toString()}`;
}

const KIND_COLOR: Record<string, string> = {
  p: "text-neutral-500",
  h2: "text-blue-600 dark:text-blue-400",
  quote: "text-purple-600 dark:text-purple-400",
  list: "text-pink-600 dark:text-pink-400",
  figure: "text-amber-600 dark:text-amber-400",
  video: "text-red-600 dark:text-red-400",
  code: "text-emerald-600 dark:text-emerald-400",
  note: "text-cyan-600 dark:text-cyan-400",
  rule: "text-neutral-400",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] tracking-wide text-neutral-400 uppercase">{label}</span>
      <span className="mono text-sm text-neutral-800 tabular-nums dark:text-neutral-200">
        {value}
      </span>
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-20 shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{value}</span>
    </div>
  );
}

function Panel({ name, data }: { name: string; data: ExtractOutput }) {
  const shown = data.blocks.slice(0, 300);
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        <h2 className="text-sm font-semibold tracking-wide uppercase">{name}</h2>
        <span className="mono text-[11px] text-neutral-400">{data.ms} ms</span>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Stat label="text chars" value={data.textLength} />
        <Stat label="blocks" value={data.blocks.length} />
        <Stat label="images" value={data.imageCount} />
        <Stat label="html chars" value={data.contentHtml.length} />
        <Stat label="truncated" value={data.truncated ? "yes" : "no"} />
      </div>

      <div className="flex flex-col gap-1">
        <Meta label="title" value={data.title} />
        <Meta label="author" value={data.author} />
        <Meta label="published" value={data.published} />
        <Meta label="site" value={data.site} />
        <Meta label="image" value={data.image} />
      </div>

      <ol className="flex flex-col gap-1.5">
        {shown.map((block, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug">
            <span
              className={`mono w-14 shrink-0 pt-0.5 text-[10px] uppercase ${KIND_COLOR[block.kind] ?? ""}`}
            >
              {block.kind}
            </span>
            <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">
              {blockText(block)}
            </span>
          </li>
        ))}
      </ol>
      {data.blocks.length > shown.length && (
        <p className="text-xs text-neutral-400">
          … {data.blocks.length - shown.length} more blocks
        </p>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-500 select-none">
          Raw extracted HTML ({data.contentHtml.length} chars)
        </summary>
        <pre className="mono mt-2 max-h-96 overflow-auto rounded bg-neutral-100 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {data.contentHtml}
        </pre>
      </details>
    </section>
  );
}

function Diff({ a, b }: { a: ExtractOutput; b: ExtractOutput }) {
  const diff = useMemo(
    () => diffParagraphs(paragraphTexts(a.blocks), paragraphTexts(b.blocks)),
    [a, b],
  );
  const onlyA = diff.filter((line) => line.kind === "onlyA").length;
  const onlyB = diff.filter((line) => line.kind === "onlyB").length;
  const same = diff.filter((line) => line.kind === "same").length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-4 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Paragraph diff</h2>
        <span className="mono text-[11px] text-neutral-400">
          shared {same} · only Readability {onlyA} · only Defuddle {onlyB}
        </span>
      </div>
      <p className="text-xs text-neutral-500">
        Readability-only paragraphs are <span className="text-red-600 dark:text-red-400">red</span>;
        Defuddle-only paragraphs are{" "}
        <span className="text-emerald-600 dark:text-emerald-400">green</span>. Shared paragraphs are
        dimmed. This is a plain text match, not an LCS diff.
      </p>
      <ol className="flex flex-col gap-1">
        {diff.slice(0, 500).map((line, i) => (
          <li
            key={i}
            className={
              line.kind === "onlyA"
                ? "border-l-2 border-red-500 bg-red-50/60 pl-2 text-[13px] text-red-800 dark:bg-red-950/40 dark:text-red-300"
                : line.kind === "onlyB"
                  ? "border-l-2 border-emerald-500 bg-emerald-50/60 pl-2 text-[13px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-l-2 border-transparent pl-2 text-[13px] text-neutral-400"
            }
          >
            {line.kind === "onlyA" ? "R " : line.kind === "onlyB" ? "D " : "  "}
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function ComparePage() {
  const [url, setUrl] = useState("");
  const [library, setLibrary] = useState<Library>("both");
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<CompareResponse, { ok: true }> | null>(null);

  const run = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(queryFor(url.trim(), options));
      const data = (await res.json()) as CompareResponse;
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setResult(data);
    } catch {
      setError("The request failed.");
    } finally {
      setLoading(false);
    }
  }, [url, options]);

  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Extractor comparison</h1>
        <p className="text-xs text-neutral-500">
          Fetch a page once and run Mozilla Readability and Defuddle over the same HTML. Local
          development only.
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/article"
          className="mono min-w-[320px] flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          value={library}
          onChange={(event) => setLibrary(event.target.value as Library)}
          className="rounded border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="both">Both side by side</option>
          <option value="readability">Readability only</option>
          <option value="defuddle">Defuddle only</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {loading ? "Extracting…" : "Extract"}
        </button>
      </form>

      <details className="rounded border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
        <summary className="cursor-pointer text-xs tracking-wide text-neutral-500 uppercase select-none">
          Options
        </summary>
        <div className="mt-3 flex flex-wrap items-start gap-8">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-neutral-500">Readability</legend>
            <label className="flex items-center gap-2 text-sm">
              charThreshold
              <input
                type="number"
                min={0}
                value={options.charThreshold}
                onChange={(event) => set("charThreshold", Number(event.target.value))}
                className="w-24 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.keepClasses}
                onChange={(event) => set("keepClasses", event.target.checked)}
              />
              keepClasses
            </label>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-neutral-500">Defuddle</legend>
            {(
              [
                ["removeLowScoring", "removeLowScoring"],
                ["removeHiddenElements", "removeHiddenElements"],
                ["removeSmallImages", "removeSmallImages"],
                ["includeReplies", "includeReplies"],
                ["standardize", "standardize"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => set(key, event.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      </details>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <>
          <p className="mono truncate text-[11px] text-neutral-400">{result.url}</p>
          <div className="flex flex-col gap-10 xl:flex-row">
            {(library === "both" || library === "readability") && (
              <Panel name="Readability" data={result.readability} />
            )}
            {(library === "both" || library === "defuddle") && (
              <Panel name="Defuddle" data={result.defuddle} />
            )}
          </div>
          {library === "both" && <Diff a={result.readability} b={result.defuddle} />}
        </>
      )}
    </main>
  );
}
