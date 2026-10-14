import { DIGEST_LANGUAGES } from "../languages";
import { BRIEFING_LIMITS as L } from "./constants";

/** The schemas supplied to models also guard both transports at runtime. */
type Schema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
  anyOf?: Schema[];
  enum?: readonly unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};
const str = (maxLength: number, minLength = 1): Schema => ({
  type: "string",
  minLength,
  maxLength,
});
const int = (maximum: number, minimum = 0): Schema => ({ type: "integer", minimum, maximum });
const arr = (items: Schema, maxItems: number, minItems = 0): Schema => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const id = str(200);
const timestamp: Schema = { type: "number", minimum: 0 };
const version: Schema = { const: 1 };
const score = { value: int(4), novelty: int(3), evidence: int(3) };
const group = obj({
  groupId: str(120),
  kind: { enum: ["news", "insight"] },
  workingHeadline: str(300),
  articleIds: arr(id, L.maxCandidates, 1),
  ...score,
  selectionReason: str(500),
  missingInformation: str(500, 0),
});
const evidence = obj({ articleId: id, excerpt: str(240) });
const supported = obj({ text: str(2000), evidence: arr(evidence, 3, 1) });
export const SHORTLIST_SCHEMA = obj({
  schemaVersion: version,
  groups: arr(group, L.maxShortlistGroups),
  extractArticleIds: arr(id, L.maxNewExtracts),
});
export const COMPOSE_SCHEMA = obj(
  {
    schemaVersion: version,
    reassessedGroups: arr(obj({ groupId: str(120), ...score }), L.maxCandidates),
    bigPicture: nullable(supported),
    topStories: arr(
      obj({
        headline: str(300),
        whatHappened: supported,
        context: nullable(supported),
        whyItMatters: nullable(supported),
        perspectives: arr(supported, 2),
      }),
      L.maxStories,
    ),
    worthReading: arr(obj({ articleId: id, whyRead: supported }), L.maxDeepReads),
  },
  ["schemaVersion", "bigPicture", "topStories", "worthReading"],
);
/** Compact retries leave room for the complete JSON and its evidence. */
const compactSupported = obj({
  text: str(800),
  evidence: arr(obj({ articleId: id, excerpt: str(120) }), 1, 1),
});
export const COMPACT_COMPOSE_SCHEMA = obj(
  {
    schemaVersion: version,
    reassessedGroups: arr(obj({ groupId: str(120), ...score }), 3),
    bigPicture: { type: "null" },
    topStories: arr(
      obj({
        headline: str(150),
        whatHappened: compactSupported,
        context: { type: "null" },
        whyItMatters: nullable(compactSupported),
        perspectives: arr(supported, 0),
      }),
      2,
    ),
    worthReading: arr(obj({ articleId: id, whyRead: compactSupported }), 1),
  },
  ["schemaVersion", "bigPicture", "topStories", "worthReading"],
);

const common = {
  schemaVersion: version,
  editionDate: str(10),
  cutoffAt: timestamp,
  timezone: str(100),
  outputLanguage: { enum: DIGEST_LANGUAGES.map((language) => language.id) },
};
const focusContext = {
  focusTopics: arr(obj({ id, label: str(200) }), L.maxFocusTopics),
  focusOnly: { type: "boolean" } as Schema,
};
export const SHORTLIST_INPUT_SCHEMA = obj(
  {
    ...common,
    ...focusContext,
    focusTopicIds: arr(id, L.maxFocusTopics),
    candidates: arr(
      obj({
        articleId: id,
        sourceId: id,
        sourceName: str(500),
        title: str(500, 0),
        summary: str(L.shortlistSummaryChars, 0),
        publishedAt: nullable(timestamp),
        topicIds: arr(id, 100),
        contentState: { enum: ["full", "summary", "truncated"] },
        fullBodyCached: { type: "boolean" },
      }),
      L.maxCandidates,
    ),
    previousStories: arr(
      obj(
        {
          editionDate: str(10),
          headline: str(300, 0),
          sourceArticleIds: arr(id, 60),
          kind: { enum: ["news", "insight"] },
        },
        ["editionDate", "headline", "sourceArticleIds"],
      ),
      200,
    ),
  },
  [...Object.keys(common), "focusTopicIds", "candidates", "previousStories"],
);
export const COMPOSE_INPUT_SCHEMA = obj(
  {
    ...common,
    ...focusContext,
    shortlist: SHORTLIST_SCHEMA,
    materials: arr(
      obj(
        {
          articleId: id,
          sourceName: str(500),
          title: str(500, 0),
          sourceUrl: nullable(str(4096)),
          publishedAt: nullable(timestamp),
          materialQuality: { enum: ["full", "excerpted", "feed-summary"] },
          text: str(L.composeArticleChars, 0),
          blockIndices: arr(int(1000000), 10000),
        },
        ["articleId", "sourceName", "title", "sourceUrl", "publishedAt", "materialQuality", "text"],
      ),
      L.maxCandidates,
    ),
    limits: obj({
      maxStories: int(L.maxStories),
      maxDeepReads: int(L.maxDeepReads),
      targetReadingMinutes: int(5, 1),
    }),
  },
  [...Object.keys(common), "shortlist", "materials", "limits"],
);

/** Small interpreter for only the schema vocabulary above; no dependencies. */
export function schemaErrors(value: unknown, schema: Schema, at = "input"): string[] {
  if (schema.anyOf)
    return schema.anyOf.some((s) => schemaErrors(value, s, at).length === 0)
      ? []
      : [`${at}: invalid nullable value`];
  if ("const" in schema && value !== schema.const) return [`${at}: unexpected constant`];
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: unexpected enum value`];
  if (schema.type === "null") return value === null ? [] : [`${at}: expected null`];
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${at}: expected array`];
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity))
      return [`${at}: array outside budget`];
    return value.flatMap((v, i) => schemaErrors(v, schema.items!, `${at}[${i}]`));
  }
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return [`${at}: expected object`];
    const record = value as Record<string, unknown>;
    const errors = (schema.required ?? [])
      .filter((key) => !(key in record))
      .map((key) => `${at}.${key}: missing`);
    for (const [key, v] of Object.entries(record)) {
      const child = schema.properties?.[key];
      if (!child) errors.push(`${at}.${key}: unexpected field`);
      else errors.push(...schemaErrors(v, child, `${at}.${key}`));
    }
    return errors;
  }
  if (schema.type === "string")
    return typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= (schema.maxLength ?? Infinity)
      ? []
      : [`${at}: invalid string length or type`];
  if (schema.type === "number" || schema.type === "integer")
    return typeof value === "number" &&
      Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isInteger(value)) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
      ? []
      : [`${at}: invalid number`];
  if (schema.type === "boolean" && typeof value !== "boolean") return [`${at}: expected boolean`];
  return [];
}
