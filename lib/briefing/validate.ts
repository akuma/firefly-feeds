import { composeSchema, SHORTLIST_SCHEMA, schemaErrors, stripUnknownOutputFields } from "./schema";
import { editorialScore, EDITORIAL_FLOOR } from "./score";
import { BRIEFING_LIMITS } from "./constants";
import type {
  ArticleMaterial,
  CandidateGroup,
  ComposeInput,
  ComposeOutput,
  ComposedDeepRead,
  ComposedStory,
  EvidenceRef,
  ShortlistInput,
  ShortlistOutput,
  SupportedText,
  ValidationResult,
} from "./types";

/**
 * What the model may publish, decided here and nowhere else.
 *
 * Every rule below refuses rather than repairs: an id the model was not given,
 * a story with no source reference, or (in legacy v1) an excerpt it cannot
 * place verbatim in the material — each stops the edition. A gist
 * attached to the wrong story is worse than no gist, and a quotation the
 * source never printed is worse than no quotation. See
 * docs/specs/ai-daily-briefing.md §8.
 */

const EXCERPT_MAX = 240;
const TEXT_MAX = 2000;

type Errors = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], at: string) {
  const errors: Errors = [];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push(`${at}.${key}: unexpected field`);
  }
  for (const key of allowed) {
    if (!(key in record)) errors.push(`${at}.${key}: missing`);
  }
  return errors;
}

function reqString(
  record: Record<string, unknown>,
  key: string,
  at: string,
  max: number,
  errors: Errors,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${at}.${key}: expected a non-empty string`);
    return "";
  }
  if (value.length > max) {
    errors.push(`${at}.${key}: longer than ${max}`);
    return "";
  }
  return value;
}

function reqInt(
  record: Record<string, unknown>,
  key: string,
  at: string,
  low: number,
  high: number,
  errors: Errors,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) {
    errors.push(`${at}.${key}: expected an integer ${low}..${high}`);
    return low;
  }
  return value;
}

function reqStringArray(
  record: Record<string, unknown>,
  key: string,
  at: string,
  max: number,
  errors: Errors,
): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
    errors.push(`${at}.${key}: expected an array of non-empty strings`);
    return [];
  }
  if (value.length > max) {
    errors.push(`${at}.${key}: more than ${max}`);
    return [];
  }
  return value as string[];
}

/** The comparison ignores whitespace and compatibility forms, nothing else. */
function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Models sometimes wrap a mid-sentence quote; accept only its exact contiguous interior. */
function verifiedExcerpt(excerpt: string, materialText: string): string | null {
  const source = normalize(materialText);
  if (source.includes(normalize(excerpt))) return excerpt;
  const trimmed = excerpt.trim();
  const pairs = [
    ["“", "”"],
    ['"', '"'],
    ["‘", "’"],
    ["'", "'"],
    ["「", "」"],
    ["『", "』"],
  ];
  const wrapped = pairs.some(
    ([open, close]) => trimmed.startsWith(open) && trimmed.endsWith(close),
  );
  if (!wrapped) return null;
  const interior = trimmed.slice(1, -1).trim();
  return interior && source.includes(normalize(interior)) ? interior : null;
}

/**
 * The one JSON object in a reply, fences and prose stripped. Models wrap JSON
 * in markdown despite being told not to; slicing from the first `{` to the
 * last `}` accepts both without teaching the parser about prose.
 */
export function parseJsonObject(raw: string): unknown | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- stage one */

const GROUP_KEYS = [
  "groupId",
  "kind",
  "workingHeadline",
  "articleIds",
  "value",
  "novelty",
  "evidence",
  "selectionReason",
  "missingInformation",
] as const;

export function validateShortlist(
  raw: unknown,
  input: ShortlistInput,
): ValidationResult<ShortlistOutput> {
  raw = stripUnknownOutputFields(raw, SHORTLIST_SCHEMA);
  const errors: Errors = schemaErrors(raw, SHORTLIST_SCHEMA, "output");
  if (!isRecord(raw)) return { ok: false, errors: ["output: expected one JSON object"] };
  errors.push(...exactKeys(raw, ["schemaVersion", "groups", "extractArticleIds"], "output"));
  if (raw.schemaVersion !== 1) errors.push("output.schemaVersion: expected 1");

  const known = new Set(input.candidates.map((c) => c.articleId));
  const groups: CandidateGroup[] = [];
  const seenGroupIds = new Set<string>();
  const usedArticles = new Set<string>();

  if (!Array.isArray(raw.groups)) {
    errors.push("output.groups: expected an array");
  } else if (raw.groups.length > BRIEFING_LIMITS.maxShortlistGroups) {
    errors.push(`output.groups: more than ${BRIEFING_LIMITS.maxShortlistGroups}`);
  } else {
    raw.groups.forEach((entry, index) => {
      const at = `groups[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      errors.push(...exactKeys(entry, GROUP_KEYS, at));
      const groupId = reqString(entry, "groupId", at, 120, errors);
      const kind = entry.kind === "news" || entry.kind === "insight" ? entry.kind : null;
      if (!kind) errors.push(`${at}.kind: expected "news" or "insight"`);
      const workingHeadline = reqString(entry, "workingHeadline", at, 300, errors);
      const articleIds = reqStringArray(
        entry,
        "articleIds",
        at,
        BRIEFING_LIMITS.maxCandidates,
        errors,
      );
      const value = reqInt(entry, "value", at, 0, 4, errors);
      const novelty = reqInt(entry, "novelty", at, 0, 3, errors);
      const evidence = reqInt(entry, "evidence", at, 0, 3, errors);
      const selectionReason = reqString(entry, "selectionReason", at, 500, errors);
      const missingInformation =
        typeof entry.missingInformation === "string"
          ? entry.missingInformation.slice(0, 500)
          : (errors.push(`${at}.missingInformation: expected a string`), "");

      if (groupId && seenGroupIds.has(groupId)) errors.push(`${at}.groupId: duplicate`);
      if (groupId) seenGroupIds.add(groupId);
      if (articleIds.length === 0) errors.push(`${at}.articleIds: empty`);
      const uniqueIds = new Set(articleIds);
      if (uniqueIds.size !== articleIds.length) errors.push(`${at}.articleIds: duplicate`);
      for (const id of articleIds) {
        // A fabricated id is dropped, never replaced: a story attributed to a
        // source that never wrote it is worse than a missing story.
        if (!known.has(id)) errors.push(`${at}.articleIds: unknown article "${id}"`);
        usedArticles.add(id);
      }

      if (groupId && kind && workingHeadline && articleIds.length > 0 && errors.length === 0) {
        groups.push({
          groupId,
          kind,
          workingHeadline,
          articleIds,
          value,
          novelty,
          evidence,
          selectionReason,
          missingInformation,
        });
      }
    });
  }

  const extractArticleIds = reqStringArray(
    raw,
    "extractArticleIds",
    "output",
    BRIEFING_LIMITS.maxNewExtracts,
    errors,
  );
  const uniqueExtracts = new Set(extractArticleIds);
  if (uniqueExtracts.size !== extractArticleIds.length) {
    errors.push("output.extractArticleIds: duplicate");
  }
  for (const id of extractArticleIds) {
    if (!usedArticles.has(id)) {
      errors.push(`output.extractArticleIds: "${id}" is not in any group`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { schemaVersion: 1, groups, extractArticleIds },
  };
}

/* ---------------------------------------------------------- stage two */

function validateSupportedText(
  raw: unknown,
  at: string,
  materials: ReadonlyMap<string, ArticleMaterial>,
  errors: Errors,
  contractVersion: 1 | 2 = 1,
): SupportedText | null {
  if (raw === null) return null;
  if (!isRecord(raw)) {
    errors.push(`${at}: expected an object or null`);
    return null;
  }
  errors.push(...exactKeys(raw, ["text", "evidence"], at));
  const text = reqString(raw, "text", at, TEXT_MAX, errors);
  const evidence: EvidenceRef[] = [];
  if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) {
    errors.push(`${at}.evidence: expected at least one reference`);
  } else {
    raw.evidence.forEach((entry, index) => {
      const where = `${at}.evidence[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${where}: expected an object`);
        return;
      }
      errors.push(
        ...exactKeys(
          entry,
          contractVersion === 1 ? ["articleId", "excerpt"] : ["articleId"],
          where,
        ),
      );
      const articleId = reqString(entry, "articleId", where, 200, errors);
      const material = materials.get(articleId);
      if (!material) {
        errors.push(`${where}.articleId: unknown material "${articleId}"`);
        return;
      }
      if (contractVersion === 2) {
        if (articleId) evidence.push({ articleId });
        return;
      }
      const excerpt = reqString(entry, "excerpt", where, EXCERPT_MAX, errors);
      // Only an added outer quotation pair may be removed. Retain no wording
      // that is not a contiguous source excerpt; never drop a failing citation.
      const verified = excerpt ? verifiedExcerpt(excerpt, material.text) : null;
      if (excerpt && verified === null) {
        errors.push(`${where}.excerpt: not found verbatim in the material`);
        return;
      }
      if (articleId && verified) evidence.push({ articleId, excerpt: verified });
    });
  }
  if (!text || evidence.length === 0) return null;
  return { text, evidence };
}

export function validateComposition(
  raw: unknown,
  input: ComposeInput,
  previouslyRecommended: readonly string[] = [],
): ValidationResult<ComposeOutput> {
  previouslyRecommended = [
    ...new Set([...previouslyRecommended, ...(input.previouslyRecommendedArticleIds ?? [])]),
  ];
  const contractVersion = input.composeContractVersion ?? 1;
  const schema = composeSchema(contractVersion);
  const errors: Errors = schemaErrors(raw, schema, "output");
  const materials = new Map(input.materials.map((m) => [m.articleId, m]));
  if (!isRecord(raw)) return { ok: false, errors: ["output: expected one JSON object"] };
  errors.push(
    ...exactKeys(
      raw,
      [
        "schemaVersion",
        "bigPicture",
        "topStories",
        "worthReading",
        ...("reassessedGroups" in raw ? ["reassessedGroups"] : []),
      ],
      "output",
    ),
  );
  if (raw.schemaVersion !== contractVersion)
    errors.push(`output.schemaVersion: expected ${contractVersion}`);

  const reassessedGroups: NonNullable<ComposeOutput["reassessedGroups"]> = [];
  const scores = new Map(input.shortlist.groups.map((g) => [g.groupId, editorialScore(g)]));
  if (Array.isArray(raw.reassessedGroups)) {
    const seen = new Set<string>();
    for (const entry of raw.reassessedGroups) {
      if (!isRecord(entry)) continue;
      const groupId = reqString(entry, "groupId", "reassessedGroups", 120, errors);
      const value = reqInt(entry, "value", "reassessedGroups", 0, 4, errors);
      const novelty = reqInt(entry, "novelty", "reassessedGroups", 0, 3, errors);
      const evidence = reqInt(entry, "evidence", "reassessedGroups", 0, 3, errors);
      if (!scores.has(groupId) || seen.has(groupId))
        errors.push("reassessedGroups: unknown or duplicate groupId");
      seen.add(groupId);
      scores.set(groupId, value + novelty + evidence);
      reassessedGroups.push({ groupId, value, novelty, evidence });
    }
  }
  const eligible = (ids: string[], kind: "news" | "insight") =>
    input.shortlist.groups.find(
      (g) =>
        g.kind === kind &&
        (scores.get(g.groupId) ?? 0) >= EDITORIAL_FLOOR &&
        ids.every((id) => g.articleIds.includes(id)),
    );
  const bigPicture = validateSupportedText(
    raw.bigPicture,
    "bigPicture",
    materials,
    errors,
    contractVersion,
  );

  const topStories: ComposedStory[] = [];
  const seenGroups = new Set<string>();
  const seenHeadlines = new Set<string>();
  const seenEvidenceSets = new Set<string>();
  if (!Array.isArray(raw.topStories)) {
    errors.push("output.topStories: expected an array");
  } else if (raw.topStories.length > input.limits.maxStories) {
    errors.push(`output.topStories: more than ${input.limits.maxStories}`);
  } else {
    raw.topStories.forEach((entry, index) => {
      const at = `topStories[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      errors.push(
        ...exactKeys(
          entry,
          ["headline", "whatHappened", "context", "whyItMatters", "perspectives"],
          at,
        ),
      );
      const headline = reqString(entry, "headline", at, 300, errors);
      const whatHappened = validateSupportedText(
        entry.whatHappened,
        `${at}.whatHappened`,
        materials,
        errors,
        contractVersion,
      );
      if (!whatHappened) errors.push(`${at}.whatHappened: required supported text`);
      if (whatHappened) {
        const matched = eligible(
          whatHappened.evidence.map((e) => e.articleId),
          "news",
        );
        if (!matched) {
          const ids = whatHappened.evidence.map((e) => e.articleId);
          const sameGroup = input.shortlist.groups.some(
            (g) => g.kind === "news" && ids.every((id) => g.articleIds.includes(id)),
          );
          errors.push(
            sameGroup
              ? `${at}: editorial score below 6`
              : `${at}: main evidence does not belong to one shortlisted news group; keep insight groups in Worth Reading`,
          );
        } else if (seenGroups.has(matched.groupId))
          errors.push(`${at}: same event group already covered`);
        else seenGroups.add(matched.groupId);
      }
      const context = validateSupportedText(
        entry.context,
        `${at}.context`,
        materials,
        errors,
        contractVersion,
      );
      const whyItMatters = validateSupportedText(
        entry.whyItMatters,
        `${at}.whyItMatters`,
        materials,
        errors,
        contractVersion,
      );
      const perspectives: SupportedText[] = [];
      if (!Array.isArray(entry.perspectives)) {
        errors.push(`${at}.perspectives: expected an array`);
      } else {
        entry.perspectives.forEach((perspective, i) => {
          const line = validateSupportedText(
            perspective,
            `${at}.perspectives[${i}]`,
            materials,
            errors,
            contractVersion,
          );
          if (line) perspectives.push(line);
        });
      }

      // One event, one story: the same headline or the same evidence twice in
      // one edition is a doubled column, not two stories.
      const headlineKey = normalize(headline).toLowerCase();
      if (headline && seenHeadlines.has(headlineKey)) {
        errors.push(`${at}.headline: already covered in this edition`);
      }
      const evidenceKey = [...new Set(whatHappened?.evidence.map((e) => e.articleId) ?? [])]
        .toSorted()
        .join(",");
      if (evidenceKey) {
        if (seenEvidenceSets.has(evidenceKey)) {
          errors.push(`${at}: same evidence as another story`);
        }
        seenEvidenceSets.add(evidenceKey);
      }
      if (headline) seenHeadlines.add(headlineKey);

      if (headline && whatHappened) {
        topStories.push({ headline, whatHappened, context, whyItMatters, perspectives });
      }
    });
  }

  const worthReading: ComposedDeepRead[] = [];
  if (!Array.isArray(raw.worthReading)) {
    errors.push("output.worthReading: expected an array");
  } else if (raw.worthReading.length > input.limits.maxDeepReads) {
    errors.push(`output.worthReading: more than ${input.limits.maxDeepReads}`);
  } else {
    raw.worthReading.forEach((entry, index) => {
      const at = `worthReading[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      errors.push(...exactKeys(entry, ["articleId", "whyRead"], at));
      const articleId = reqString(entry, "articleId", at, 200, errors);
      const whyRead = validateSupportedText(
        entry.whyRead,
        `${at}.whyRead`,
        materials,
        errors,
        contractVersion,
      );
      if (articleId && !materials.has(articleId)) {
        errors.push(`${at}.articleId: unknown material "${articleId}"`);
      }
      // A recommendation must cite the article it recommends.
      if (whyRead && !whyRead.evidence.some((e) => e.articleId === articleId)) {
        errors.push(`${at}.whyRead: must cite "${articleId}"`);
      }
      if (!eligible([articleId], "insight")) {
        const sameGroup = input.shortlist.groups.some(
          (g) => g.kind === "insight" && g.articleIds.includes(articleId),
        );
        errors.push(
          sameGroup
            ? `${at}: editorial score below 6`
            : `${at}: article does not belong to a shortlisted insight group`,
        );
      }
      if (worthReading.some((previous) => previous.articleId === articleId))
        errors.push(`${at}.articleId: duplicate recommendation`);
      if (previouslyRecommended.includes(articleId)) {
        errors.push(`${at}.articleId: already recommended in an earlier edition`);
      }
      if (articleId && whyRead) worthReading.push({ articleId, whyRead });
    });
  }

  // An edition with nothing evidenced is not an edition to publish.
  const evidenced = topStories.length > 0 || worthReading.length > 0;
  if (!evidenced) errors.push("INSUFFICIENT_CONTENT: nothing evidenced to publish");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: contractVersion,
      ...(reassessedGroups.length ? { reassessedGroups } : {}),
      bigPicture,
      topStories,
      worthReading,
    },
  };
}

/**
 * A weak, misplaced or previously recommended item is an editorial omission. Drop whole items only
 * when that item's failures are only editorial selection failures. Fill the edition
 * in model order, discarding whole tail items once its size cap is reached.
 * Invalid references, invented excerpts and structural errors in retained required
 * prose still fail the final publishing gate; never move prose between sections.
 */
export function pruneWeakComposition(
  answer: unknown,
  input: ComposeInput,
  previouslyRecommended: readonly string[] = [],
): { output: unknown; omitted: number; omittedSections: number } {
  const cap = (output: unknown, omitted = 0, omittedSections = 0) => {
    if (!isRecord(output)) return { output, omitted, omittedSections };
    const bounded = { ...output };
    for (const [key, limit] of [
      ["topStories", Math.max(0, Math.min(input.limits.maxStories, BRIEFING_LIMITS.maxStories))],
      [
        "worthReading",
        Math.max(0, Math.min(input.limits.maxDeepReads, BRIEFING_LIMITS.maxDeepReads)),
      ],
    ] as const) {
      const items = output[key];
      if (!Array.isArray(items)) continue;
      bounded[key] = items.slice(0, limit);
      omitted += Math.max(0, items.length - limit);
    }
    return { output: bounded, omitted, omittedSections };
  };
  const schema = composeSchema(input.composeContractVersion ?? 1);
  const projected = stripUnknownOutputFields(answer, schema);
  if (
    !isRecord(projected) ||
    !Array.isArray(projected.topStories) ||
    !Array.isArray(projected.worthReading)
  )
    return cap(projected);
  const root = { ...projected, topStories: [], worthReading: [] };
  if (schemaErrors(root, schema).length) return cap(projected);
  const normalizedRoot = withoutUnverifiableOptionalSections(
    root as unknown as ComposeOutput,
    input,
  );
  let omitted = 0;
  let omittedSections = normalizedRoot.omittedSections;
  const weak =
    /^(topStories|worthReading)\[\d+\](?:: (?:editorial score below 6|main evidence does not belong to one shortlisted news group; keep insight groups in Worth Reading|article does not belong to a shortlisted insight group)|\.articleId: already recommended in an earlier edition)$/;
  const select = (key: "topStories" | "worthReading", entries: unknown[], limit: number) => {
    const kept: unknown[] = [];
    for (const [index, entry] of entries.entries()) {
      // Stop at the publication cap; unused tail data cannot poison retained stories.
      if (kept.length >= limit || index >= BRIEFING_LIMITS.maxCandidates) {
        omitted += entries.length - index;
        break;
      }
      const candidate = { ...normalizedRoot.output, bigPicture: null, [key]: [entry] };
      if (schemaErrors(candidate, schema).length) {
        kept.push(entry);
        continue;
      }
      const normalized = withoutUnverifiableOptionalSections(candidate as ComposeOutput, input);
      const checked = validateComposition(normalized.output, input, previouslyRecommended);
      if (
        !checked.ok &&
        checked.errors.length &&
        checked.errors.every((error) => weak.test(error))
      ) {
        omitted++;
        continue;
      }
      // Invalid required prose is retained for the final strict gate, never repaired locally.
      kept.push(normalized.output[key][0]);
      omittedSections += normalized.omittedSections;
    }
    return kept;
  };
  const trimmed = {
    ...normalizedRoot.output,
    topStories: select(
      "topStories",
      projected.topStories,
      Math.max(0, Math.min(input.limits.maxStories, BRIEFING_LIMITS.maxStories)),
    ),
    worthReading: select(
      "worthReading",
      projected.worthReading,
      Math.max(0, Math.min(input.limits.maxDeepReads, BRIEFING_LIMITS.maxDeepReads)),
    ),
  };
  const checked = validateComposition(trimmed, input, previouslyRecommended);
  if (omitted && checked.ok) {
    const retained = new Set(citedArticleIds({ ...checked.value, bigPicture: null }));
    if (trimmed.bigPicture?.evidence.some((ref) => !retained.has(ref.articleId)))
      trimmed.bigPicture = null;
  }
  return { output: trimmed, omitted, omittedSections };
}

function withoutUnverifiableOptionalSections(output: ComposeOutput, input: ComposeInput) {
  if (input.composeContractVersion === 2) return { output, omittedSections: 0 };
  const materials = new Map(input.materials.map((material) => [material.articleId, material]));
  let omittedSections = 0;
  const keep = (section: SupportedText | null): SupportedText | null => {
    if (!section) return section;
    const errors: Errors = [];
    validateSupportedText(section, "section", materials, errors);
    // Remove the entire unsupported paragraph, never just its bad citation.
    // Unknown sources, malformed fields and all required prose still fail validation.
    if (
      errors.length &&
      errors.every((error) => error.endsWith(".excerpt: not found verbatim in the material"))
    ) {
      omittedSections++;
      return null;
    }
    return section;
  };
  return {
    output: {
      ...output,
      bigPicture: keep(output.bigPicture),
      topStories: output.topStories.map((story) => ({
        ...story,
        context: keep(story.context),
        whyItMatters: keep(story.whyItMatters),
        perspectives: story.perspectives
          .map(keep)
          .filter((section): section is SupportedText => section !== null),
      })),
    },
    omittedSections,
  };
}

/** Every article id the validated composition rests on, for the source list. */
export function citedArticleIds(output: ComposeOutput): string[] {
  const ids = new Set<string>();
  const walk = (text: SupportedText | null) => {
    for (const ref of text?.evidence ?? []) ids.add(ref.articleId);
  };
  walk(output.bigPicture);
  for (const story of output.topStories) {
    walk(story.whatHappened);
    walk(story.context);
    walk(story.whyItMatters);
    for (const line of story.perspectives) walk(line);
  }
  for (const deep of output.worthReading) walk(deep.whyRead);
  return [...ids];
}
