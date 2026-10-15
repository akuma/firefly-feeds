import { articleFingerprint, classifyInputFor } from "../classify";
import { ARTICLE_STALE_MS, needsArticleRefresh } from "../refreshing";
import { BRIEFING_LIMITS } from "./constants";
import type { ArticleClassification, ArticleRecord, SourceRecord } from "../storage/types";
import type { BriefingCandidate, CandidateSet } from "./types";

/**
 * The deterministic half of the briefing: what the day offers, decided without
 * a model, identically on every machine that sees the same records.
 *
 * The fairness rule is the point. A high-volume publisher could otherwise
 * consume every slot in a prompt simply by publishing more, and the edition
 * would be that publisher's column with extra steps — so each source gets a
 * first-round share before anyone gets seconds. See docs/specs/ai-daily-briefing.md §3.
 */

const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

/**
 * The form two links must agree in to be the same page: no fragment, no
 * tracking parameters, stable query order. Everything else in the query is
 * meaning a publisher chose — `?id=42` is not `?id=43`.
 */
export function canonicalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      return null;
    parsed.hash = "";
    const kept = [...parsed.searchParams.entries()]
      .filter(
        ([key]) => !key.toLowerCase().startsWith("utm_") && !TRACKING_PARAMS.has(key.toLowerCase()),
      )
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    parsed.search = "";
    for (const [key, value] of kept) parsed.searchParams.append(key, value);
    return parsed.href;
  } catch {
    return null;
  }
}

type Bucketed = { candidate: BriefingCandidate; bucket: "recent" | "older" };

/**
 * One bucket, sampled so no source owns it: five-round rotation first (one
 * story per source per round, at most five each), then open rotation until the
 * quota is full. Deterministic: equal inputs, equal output, in every run.
 */
function fairSample(sorted: readonly Bucketed[], quota: number): Bucketed[] {
  const queues = new Map<string, Bucketed[]>();
  const order: string[] = [];
  for (const item of sorted) {
    const queue = queues.get(item.candidate.sourceId);
    if (queue) queue.push(item);
    else {
      queues.set(item.candidate.sourceId, [item]);
      order.push(item.candidate.sourceId);
    }
  }
  const taken: Bucketed[] = [];
  for (let round = 0; taken.length < quota; round += 1) {
    let moved = false;
    for (const id of order) {
      if (taken.length >= quota) break;
      const queue = queues.get(id);
      if (!queue?.length) continue;
      // The first five rounds are the guaranteed share; after that a source
      // may only have seconds left over, which is where they belong.
      if (round < BRIEFING_LIMITS.maxPerSourceInitial) {
        taken.push(queue.shift()!);
        moved = true;
      }
    }
    if (!moved) {
      // Every source is at its guaranteed share: open rotation.
      for (const id of order) {
        if (taken.length >= quota) break;
        const queue = queues.get(id);
        if (!queue?.length) continue;
        taken.push(queue.shift()!);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return taken;
}

export function prepareCandidates(input: {
  articles: readonly ArticleRecord[];
  sources: readonly SourceRecord[];
  classifications: readonly ArticleClassification[];
  cutoffAt: number;
  focusTopicIds?: readonly string[];
  activeTopicIds?: readonly string[];
}): CandidateSet {
  const { articles, sources, classifications, cutoffAt, focusTopicIds = [] } = input;
  const skippedStats = {
    duplicates: 0,
    outOfWindow: 0,
    noSource: 0,
    sample: 0,
    empty: 0,
    capped: 0,
    offFocus: 0,
  };

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const articleById = new Map(articles.map((article) => [article.id, article]));
  const topicsByArticle = new Map<string, string[]>();
  for (const record of classifications) {
    if (record.deletedAt || record.status === "rejected" || record.status === "needs_review")
      continue;
    const article = articleById.get(record.itemId);
    if (!article) continue;
    const classifiedInput = classifyInputFor(article);
    // Automatic tags describe a particular text; a reader's confirmation outlives it.
    if (
      record.status === "auto" &&
      record.contentFingerprint !==
        articleFingerprint(classifiedInput.title, classifiedInput.summary)
    )
      continue;
    topicsByArticle.set(
      record.itemId,
      record.topicIds.filter((id) => !input.activeTopicIds || input.activeTopicIds.includes(id)),
    );
  }

  // Newest first, tie-broken by id: the same records must produce the same
  // edition on every run, whatever order the database returned them in.
  const ordered = [...articles].toSorted((a, b) => {
    const at = a.publishedAt || a.fetchedAt;
    const bt = b.publishedAt || b.fetchedAt;
    return bt - at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  const recentWindowMs = BRIEFING_LIMITS.recentWindowHours * 60 * 60_000;
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const pool: Bucketed[] = [];

  for (const article of ordered) {
    const source = sourceById.get(article.sourceId);
    if (!source || source.deletedAt) {
      skippedStats.noSource += 1;
      continue;
    }
    const topics = topicsByArticle.get(article.id) ?? [];
    if (focusTopicIds.length && topics.length && !topics.some((id) => focusTopicIds.includes(id))) {
      skippedStats.offFocus += 1;
      continue;
    }
    const effectiveAt = article.publishedAt || article.fetchedAt;
    // A timestamp in the future is a feed's error, not news from tomorrow.
    if (effectiveAt > cutoffAt || effectiveAt < cutoffAt - recentWindowMs) {
      skippedStats.outOfWindow += 1;
      continue;
    }
    if (!article.title.trim() && !article.summary.trim() && article.body.length === 0) {
      skippedStats.empty += 1;
      continue;
    }
    if (seenIds.has(article.id)) {
      skippedStats.duplicates += 1;
      continue;
    }
    const canonical = article.link ? canonicalUrl(article.link) : null;
    if (canonical && seenUrls.has(canonical)) {
      skippedStats.duplicates += 1;
      continue;
    }
    const titleKey = `${article.sourceId}\u0000${article.title.trim()}`;
    if (article.title.trim() && seenTitles.has(titleKey)) {
      skippedStats.duplicates += 1;
      continue;
    }
    seenIds.add(article.id);
    if (canonical) seenUrls.add(canonical);
    if (article.title.trim()) seenTitles.add(titleKey);

    const candidate: BriefingCandidate = {
      articleId: article.id,
      sourceId: article.sourceId,
      sourceName: source.title,
      title: article.title.trim().slice(0, BRIEFING_LIMITS.shortlistSummaryChars),
      summary: article.summary.trim().slice(0, BRIEFING_LIMITS.shortlistSummaryChars),
      publishedAt: article.publishedAt || null,
      topicIds: topicsByArticle.get(article.id) ?? [],
      contentState: article.contentState,
      fullBodyCached:
        article.contentState === "full" &&
        (article.contentFetchedAt === undefined
          ? cutoffAt - article.fetchedAt < ARTICLE_STALE_MS
          : !needsArticleRefresh(article, cutoffAt)),
    };
    pool.push({ candidate, bucket: "recent" });
  }

  const picked = fairSample(pool, BRIEFING_LIMITS.maxCandidates);
  skippedStats.capped = pool.length - picked.length;

  const sourceCoverage: Record<string, number> = {};
  const selectedWindow = { recent: 0, older: 0 };
  for (const item of picked) {
    sourceCoverage[item.candidate.sourceId] = (sourceCoverage[item.candidate.sourceId] ?? 0) + 1;
    selectedWindow[item.bucket] += 1;
  }

  return {
    candidates: picked.map((item) => item.candidate),
    skippedStats,
    sourceCoverage,
    selectedWindow,
  };
}
