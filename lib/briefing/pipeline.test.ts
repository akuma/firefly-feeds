import { deleteDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});

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
});
