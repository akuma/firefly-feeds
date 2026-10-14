"use client";

import { ChevronDown } from "lucide-react";
import { DIGEST_LANGUAGES, readDigestLanguage } from "@/lib/languages";
import { clsx } from "../clsx";
import { useEffect, useRef, useState } from "react";
import { generatePhase } from "@/lib/briefing/generate";
import { findService, serviceReady } from "@/lib/llm";
import { localDate } from "@/lib/briefing/pipeline";
import { useReader } from "@/lib/store";
import { BRIEFING_LIMITS } from "@/lib/briefing/constants";

/**
 * The briefing's language and focus topics reuse local preferences. The
 * model, the key and the provider are the application's existing model
 * configuration in the same section — one place, one meaning — and generation
 * budgets are product constants the reader is not asked to price.
 */
export function BriefingSettings() {
  const r = useReader();
  const [testing, setTesting] = useState(false);
  const connectionController = useRef<AbortController | null>(null);
  useEffect(() => () => connectionController.current?.abort(), []);
  const [connection, setConnection] = useState<string | null>(null);
  const service = findService(r.llmConfig.service);
  const ready = service && serviceReady(service, r.llmConfig);
  const testConnection = async () => {
    const controller = new AbortController();
    connectionController.current = controller;
    setTesting(true);
    setConnection(null);
    const cutoffAt = Date.now();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = await generatePhase({
      phase: "shortlist",
      signal: controller.signal,
      llm: r.llmConfig,
      payload: {
        schemaVersion: 1,
        editionDate: localDate(cutoffAt, timezone),
        cutoffAt,
        timezone,
        outputLanguage: r.digestLanguage,
        focusTopicIds: [],
        candidates: [],
        previousStories: [],
      },
    });
    if (controller.signal.aborted) return;
    setConnection(result.ok ? "Connection and structured output verified." : result.message);
    setTesting(false);
  };
  const focus = r.briefingFocus;
  const toggle = (id: string) => {
    if (focus.includes(id)) {
      r.setBriefingFocus(focus.filter((topic) => topic !== id));
      return;
    }
    r.setBriefingFocus([...focus, id].slice(0, BRIEFING_LIMITS.maxFocusTopics));
  };

  return (
    <div className="mt-8">
      <label htmlFor="briefing-language" className="label block text-ink4">
        Written in
      </label>
      <div className="relative mt-2 border-b border-rulestrong pr-6 pb-2">
        <select
          id="briefing-language"
          value={r.digestLanguage}
          onChange={(e) => r.setDigestLanguage(readDigestLanguage(e.target.value))}
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
          className="pointer-events-none absolute right-0 bottom-2.5 text-ink4"
        />
      </div>
      <p className="mt-2 text-[13px] leading-[1.45] text-ink4">
        Applies to new editions. Saved editions and resumed runs keep their original language.
      </p>
      <div className="mt-6" />
      <button
        type="button"
        disabled={!ready || testing}
        onClick={testConnection}
        className="mono text-[10px] tracking-[0.13em] text-spark uppercase disabled:cursor-not-allowed disabled:text-ink4"
      >
        {testing ? "Testing connection…" : "Test connection"}
      </button>
      <p className="mt-2 text-[13px] leading-[1.45] text-ink4">
        Sends an empty editorial request. Your provider may charge for this test.
      </p>
      {connection && (
        <p role="status" className="mt-2 text-[13px] text-ink3">
          {connection}
        </p>
      )}
      <div className="mt-6" />
      <div className="label text-ink4">Focus topics · at most {BRIEFING_LIMITS.maxFocusTopics}</div>
      <p className="mt-1.5 max-w-[56ch] text-[13px] leading-[1.45] text-ink4">
        With topics selected, your briefing stays within those interests. Fewer stories are fine.
        Leave empty for a general briefing.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.topics.map((topic) => {
          const on = focus.includes(topic.id);
          return (
            <button
              key={topic.id}
              type="button"
              aria-pressed={on}
              disabled={!on && focus.length >= BRIEFING_LIMITS.maxFocusTopics}
              onClick={() => toggle(topic.id)}
              className={clsx(
                "mono border px-2.5 py-1.5 text-[9.5px] tracking-[0.13em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                on
                  ? "border-spark text-spark"
                  : "border-rule text-ink4 hover:border-rulestrong hover:text-ink2",
              )}
            >
              {topic.label}
            </button>
          );
        })}
        {r.topics.length === 0 && (
          <p className="text-[13px] text-ink4">No topics yet — add one in the Topics section.</p>
        )}
      </div>
    </div>
  );
}
