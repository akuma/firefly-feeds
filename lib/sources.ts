import type { Folder, FolderId } from "./types";

/**
 * Real, verifiable publications. These are NOT subscriptions — nothing is
 * fetched until the reader asks for it. They exist so the first run offers a
 * way in, and every one of these feed URLs was checked to resolve.
 */

export const FOLDERS: Folder[] = [
  { id: "news", name: "News" },
  { id: "science", name: "Science" },
  { id: "technology", name: "Technology" },
  { id: "ai", name: "AI" },
  { id: "culture", name: "Culture" },
  { id: "design", name: "Design" },
  { id: "independent", name: "Ideas" },
];

export type SuggestedSource = {
  /** Stable id derived from the URL, matching `sourceIdFor`. */
  id: string;
  name: string;
  host: string;
  /** Where a subscription to this source files by default. */
  folder: FolderId;
  siteUrl: string;
  feedUrl: string;
  /** A plain description. No superlatives — this is an offer, not a pitch. */
  blurb: string;
};

/**
 * Six sources you can subscribe to, spread across news, science, technology,
 * culture and long-form writing.
 *
 * Nothing here is promoted and nothing is a partnership: they are public
 * broadcasters, a museum, an agency, and two independent publications, listed
 * because together they read like a general-interest edition rather than a
 * technology feed. Each URL was checked to resolve.
 *
 * Being listed subscribes you to nothing. Every one of these is a button the
 * reader has to press.
 */
export const SUGGESTED_SOURCES: SuggestedSource[] = [
  {
    id: "sbbc",
    name: "BBC News",
    host: "bbc.co.uk",
    folder: "news",
    siteUrl: "https://www.bbc.co.uk/news",
    feedUrl: "https://feeds.bbci.co.uk/news/rss.xml",
    blurb: "World news from the public broadcaster.",
  },
  {
    id: "snpr",
    name: "NPR",
    host: "npr.org",
    folder: "news",
    siteUrl: "https://www.npr.org",
    feedUrl: "https://feeds.npr.org/1001/rss.xml",
    blurb: "News and analysis from American public radio.",
  },
  {
    id: "ssmithsonian",
    name: "Smithsonian Magazine",
    host: "smithsonianmag.com",
    folder: "culture",
    siteUrl: "https://www.smithsonianmag.com",
    feedUrl: "https://www.smithsonianmag.com/rss/articles/",
    blurb: "History, science and culture from the Smithsonian.",
  },
  {
    id: "snasa",
    name: "NASA",
    host: "nasa.gov",
    folder: "science",
    siteUrl: "https://www.nasa.gov",
    feedUrl: "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    blurb: "Mission updates and imagery from the space agency.",
  },
  {
    id: "sarstechnica",
    name: "Ars Technica",
    host: "arstechnica.com",
    folder: "technology",
    siteUrl: "https://arstechnica.com",
    feedUrl: "https://feeds.arstechnica.com/arstechnica/index",
    blurb: "In-depth technology reporting.",
  },
  {
    id: "saeon",
    name: "Aeon",
    host: "aeon.co",
    folder: "culture",
    siteUrl: "https://aeon.co",
    feedUrl: "https://aeon.co/feed.rss",
    blurb: "Long-form essays on philosophy, science and society.",
  },
];

export const SUGGESTED_BY_ID = new Map(SUGGESTED_SOURCES.map((s) => [s.id, s]));
