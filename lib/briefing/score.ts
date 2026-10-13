import type { CandidateGroup } from "./types";

/**
 * The editorial arithmetic behind the shortlist, kept out of the model and out
 * of the prompt: the model supplies three independent judgements, the program
 * adds them. Scores are comparable within one batch only — an 8 is not an 80%
 * chance, and yesterday's 8 is not today's 8.
 */

/** Below this an editorial group may not become a story, however interesting. */
export const EDITORIAL_FLOOR = 6;

export function editorialScore(group: CandidateGroup): number {
  return group.value + group.novelty + group.evidence;
}

/**
 * The only personalisation there is: one point for touching a focus topic, and
 * never more than one. Interest orders the queue; it cannot walk past the
 * editorial floor, because a briefing that flatters is not worth reading.
 */
export function interestBoost(topics: readonly string[], focusTopicIds: readonly string[]): number {
  return focusTopicIds.length > 0 && topics.some((id) => focusTopicIds.includes(id)) ? 1 : 0;
}

export type RankedGroup = {
  group: CandidateGroup;
  editorial: number;
  boost: number;
};

/**
 * Best first, with diversity as a soft tie-break rather than a quota: when two
 * groups are worth about the same, the one from a source the selection has not
 * used yet wins — and a clearly better story is never traded for balance.
 */
export function rankGroups(
  groups: readonly CandidateGroup[],
  focusTopicIds: readonly string[],
  /** Which topics each group draws on, so interest can be measured. */
  topicsByGroup: ReadonlyMap<string, readonly string[]>,
): RankedGroup[] {
  const ranked = groups.map((group) => {
    const topics = topicsByGroup.get(group.groupId) ?? [];
    return { group, editorial: editorialScore(group), boost: interestBoost(topics, focusTopicIds) };
  });
  ranked.sort((a, b) => {
    const total = b.editorial + b.boost - (a.editorial + a.boost);
    if (total !== 0) return total;
    // Soft constraint only: equal totals settle by stable id, and the greedy
    // selection below is where source coverage actually breaks ties.
    return a.group.groupId < b.group.groupId ? -1 : 1;
  });
  return ranked;
}

/**
 * Greedy selection with the soft diversity rule applied at pick time: a group
 * sharing a source with one already chosen only competes on equal terms.
 */
export function selectForEdition(
  ranked: readonly RankedGroup[],
  limit: number,
  sourceOf: (groupId: string) => readonly string[],
): CandidateGroup[] {
  const chosen: CandidateGroup[] = [];
  const usedSources = new Set<string>();
  const pending = [...ranked];
  while (chosen.length < limit && pending.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pending.length; i += 1) {
      const entry = pending[i];
      const repeat = sourceOf(entry.group.groupId).some((s) => usedSources.has(s));
      const score = entry.editorial + entry.boost - (repeat ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const [picked] = pending.splice(bestIndex, 1);
    chosen.push(picked.group);
    for (const s of sourceOf(picked.group.groupId)) usedSources.add(s);
  }
  return chosen;
}
