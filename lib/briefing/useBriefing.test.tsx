import { act, renderHook, waitFor } from "@testing-library/react";
import type { MouseEvent } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { LlmConfig } from "../llm";
import { loadBriefings, runBriefing } from "./pipeline";
import { useBriefing } from "./useBriefing";

vi.mock("./pipeline", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pipeline")>();
  return {
    ...original,
    loadBriefings: vi.fn(async () => []),
    loadResumableRun: vi.fn(async () => undefined),
    runBriefing: vi.fn(async () => ({})),
  };
});
vi.mock("../storage/repository", () => ({
  loadAll: vi.fn(async () => ({ articles: [], sources: [], classifications: [], topics: [] })),
}));

const llm: LlmConfig = { service: "openai", wire: "openai", baseUrl: "", models: {}, keys: {} };

beforeEach(() => vi.clearAllMocks());

it("only starts from the Generate button and records the manual trigger", async () => {
  const { result } = renderHook(() => useBriefing(llm, []));
  await waitFor(() => expect(loadBriefings).toHaveBeenCalled());
  await act(async () => {
    await result.current.generate(undefined as unknown as MouseEvent<HTMLButtonElement>);
  });
  expect(runBriefing).not.toHaveBeenCalled();

  const button = document.createElement("button");
  button.dataset.t = "briefing-generate";
  await act(async () => {
    await result.current.generate({
      type: "click",
      currentTarget: button,
    } as MouseEvent<HTMLButtonElement>);
  });
  expect(runBriefing).toHaveBeenCalledOnce();
  expect(vi.mocked(runBriefing).mock.calls[0][0]).toMatchObject({
    trigger: { type: "manual", action: "generate", at: expect.any(Number) },
  });
});

it("loads and reloads without starting generation when preferences change", async () => {
  const { result, rerender } = renderHook(
    ({ enabled, language }: { enabled: boolean; language: "en" | "zh-Hans" }) =>
      useBriefing(llm, ["ai"], undefined, enabled, language),
    { initialProps: { enabled: true, language: "en" } },
  );
  await waitFor(() => expect(loadBriefings).toHaveBeenCalled());
  rerender({ enabled: false, language: "zh-Hans" });
  rerender({ enabled: true, language: "zh-Hans" });
  await act(async () => {
    result.current.open("another-edition");
    await result.current.reload();
  });
  expect(runBriefing).not.toHaveBeenCalled();
});
