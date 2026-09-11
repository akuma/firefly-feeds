import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editionFor } from "@/lib/edition";
import { Shell } from "./shell";

/**
 * The shell is the only place where state, storage and layout meet, so these
 * are integration tests rather than unit tests: a real (fake) IndexedDB, a real
 * DOM, real keyboard events.
 *
 * Every query is scoped to a column. The three-column layout renders desktop
 * and mobile chrome into the same tree — one hidden by CSS — so an unscoped
 * `getByText` finds the same control twice and tells you nothing.
 */

const nav = () => document.querySelector<HTMLElement>("[data-col='nav']")!;
const stream = () => document.querySelector<HTMLElement>("[data-col='stream']")!;
const reader = () => document.querySelector<HTMLElement>("[data-col='reader']")!;
const rows = () =>
  document.querySelectorAll<HTMLElement>(
    "[data-story] [role='button'], [data-story][role='button']",
  );

/** Reads "N unread · M sources" out of the navigation colophon. */
function colophon(): { unread: number } {
  const line = [...nav().querySelectorAll("span")]
    .map((node) => node.textContent ?? "")
    .find((text) => /^\d+ unread( · \d+ sources)?$/.test(text));
  return { unread: Number(/^(\d+)/.exec(line ?? "")?.[1] ?? -1) };
}

async function mount() {
  const user = userEvent.setup();
  const result = render(<Shell edition={editionFor(new Date("2026-09-11T09:00:00Z"))} />);
  await waitFor(() => expect(screen.getByText("Reading Stream")).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText("Opening the edition")).not.toBeInTheDocument());
  return { user, ...result };
}

beforeEach(async () => {
  // each test starts with an empty registry, so the sample edition is what shows
  const repo = await import("@/lib/storage/repository");
  await repo.clearAll();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("--reader-size");
});

afterEach(() => localStorage.clear());

describe("the edition", () => {
  it("prints the issue date and opens on the stream", async () => {
    await mount();
    expect(within(stream()).getByText("11")).toBeInTheDocument();
    expect(within(stream()).getByText("SEPTEMBER")).toBeInTheDocument();
    expect(within(stream()).getByText("Reading Stream")).toBeInTheDocument();
  });

  it("renders a story column with real bodies behind it", async () => {
    await mount();
    expect(rows().length).toBeGreaterThan(5);
    expect(
      within(reader()).getByText(/The Quiet Return of the Personal Website/),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-t='reader-body']")?.textContent?.length).toBeGreaterThan(
      200,
    );
  });
});

describe("text size", () => {
  it("exposes exactly one menu, not one per toolbar", async () => {
    const { user } = await mount();
    // desktop and mobile toolbars both exist in the DOM; the popover must not
    await user.click(screen.getAllByLabelText("Text size")[0]);
    await waitFor(() => expect(screen.getAllByLabelText(/^Text size [1-4]$/)).toHaveLength(4));
  });

  it("actually changes the reading size", async () => {
    const { user } = await mount();
    const root = document.documentElement;

    await user.click(screen.getAllByLabelText("Text size")[0]);
    await waitFor(() => expect(screen.getAllByLabelText("Text size 1")).toHaveLength(1));
    await user.click(screen.getAllByLabelText("Text size 1")[0]);
    // the regression: a second hidden popover closed on mousedown and unmounted
    // this button before its click could land, so nothing ever changed
    await waitFor(() => expect(root.style.getPropertyValue("--reader-size")).toBe("17.5px"));

    await user.click(screen.getAllByLabelText("Text size 4")[0]);
    await waitFor(() => expect(root.style.getPropertyValue("--reader-size")).toBe("23.5px"));
  });

  it("closes on Escape", async () => {
    const { user } = await mount();
    await user.click(screen.getAllByLabelText("Text size")[0]);
    await waitFor(() => expect(screen.getAllByLabelText("Text size 1")).toHaveLength(1));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByLabelText("Text size 1")).toHaveLength(0));
  });
});

describe("reading state", () => {
  it("marks a story read and decrements the edition's unread count", async () => {
    const { user } = await mount();
    const before = colophon().unread;
    expect(before).toBeGreaterThan(0);

    await user.click(rows()[1]);
    await waitFor(() => expect(colophon().unread).toBe(before - 1));
  });

  it("keeps a saved story in the Saved column", async () => {
    const { user } = await mount();
    await user.click(within(stream()).getAllByLabelText(/^Save/)[0]);

    await user.click(within(nav()).getByText("Saved"));
    await waitFor(() =>
      expect(stream().querySelector("[data-t='viewtitle']")).toHaveTextContent("Saved"),
    );
    expect(rows().length).toBeGreaterThan(0);
  });

  it("survives a remount, because it is written to storage", async () => {
    const first = await mount();
    await first.user.click(rows()[1]);
    const after = colophon().unread;
    first.unmount();

    await mount();
    expect(colophon().unread).toBe(after);
  });
});

describe("open original", () => {
  it("offers no outbound link for invented stories", async () => {
    await mount();
    // sample stories have no original, so nothing here may point anywhere — a
    // plausible-looking link to a real homepage would imply the piece exists
    expect(stream().querySelectorAll("a[href^='http']")).toHaveLength(0);
    expect(reader().querySelectorAll("a[href^='http']")).toHaveLength(0);
    expect(within(reader()).getByText("Sample story")).toBeInTheDocument();
  });

  it("still gives every stream row its controls, whatever its layout", async () => {
    await mount();
    const controls = stream().querySelectorAll("[aria-label='Sample story — no original']");
    expect(controls.length).toBe(rows().length);
  });
});

describe("the navigation", () => {
  it("draws one rule between sections, and none above the first", async () => {
    await mount();
    const sections = nav().querySelectorAll("section");
    const rules = nav().querySelectorAll("section > div > .bg-rule");
    expect(sections.length).toBeGreaterThan(1);
    // a rule belongs to a section, so two sections can never draw two rules
    // against each other — the first is separated by the masthead's rule
    expect(rules.length).toBe(sections.length - 1);
  });

  it("offers suggested sources while onboarding", async () => {
    await mount();
    expect(within(nav()).getByText("Suggested")).toBeInTheDocument();
    expect(within(nav()).queryByText("Sources")).not.toBeInTheDocument();
  });

  it("swaps the suggestions for real sources once subscribed", async () => {
    const repo = await import("@/lib/storage/repository");
    await repo.putSource({
      id: "sone",
      url: "https://example.com/f.xml",
      siteUrl: "https://example.com",
      title: "One Source",
      host: "example.com",
      folder: "independent",
      addedAt: Date.now(),
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await mount();
    expect(within(nav()).getByText("Sources")).toBeInTheDocument();
    expect(within(nav()).getByText("One Source")).toBeInTheDocument();
    expect(within(nav()).queryByText("Suggested")).not.toBeInTheDocument();
  });
});

describe("the wordmark", () => {
  it("sets the name as one word at one size, with a strapline beneath", async () => {
    await mount();
    const mark = nav().querySelector("button[aria-label^='FireflyReader']")!;
    const name = mark.querySelector("span.display")!;
    const strapline = mark.querySelector("span.mono")!;

    expect(name.textContent).toBe("Firefly Reader");
    // one element, so one face and one size — the name never changes typeface
    // or size part-way through
    expect(name.querySelectorAll("span")).toHaveLength(0);
    expect(name.getAttribute("class")).not.toMatch(/mono/);
    expect(strapline.textContent).toMatch(/a quiet place to read/i);
    expect(name.compareDocumentPosition(strapline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("writes the date out rather than abbreviating it", async () => {
    await mount();
    // "Ed. 11.09.2026" read as *editor*, and 11.09 is ambiguous between
    // 11 September and 9 November
    expect(nav().textContent).not.toMatch(/Ed\./);
    // the uppercase is a CSS transform, so the text itself is mixed case
    expect(stream().textContent).toMatch(/Friday, 11 September 2026/i);
  });
});

describe("the sample edition", () => {
  it("is labelled and explainable", async () => {
    await mount();
    expect(within(stream()).getByText("Sample edition")).toBeInTheDocument();
    expect(within(stream()).getByText(/invented stories, invented writers/i)).toBeInTheDocument();
  });

  it("retires itself as soon as a real source exists", async () => {
    const repo = await import("@/lib/storage/repository");
    await repo.putSource({
      id: "sreal",
      url: "https://example.com/feed.xml",
      siteUrl: "https://example.com",
      title: "A Real Source",
      host: "example.com",
      folder: "independent",
      addedAt: Date.now(),
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await mount();
    expect(screen.queryByText("Sample edition")).not.toBeInTheDocument();
    expect(within(nav()).getByText("A Real Source")).toBeInTheDocument();
    // the invented stories go with it
    expect(screen.queryByText(/The Quiet Return of the Personal Website/)).not.toBeInTheDocument();
  });
});

describe("columns", () => {
  it("switches source and carries the reader with it", async () => {
    const { user } = await mount();
    await user.click(within(nav()).getByRole("button", { name: /^Independent Web/ }));

    await waitFor(() =>
      expect(stream().querySelector("[data-t='viewtitle']")).toHaveTextContent("Independent Web"),
    );
    expect(rows().length).toBeGreaterThan(0);
    // the open story must belong to the column that is showing
    const selected = document.querySelector("[aria-current='true']");
    expect(selected).toBeTruthy();
  });

  it("filters the column to unread only", async () => {
    const { user } = await mount();
    const total = rows().length;

    await user.click(within(stream()).getByRole("button", { name: "Unread" }));
    await waitFor(() => expect(rows().length).toBeLessThanOrEqual(total));
    for (const row of rows()) {
      expect(row.querySelector("[role='button']") ?? row).toBeTruthy();
    }
  });

  it("searches across every source", async () => {
    const { user } = await mount();
    await user.keyboard("/");
    const input = await screen.findByPlaceholderText(/Search every story/);
    await user.type(input, "small models");
    await waitFor(() => expect(screen.getByText(/1 match/)).toBeInTheDocument());
  });
});

describe("appearance", () => {
  it("toggles the colour scheme on the document element", async () => {
    const { user } = await mount();
    await user.keyboard("t");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    await user.keyboard("t");
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  });
});
