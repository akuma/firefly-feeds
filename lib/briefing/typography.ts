import type { DigestLanguageId } from "../languages";

// These spans are identifiers, not prose: spacing inside them can break a link or code.
const VERBATIM =
  /(```[\s\S]*?```|`[^`\n]*`|(?:https?:\/\/|www\.)[^\s<>"“”‘’，。；！？）]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gu;
const HAN_END = /\p{Script=Han}$/u;
const LATIN_START = /^[\p{Script=Latin}0-9]/u;
const LATIN_END = /[\p{Script=Latin}0-9]\p{Mark}*$/u;
const HAN_START = /^\p{Script=Han}/u;

/** Display-only spacing; saved prose, evidence, IDs and source URLs stay untouched. */
export function formatBriefingText(text: string, language?: DigestLanguageId): string {
  if (
    language === "ja" ||
    language === "ko" ||
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
  )
    return text;
  let formatted = "";
  for (const [index, part] of text.split(VERBATIM).entries()) {
    const chunk =
      index % 2 === 1
        ? part
        : part
            .replace(/(\p{Script=Han})(?=[\p{Script=Latin}0-9])/gu, "$1 ")
            .replace(/([\p{Script=Latin}0-9]\p{Mark}*)(?=\p{Script=Han})/gu, "$1 ");
    if (
      (HAN_END.test(formatted) && LATIN_START.test(chunk)) ||
      (LATIN_END.test(formatted) && HAN_START.test(chunk))
    )
      formatted += " ";
    formatted += chunk;
  }
  return formatted;
}
