export type FolderId =
  "news" | "science" | "technology" | "culture" | "design" | "independent" | "ai";

/**
 * Whether a cached body is the publisher's full text, only what the feed
 * summarised, or our own cut of something longer.
 */
export type ContentState = "full" | "summary" | "truncated";

/** Whether an on-demand full-text extraction has run. Failure is sticky: it is
 * recorded so opening the story again does not hammer the publisher. */
export type ExtractionState = "idle" | "success" | "failed";

export type SmartViewId = "all" | "today" | "saved" | "later";

/** Seeded feeds have literal ids; subscribed feeds get a generated one. */
export type FeedId = string;

export type ViewId = SmartViewId | `folder:${FolderId}` | `feed:${FeedId}`;

export type Feed = {
  id: FeedId;
  name: string;
  /** Absent when the feed was subscribed without a folder. */
  folder?: FolderId;
  /** Host shown in the reader's provenance line. */
  host: string;
  /** Two-letter monogram used in dense list contexts. */
  mark: string;
  /** Present only on feeds the reader subscribed to themselves. */
  feedUrl?: string;
  siteUrl?: string;
  subscribed?: boolean;
  /** True for the built-in sample edition — invented, never fetched, no links. */
  sample?: boolean;
};

export type Folder = {
  id: FolderId;
  name: string;
};

/**
 * A run of text, with a link when the page made it one. Blocks carry the plain
 * `text` for measuring and searching, and an `inline` breakdown only when there
 * is something to link.
 */
export type Inline = { text: string; href?: string };

export type Block =
  | { kind: "p"; text: string; inline?: Inline[] }
  | { kind: "h2"; text: string; inline?: Inline[] }
  | { kind: "quote"; text: string; cite?: string; inline?: Inline[] }
  /** `src` is set when the artwork came from the feed; otherwise a plate is generated. */
  | { kind: "figure"; caption: string; seed: number; src?: string }
  /**
   * A video the original page embeds. Only an allowlisted provider and an id
   * are stored, never publisher markup, so the reader can render a safe embed.
   */
  | { kind: "video"; provider: "youtube" | "vimeo"; id: string; title?: string }
  | { kind: "list"; items: string[]; inlineItems?: Inline[][] }
  | { kind: "note"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" };

/**
 * Stream rhythm. The stream deliberately does not render every story the same
 * way — `layout` decides how much space a story is given in the column.
 */
export type StoryLayout = "feature" | "standard" | "compact" | "quote" | "brief";

export type Article = {
  id: string;
  title: string;
  feedId: FeedId;
  /** Standfirst / summary shown in the stream and under the headline. */
  dek: string;
  /** Minutes before the edition closed. Drives every relative timestamp. */
  minutesAgo: number;
  layout: StoryLayout;
  /** Seed for the generative plate, when the story carries artwork. */
  plate?: number;
  /** Photograph supplied by the feed or page, used as the stream thumbnail. */
  image?: string;
  /** True when `image` is the page's declared cover, shown above the body. */
  hasCover?: boolean;
  /** True when the page is a video that has to be watched at the source. */
  videoPage?: boolean;
  /** Pull quote used by the `quote` layout in the stream. */
  pull?: string;
  byline?: string;
  body: Block[];
  /** Canonical URL, for stories that came from a real feed. */
  link?: string;
  /** Pre-formatted publication date for the reader's provenance line. */
  publishedLabel?: string;
  /** True for stories fetched from a subscription rather than seeded. */
  live?: boolean;
  /** Whether the body is full, a feed summary, or our own cut. */
  contentState: ContentState;
  /** Whether an on-demand full-text fetch has run for this story. */
  extractionState: ExtractionState;
};

export type Story = Article & {
  /** Reading time derived from the body. */
  minutes: number;
};
