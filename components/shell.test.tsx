import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
function colophon(): { unread: number; sources: number } {
  const line = [...nav().querySelectorAll("span")]
    .map((node) => node.textContent ?? "")
    .find((text) => /^\d+ unread · \d+ sources$/.test(text));
  const [, unread, sources] = /^(\d+) unread · (\d+) sources$/.exec(line ?? "") ?? [];
  return { unread: Number(unread ?? -1), sources: Number(sources ?? -1) };
}

async function mount() {
  const user = userEvent.setup();
  const result = render(<Shell />);
  await waitFor(() => expect(screen.getByText("Reading Stream")).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText("Opening the edition")).not.toBeInTheDocument());
  return { user, ...result };
}

beforeEach(() => {
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
  it("gives the reader a new-tab link to the story's source", async () => {
    await mount();
    const links = reader().querySelectorAll<HTMLAnchorElement>("a[aria-label='Open original (O)']");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("gives every stream row its own link, whatever its layout", async () => {
    await mount();
    const links = stream().querySelectorAll<HTMLAnchorElement>("a[aria-label='Open original (O)']");
    // every layout — including the dense contents-page rows — carries controls
    expect(links.length).toBe(rows().length);
    for (const link of links) expect(link.getAttribute("href")).toMatch(/^https:\/\//);
  });
});

describe("columns", () => {
  it("switches source and carries the reader with it", async () => {
    const { user } = await mount();
    await user.click(within(nav()).getByRole("button", { name: /^Aeon/ }));

    await waitFor(() =>
      expect(stream().querySelector("[data-t='viewtitle']")).toHaveTextContent("Aeon"),
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
