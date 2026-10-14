import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleContentResult } from "../article-content";
import type { LlmConfig } from "../llm";
import type { ArticleRecord, SourceRecord } from "../storage/types";
import type {
  ComposeInput,
  ComposeOutput,
  GenerateResult,
  ShortlistInput,
  ShortlistOutput,
} from "./types";

/**
 * The golden case of docs/specs/ai-daily-briefing.md §11: two sources on one
 * release, one unrelated story, one older essay, one essay already
 * recommended. Deterministic stages run for real; only the model and the
 * network are stubbed, because both are exactly what the pipeline exists to
 * survive.
 */

let previousDb: typeof import("../storage/db") | undefined;

async function freshModules() {
  if (previousDb) {
    await previousDb.close();
    previousDb = undefined;
  }
  vi.resetModules();
  await deleteDB("firefly-feeds").catch(() => {});
  previousDb = await import("../storage/db");
  return {
    pipeline: await import("./pipeline"),
    repo: await import("../storage/repository"),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(T0);
});

afterEach(() => vi.restoreAllMocks());

const T0 = new Date("2026-10-13T08:00:00Z").getTime();
const HOURS = 60 * 60_000;

const LLM: LlmConfig = { service: "openai", wire: "openai", baseUrl: "", models: {}, keys: {} };

/** A promise whose resolution the test decides — for a run still thinking. */
function deferred<T>() {
  const box: { settle?: (value: T) => void } = {};
  const promise = new Promise<T>((settle) => {
    box.settle = settle;
  });
  return { promise, resolve: (value: T) => box.settle?.(value) };
}

function source(id: string, title: string): SourceRecord {
  return {
    id,
    url: `https://${id}.example/feed.xml`,
    siteUrl: `https://${id}.example`,
    title,
    host: `${id}.example`,
    addedAt: T0,
    fetchedAt: T0,
    updatedAt: T0,
  };
}

function article(
  id: string,
  sourceId: string,
  publishedAt: number,
  title: string,
  summary: string,
  patch: Partial<ArticleRecord> = {},
): ArticleRecord {
  return {
    id,
    sourceId,
    title,
    publishedAt,
    fetchedAt: T0,
    summary,
    body: [{ kind: "p", text: summary }],
    minutes: 4,
    layout: "standard",
    contentState: "summary",
    extractionState: "idle",
    ...patch,
  };
}

const FIXTURE = {
  sources: [source("A", "Source A"), source("B", "Source B"), source("C", "Source C")],
  classifications: [],
  articles: [
    article(
      "A~A1",
      "A",
      T0 - HOURS,
      "A robotics project releases a new version",
      "The robotics project released version 2 with limits on memory.",
    ),
    article(
      "B~B1",
      "B",
      T0 - HOURS,
      "A technical report on the same release",
      "The lab published a technical report on the same release.",
    ),
    article(
      "A~A2",
      "A",
      T0 - 2 * HOURS,
      "A chip maker announces a new part",
      "A chip maker announced a new part.",
    ),
    article(
      "C~C1",
      "C",
      T0 - 5 * 24 * HOURS,
      "Engineering tradeoffs in software delivery",
      "A long argument about delivery tradeoffs.",
      { body: [] },
    ),
    article(
      "C~C2",
      "C",
      T0 - 6 * 24 * HOURS,
      "The same essay as last week",
      "An essay already recommended last week.",
    ),
  ],
  history: [
    {
      editionDate: "2026-10-12",
      headline: "Yesterday's pick",
      sourceArticleIds: ["C~C2"],
    },
  ],
};

const shortlistAnswer: ShortlistOutput = {
  schemaVersion: 1,
  groups: [
    {
      groupId: "g1",
      kind: "news",
      workingHeadline: "A robotics project releases a new version",
      articleIds: ["A~A1", "B~B1"],
      value: 3,
      novelty: 2,
      evidence: 2,
      selectionReason: "Two articles describe the same substantive release",
      missingInformation: "Details and limitations of the new version",
    },
    {
      groupId: "g2",
      kind: "insight",
      workingHeadline: "Engineering tradeoffs in software delivery",
      articleIds: ["C~C1"],
      value: 4,
      novelty: 2,
      evidence: 2,
      selectionReason: "A substantive long-form argument",
      missingInformation: "Whether conclusions are supported in full text",
    },
  ],
  extractArticleIds: ["A~A1", "C~C1"],
};

const composeAnswer: ComposeOutput = {
  schemaVersion: 1,
  bigPicture: null,
  topStories: [
    {
      headline: "A robotics project releases a new version",
      whatHappened: {
        text: "The project released version 2 with limits on memory.",
        evidence: [{ articleId: "A~A1", excerpt: "released version 2 with limits on memory." }],
      },
      context: {
        text: "The lab published a report on the same release.",
        evidence: [{ articleId: "B~B1", excerpt: "The lab published a technical report" }],
      },
      whyItMatters: null,
      perspectives: [],
    },
  ],
  // C1's extraction failed and the summary does not support a deep read; C2
  // was recommended yesterday. Neither may appear — the edition shrinks
  // instead of inventing.
  worthReading: [],
};

function stubGenerate(options: {
  shortlist?: () => GenerateResult;
  compose?: () => GenerateResult;
}) {
  const calls: { phase: string; feedback?: string[] }[] = [];
  const generate = async (call: {
    phase: "shortlist" | "compose";
    payload: ShortlistInput | ComposeInput;
    retryFeedback?: string[];
  }) => {
    calls.push({ phase: call.phase, feedback: call.retryFeedback });
    const answer =
      call.phase === "shortlist"
        ? (options.shortlist?.() ?? {
            ok: true as const,
            phase: "shortlist" as const,
            result: shortlistAnswer,
            provider: "stub",
            model: "stub-1",
          })
        : (options.compose?.() ?? {
            ok: true as const,
            phase: "compose" as const,
            result: composeAnswer,
            provider: "stub",
            model: "stub-1",
          });
    return answer;
  };
  return { calls, generate };
}

describe("the briefing pipeline", () => {
  it("writes the annotated edition end to end, in two calls, without trusting the model's metadata", async () => {
    const { pipeline, repo } = await freshModules();
    const { calls, generate } = stubGenerate({});
    const fetched: string[] = [];

    const outcome = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: ["technology"],
      timezone: "Europe/Berlin",
      llm: LLM,
      generate,
      fetchContent: async ({ article: target }): Promise<ArticleContentResult> => {
        fetched.push(target.id);
        if (target.id === "C~C1") {
          // the site refuses; the feed summary carries the candidate onward
          return {
            article: { ...target, extractionState: "failed", contentCheckedAt: Date.now() },
            availability: "summary",
            fetched: false,
            error: "forbidden",
          };
        }
        return {
          article: {
            ...target,
            body: [
              { kind: "p", text: "The robotics project released version 2 with limits on memory." },
            ],
            contentState: "full",
            extractionState: "success",
            contentFetchedAt: Date.now(),
          },
          availability: "full",
          fetched: true,
        };
      },
    });

    expect(outcome.error).toBeUndefined();
    const edition = outcome.edition!;
    expect(edition.id).toBe(`${edition.editionKey}#r1`);
    expect(edition.editionDate).toBe("2026-10-13");
    // one event, one story, two sources — the program, not the model, decides
    // what the source list says
    expect(edition.topStories).toHaveLength(1);
    expect(edition.topStories[0].sourceArticleIds).toEqual(["A~A1", "B~B1"]);
    expect(edition.sourceSnapshots.map((s) => s.sourceName).toSorted()).toEqual([
      "Source A",
      "Source B",
    ]);
    expect(edition.topStories[0].headline).toBe("A robotics project releases a new version");
    expect(edition.stats.llmRequests).toBe(2);
    expect(edition.stats.fullTextsFetched).toBe(1);
    expect(edition.stats.fullTextsFailed).toBe(1);

    // extraction was attempted only where the shortlist asked for it
    expect(fetched.toSorted()).toEqual(["A~A1", "C~C1"]);
    // a failed body is a feed summary, labelled as one — never dressed as full
    const run = await repo.getBriefingRun(outcome.run.runId);
    const material = run?.materials?.find((m) => m.articleId === "C~C1");
    expect(material?.materialQuality).toBe("feed-summary");

    expect(calls.map((c) => c.phase)).toEqual(["shortlist", "compose"]);
  });

  it("repairs one bad answer with the validator's own words, and stops there", async () => {
    const { pipeline, repo } = await freshModules();
    let shortlistCalls = 0;
    const { calls, generate } = stubGenerate({
      shortlist: () => {
        shortlistCalls += 1;
        if (shortlistCalls === 1) {
          return {
            ok: false,
            code: "INVALID_OUTPUT",
            message: "bad",
            retryable: true,
            errors: ['groups[0].articleIds: unknown article "MADE-UP"'],
          };
        }
        return {
          ok: true,
          phase: "shortlist",
          result: shortlistAnswer,
          provider: "stub",
          model: "stub-1",
        };
      },
    });

    const outcome = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "Europe/Berlin",
      llm: LLM,
      generate,
      fetchContent: async ({ article: target }) => ({
        article: target,
        availability: "summary",
        fetched: false,
      }),
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.edition?.stats.llmRequests).toBe(3);
    // the repair repeated the same frozen question and only added complaints
    expect(calls[0].feedback).toBeUndefined();
    expect(calls[1].feedback).toEqual(['groups[0].articleIds: unknown article "MADE-UP"']);
    expect(await repo.getBriefings()).toHaveLength(1);
  });

  it("publishes nothing when the model cannot produce a usable answer", async () => {
    const { pipeline, repo } = await freshModules();
    const { generate } = stubGenerate({
      shortlist: () => ({
        ok: false,
        code: "INVALID_OUTPUT",
        message: "bad",
        retryable: false,
      }),
    });
    const outcome = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "Europe/Berlin",
      llm: LLM,
      generate,
      fetchContent: async ({ article: target }) => ({
        article: target,
        availability: "summary",
        fetched: false,
      }),
    });
    expect(outcome.edition).toBeUndefined();
    expect(outcome.error?.code).toBe("INVALID_OUTPUT");
    // a failed run is kept for diagnosis; a half-written edition is not
    expect(await repo.getBriefings()).toHaveLength(0);
    expect(outcome.run.status).toBe("failed");
  });

  it("gives a regenerated day a new revision and keeps the old edition readable", async () => {
    const { pipeline } = await freshModules();
    const args = {
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "Europe/Berlin",
      llm: LLM,
      fetchContent: async ({ article: target }: { article: ArticleRecord }) => ({
        article: target,
        availability: "summary" as const,
        fetched: false,
      }),
    };
    const first = await pipeline.runBriefing({ ...args, ...stubGenerate({}) });
    const second = await pipeline.runBriefing({ ...args, ...stubGenerate({}) });

    expect(first.edition?.id).toBe(`${first.edition?.editionKey}#r1`);
    expect(second.edition?.id).toBe(`${second.edition?.editionKey}#r2`);
    // Regenerate never overwrites: both revisions remain
    const editions = await pipeline.loadBriefings();
    expect(editions.map((e) => e.revision).toSorted()).toEqual([1, 2]);
  });

  it("stops when the reader cancels, and keeps the frozen run for resuming", async () => {
    const { pipeline, repo } = await freshModules();
    const controller = new AbortController();
    const { generate } = stubGenerate({});
    const outcome = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "Europe/Berlin",
      llm: LLM,
      generate,
      signal: controller.signal,
      fetchContent: async ({ article: target }) => {
        controller.abort();
        return { article: target, availability: "summary", fetched: false, error: "cancelled" };
      },
    });
    expect(outcome.edition).toBeUndefined();
    expect(outcome.run.status).toBe("cancelled");
    const resumable = await pipeline.loadResumableRun();
    expect(resumable?.runId).toBe(outcome.run.runId);
    expect(await repo.getBriefings()).toHaveLength(0);
  });

  it("refuses to run while another tab holds the lease", async () => {
    const { pipeline, repo } = await freshModules();
    const args = {
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "Europe/Berlin",
      llm: LLM,
      fetchContent: async ({ article: target }: { article: ArticleRecord }) => ({
        article: target,
        availability: "summary" as const,
        fetched: false,
      }),
    };
    // A run started elsewhere and still thinking: its lease is held.
    const held = deferred<GenerateResult>();
    const foreign = pipeline.runBriefing({
      ...args,
      owner: "tab:other",
      generate: () => held.promise,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const mine = await pipeline.runBriefing({ ...args, owner: "tab:mine", ...stubGenerate({}) });
    expect(mine.error?.code).toBe("IN_USE");
    expect(mine.edition).toBeUndefined();
    expect(await repo.getBriefings()).toHaveLength(0);

    // let the other tab finish so nothing leaks past the test
    held.resolve({
      ok: false,
      code: "PROVIDER_ERROR",
      message: "stopped",
      retryable: false,
    });
    await foreign;
  });
  it("resumes unfinished enrichment on frozen articles without repeating completed work", async () => {
    const { pipeline } = await freshModules();
    const controller = new AbortController();
    const first = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      outputLanguage: "zh-Hans",
      llm: LLM,
      ...stubGenerate({}),
      signal: controller.signal,
      fetchContent: async ({ article: target }) => {
        if (target.id === "C~C1") {
          controller.abort();
          return { article: target, availability: "summary", fetched: false, error: "cancelled" };
        }
        return { article: target, availability: "full", fetched: true };
      },
    });
    expect(first.run.status).toBe("cancelled");
    const fetched: string[] = [];
    const second = await pipeline.runBriefing({
      ...FIXTURE,
      articles: FIXTURE.articles.map((a) => ({ ...a, summary: "CHANGED", body: [] })),
      focusTopicIds: [],
      timezone: "Asia/Shanghai",
      outputLanguage: "ja",
      llm: LLM,
      resume: first.run,
      ...stubGenerate({}),
      fetchContent: async ({ article: target }) => {
        fetched.push(target.id);
        expect(target.summary).not.toBe("CHANGED");
        return { article: target, availability: "summary", fetched: false };
      },
    });
    expect(second.error).toBeUndefined();
    expect(fetched).toEqual(["C~C1"]);
    expect(second.edition?.timezone).toBe("UTC");
    expect(second.run.prepared?.outputLanguage).toBe("zh-Hans");
    expect(second.edition?.outputLanguage).toBe("zh-Hans");
    expect(second.edition?.stats.fullTextsFetched).toBe(1);
  });

  it("does not publish or repair an answer after cancellation during a model call", async () => {
    const { pipeline, repo } = await freshModules();
    const controller = new AbortController();
    const { generate, calls } = stubGenerate({});
    const result = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      llm: LLM,
      signal: controller.signal,
      generate: async (call) => {
        controller.abort();
        return generate(call);
      },
    });
    expect(result.run.status).toBe("cancelled");
    expect(calls).toHaveLength(1);
    expect(await repo.getBriefings()).toEqual([]);
  });

  it("never resets the paid-call ceiling when a failed run is resumed", async () => {
    const { pipeline } = await freshModules();
    const stub = stubGenerate({
      shortlist: () => ({
        ok: false,
        code: "PROVIDER_ERROR",
        message: "offline",
        retryable: true,
      }),
    });
    const args = { ...FIXTURE, focusTopicIds: [], timezone: "UTC", llm: LLM, ...stub };
    const first = await pipeline.runBriefing(args);
    const second = await pipeline.runBriefing({ ...args, resume: first.run });
    await pipeline.runBriefing({ ...args, resume: second.run });
    expect(stub.calls.length).toBeLessThanOrEqual(3);
  });

  it("locks different edition slots globally and preserves a newer owner's checkpoint", async () => {
    const { pipeline, repo } = await freshModules();
    const args = {
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      llm: LLM,
      ...stubGenerate({}),
      fetchContent: async ({ article: a }: { article: ArticleRecord }) => ({
        article: a,
        availability: "summary" as const,
        fetched: false,
      }),
    };
    const first = await pipeline.runBriefing(args);
    const old = {
      ...first.run,
      runId: "other-slot",
      editionKey: "other-issue@UTC",
      status: "shortlisting" as const,
    };
    expect(await repo.claimBriefingRun(old, "foreign", Date.now(), 120000)).toBe(true);
    const second = await pipeline.runBriefing(args);
    expect(second.error?.code).toBe("IN_USE");
    const stolen = { ...old, lease: { ownerId: "old", expiresAt: Date.now() + 120000 } };
    await expect(repo.putBriefingRun(stolen)).rejects.toThrow(/lease/i);
    expect((await repo.getBriefingRun(old.runId))?.lease?.ownerId).toBe("foreign");
  });
  it("counts cancelled extraction attempts against the run's total network budget", async () => {
    const { pipeline } = await freshModules();
    let resume: import("./types").BriefingRun | undefined;
    let attempts = 0;
    for (let i = 0; i < 12; i++) {
      const controller = new AbortController();
      /* oxlint-disable-next-line no-await-in-loop */
      const result = await pipeline.runBriefing({
        ...FIXTURE,
        focusTopicIds: [],
        timezone: "UTC",
        llm: LLM,
        ...stubGenerate({}),
        resume,
        signal: controller.signal,
        fetchContent: async ({ article: a }) => {
          attempts++;
          controller.abort();
          return { article: a, availability: "summary", fetched: false, error: "cancelled" };
        },
      });
      resume = result.run;
      if (result.edition) break;
    }
    expect(attempts).toBeLessThanOrEqual(10);
  });
  it("preserves safe field-level validation details in the visible phase error", async () => {
    const { pipeline } = await freshModules();
    const result = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      llm: LLM,
      ...stubGenerate({
        shortlist: () => ({
          ok: false,
          code: "INVALID_OUTPUT",
          message: "The model's answer did not match the phase schema.",
          retryable: false,
          errors: ["groups[0].missingInformation: missing"],
        }),
      }),
    });
    expect(result.error?.message).toContain("groups[0].missingInformation: missing");
  });
  it.each([1, 6])(
    "can publish from just %s input articles without a minimum-ten rule",
    async (count) => {
      const { pipeline } = await freshModules();
      const items = Array.from({ length: count }, (_, i) =>
        article(
          `A~small${i}`,
          "A",
          Date.now() - 1000 - i,
          `Distinct release ${i}`,
          "The project released version 2 with limits on memory.",
        ),
      );
      const shortlist: ShortlistOutput = {
        schemaVersion: 1,
        groups: [{ ...shortlistAnswer.groups[0], articleIds: [items[0].id] }],
        extractArticleIds: [],
      };
      const composed: ComposeOutput = {
        ...composeAnswer,
        topStories: [
          {
            ...composeAnswer.topStories[0],
            context: null,
            whatHappened: {
              ...composeAnswer.topStories[0].whatHappened,
              evidence: [
                { articleId: items[0].id, excerpt: "released version 2 with limits on memory." },
              ],
            },
          },
        ],
      };
      const result = await pipeline.runBriefing({
        ...FIXTURE,
        articles: items,
        focusTopicIds: [],
        timezone: "UTC",
        llm: LLM,
        ...stubGenerate({
          shortlist: () => ({
            ok: true,
            phase: "shortlist",
            result: shortlist,
            provider: "stub",
            model: "stub",
          }),
          compose: () => ({
            ok: true,
            phase: "compose",
            result: composed,
            provider: "stub",
            model: "stub",
          }),
        }),
      });
      expect(result.error).toBeUndefined();
      expect(result.edition?.topStories).toHaveLength(1);
      expect(result.edition?.stats.candidates).toBe(count);
    },
  );

  it.each(["low score", "wrong section"] as const)(
    "publishes qualifying topics without a paid repair for one item with %s",
    async (problem) => {
      const { pipeline } = await freshModules();
      const shortlist: ShortlistOutput = {
        ...shortlistAnswer,
        groups: [
          ...shortlistAnswer.groups,
          {
            ...shortlistAnswer.groups[0],
            groupId: "weak",
            articleIds: ["A~A2"],
            kind: problem === "wrong section" ? "insight" : "news",
            value: problem === "wrong section" ? 3 : 1,
            novelty: 1,
            evidence: 2,
          },
        ],
      };
      const composed: ComposeOutput = {
        ...composeAnswer,
        topStories: [
          ...composeAnswer.topStories,
          {
            headline: "A chip maker announces a new part",
            whatHappened: {
              text: "A chip maker announced a new part.",
              evidence: [{ articleId: "A~A2", excerpt: "A chip maker announced a new part." }],
            },
            context: null,
            whyItMatters: null,
            perspectives: [],
          },
        ],
      };
      const model = stubGenerate({
        shortlist: () => ({
          ok: true,
          phase: "shortlist",
          result: shortlist,
          provider: "stub",
          model: "stub",
        }),
        compose: () => ({
          ok: true,
          phase: "compose",
          result: composed,
          provider: "stub",
          model: "stub",
        }),
      });
      const result = await pipeline.runBriefing({
        ...FIXTURE,
        focusTopicIds: [],
        timezone: "UTC",
        llm: LLM,
        ...model,
        fetchContent: async ({ article: a }) => ({
          article: a,
          availability: "summary",
          fetched: false,
        }),
      });
      expect(result.error).toBeUndefined();
      expect(result.edition?.topStories).toHaveLength(1);
      expect(result.edition?.stats.omittedWeakItems).toBe(1);
      expect(model.calls).toHaveLength(2);
    },
  );
});

it("carries a truncation requirement into Resume on an older checkpoint without spending a new shortlist call", async () => {
  const { pipeline } = await freshModules();
  const first = await pipeline.runBriefing({
    ...FIXTURE,
    focusTopicIds: [],
    timezone: "UTC",
    llm: LLM,
    ...stubGenerate({
      compose: () => ({
        ok: false,
        code: "OUTPUT_TRUNCATED",
        message: "cut off",
        retryable: false,
      }),
    }),
    fetchContent: async ({ article: target }) => ({
      article: target,
      availability: "summary",
      fetched: false,
    }),
  });
  expect(first.run.callsUsed).toBe(2);
  const oldCheckpoint = { ...first.run, truncatedPhases: undefined };
  const { generate, calls } = stubGenerate({});
  const resumed = await pipeline.runBriefing({
    ...FIXTURE,
    focusTopicIds: [],
    timezone: "UTC",
    llm: LLM,
    resume: oldCheckpoint,
    generate,
  });
  expect(resumed.error).toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(calls[0].phase).toBe("compose");
  expect(calls[0].feedback).toContain("OUTPUT_TRUNCATED");
  expect(resumed.edition?.stats.llmRequests).toBe(3);
});

it("asks for compact writing when selection already used the one repair call", async () => {
  const { pipeline } = await freshModules();
  let shortlistCalls = 0;
  const model = stubGenerate({
    shortlist: () => {
      shortlistCalls++;
      return shortlistCalls === 1
        ? { ok: false, code: "INVALID_OUTPUT", message: "bad shape", retryable: true }
        : {
            ok: true,
            phase: "shortlist",
            result: shortlistAnswer,
            provider: "stub",
            model: "stub",
          };
    },
  });
  const result = await pipeline.runBriefing({
    ...FIXTURE,
    focusTopicIds: [],
    timezone: "UTC",
    llm: LLM,
    ...model,
    fetchContent: async ({ article: target }) => ({
      article: target,
      availability: "summary",
      fetched: false,
    }),
  });
  expect(result.error).toBeUndefined();
  expect(model.calls[2].feedback).toContain("COMPACT_OUTPUT");
  expect(model.calls).toHaveLength(3);
});

it.each(["shortlist", "compose"] as const)(
  "retains the compact requirement when cancellation lands on a truncated %s reply",
  async (phase) => {
    const { pipeline } = await freshModules();
    const controller = new AbortController();
    const first = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      llm: LLM,
      signal: controller.signal,
      ...stubGenerate({
        [phase]: () => {
          controller.abort();
          return { ok: false, code: "OUTPUT_TRUNCATED", message: "cut off", retryable: true };
        },
      }),
      fetchContent: async ({ article: target }) => ({
        article: target,
        availability: "summary",
        fetched: false,
      }),
    });
    expect(first.run.status).toBe("cancelled");
    expect(first.run.truncatedPhases).toEqual([phase]);
    const model = stubGenerate({});
    const resumed = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      llm: LLM,
      resume: first.run,
      ...model,
    });
    expect(resumed.error).toBeUndefined();
    expect(model.calls).toHaveLength(phase === "shortlist" ? 2 : 1);
    expect(model.calls[0].feedback).toContain("OUTPUT_TRUNCATED");
    if (phase === "shortlist") expect(model.calls[1].feedback).toContain("COMPACT_OUTPUT");
  },
);

it.each(["OUTPUT_TRUNCATED", "INVALID_OUTPUT"] as const)(
  "repairs a %s compose reply only once on frozen material",
  async (code) => {
    const { pipeline } = await freshModules();
    let writingCalls = 0;
    const model = stubGenerate({
      compose: () => {
        writingCalls++;
        return writingCalls === 1
          ? {
              ok: false,
              code,
              message: "cut off",
              retryable: true,
              errors: [
                code === "OUTPUT_TRUNCATED"
                  ? "output: cut off at the token limit"
                  : "topStories[0].whatHappened: missing",
              ],
            }
          : { ok: true, phase: "compose", result: composeAnswer, provider: "stub", model: "stub" };
      },
    });
    const result = await pipeline.runBriefing({
      ...FIXTURE,
      focusTopicIds: [],
      timezone: "UTC",
      llm: LLM,
      ...model,
      fetchContent: async ({ article: target }) => ({
        article: target,
        availability: "summary",
        fetched: false,
      }),
    });
    expect(result.error).toBeUndefined();
    expect(result.run.truncatedPhases).toEqual(
      code === "OUTPUT_TRUNCATED" ? ["compose"] : undefined,
    );
    expect(model.calls.map((c) => c.phase)).toEqual(["shortlist", "compose", "compose"]);
    if (code === "OUTPUT_TRUNCATED")
      expect(model.calls[2].feedback).toEqual(["output: cut off at the token limit"]);
    else
      expect(model.calls[2].feedback).toEqual([
        "topStories[0].whatHappened: missing",
        "COMPACT_OUTPUT",
      ]);
  },
);

function failWritingForResume() {
  return stubGenerate({
    compose: () => ({
      ok: false,
      code: "PROVIDER_ERROR",
      message: "interrupted",
      retryable: false,
    }),
  });
}

it("hides an older incomplete run after a newer edition is saved without deleting its checkpoint", async () => {
  const { pipeline, repo } = await freshModules();
  const args = {
    ...FIXTURE,
    focusTopicIds: [],
    timezone: "UTC",
    llm: LLM,
    fetchContent: async ({ article: target }: { article: ArticleRecord }) => ({
      article: target,
      availability: "summary" as const,
      fetched: false,
    }),
  };
  const old = await pipeline.runBriefing({ ...args, ...failWritingForResume() });
  const saved = await pipeline.runBriefing({ ...args, ...stubGenerate({}) });
  expect(saved.edition).toBeDefined();
  await repo.putBriefingRun({ ...old.run, updatedAt: T0 + 10000 });
  expect(await pipeline.loadResumableRun(old.run.editionKey)).toBeUndefined();
  expect(await repo.getBriefingRun(old.run.runId)).toBeDefined();
  // The saved version can arrive after the UI's eligibility check but before claim.
  expect(await repo.claimBriefingRun(old.run, "late-tab", T0, 120000)).toBe(false);
  await repo.deleteBriefingRun(saved.run.runId);
  expect(await repo.claimBriefingRun(old.run, "late-tab", T0, 120000)).toBe(false);
});

it("does not offer a different date or timezone's unfinished run", async () => {
  const { pipeline } = await freshModules();
  const failed = await pipeline.runBriefing({
    ...FIXTURE,
    focusTopicIds: [],
    timezone: "UTC",
    llm: LLM,
    ...failWritingForResume(),
    fetchContent: async ({ article: target }) => ({
      article: target,
      availability: "summary",
      fetched: false,
    }),
  });
  expect(await pipeline.loadResumableRun(failed.run.editionKey)).toBeDefined();
  expect(await pipeline.loadResumableRun("2026-10-14@UTC")).toBeUndefined();
  expect(await pipeline.loadResumableRun("2026-10-13@Asia/Shanghai")).toBeUndefined();
});

it("does not fall back to an older failed run when the newest attempt has exhausted its budget", async () => {
  const { pipeline } = await freshModules();
  const args = {
    ...FIXTURE,
    focusTopicIds: [],
    timezone: "UTC",
    llm: LLM,
    fetchContent: async ({ article: target }: { article: ArticleRecord }) => ({
      article: target,
      availability: "summary" as const,
      fetched: false,
    }),
  };
  const old = await pipeline.runBriefing({ ...args, ...failWritingForResume() });
  const latest = await pipeline.runBriefing({
    ...args,
    ...stubGenerate({
      compose: () => ({ ok: false, code: "OUTPUT_TRUNCATED", message: "cut off", retryable: true }),
    }),
  });
  expect(latest.run.callsUsed).toBe(3);
  expect(await pipeline.loadResumableRun(old.run.editionKey)).toBeUndefined();
});

it("freezes readable focus scope and retains it in Writing after preferences change on Resume", async () => {
  const { pipeline } = await freshModules();
  const first = await pipeline.runBriefing({
    ...FIXTURE,
    focusTopicIds: ["custom-123"],
    topics: [{ id: "custom-123", label: "Design" }],
    timezone: "UTC",
    llm: LLM,
    ...failWritingForResume(),
    fetchContent: async ({ article: target }) => ({
      article: target,
      availability: "summary",
      fetched: false,
    }),
  });
  const phases: Array<ShortlistInput | ComposeInput> = [];
  const model = stubGenerate({});
  const resumed = await pipeline.runBriefing({
    ...FIXTURE,
    focusTopicIds: ["politics"],
    topics: [{ id: "politics", label: "Politics" }],
    timezone: "UTC",
    llm: LLM,
    resume: first.run,
    generate: async (call) => {
      phases.push(call.payload);
      return model.generate(call);
    },
  });
  expect(resumed.edition).toBeDefined();
  expect(phases).toHaveLength(1);
  expect(phases[0]).toMatchObject({
    focusOnly: true,
    focusTopics: [{ id: "custom-123", label: "Design" }],
  });
});
