"use client";

import { clsx } from "../clsx";
import { useReader } from "@/lib/store";
import { BRIEFING_LIMITS } from "@/lib/briefing/constants";

/**
 * The briefing's only settings: which topics it leans toward. The model, the
 * key and the provider are the application's existing model configuration —
 * one place, one meaning — and generation budgets are product constants the
 * reader is not asked to price.
 */
export function BriefingSettings() {
  const r = useReader();
  const focus = r.briefingFocus;
  const toggle = (id: string) => {
    if (focus.includes(id)) {
      r.setBriefingFocus(focus.filter((topic) => topic !== id));
      return;
    }
    r.setBriefingFocus([...focus, id].slice(0, BRIEFING_LIMITS.maxFocusTopics));
  };

  return (
    <div className="mt-9 border-t border-rule pt-6">
      <h2 className="display text-[21px] leading-[1.14] font-medium tracking-[-0.014em] text-ink">
        AI Briefing
      </h2>
      <p className="mt-1.5 max-w-[56ch] text-[13px] leading-[1.45] text-ink4">
        The daily edition is written by the model configured above. Only the selected stories&rsquo;
        titles, summaries and limited text are sent to that provider; your key is stored in this
        browser and is readable by this page&rsquo;s JavaScript. Generation uses your
        provider&rsquo;s own billing.
      </p>

      <div className="mt-5">
        <div className="label text-ink4">
          Focus topics · at most {BRIEFING_LIMITS.maxFocusTopics}
        </div>
        <p className="mt-1.5 max-w-[56ch] text-[13px] leading-[1.45] text-ink4">
          A small weight behind editorial value — never a filter, and never a reason to pad an
          edition.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.topics.map((topic) => {
            const on = focus.includes(topic.id);
            return (
              <button
                key={topic.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(topic.id)}
                className={clsx(
                  "mono border px-2.5 py-1.5 text-[9.5px] tracking-[0.13em] uppercase transition-colors",
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
            <p className="text-[13px] text-ink4">No topics yet — add one above.</p>
          )}
        </div>
      </div>
    </div>
  );
}
