/**
 * The languages Today's briefing is written in, and the briefing's own words in
 * each.
 *
 * This is not an app-wide translation layer. The reader's chrome — navigation,
 * the stream, the reader, Settings — speaks English and keeps speaking it; what
 * this covers is the one page a reader scans rather than reads. A briefing in
 * your language is worth the ten minutes of strings it costs; a half-translated
 * application is worth less than an English one.
 *
 * Three things are deliberately outside it:
 *
 *   - **Arabic, Hebrew and other right-to-left scripts.** The layout is built
 *     left-to-right and the type has no direction switching, so offering them
 *     would promise a rendering nobody has checked.
 *   - **The app's own dates and relative times.** "5 min ago" and the masthead
 *     month are shared chrome, and belong with a real translation pass.
 *   - **A free-text language field.** The set is closed, the same way the
 *     topic set is: a language this table does not name is one this app has not
 *     checked the output limits for.
 */

/** The language the edition is written in. */
export type DigestLanguageId =
  "source" | "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko" | "es" | "fr" | "de" | "pt" | "ru";

export type DigestStrings = {
  off: string;
  offAction: string;
  quiet: string;
  quietNote: string;
  /** The list of editions the reader has already read. */
  history: string;
  /** The label for today's own row in that list. */
  today: string;
  /** How many picks an earlier edition had. */
  picks: (n: number) => string;
  unconfigured: string;
  unconfiguredNote: string;
  writing: string;
  retry: string;
  /** Rewriting today's edition on purpose. */
  regenerate: string;
  /** While a rewrite is in flight. */
  rewriting: string;
  /** The daily cap, as a title on the control that is now inert. */
  capTitle: string;
  regenerateTitle: string;
  /** How much of today made the edition. */
  edition: (picks: number, candidates: number) => string;
  provenance: string;
  /** What arrived after this edition was written. */
  stale: (n: number) => string;
  minutes: (n: number) => string;
  /** This edition was written before the reader changed the language. */
  otherLanguage: string;
};

export type DigestLanguage = {
  id: DigestLanguageId;
  /** What the reader picks from, written in the language itself. */
  label: string;
  /** The same, for the sentence the model is given. */
  promptName?: string;
  /**
   * What counts as one over-long line.
   *
   * A sentence carries more per character where characters are words, so the
   * same ceiling would let a Chinese gist become a paragraph before anything
   * dropped it.
   */
  lineLimit: number;
  /** The page's own words, where this app has written them. */
  strings?: DigestStrings;
};

/** One sentence, in every language this app claims to write one in. */
const EN: DigestStrings = {
  off: "The briefing is off",
  offAction: "Open settings",
  quiet: "Not enough new today",
  quietNote:
    "Three unread stories is the least an edition can be chosen from — and a story already featured in an earlier edition is not offered twice.",
  history: "Earlier editions",
  today: "Today",
  picks: (n) => `${n} ${n === 1 ? "story" : "stories"}`,
  unconfigured: "No model is set up yet",
  unconfiguredNote: "A briefing is written by a model of your own choosing.",
  writing: "Writing today's edition…",
  retry: "Retry",
  regenerate: "Regenerate",
  rewriting: "Writing…",
  capTitle: "No rewrites left today",
  regenerateTitle: "Write today's edition again from the current stories",
  edition: (picks, candidates) =>
    `${picks} of ${candidates} ${candidates === 1 ? "story" : "stories"}, chosen and summarised from your own feeds.`,
  provenance: "Written from each story's title and summary. Nothing fetched, nothing invented.",
  stale: (n) => `${n} new ${n === 1 ? "story" : "stories"} since this edition was written`,
  minutes: (n) => `${n} min read`,
  otherLanguage: "This edition is in another language. Regenerate to rewrite it.",
};

const ZH_HANS: DigestStrings = {
  off: "导读已关闭",
  offAction: "打开设置",
  quiet: "今天的新内容不够",
  quietNote: "至少要有三条未读，才谈得上挑选；而且已经推荐过的文章不会再出现。",
  history: "更早的导读",
  today: "今天",
  picks: (n) => `${n} 篇`,
  unconfigured: "还没有配置模型",
  unconfiguredNote: "导读由你自己选择的模型写成。",
  writing: "正在写今天的导读…",
  retry: "重试",
  regenerate: "重新生成",
  rewriting: "正在写…",
  capTitle: "今天的重写次数已用完",
  regenerateTitle: "用当前的故事重新写今天的导读",
  edition: (picks, candidates) => `从 ${candidates} 篇里选出 ${picks} 篇，取自你的订阅。`,
  provenance: "仅依据各篇的标题与摘要写成。没有抓取原文，也没有编造。",
  stale: (n) => `这版写完之后又来了 ${n} 篇新内容`,
  minutes: (n) => `约 ${n} 分钟`,
  otherLanguage: "这版导读不是用你现在的语言写的。点「重新生成」重写。",
};

const ZH_HANT: DigestStrings = {
  off: "導讀已關閉",
  offAction: "開啟設定",
  quiet: "今天的新內容不夠",
  quietNote: "至少要有三則未讀，才談得上挑選；而且已經推薦過的文章不會再出現。",
  history: "更早的導讀",
  today: "今天",
  picks: (n) => `${n} 則`,
  unconfigured: "還沒有設定模型",
  unconfiguredNote: "導讀由你自己選擇的模型寫成。",
  writing: "正在寫今天的導讀…",
  retry: "重試",
  regenerate: "重新產生",
  rewriting: "正在寫…",
  capTitle: "今天的重寫次數已用完",
  regenerateTitle: "用目前的故事重寫今天的導讀",
  edition: (picks, candidates) => `從 ${candidates} 則裡選出 ${picks} 則，取自你的訂閱。`,
  provenance: "僅依據各則的標題與摘要寫成。沒有抓取原文，也沒有編造。",
  stale: (n) => `這版寫完之後又來了 ${n} 則新內容`,
  minutes: (n) => `約 ${n} 分鐘`,
  otherLanguage: "這版導讀不是用你現在的語言寫的。點「重新產生」重寫。",
};

const JA: DigestStrings = {
  off: "ブリーフィングはオフです",
  offAction: "設定を開く",
  quiet: "今日は新着が少なすぎます",
  quietNote: "選ぶには未読が3件以上必要です。すでに紹介した記事は二度と出ません。",
  history: "過去の版",
  today: "今日",
  picks: (n) => `${n}件`,
  unconfigured: "モデルが未設定です",
  unconfiguredNote: "ブリーフィングは、あなたが選んだモデルが書きます。",
  writing: "今日のブリーフィングを書いています…",
  retry: "再試行",
  regenerate: "書き直す",
  rewriting: "書き直しています…",
  capTitle: "今日の書き直しは上限に達しました",
  regenerateTitle: "いまの記事から今日のブリーフィングを書き直す",
  edition: (picks, candidates) =>
    `${candidates}件から${picks}件を選び、購読フィードの内容からまとめました。`,
  provenance: "各記事のタイトルと要約だけを根拠に書いています。原文の取得も、創作もしていません。",
  stale: (n) => `この版を書いたあとに${n}件の新着があります`,
  minutes: (n) => `読了 ${n}分`,
  otherLanguage: "この版は別の言語で書かれています。「書き直す」で書き直してください。",
};

const KO: DigestStrings = {
  off: "브리핑이 꺼져 있습니다",
  offAction: "설정 열기",
  quiet: "오늘은 새 글이 너무 적습니다",
  quietNote:
    "고르려면 읽지 않은 글이 3개 이상 있어야 합니다. 이미 소개한 글은 다시 나오지 않습니다.",
  history: "이전 브리핑",
  today: "오늘",
  picks: (n) => `${n}개`,
  unconfigured: "모델이 설정되지 않았습니다",
  unconfiguredNote: "브리핑은 당신이 고른 모델이 씁니다.",
  writing: "오늘의 브리핑을 쓰는 중…",
  retry: "다시 시도",
  regenerate: "다시 쓰기",
  rewriting: "다시 쓰는 중…",
  capTitle: "오늘 다시 쓰기 횟수를 모두 썼습니다",
  regenerateTitle: "지금의 글들로 오늘의 브리핑을 다시 쓰기",
  edition: (picks, candidates) =>
    `${candidates}개 중 ${picks}개를 골라, 구독 피드의 내용으로 정리했습니다.`,
  provenance: "각 글의 제목과 요약만을 근거로 씁니다. 원문을 가져오지도, 지어내지도 않았습니다.",
  stale: (n) => `이 버전을 쓴 뒤 새 글이 ${n}개 더 왔습니다`,
  minutes: (n) => `약 ${n}분`,
  otherLanguage: "이 버전은 다른 언어로 쓰여 있습니다. '다시 쓰기'로 다시 써 주세요.",
};

/**
 * The set, ordered as a reader meets it: the default first, then the
 * languages this app's own words have been written in, then the rest.
 *
 * "source" is not a language but the default choice — write each gist in the
 * language of the story it is about. Its `promptName` is absent because there
 * is nothing to name, and the page's own words stay in English when it is
 * chosen: a page cannot follow a language that differs story by story.
 */
export const DIGEST_LANGUAGES: readonly DigestLanguage[] = [
  { id: "source", label: "The story's own language", lineLimit: 120 },
  { id: "en", label: "English", promptName: "English", lineLimit: 120, strings: EN },
  {
    id: "zh-Hans",
    label: "简体中文",
    promptName: "Simplified Chinese",
    lineLimit: 60,
    strings: ZH_HANS,
  },
  {
    id: "zh-Hant",
    label: "繁體中文",
    promptName: "Traditional Chinese",
    lineLimit: 60,
    strings: ZH_HANT,
  },
  { id: "ja", label: "日本語", promptName: "Japanese", lineLimit: 60, strings: JA },
  { id: "ko", label: "한국어", promptName: "Korean", lineLimit: 60, strings: KO },
  { id: "es", label: "Español", promptName: "Spanish", lineLimit: 120 },
  { id: "fr", label: "Français", promptName: "French", lineLimit: 120 },
  { id: "de", label: "Deutsch", promptName: "German", lineLimit: 120 },
  { id: "pt", label: "Português", promptName: "Portuguese", lineLimit: 120 },
  { id: "ru", label: "Русский", promptName: "Russian", lineLimit: 120 },
];

export const DEFAULT_DIGEST_LANGUAGE: DigestLanguageId = "source";

export function findLanguage(id: string | null | undefined): DigestLanguage {
  return DIGEST_LANGUAGES.find((language) => language.id === id) ?? DIGEST_LANGUAGES[0];
}

/**
 * The page's own words in one language.
 *
 * A language this app has not written them in falls back to English rather
 * than to silence: a Spanish edition with English labels around it is what the
 * reader has today, and it beats an edition that cannot be regenerated because
 * the button has no name.
 */
export function digestStrings(id: DigestLanguageId): DigestStrings {
  return findLanguage(id).strings ?? EN;
}

/** A language this app validates an answer in, or the default. */
export function readDigestLanguage(value: unknown): DigestLanguageId {
  return typeof value === "string" && findLanguage(value).id === value
    ? (value as DigestLanguageId)
    : DEFAULT_DIGEST_LANGUAGE;
}
