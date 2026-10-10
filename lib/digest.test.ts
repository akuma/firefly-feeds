import { describe, expect, it } from "vitest";
import {
  buildDigestMessages,
  dayKey,
  DIGEST_MAX_CANDIDATES,
  DIGEST_PICKS,
  digestIsStale,
  parseDigest,
  requestDigest,
  selectCandidates,
  staleCount,
  type DigestCandidate,
} from "./digest";
import { DEFAULT_LLM_CONFIG, type LlmConfig } from "./llm";
import type { DigestRecord } from "./storage/types";
import type { Block, Story } from "./types";

function story(
  id: string,
  opts: {
    minutesAgo: number;
    live?: boolean;
    dek?: string;
    body?: Block[];
    title?: string;
  },
): Story {
  return {
    id,
    title: opts.title ?? `Title ${id}`,
    feedId: "s1",
    dek: opts.dek ?? "A summary.",
    minutesAgo: opts.minutesAgo,
    minutes: 2,
    layout: "compact",
    body: opts.body ?? [{ kind: "p", text: "Body text." }],
    // A story from a real subscription is `live`; the sample edition's are not,
    // and it is the difference the briefing filters on.
    ...(opts.live === false ? {} : { live: true }),
    contentState: "full",
    extractionState: "idle",
    topics: [],
  };
}

function record(patch: Partial<DigestRecord> = {}): DigestRecord {
  return {
    day: "2026-09-11",
    picks: ["a"],
    gists: { a: "A gist." },
    reasons: { a: "A reason." },
    candidates: ["a", "b"],
    provider: "ollama",
    language: "source",
    updatedAt: 1,
    ...patch,
  };
}

const candidate = (id: string): DigestCandidate => ({ id, title: `Title ${id}`, summary: "s" });

describe("the day", () => {
  it("is the reader's own calendar day, not a UTC one", () => {
    // Built from local components, so the answer is the same wherever the test
    // runs: 11 September at 23:59 is the 11th in every timezone.
    expect(dayKey(new Date(2026, 8, 11, 23, 59).getTime())).toBe("2026-09-11");
    expect(dayKey(new Date(2026, 0, 3, 0, 1).getTime())).toBe("2026-01-03");
  });
});

describe("the candidates", () => {
  it("takes today's unread stories from real subscriptions, newest first", () => {
    const picked = selectCandidates(
      [
        story("oldest", { minutesAgo: 600 }),
        story("newest", { minutesAgo: 5 }),
        story("read", { minutesAgo: 2 }),
        story("sample", { minutesAgo: 1, live: false }),
        story("yesterday", { minutesAgo: 60 * 25 }),
      ],
      { read: true },
    );
    expect(picked.map((c) => c.id)).toEqual(["newest", "oldest"]);
  });

  it("caps the list, because the cost of a call is knowable in advance", () => {
    const many = Array.from({ length: DIGEST_MAX_CANDIDATES + 5 }, (_, i) =>
      story(`s${i}`, { minutesAgo: i + 1 }),
    );
    const picked = selectCandidates(many, {});
    expect(picked).toHaveLength(DIGEST_MAX_CANDIDATES);
    // The newest twenty, not the oldest twenty.
    expect(picked[0].id).toBe("s0");
  });

  it("judges a story with no summary on its cached body, and fetches nothing", () => {
    const picked = selectCandidates(
      [
        story("bare", {
          minutesAgo: 3,
          dek: "",
          body: [{ kind: "p", text: "The first paragraph." }],
        }),
      ],
      {},
    );
    expect(picked[0].summary).toBe("The first paragraph.");
  });
});

describe("the model's answer", () => {
  const ids = new Set(["a", "b", "c", "d", "e", "f"]);

  it("takes the JSON out of a reply that wrapped it in markdown", () => {
    const picks = parseDigest(
      'Sure! Here you go:\n```json\n[{"id":"a","gist":"One.","why":"Because."}]\n```',
      ids,
    );
    expect(picks).toEqual([{ id: "a", gist: "One.", why: "Because." }]);
  });

  it("drops everything it cannot trace back to a story it was given", () => {
    const picks = parseDigest(
      JSON.stringify([
        { id: "a", gist: "One.", why: "Because." },
        // Not one of the candidates: a gist attached to the wrong story is
        // worse than no gist at all.
        { id: "invented", gist: "Two.", why: "Because." },
        // Over its limit: the edition's layout has no room for a sentence that
        // had to be cut, so it goes rather than being truncated.
        { id: "b", gist: "x".repeat(200), why: "Because." },
        // Not a sentence.
        { id: "c", gist: "", why: "Because." },
        // Repeated: the first one stands.
        { id: "a", gist: "Again.", why: "Because." },
      ]),
      ids,
    );
    expect(picks).toEqual([{ id: "a", gist: "One.", why: "Because." }]);
  });

  it("refuses a reply it cannot read, rather than showing half an edition", () => {
    expect(parseDigest("I could not decide.", ids)).toEqual([]);
    expect(parseDigest("{}", ids)).toEqual([]);
    expect(parseDigest('[{"id":"a"}]', ids)).toEqual([]);
  });

  it("keeps at most an edition's worth, in the order the model chose", () => {
    const picks = parseDigest(
      JSON.stringify(["a", "b", "c", "d", "e", "f"].map((id) => ({ id, gist: "G.", why: "W." }))),
      ids,
    );
    expect(picks.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(picks).toHaveLength(DIGEST_PICKS);
  });

  it("is asked for a choice over a numbered list of ids it can copy back", () => {
    const messages = buildDigestMessages([candidate("a"), candidate("b")]);
    expect(messages[0].role).toBe("system");
    // The prompt is written here, not carried in the request — a request that
    // brought its own instructions would be a general proxy with our domain on.
    expect(messages[0].content).toMatch(/JSON array/);
    expect(messages[0].content).toMatch(/never add a fact/i);
    expect(messages[1].content).toContain("[a]");
    expect(messages[1].content).toContain("[b]");
  });

  it("writes the words the reader will see in the language they asked for", () => {
    // By default both fields follow the story — which is what was missing
    // before: only the gist was told to, and the reason came back English.
    const source = buildDigestMessages([candidate("a")])[0].content;
    expect(source).toMatch(/Write both fields in the language of the story itself/);

    // A named language is one instruction among the rest, and names travel
    // untranslated: "OpenAI" is not a word to be rendered into another script.
    const japanese = buildDigestMessages([candidate("a")], "ja")[0].content;
    expect(japanese).toMatch(/Write both fields in Japanese/);
    expect(japanese).toMatch(/original form/);
    // …and the ceiling follows the language, because a sentence carries more
    // per character where characters are words.
    expect(japanese).toMatch(/at most 60 characters/);
    expect(buildDigestMessages([candidate("a")], "en")[0].content).toMatch(/at most 120/);
  });

  it("drops a line the language has no room for", () => {
    const long = "x".repeat(80);
    const one = new Set(["a"]);
    // English has room for it; Chinese does not, and a gist that had to be cut
    // off mid-sentence is not a gist.
    expect(parseDigest(JSON.stringify([{ id: "a", gist: long, why: "W." }]), one)).toHaveLength(1);
    expect(parseDigest(JSON.stringify([{ id: "a", gist: long, why: "W." }]), one, 60)).toEqual([]);
  });
});

describe("what is new since an edition was written", () => {
  it("counts arrivals, and ignores stories that have been read away", () => {
    const written = record({ candidates: ["a", "b"] });
    // One arrived after the edition was written.
    expect(staleCount(written, [candidate("a"), candidate("b"), candidate("c")])).toBe(1);
    expect(digestIsStale(written, [candidate("a"), candidate("b"), candidate("c")])).toBe(true);
    // One has since been read and dropped out: the edition the reader has
    // already read is not wrong, and rewriting it would add nothing.
    expect(staleCount(written, [candidate("a")])).toBe(0);
    expect(digestIsStale(written, [candidate("a")])).toBe(false);
    expect(staleCount(undefined, [candidate("c")])).toBe(0);
  });
});

describe("asking for an edition", () => {
  it("refuses a service that is not set up, without sending anything", async () => {
    const original = globalThis.fetch;
    let asked = 0;
    globalThis.fetch = (async () => {
      asked += 1;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const result = await requestDigest({
        candidates: [candidate("a")],
        llm: { ...DEFAULT_LLM_CONFIG, service: "openai" } satisfies LlmConfig,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/still needs/);
      expect(asked).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
