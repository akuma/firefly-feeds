import { describe, expect, it } from "vitest";
import { STALE_MS, staleSourceIds } from "./refreshing";
import type { SourceRecord } from "./storage/types";

function source(id: string, fetchedAt: number, extra?: Partial<SourceRecord>): SourceRecord {
  return {
    id,
    url: `https://${id}.example/feed.xml`,
    siteUrl: `https://${id}.example`,
    title: id,
    host: `${id}.example`,
    addedAt: 0,
    fetchedAt,
    error: null,
    updatedAt: 0,
    ...extra,
  };
}

const NOW = 1_000_000;

describe("staleSourceIds", () => {
  it("includes only sources older than the staleness window", () => {
    const ids = staleSourceIds(
      [
        source("fresh", NOW - (STALE_MS - 1)),
        source("edge", NOW - STALE_MS),
        source("stale", NOW - STALE_MS - 1),
      ],
      NOW,
    );
    expect(ids).toEqual(["stale", "edge"]);
  });

  it("orders oldest first", () => {
    const ids = staleSourceIds(
      [source("newer", NOW - 2 * STALE_MS), source("older", NOW - 5 * STALE_MS)],
      NOW,
    );
    expect(ids).toEqual(["older", "newer"]);
  });

  it("skips tombstoned sources", () => {
    const ids = staleSourceIds([source("gone", 0, { deletedAt: NOW })], NOW);
    expect(ids).toEqual([]);
  });
});
