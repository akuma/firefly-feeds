import { describe, expect, it } from "vitest";
import {
  articleFingerprint,
  buildClassifyRequest,
  classificationFromOutcome,
  classifyInputFor,
  ClassifyError,
  CONFIDENCE_THRESHOLD,
  correctionRecord,
  defaultTopics,
  mergeClassification,
  needsClassification,
  parseClassifyResponse,
  resolveClassification,
} from "./classify";
import type { ArticleClassification, ArticleTopic } from "./storage/types";

const AT = 1_700_000_000_000;

const topics: ArticleTopic[] = [
  { id: "news", slug: "news", label: "News", updatedAt: AT },
  { id: "technology", slug: "technology", label: "Technology", updatedAt: AT },
  { id: "science", slug: "science", label: "Science", updatedAt: AT },
];

const known = new Set(topics.map((topic) => topic.slug));

/** A response in the shape Jev's native decisions endpoint returns. */
function jevResponse(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    message: "ok",
    data: {
      model: "typesafe-ai/jev",
      answers: {
        topic: {
          choice: "technology",
          confidence: 0.81,
          probabilities: { technology: 0.72, science: 0.18, news: 0.1 },
        },
      },
      ...overrides,
    },
  };
}

describe("the classifier request", () => {
  it("offers a closed set, so the answer can only be one of the reader's topics", () => {
    const request = buildClassifyRequest(
      { title: "A title", summary: "A summary" },
      topics.map((topic) => ({ slug: topic.slug, label: topic.label })),
    );
    expect(request.questions.topic.type).toBe("choice");
    expect(Object.keys(request.questions.topic.criteria).toSorted()).toEqual([
      "news",
      "science",
      "technology",
    ]);
    expect(request.state.title).toBe("A title");
    expect(request.state.summary).toBe("A summary");
  });
});

/* -------------------------------------------------------- result validation */

describe("reading a Jev answer", () => {
  it("accepts a successful closed-set choice and keeps its secondary topics", () => {
    const suggestion = parseClassifyResponse(jevResponse(), known);
    expect(suggestion.primarySlug).toBe("technology");
    expect(suggestion.topicSlugs[0]).toBe("technology");
    expect(suggestion.topicSlugs).toContain("science");
    expect(suggestion.confidence).toBeCloseTo(0.81);
    expect(suggestion.model).toBe("typesafe-ai/jev");
  });

  it("refuses a failed call rather than inventing an answer", () => {
    expect(() =>
      parseClassifyResponse({ code: -1, message: "Too many requests.", data: null }, known),
    ).toThrow(/Too many requests/);
  });

  it("refuses a choice outside the reader's own topic set", () => {
    const raw = jevResponse({
      answers: { topic: { choice: "sports", confidence: 0.9 } },
    });
    expect(() => parseClassifyResponse(raw, known)).toThrow(ClassifyError);
  });

  it("refuses a response with no choice at all", () => {
    expect(() => parseClassifyResponse({ code: 0, data: { answers: {} } }, known)).toThrow(
      /did not choose/,
    );
  });

  it("clamps a confidence the model reports out of range", () => {
    const raw = jevResponse({ answers: { topic: { choice: "news", confidence: 4 } } });
    expect(parseClassifyResponse(raw, known).confidence).toBe(1);
  });
});

/* ----------------------------------------------------------- threshold gate */

describe("the confidence floor", () => {
  it("calls a confident answer a fact", () => {
    const parsed = parseClassifyResponse(jevResponse(), known);
    const outcome = resolveClassification(parsed, topics);
    expect(outcome.status).toBe("auto");
    expect(outcome.primaryTopicId).toBe("technology");
    expect(outcome.topicIds[0]).toBe("technology");
  });

  it("holds a weak answer as a question instead", () => {
    const raw = jevResponse({
      answers: { topic: { choice: "news", confidence: CONFIDENCE_THRESHOLD - 0.01 } },
    });
    const outcome = resolveClassification(parseClassifyResponse(raw, known), topics);
    expect(outcome.status).toBe("needs_review");
    // the topic is still recorded — it is a suggestion, not silence
    expect(outcome.primaryTopicId).toBe("news");
  });

  it("treats the threshold itself as confident enough", () => {
    const raw = jevResponse({
      answers: { topic: { choice: "news", confidence: CONFIDENCE_THRESHOLD } },
    });
    expect(resolveClassification(parseClassifyResponse(raw, known), topics).status).toBe("auto");
  });
});

/* ------------------------------------------------------- correction wins */

describe("a reader's correction", () => {
  const fingerprint = articleFingerprint("A title", "A summary");
  const incoming = classificationFromOutcome(
    "s1~a",
    { primaryTopicId: "news", topicIds: ["news"], confidence: 0.9, status: "auto" },
    fingerprint,
    { at: AT },
  );

  it("overwrites an automatic result", () => {
    const correction = correctionRecord("s1~a", ["science"], fingerprint, AT + 1);
    const winner = mergeClassification(incoming, correction);
    expect(winner.status).toBe("confirmed");
    expect(winner.topicIds).toEqual(["science"]);
  });

  it("is never overwritten by a later automatic pass", () => {
    const correction = correctionRecord("s1~a", ["science"], fingerprint, AT + 1);
    const winner = mergeClassification(correction, incoming);
    expect(winner).toBe(correction);
    expect(winner.topicIds).toEqual(["science"]);
  });

  it("survives a change to the story's text, which would else re-classify it", () => {
    const correction = correctionRecord("s1~a", ["science"], fingerprint, AT + 1);
    expect(
      needsClassification({ title: "A new title", summary: "A summary" }, correction, topics),
    ).toBe(false);
  });

  it("re-classifies an automatic result when the text changes", () => {
    expect(
      needsClassification({ title: "A new title", summary: "A summary" }, incoming, topics),
    ).toBe(true);
    expect(needsClassification({ title: "A title", summary: "A summary" }, incoming, topics)).toBe(
      false,
    );
  });

  it("does nothing once the reader has rejected the classification", () => {
    const rejected: ArticleClassification = {
      ...incoming,
      status: "rejected",
      topicIds: [],
      primaryTopicId: undefined,
    };
    expect(needsClassification({ title: "x", summary: "y" }, rejected, topics)).toBe(false);
  });
});

/* -------------------------------------------------------------- misc */

describe("classification input", () => {
  it("uses the summary when there is one", () => {
    expect(
      classifyInputFor({ title: "T", summary: "S", body: [{ kind: "p", text: "Body" }] }),
    ).toEqual({ title: "T", summary: "S" });
  });

  it("falls back to an already-cached body and never fetches a new one", () => {
    expect(
      classifyInputFor({
        title: "T",
        summary: "",
        body: [
          { kind: "p", text: "First paragraph." },
          { kind: "p", text: "Second paragraph." },
        ],
      }),
    ).toEqual({ title: "T", summary: "First paragraph. Second paragraph." });
  });

  it("gives the fingerprint only two answers for the same text", () => {
    expect(articleFingerprint("A  Title", " A summary ")).toBe(
      articleFingerprint("a title", "a summary"),
    );
    expect(articleFingerprint("A title", "A summary")).not.toBe(
      articleFingerprint("A title", "A different summary"),
    );
  });

  it("offers a default topic set that is not empty and has unique slugs", () => {
    const seeded = defaultTopics(AT);
    expect(seeded.length).toBeGreaterThan(5);
    expect(new Set(seeded.map((topic) => topic.slug)).size).toBe(seeded.length);
    expect(seeded.every((topic) => topic.builtin === true)).toBe(true);
  });
});
