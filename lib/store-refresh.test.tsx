import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editionFor } from "./edition";
import { useReaderState } from "./store";
import * as repo from "./storage/repository";
import type { IncomingItem } from "./refreshing";

function item(id: string): IncomingItem {
  return {
    id,
    title: id,
    summary: "A paper.",
    body: [{ kind: "p", text: "A paper." }],
    minutes: 1,
    layout: "compact",
    contentState: "full",
  };
}

beforeEach(async () => {
  await repo.clearAll();
  localStorage.clear();
  const now = Date.now();
  await repo.putSource({
    id: "arxiv",
    title: "arXiv",
    siteUrl: "https://arxiv.org",
    host: "rss.arxiv.org",
    url: "https://rss.arxiv.org/atom/cs.AI+q-bio.NC",
    addedAt: now,
    updatedAt: now,
    fetchedAt: now,
    error: "Previous failure",
  });
  await repo.replaceArticles(
    "arxiv",
    ["old", "unsaved"].map((id) => ({
      id: `arxiv~${id}`,
      sourceId: "arxiv",
      title: "Cached paper",
      summary: "A paper.",
      publishedAt: now,
      fetchedAt: now,
      body: [{ kind: "p", text: "Cached text." }],
      minutes: 1,
      layout: "compact",
      contentState: "full",
      extractionState: "idle",
    })),
  );
  await repo.putReading({ id: "arxiv~old", saved: true, read: true, later: true, updatedAt: now });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubFeed(items: IncomingItem[]) {
  const fetch = vi.fn(async () =>
    Response.json({ ok: true, feed: { host: "rss.arxiv.org" }, items }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function mountReader() {
  const hook = renderHook(() => useReaderState(editionFor(new Date("2026-10-17"))));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

it("accepts an empty successful refresh, clears the error and preserves cached articles and reading state", async () => {
  stubFeed([]);
  const beforeArticles = await repo.getArticles("arxiv");
  const beforeReading = (await repo.loadAll()).reading;
  const { result } = await mountReader();
  await act(async () => {
    await result.current.refresh("arxiv");
  });
  expect(result.current.sources[0].error).toBeNull();
  expect(result.current.refreshResults.get("arxiv")?.added).toBe(0);
  expect(await repo.getArticles("arxiv")).toEqual(beforeArticles);
  expect((await repo.loadAll()).reading).toEqual(beforeReading);
  expect(result.current.stories.some((story) => story.id === "arxiv~old")).toBe(true);
});

it("counts unique newly inserted IDs instead of returned rows or unread articles, then expires the badge", async () => {
  stubFeed([item("old"), item("new"), item("new")]);
  const { result } = await mountReader();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await act(async () => {
    await result.current.refresh("arxiv");
  });
  expect(result.current.refreshResults.get("arxiv")?.added).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(result.current.refreshResults.has("arxiv")).toBe(false);
  await act(async () => {
    await result.current.refresh("arxiv");
  });
  expect(result.current.refreshResults.get("arxiv")?.added).toBe(0);
});

it("removes a previous success badge when the next refresh fails and keeps the cache", async () => {
  const fetch = stubFeed([]);
  const { result } = await mountReader();
  await act(async () => {
    await result.current.refresh("arxiv");
  });
  expect(result.current.refreshResults.has("arxiv")).toBe(true);
  fetch.mockImplementation(async () =>
    Response.json({ ok: false, error: "HTTP 503: temporarily unavailable" }, { status: 503 }),
  );
  const cached = await repo.getArticles("arxiv");
  await act(async () => {
    await result.current.refresh("arxiv");
  });
  expect(result.current.sources[0].error).toBe("HTTP 503: temporarily unavailable");
  expect(result.current.refreshResults.has("arxiv")).toBe(false);
  expect(await repo.getArticles("arxiv")).toEqual(cached);
});

it("expires each source result from its own completion time", async () => {
  const first = (await repo.getSource("arxiv"))!;
  await repo.putSource({
    ...first,
    id: "other",
    title: "Other",
    url: "https://other.example/feed",
  });
  stubFeed([]);
  const { result } = await mountReader();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await act(async () => {
    await result.current.refresh("arxiv");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  await act(async () => {
    await result.current.refresh("other");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(result.current.refreshResults.has("arxiv")).toBe(false);
  expect(result.current.refreshResults.get("other")?.added).toBe(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(result.current.refreshResults.size).toBe(0);
});
