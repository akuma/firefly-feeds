import { describe, expect, it } from "vitest";
import {
  buildDigestMessages,
  concentratedPublication,
  dayKey,
  DIGEST_OFFER_LIMIT,
  offerCandidates,
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
    offered: 2,
    provider: "ollama",
    language: "source",
    updatedAt: 1,
    ...patch,
  };
}

const candidate = (id: string, source = "The Daily"): DigestCandidate => ({
  id,
  title: `Title ${id}`,
  source,
  excerpt: "s",
});

/** A model's reply choosing exactly these ids, all with usable lines. */
const reply = (...chosen: string[]) =>
  JSON.stringify(chosen.map((id) => ({ id, gist: "G.", why: "W." })));

describe("the day", () => {
  it("is the reader's own calendar day, not a UTC one", () => {
    // Built from local components, so the answer is the same wherever the test
    // runs: 11 September at 23:59 is the 11th in every timezone.
    expect(dayKey(new Date(2026, 8, 11, 23, 59).getTime())).toBe("2026-09-11");
    expect(dayKey(new Date(2026, 0, 3, 0, 1).getTime())).toBe("2026-01-03");
  });
});

describe("the candidates", () => {
  it("takes the unread stories that arrived within the window, newest first", () => {
    const picked = selectCandidates(
      [
        story("oldest", { minutesAgo: 600 }),
        story("newest", { minutesAgo: 5 }),
        story("read", { minutesAgo: 2 }),
        story("sample", { minutesAgo: 1, live: false }),
        story("too old", { minutesAgo: 60 * 25 }),
      ],
      { read: true },
      60 * 24,
      () => "The Daily",
    );
    expect(picked.map((c) => c.id)).toEqual(["newest", "oldest"]);
    // the publication travels with the story — the per-publication rule
    // cannot be followed without it
    expect(picked.map((c) => c.source)).toEqual(["The Daily", "The Daily"]);
  });

  it("offers each story to exactly one day, and never a story from another", () => {
    // The window is the day — how many minutes since local midnight — and not
    // the last twenty-four hours. A sliding window carries yesterday's stories
    // into today; this one does not, so yesterday's edition and today's can
    // never share a story. Nothing is excluded for having been picked before:
    // the function has no way to know, and does not need one.
    const stories = [story("yesterday", { minutesAgo: 180 }), story("today", { minutesAgo: 30 })];
    // Two hours past midnight, so today reaches back two hours.
    expect(selectCandidates(stories, {}, 120, () => "The Daily").map((c) => c.id)).toEqual([
      "today",
    ]);
  });

  it("counts the whole day, and caps only what one prompt carries", () => {
    const many = Array.from({ length: DIGEST_OFFER_LIMIT + 5 }, (_, i) =>
      story(`s${i}`, { minutesAgo: i + 1 }),
    );
    // The day is the day: a query does not quietly decide that twenty of thirty
    // stories are the day's stories.
    const all = selectCandidates(many, {}, 60 * 24, () => "The Daily");
    expect(all).toHaveLength(DIGEST_OFFER_LIMIT + 5);
    // What one prompt carries is capped — the newest, so it is the tail of the
    // day a budget trims and never the head.
    const offered = offerCandidates(all);
    expect(offered).toHaveLength(DIGEST_OFFER_LIMIT);
    expect(offered[0].id).toBe("s0");
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
      60 * 24,
      () => "The Daily",
    );
    expect(picked[0].excerpt).toBe("The first paragraph.");
  });
});

describe("the model's answer", () => {
  // Each offered story from its own publication, so no test stumbles over the
  // spread rule unless it is asking for it.
  const ids = new Map(["a", "b", "c", "d", "e", "f"].map((id) => [id, `Daily ${id}`]));

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

  it("refuses a third story from one publication, however good the reasons", () => {
    // The spread across the day's feeds is the edition's value, so the rule is
    // held to here and not only written in the prompt: five pieces from the
    // publisher who sent the most is a feed, not an edit.
    const offers = new Map([
      ["a", "The Daily"],
      ["b", "The Daily"],
      ["c", "The Daily"],
      ["d", "Weekly"],
      ["e", "The Daily"],
      ["f", "Weekly"],
    ]);
    const picks = parseDigest(
      JSON.stringify(["a", "b", "c", "d", "e", "f"].map((id) => ({ id, gist: "G.", why: "W." }))),
      offers,
    );
    expect(picks.map((p) => p.id)).toEqual(["a", "b", "d", "f"]);
  });

  it("tells the model which publication each story came from, in piles", () => {
    // Without the name, the per-publication rule was an instruction no model
    // could follow: the stories arrived with no provenance at all. And the
    // stories arrive grouped, because a quota is followed where it sits beside
    // the pile it caps and misread where a flat list buries the name.
    const messages = buildDigestMessages([
      candidate("a", "The Daily"),
      candidate("c", "The Daily"),
      candidate("b", "Weekly"),
    ]);
    const list = messages[1].content;
    expect(list).toContain("Publication: The Daily");
    expect(list).toContain("Publication: Weekly");
    // …grouped: the second Daily story sits under its own publication, before
    // the next publication's header
    expect(list.indexOf("Publication: Weekly")).toBeGreaterThan(list.indexOf("[c]"));
    expect(messages[0].content).toMatch(/grouped by publication/);
    expect(messages[0].content).toMatch(/at most 2 stories from any one publication/);
  });

  it("tells the next attempt what the last one got wrong, in our words", () => {
    // The wire carries a kind and a name, never text: a request that brought
    // its own instructions would be a general proxy with our domain on it.
    const plain = buildDigestMessages([candidate("a")])[0].content;
    expect(plain).not.toMatch(/previous attempt/);

    const unreadable = buildDigestMessages([candidate("a")], "source", "", {
      kind: "tighten",
    })[0].content;
    expect(unreadable).toMatch(/A note on a previous attempt/);
    expect(unreadable).toMatch(/character limit/);

    // A column of one publisher is named, so a model that over-used one pile
    // is told which pile it over-used and where to look instead.
    const column = buildDigestMessages([candidate("a", "The Daily")], "source", "", {
      kind: "spread",
      source: "The Daily",
    })[0].content;
    expect(column).toMatch(/chose every story from The Daily/);
    expect(column).toMatch(/at least three of the publications/);
    // …and the pile it over-used is listed last, so the second answer is not
    // anchored on the same one again.
    const reordered = buildDigestMessages(
      [candidate("a", "The Daily"), candidate("b", "Weekly")],
      "source",
      "",
      { kind: "spread", source: "The Daily" },
    )[1].content;
    expect(reordered.indexOf("Publication: Weekly")).toBeLessThan(
      reordered.indexOf("Publication: The Daily"),
    );

    // A short answer is told how short it was, and of how many — data, not
    // flattery.
    const short = buildDigestMessages(
      ["a", "b", "c", "d", "e", "f"].map((id, i) => candidate(id, i < 2 ? "The Daily" : "Weekly")),
      "source",
      "",
      { kind: "few", picked: 3 },
    )[0].content;
    expect(short).toMatch(/chose only 3 of the 6 stories offered/);
  });

  it("lifts the ceiling when the whole day is one publication", () => {
    // There is no spread to keep where the day offered none: the stories
    // compete on merit alone, and five of them make the edition.
    const solo = new Map(["a", "b", "c", "d", "e", "f"].map((id) => [id, "The Daily"]));
    const picks = parseDigest(
      JSON.stringify(["a", "b", "c", "d", "e", "f"].map((id) => ({ id, gist: "G.", why: "W." }))),
      solo,
    );
    expect(picks.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(concentratedPublication(picks, solo)).toBeNull();
  });

  it("refuses to call one publication's column an edition", () => {
    const offers = new Map([
      ["a", "The Daily"],
      ["b", "The Daily"],
      ["c", "Weekly"],
    ]);
    // Every pick from one publisher while the day offered several: the answer
    // that must not become an edition, however good its two lines are.
    expect(concentratedPublication(parseDigest(reply("a", "b"), offers), offers)).toBe("The Daily");
    // One pick is not a column — "if fewer pass, return fewer" still stands.
    expect(concentratedPublication(parseDigest(reply("a"), offers), offers)).toBeNull();
    // …and a spread is an edition.
    expect(concentratedPublication(parseDigest(reply("a", "c"), offers), offers)).toBeNull();
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

  it("picks for the reader who is actually reading", () => {
    const mine = buildDigestMessages(
      [candidate("a")],
      "zh-Hans",
      "创新方案如何落地密歇根州；离奇大案与名酒失窃的细节",
    )
      .map((m) => m.content)
      .join("\n");
    // Their words are quoted as fact about them, and the choice is theirs…
    expect(mine).toMatch(/What this reader says about their taste/);
    // Taste is a filter, not just a ranking: what they skip is out, however big.
    expect(mine).toMatch(/of the kind they skip is out/);
    expect(mine).toContain("名酒失窃");
    expect(mine).toMatch(/Choose the 5 this reader/);
    // And the taste rule outranks the quota: a skipped kind never pads the list.
    expect(mine).toMatch(/Five is the edition when the list holds five/);
    expect(mine).toMatch(/never pad with a piece of a kind they skip/);
    expect(mine).toMatch(/a story on it beats a story that is merely big/);
    // …and the writing is told to be specific rather than a restated title.
    expect(mine).toMatch(/Not a description of a document/);
    expect(mine).toMatch(/never the title in other words/);
    expect(mine).toMatch(/vary what each sentence leads with/);

    // Nobody has said anything, so nothing is claimed on their behalf.
    const generic = buildDigestMessages([candidate("a")])[0].content;
    expect(generic).toMatch(/a broadly curious reader/);
    expect(generic).not.toMatch(/What this reader says/);
  });

  it("drops a line the language has no room for", () => {
    const long = "x".repeat(80);
    const one = new Map([["a", "The Daily"]]);
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
