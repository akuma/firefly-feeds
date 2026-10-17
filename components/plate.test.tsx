import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Media } from "./plate";

function sized(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, get: () => width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, get: () => height });
  fireEvent.load(img);
}

describe("Media", () => {
  it("keeps a stream thumbnail cropped to its frame", () => {
    const { container } = render(
      <Media seed={1} src="https://cdn.test/wide.jpg" className="aspect-[4/3] w-full" />,
    );
    const img = container.querySelector("img");
    expect(img?.className).toContain("object-cover");
    sized(img!, 200, 300);
    expect(img?.className).toContain("object-cover");
    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("");
  });

  it("lets a reader portrait keep its own ratio", () => {
    const { container } = render(
      <Media
        preservePortrait
        seed={1}
        src="https://cdn.test/person.jpg"
        className="aspect-[16/9] w-full"
      />,
    );
    const img = container.querySelector("img")!;
    // Unmeasured, so the 16:9 frame cannot crop it before its size is known.
    expect(img.className).not.toContain("object-cover");
    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("auto");

    sized(img, 200, 300);
    expect(img.className).not.toContain("object-cover");
    // 75vh × 2/3. jsdom simplifies the calc when the ratio divides evenly.
    expect(img.style.width).toBe("min(100%, 50vh)");
  });

  it("keeps a reader landscape in the 16:9 frame", () => {
    const { container } = render(
      <Media
        preservePortrait
        seed={1}
        src="https://cdn.test/horizon.jpg"
        className="aspect-[16/9] w-full"
      />,
    );
    const img = container.querySelector("img")!;
    sized(img, 800, 450);
    expect(img.className).toContain("object-cover");
    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("");
  });

  it("keeps a square photograph in the frame", () => {
    const { container } = render(
      <Media
        preservePortrait
        seed={1}
        src="https://cdn.test/square.jpg"
        className="aspect-[16/9] w-full"
      />,
    );
    const img = container.querySelector("img")!;
    sized(img, 600, 600);
    expect(img.className).toContain("object-cover");
  });

  it("measures a portrait that has already finished loading", () => {
    const image = HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(image, "complete");
    const naturalWidth = Object.getOwnPropertyDescriptor(image, "naturalWidth");
    const naturalHeight = Object.getOwnPropertyDescriptor(image, "naturalHeight");
    Object.defineProperty(image, "complete", { configurable: true, get: () => true });
    Object.defineProperty(image, "naturalWidth", { configurable: true, get: () => 200 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, get: () => 300 });
    try {
      const { container } = render(
        <Media
          preservePortrait
          seed={1}
          src="https://cdn.test/cached.jpg"
          className="aspect-[16/9] w-full"
        />,
      );
      const img = container.querySelector("img")!;
      expect(img.className).not.toContain("object-cover");
      expect(img.style.width).toBe("min(100%, 50vh)");
    } finally {
      if (complete) Object.defineProperty(image, "complete", complete);
      if (naturalWidth) Object.defineProperty(image, "naturalWidth", naturalWidth);
      if (naturalHeight) Object.defineProperty(image, "naturalHeight", naturalHeight);
    }
  });

  it("shows the address under a picture that failed to load", () => {
    const src = "https://cdn.test/missing/photo.jpg?w=1200";
    const { container } = render(
      <div className="grid grid-cols-[minmax(0,1fr)_84px]">
        <Media seed={1} src={src} className="aspect-[4/3] w-full" />
      </div>,
    );
    const first = container.querySelector("img")!;
    fireEvent.error(first);
    expect(container.textContent).not.toContain("Image unavailable");
    fireEvent.error(container.querySelector("img")!);

    const frame = container.querySelector('[class*="aspect-"]')!;
    expect(frame.textContent).toContain("Image unavailable");
    expect(frame.textContent).not.toContain(src);
    const address = screen.getByText(src);
    expect(address.getAttribute("data-t")).toBe("image-address");
    expect(address.className).toContain("col-span-2");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a picture the origin request blocked once it is asked for with no referrer", () => {
    const src = "https://cdn.test/foreign-origin.jpg";
    let gaveUp = false;
    const { container } = render(
      <Media seed={1} src={src} onError={() => (gaveUp = true)} className="aspect-[4/3] w-full" />,
    );
    const first = container.querySelector("img")!;
    expect(first.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    fireEvent.error(first);

    const second = container.querySelector("img")!;
    expect(second).not.toBe(first);
    expect(second.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(gaveUp).toBe(false);
    expect(container.textContent).not.toContain("Image unavailable");
    fireEvent.load(second);
    expect(container.querySelector("img")).toBe(second);
    expect(gaveUp).toBe(false);
  });

  it("gives up after one retry and resets the policy when the source changes", () => {
    const onError = vi.fn();
    const { container, rerender } = render(
      <Media seed={1} src="https://cdn.test/first.jpg" onError={onError} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(container.querySelector("img")!);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();

    rerender(<Media seed={1} src="https://cdn.test/second.jpg" onError={onError} />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://cdn.test/second.jpg");
    expect(image.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(container.textContent).not.toContain("Image unavailable");
    fireEvent.error(image);
    expect(container.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
