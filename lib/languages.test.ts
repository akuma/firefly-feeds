import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIGEST_LANGUAGE,
  DIGEST_LANGUAGES,
  digestStrings,
  findLanguage,
  readDigestLanguage,
} from "./languages";

describe("the language set", () => {
  it("names every language in itself, and keeps the set closed", () => {
    const ids = DIGEST_LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The default is a choice rather than a language: write each gist in the
    // language of the story it is about.
    expect(DIGEST_LANGUAGES[0].id).toBe(DEFAULT_DIGEST_LANGUAGE);
    expect(DIGEST_LANGUAGES[0].promptName).toBeUndefined();
    for (const language of DIGEST_LANGUAGES) {
      expect(language.label.trim()).not.toBe("");
      expect(language.lineLimit).toBeGreaterThan(0);
    }
    // A sentence carries more per character where characters are words.
    expect(findLanguage("zh-Hans").lineLimit).toBeLessThan(findLanguage("en").lineLimit);
    expect(findLanguage("ja").lineLimit).toBeLessThan(findLanguage("en").lineLimit);
  });

  it("writes the page's own words in the languages it has them in, and English otherwise", () => {
    expect(digestStrings("zh-Hans").regenerate).toBe("重新生成");
    expect(digestStrings("ja").regenerate).toBe("書き直す");
    expect(digestStrings("ko").regenerate).toBe("다시 쓰기");
    // A language this app has not written them in still leaves the reader able
    // to act, which beats an edition they cannot regenerate.
    expect(digestStrings("es").regenerate).toBe("Regenerate");
    expect(digestStrings("source").regenerate).toBe("Regenerate");
    expect(readDigestLanguage("zh-Hant")).toBe("zh-Hant");
    expect(readDigestLanguage("klingon")).toBe(DEFAULT_DIGEST_LANGUAGE);
    expect(readDigestLanguage(undefined)).toBe(DEFAULT_DIGEST_LANGUAGE);
  });
});
