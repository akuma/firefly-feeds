import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom has no matchMedia, and the shell uses it to decide whether the third
// navigation column fits.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom does not implement layout, so scrollIntoView is missing.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
