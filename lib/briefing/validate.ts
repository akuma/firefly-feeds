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
 * an excerpt it cannot place verbatim in the material, a story with no evidence
 * at all — each stops the edition rather than being papered over. A gist
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
  const errors: Errors = [];
  if (!isRecord(raw)) return { ok: false, errors: ["output: expected one JSON object"] };
  errors.push(...exactKeys(raw, ["schemaVersion", "groups", "extractArticleIds"], "output"));
  if (raw.schemaVersion !== 1) errors.push("output.schemaVersion: expected 1");

  const known = new Set(input.candidates.map((c) => c.articleId));
  const groups: CandidateGroup[] = [];
  const seenGroupIds = new Set<string>();
  const usedArticles = new Set<string>();

  if (!Array.isArray(raw.groups)) {
    errors.push("output.groups: expected an array");
  } else if (raw.groups.length > BRIEFING_LIMITS.maxCandidates) {
    errors.push(`output.groups: more than ${BRIEFING_LIMITS.maxCandidates}`);
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
      errors.push(...exactKeys(entry, ["articleId", "excerpt"], where));
      const articleId = reqString(entry, "articleId", where, 200, errors);
      const excerpt = reqString(entry, "excerpt", where, EXCERPT_MAX, errors);
      const material = materials.get(articleId);
      if (!material) {
        errors.push(`${where}.articleId: unknown material "${articleId}"`);
        return;
      }
      // The quote must exist in what the model was actually given — verbatim
      // up to whitespace. A paraphrase is a fabrication.
      if (excerpt && !normalize(material.text).includes(normalize(excerpt))) {
        errors.push(`${where}.excerpt: not found verbatim in the material`);
        return;
      }
      if (articleId && excerpt) evidence.push({ articleId, excerpt });
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
  const errors: Errors = [];
  const materials = new Map(input.materials.map((m) => [m.articleId, m]));
  if (!isRecord(raw)) return { ok: false, errors: ["output: expected one JSON object"] };
  errors.push(
    ...exactKeys(raw, ["schemaVersion", "bigPicture", "topStories", "worthReading"], "output"),
  );
  if (raw.schemaVersion !== 1) errors.push("output.schemaVersion: expected 1");

  const bigPicture = validateSupportedText(raw.bigPicture, "bigPicture", materials, errors);

  const topStories: ComposedStory[] = [];
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
      );
      const context = validateSupportedText(entry.context, `${at}.context`, materials, errors);
      const whyItMatters = validateSupportedText(
        entry.whyItMatters,
        `${at}.whyItMatters`,
        materials,
        errors,
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
      const whyRead = validateSupportedText(entry.whyRead, `${at}.whyRead`, materials, errors);
      if (articleId && !materials.has(articleId)) {
        errors.push(`${at}.articleId: unknown material "${articleId}"`);
      }
      // A recommendation must cite the article it recommends.
      if (whyRead && !whyRead.evidence.some((e) => e.articleId === articleId)) {
        errors.push(`${at}.whyRead: must cite "${articleId}"`);
      }
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
      schemaVersion: 1,
      bigPicture,
      topStories,
      worthReading,
    },
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
