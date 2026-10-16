import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
