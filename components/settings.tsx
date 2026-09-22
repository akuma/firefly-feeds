"use client";

import { Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "./clsx";
import { useReader } from "@/lib/store";

/**
 * Classification settings: the switch, the credential, and the topic set the
 * reader maintains.
 *
 * A dialog rather than a page because it is a small, occasional decision. It
 * follows the house dialog rule — capped height, a scrolling body — so the
 * topic list can be long without pushing anything out of reach.
 */
export function Settings() {
  const r = useReader();
  const close = () => r.setSettingsOpen(false);
  const [serverConfigured, setServerConfigured] = useState<{
    configured: boolean;
    provider: string | null;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState(r.jevKey);

  // Whether the shared server credential exists is a fact only the endpoint
  // knows; the dialog asks once rather than guessing from a failed run.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/classify")
      .then((res) => res.json())
      .then((data: { configured?: boolean; provider?: string | null }) => {
        if (!cancelled) {
          setServerConfigured({
            configured: Boolean(data?.configured),
            provider: data?.provider ?? null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setServerConfigured({ configured: false, provider: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const keyReady = Boolean(r.jevKey) || serverConfigured?.configured === true;
  const providerLabel =
    serverConfigured?.provider === "cloudflare"
      ? "Cloudflare Workers AI"
      : serverConfigured?.provider === "jev"
        ? "Direct Jev API"
        : null;
  const lastProvider =
    r.classifyProvider === "cloudflare"
      ? "Cloudflare"
      : r.classifyProvider === "jev"
        ? "direct Jev"
        : null;

  const addDraft = () => {
    const label = draft.trim();
    if (!label) return;
    r.addTopic(label);
    setDraft("");
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[7vh] sm:pt-[9vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in oklab, var(--c-canvas) 94%, transparent)" }}
      />

      <div
        role="dialog"
        aria-label="Settings"
        className="ff-rise relative flex max-h-[86vh] w-full max-w-[600px] flex-col border border-rule bg-reader shadow-[0_30px_60px_-40px_rgba(0,0,0,0.5)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-3">
          <span className="label text-ink4">Settings</span>
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
          {/* ------------------------------------------------ classification */}
          <h2 className="display text-[24px] leading-[1.12] font-medium tracking-[-0.016em] text-ink">
            Article classification
          </h2>
          <p className="mt-2.5 max-w-[54ch] text-[14.5px] leading-[1.5] text-ink3">
            Each story gets a topic from the classifier, chosen only from the list below. A
            low-confidence answer is shown as a question, and you can always correct it.
          </p>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-rule pt-5">
            <div className="min-w-0">
              <div className="text-[15.5px] leading-[1.3] text-ink">Classify new stories</div>
              <p className="mt-1 max-w-[42ch] text-[13px] leading-[1.45] text-ink4">
                Sends a story&apos;s title and summary to Jev through this app&apos;s own endpoint.
                Off by default; nothing is sent while it is off.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={r.classifyEnabled}
              aria-label="Classify new stories"
              onClick={() => r.setClassifyEnabled(!r.classifyEnabled)}
              className={clsx(
                "mono shrink-0 px-3 py-2 text-[9.5px] tracking-[0.14em] uppercase transition-colors",
                r.classifyEnabled
                  ? "bg-ink text-canvas"
                  : "text-ink3 ring-1 ring-rule ring-inset hover:bg-hoverc hover:text-ink",
              )}
            >
              {r.classifyEnabled ? "On" : "Off"}
            </button>
          </div>

          {r.classifyEnabled && (
            <div className="ff-fade mt-5">
              <div className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                <span className="flex items-center gap-1.5">
                  <Sparkles size={11} strokeWidth={1.6} />
                  {serverConfigured === null
                    ? "Checking for a credential…"
                    : keyReady
                      ? providerLabel
                        ? `${providerLabel} ready`
                        : "Credential ready"
                      : "No classifier credential"}
                </span>
                {r.classifyWorking && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-spark">Classifying…</span>
                  </>
                )}
                {r.pendingClassifications > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{r.pendingClassifications} waiting</span>
                  </>
                )}
                {lastProvider && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Last via {lastProvider}</span>
                  </>
                )}
              </div>

              <label htmlFor="jev-key" className="label mt-5 block text-ink4">
                Cloudflare API token (optional)
              </label>
              <div className="mt-2 flex items-center gap-3 border-b border-rulestrong pb-2">
                <input
                  id="jev-key"
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onBlur={() => r.setJevKey(keyDraft.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") r.setJevKey(keyDraft.trim());
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Kept in this browser only"
                  className="mono min-w-0 flex-1 bg-transparent text-[13px] text-ink2 outline-none placeholder:text-ink4"
                />
                {keyDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      setKeyDraft("");
                      r.setJevKey("");
                    }}
                    className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                Jev runs through Cloudflare Workers AI. A shared token can be configured on the
                server; this one overrides it for this browser and is never written anywhere else.
              </p>

              {r.classifyError && (
                <div className="mt-5 flex items-start justify-between gap-4 border-l-2 border-spark py-1 pl-4">
                  <p className="text-[13.5px] leading-[1.5] text-ink2">{r.classifyError}</p>
                  <button
                    type="button"
                    onClick={r.retryClassification}
                    className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------- topics */}
          <div className="mt-9 flex items-center justify-between gap-4 border-t border-rule pt-6">
            <div>
              <h2 className="display text-[21px] leading-[1.14] font-medium tracking-[-0.014em] text-ink">
                Topics
              </h2>
              <p className="mt-1.5 max-w-[50ch] text-[13px] leading-[1.45] text-ink4">
                The closed set the classifier chooses from. Separate from a source&apos;s folder — a
                story carries a topic, a publication is filed under a folder.
              </p>
            </div>
            <button
              type="button"
              onClick={r.restoreDefaultTopics}
              title="Restore any built-in topic you removed"
              className="mono flex shrink-0 items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-spark"
            >
              <RotateCcw size={11} strokeWidth={1.8} />
              Defaults
            </button>
          </div>

          <div className="mt-4 border-t border-rule">
            {r.topics.length === 0 ? (
              <p className="py-5 text-[14px] text-ink4">
                No topics yet. Turn classification on to add the default set, or add your own.
              </p>
            ) : (
              r.topics.map((topic) => (
                <div
                  key={topic.id}
                  className="flex items-center gap-3 border-b border-rulesoft py-2.5 last:border-0"
                >
                  <input
                    defaultValue={topic.label}
                    aria-label={`Rename ${topic.label}`}
                    spellCheck={false}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== topic.label) {
                        r.updateTopic(topic.id, { label: e.target.value });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-w-0 flex-1 border-b border-transparent bg-transparent text-[15px] leading-[1.3] text-ink transition-colors outline-none hover:border-rule focus:border-rulestrong"
                  />
                  {topic.builtin && <span className="label shrink-0 text-ink4">Built-in</span>}
                  <button
                    type="button"
                    onClick={() => r.deleteTopic(topic.id)}
                    aria-label={`Remove ${topic.label}`}
                    className="shrink-0 text-ink4 transition-colors hover:text-spark"
                  >
                    <Trash2 size={13} strokeWidth={1.7} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center gap-3 border-b border-rulestrong pb-2">
            <Plus size={13} strokeWidth={1.8} className="shrink-0 text-spark" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addDraft();
              }}
              aria-label="Add a topic"
              spellCheck={false}
              placeholder="Add a topic"
              className="min-w-0 flex-1 bg-transparent text-[15px] leading-[1.3] text-ink outline-none placeholder:text-ink4"
            />
            <button
              type="button"
              onClick={addDraft}
              disabled={!draft.trim()}
              className="mono shrink-0 bg-ink px-3 py-1.5 text-[9px] tracking-[0.16em] text-canvas uppercase transition-opacity disabled:opacity-25"
            >
              Add
            </button>
          </div>

          <p className="mono mt-6 max-w-[58ch] text-[9.5px] leading-[1.8] tracking-[0.08em] text-ink4 uppercase">
            Topics and classifications are kept on this device alongside your reading state. The
            classifier never fetches a publisher&apos;s page and never reads a story you have not
            already stored.
          </p>
        </div>
      </div>
    </div>
  );
}
