"use client";

import { ChevronDown, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "./clsx";
import {
  canCallDirectly,
  CLASSIFY_PROVIDERS,
  ollamaTagsUrl,
  readOllamaModels,
  type ClassifyProviderId,
  fieldValue,
  findProvider,
  missingFields,
  providerLabel,
  withField,
} from "@/lib/classify";
import {
  LLM_SERVICES,
  findService,
  llmFieldValue,
  missingFields as llmMissingFields,
  ollamaChatModelsUrl,
  readOllamaChatModels,
  serviceLabel,
  withLlmField,
  type LlmField,
  type LlmServiceId,
} from "@/lib/llm";
import { DIGEST_LANGUAGES, type DigestLanguageId } from "@/lib/languages";
import { DIGEST_INTERESTS_LIMIT } from "@/lib/digest";
import { useReader } from "@/lib/store";

/**
 * Classification settings: the switch, the classifier, and the topic set the
 * reader maintains.
 *
 * A dialog rather than a page because it is a small, occasional decision. It
 * follows the house dialog rule — capped height, a scrolling body — so the
 * topic list can be long without pushing anything out of reach.
 *
 * The classifier half is rendered from `CLASSIFY_PROVIDERS` rather than written
 * out: the list, each one's description and the fields it asks for all come from
 * that table, so a new decision API needs no change here.
 */
export function Settings() {
  const r = useReader();
  const close = () => r.setSettingsOpen(false);
  const [draft, setDraft] = useState("");
  /** The decision models the local Ollama has, or null while asking. */
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  /** Whether Ollama could be asked at all — running, and letting this page in. */
  const [ollamaUnreachable, setOllamaUnreachable] = useState(false);

  /* ---------------------------------------------------------- briefing */

  const chosenLlm = findService(r.llmConfig.service) ?? LLM_SERVICES[0];
  const llmReady = llmMissingFields(chosenLlm, r.llmConfig).length === 0;
  const lastDigestService = serviceLabel(r.digestProvider);
  /** The chat models the local Ollama has, or null while asking. */
  const [ollamaChatModels, setOllamaChatModels] = useState<string[] | null>(null);
  const [ollamaChatUnreachable, setOllamaChatUnreachable] = useState(false);
  const ollamaChatDirect = chosenLlm.id === "ollama" && chosenLlm.direct?.(r.llmConfig) === true;

  // One label per transport, shared with the server so the two never drift.
  const lastProvider = providerLabel(r.classifyProvider);
  const chosen = findProvider(r.classifyConfig.provider) ?? CLASSIFY_PROVIDERS[0];
  const ready = missingFields(chosen, r.classifyConfig).length === 0;

  /*
   * A local Ollama is asked for directly: the request leaves from the reader's
   * machine, which is the only place that can reach it. Where the page itself was
   * served from makes no difference to that — only to whether Ollama's CORS
   * policy admits the page, which is what `ollamaUnreachable` reports.
   */
  const ollamaDirect = chosen.id === "ollama" && canCallDirectly(chosen, r.classifyConfig);
  const ollamaTrouble = chosen.id === "ollama" && ollamaUnreachable;

  // What a local Ollama can actually answer with is a fact only it knows, so the
  // picker asks rather than assuming. Debounced, because the address is a text
  // field and every keystroke would otherwise be a request.
  useEffect(() => {
    if (chosen.id !== "ollama") return;
    const base = r.classifyConfig.ollamaBaseUrl;
    let cancelled = false;
    const timer = setTimeout(() => {
      // The previous list stays until this one arrives, so editing the address
      // does not make the field flicker between a picker and a text box.
      const url = ollamaDirect
        ? ollamaTagsUrl(base)
        : `/api/classify/models?base=${encodeURIComponent(base)}`;
      setOllamaUnreachable(false);
      void fetch(url)
        .then((res) => res.json())
        .then((data: unknown) => {
          if (cancelled) return;
          // Two shapes: Ollama's own list, and the one our endpoint normalises
          // it into when it has to ask on the reader's behalf.
          const list = data as { ok?: boolean; models?: string[] };
          setOllamaModels(
            ollamaDirect ? readOllamaModels(data) : list.ok ? (list.models ?? []) : [],
          );
        })
        .catch(() => {
          // Not the same as an empty list: Ollama was never heard from, so the
          // reader cannot act on this by pulling a model.
          if (cancelled) return;
          setOllamaModels([]);
          setOllamaUnreachable(true);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chosen.id, r.classifyConfig.ollamaBaseUrl, ollamaDirect]);

  // A field whose choices are only known at runtime gets them here, so the table
  // stays a static description and the dialog stays a generic renderer.
  const fields = chosen.fields.map((field) =>
    field.key === "ollamaModel" && ollamaModels?.length
      ? { ...field, choices: ollamaModels.map((name) => ({ value: name, label: name })) }
      : field,
  );

  // The same for the briefing's model picker: what a local Ollama can actually
  // chat with is a fact only it knows, so the list is asked for rather than
  // assumed. Debounced, because the address is a text field.
  useEffect(() => {
    if (chosenLlm.id !== "ollama") return;
    const base = r.llmConfig.baseUrl;
    let cancelled = false;
    const timer = setTimeout(() => {
      setOllamaChatUnreachable(false);
      const url = ollamaChatDirect
        ? ollamaChatModelsUrl(base)
        : `/api/digest/models?base=${encodeURIComponent(base)}`;
      void fetch(url)
        .then((res) => res.json())
        .then((data: unknown) => {
          if (cancelled) return;
          // Two shapes: Ollama's own list, and the one our endpoint normalises
          // it into when it has to ask on the reader's behalf.
          const list = data as { ok?: boolean; models?: string[] };
          setOllamaChatModels(
            ollamaChatDirect ? readOllamaChatModels(data) : list.ok ? (list.models ?? []) : [],
          );
        })
        .catch(() => {
          // Not the same as an empty list: Ollama was never heard from, so the
          // reader cannot act on this by pulling a model.
          if (cancelled) return;
          setOllamaChatModels([]);
          setOllamaChatUnreachable(true);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chosenLlm.id, r.llmConfig.baseUrl, ollamaChatDirect]);

  const llmFields = chosenLlm.fields.map((field) =>
    field.key === "model" && chosenLlm.id === "ollama" && ollamaChatModels?.length
      ? { ...field, choices: ollamaChatModels.map((name) => ({ value: name, label: name })) }
      : field,
  );

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
                Sends a story&apos;s title and summary to the classifier through this app&apos;s own
                endpoint. Off by default; nothing is sent while it is off.
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
                  {ollamaTrouble
                    ? `${chosen.label} unreachable`
                    : ready
                      ? `${chosen.label} ready`
                      : `${chosen.label} needs setting up`}
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

              <div className="mt-6">
                <label htmlFor="classifier" className="label block text-ink4">
                  Classifier
                </label>
                <div className="relative mt-2 border-b border-rulestrong pr-6 pb-2">
                  <select
                    id="classifier"
                    value={chosen.id}
                    onChange={(e) =>
                      r.updateClassifyConfig({
                        provider: e.target.value as ClassifyProviderId,
                      })
                    }
                    className="mono w-full appearance-none bg-transparent text-[13px] text-ink2 outline-none"
                  >
                    {CLASSIFY_PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={12}
                    strokeWidth={1.6}
                    aria-hidden
                    className="pointer-events-none absolute right-0 bottom-3 text-ink4"
                  />
                </div>
                <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                  {chosen.blurb}
                </p>
              </div>

              <p className="mt-2.5 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                Kept in this browser only, and sent to this app&apos;s own endpoint rather than to
                the service itself. A commercial API bills per story, so a local model is the
                cheaper default.
              </p>

              {/* Whatever the chosen transport asks for, rendered from its own
                  entry in the table — so a new one needs no change here. */}
              <div className="mt-6 flex flex-col gap-5">
                {fields.map((field) => {
                  const id = `classify-${field.key}`;
                  const unreachable = field.key === "ollamaModel" && ollamaTrouble;
                  return (
                    <div key={field.key}>
                      <label htmlFor={id} className="label block text-ink4">
                        {field.label}
                        {field.optional && <span className="ml-2 normal-case">(optional)</span>}
                      </label>
                      {unreachable ? (
                        <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink3">
                          Ollama could not be asked at that address. Either it is not running, or it
                          has not admitted this page — a site on a domain needs{" "}
                          <span className="mono">OLLAMA_ORIGINS</span> naming it.
                        </p>
                      ) : (
                        <div className="relative mt-2 flex items-center gap-3 border-b border-rulestrong pb-2">
                          {field.choices ? (
                            <>
                              <select
                                id={id}
                                value={fieldValue(r.classifyConfig, chosen.id, field.key)}
                                onChange={(e) =>
                                  r.updateClassifyConfig(
                                    withField(
                                      r.classifyConfig,
                                      chosen.id,
                                      field.key,
                                      e.target.value,
                                    ),
                                  )
                                }
                                className="mono w-full appearance-none bg-transparent text-[13px] text-ink2 outline-none"
                              >
                                <option value="">{field.placeholder}</option>
                                {field.choices.map((choice) => (
                                  <option key={choice.value} value={choice.value}>
                                    {choice.label}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown
                                size={12}
                                strokeWidth={1.6}
                                aria-hidden
                                className="pointer-events-none absolute right-0 bottom-2.5 text-ink4"
                              />
                            </>
                          ) : (
                            <input
                              id={id}
                              type={field.secret ? "password" : "text"}
                              value={fieldValue(r.classifyConfig, chosen.id, field.key)}
                              onChange={(e) =>
                                r.updateClassifyConfig(
                                  withField(r.classifyConfig, chosen.id, field.key, e.target.value),
                                )
                              }
                              spellCheck={false}
                              autoComplete="off"
                              placeholder={field.placeholder}
                              className="mono min-w-0 flex-1 bg-transparent text-[13px] text-ink2 outline-none placeholder:text-ink4"
                            />
                          )}
                          {field.secret && fieldValue(r.classifyConfig, chosen.id, field.key) && (
                            <button
                              type="button"
                              onClick={() =>
                                r.updateClassifyConfig(
                                  withField(r.classifyConfig, chosen.id, field.key, ""),
                                )
                              }
                              className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      )}
                      {field.hint && (
                        <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                          {field.hint}
                        </p>
                      )}
                      {field.key === "ollamaModel" &&
                        !unreachable &&
                        ollamaModels?.length === 0 && (
                          <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                            No decision models found at that address. Pull one — `ollama pull
                            clef-flash`, say — and it will appear here.
                          </p>
                        )}
                    </div>
                  );
                })}
              </div>

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

          {/* ------------------------------------------------------ briefing */}
          <div className="mt-9 border-t border-rule pt-6">
            <h2 className="display text-[24px] leading-[1.12] font-medium tracking-[-0.016em] text-ink">
              Today&apos;s briefing
            </h2>
            <p className="mt-2.5 max-w-[54ch] text-[14.5px] leading-[1.5] text-ink3">
              A short edition of today&apos;s unread stories, written from their own titles and
              summaries. One a day, and rewritten only when you ask.
            </p>

            <div className="mt-6 flex items-center justify-between gap-4 border-t border-rule pt-5">
              <div className="min-w-0">
                <div className="text-[15.5px] leading-[1.3] text-ink">Write a daily briefing</div>
                <p className="mt-1 max-w-[42ch] text-[13px] leading-[1.45] text-ink4">
                  Sends today&apos;s unread headlines and summaries — up to 20 at once — to the
                  model you chose, using your own key. A local Ollama sends nothing off this
                  machine.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={r.digestEnabled}
                aria-label="Write a daily briefing"
                onClick={() => r.setDigestEnabled(!r.digestEnabled)}
                className={clsx(
                  "mono shrink-0 px-3 py-2 text-[9.5px] tracking-[0.14em] uppercase transition-colors",
                  r.digestEnabled
                    ? "bg-ink text-canvas"
                    : "text-ink3 ring-1 ring-rule ring-inset hover:bg-hoverc hover:text-ink",
                )}
              >
                {r.digestEnabled ? "On" : "Off"}
              </button>
            </div>

            {r.digestEnabled && (
              <div className="ff-fade mt-5">
                <div className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={11} strokeWidth={1.6} />
                    {ollamaChatUnreachable
                      ? `${chosenLlm.label} unreachable`
                      : llmReady
                        ? `${chosenLlm.label} ready`
                        : `${chosenLlm.label} needs setting up`}
                  </span>
                  {r.digestWorking && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-spark">Writing…</span>
                    </>
                  )}
                  {lastDigestService && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Last via {lastDigestService}</span>
                    </>
                  )}
                </div>

                <div className="mt-6">
                  <label htmlFor="llm-service" className="label block text-ink4">
                    Model provider
                  </label>
                  <div className="relative mt-2 border-b border-rulestrong pr-6 pb-2">
                    <select
                      id="llm-service"
                      value={chosenLlm.id}
                      onChange={(e) =>
                        r.updateLlmConfig({ service: e.target.value as LlmServiceId })
                      }
                      className="mono w-full appearance-none bg-transparent text-[13px] text-ink2 outline-none"
                    >
                      {LLM_SERVICES.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={12}
                      strokeWidth={1.6}
                      aria-hidden
                      className="pointer-events-none absolute right-0 bottom-3 text-ink4"
                    />
                  </div>
                  <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                    {chosenLlm.blurb}
                  </p>
                </div>

                <p className="mt-2.5 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                  Kept in this browser only, and sent to this app&apos;s own endpoint rather than to
                  the service itself. A model of your own bills per edition, so a local one is the
                  cheaper default.
                </p>

                <div className="mt-6">
                  <label htmlFor="llm-language" className="label block text-ink4">
                    Written in
                  </label>
                  <div className="relative mt-2 border-b border-rulestrong pr-6 pb-2">
                    <select
                      id="llm-language"
                      value={r.digestLanguage}
                      onChange={(e) => r.setDigestLanguage(e.target.value as DigestLanguageId)}
                      className="mono w-full appearance-none bg-transparent text-[13px] text-ink2 outline-none"
                    >
                      {DIGEST_LANGUAGES.map((language) => (
                        <option key={language.id} value={language.id}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={12}
                      strokeWidth={1.6}
                      aria-hidden
                      className="pointer-events-none absolute right-0 bottom-3 text-ink4"
                    />
                  </div>
                  <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                    The language the gists and reasons are written in. With the story&apos;s own
                    language chosen, each one follows its story and the page around them stays in
                    English.
                  </p>
                </div>

                <div className="mt-6">
                  <label htmlFor="llm-interests" className="label block text-ink4">
                    Reading taste
                  </label>
                  <textarea
                    id="llm-interests"
                    value={r.digestInterests}
                    onChange={(e) =>
                      r.setDigestInterests(e.target.value.slice(0, DIGEST_INTERESTS_LIMIT))
                    }
                    rows={3}
                    spellCheck={false}
                    placeholder="What you like, what you skip — and the kind of detail you want"
                    className="mono min-h-[64px] w-full resize-y border-b border-rulestrong bg-transparent py-2 text-[13px] leading-[1.5] text-ink2 outline-none placeholder:text-ink4"
                  />
                  <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                    Write it as taste, not as a list of topics: what makes a piece worth your time —
                    evidence, process, numbers — and what wastes it, such as predictions, funding
                    news or press releases. What you skip is the strongest line here: it rules a
                    story out however big it is. Subjects are welcome too, but taste travels further
                    — it applies to tomorrow&apos;s stories even when they are about nothing you
                    named. Empty, and the edition is chosen for a reader nobody has met.
                  </p>
                </div>

                {/* Whatever the chosen service asks for, rendered from its own
                    entry in the table — so a new one needs no change here. */}
                <div className="mt-6 flex flex-col gap-5">
                  {llmFields.map((field) => {
                    const id = `llm-${field.key}`;
                    const unreachable =
                      field.key === "model" && chosenLlm.id === "ollama" && ollamaChatUnreachable;
                    const value = llmFieldValue(r.llmConfig, field as LlmField);
                    const write = (next: string) =>
                      r.updateLlmConfig(withLlmField(r.llmConfig, field as LlmField, next));
                    return (
                      <div key={field.key}>
                        <label htmlFor={id} className="label block text-ink4">
                          {field.label}
                          {field.optional && <span className="ml-2 normal-case">(optional)</span>}
                        </label>
                        {unreachable ? (
                          <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink3">
                            Ollama could not be asked at that address. Either it is not running, or
                            it has not admitted this page — a site on a domain needs{" "}
                            <span className="mono">OLLAMA_ORIGINS</span> naming it.
                          </p>
                        ) : (
                          <div className="relative mt-2 flex items-center gap-3 border-b border-rulestrong pb-2">
                            {field.choices ? (
                              <>
                                <select
                                  id={id}
                                  value={value}
                                  onChange={(e) => write(e.target.value)}
                                  className="mono w-full appearance-none bg-transparent text-[13px] text-ink2 outline-none"
                                >
                                  <option value="">{field.placeholder}</option>
                                  {field.choices.map((choice) => (
                                    <option key={choice.value} value={choice.value}>
                                      {choice.label}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown
                                  size={12}
                                  strokeWidth={1.6}
                                  aria-hidden
                                  className="pointer-events-none absolute right-0 bottom-2.5 text-ink4"
                                />
                              </>
                            ) : (
                              <input
                                id={id}
                                type={field.secret ? "password" : "text"}
                                value={value}
                                onChange={(e) => write(e.target.value)}
                                spellCheck={false}
                                autoComplete="off"
                                placeholder={field.placeholder}
                                className="mono min-w-0 flex-1 bg-transparent text-[13px] text-ink2 outline-none placeholder:text-ink4"
                              />
                            )}
                            {field.secret && value && (
                              <button
                                type="button"
                                onClick={() => write("")}
                                className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        )}
                        {field.hint && (
                          <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                            {field.hint}
                          </p>
                        )}
                        {field.key === "model" &&
                          chosenLlm.id === "ollama" &&
                          !unreachable &&
                          ollamaChatModels?.length === 0 && (
                            <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.45] text-ink4">
                              No chat models found at that address. Pull one —{" "}
                              <span className="mono">ollama pull llama3.2</span>, say — and it will
                              appear here.
                            </p>
                          )}
                      </div>
                    );
                  })}
                </div>

                {r.digestError && (
                  <div className="mt-5 flex items-start justify-between gap-4 border-l-2 border-spark py-1 pl-4">
                    <p className="text-[13.5px] leading-[1.5] text-ink2">{r.digestError}</p>
                    <button
                      type="button"
                      onClick={r.writeEdition}
                      className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

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
