import type { Folder, FolderId } from "./types";

/**
 * Real, verifiable publications. These are NOT subscriptions — nothing is
 * fetched until the reader asks for it. They exist so the first run offers a
 * way in, and every one of these feed URLs was checked to resolve.
 */

export const FOLDERS: Folder[] = [
  { id: "design", name: "Design" },
  { id: "technology", name: "Technology" },
  { id: "ai", name: "AI" },
  { id: "independent", name: "Independent Web" },
  { id: "culture", name: "Culture" },
];

export type SuggestedSource = {
  /** Stable id derived from the URL, matching `sourceIdFor`. */
  id: string;
  name: string;
  host: string;
  folder: FolderId;
  siteUrl: string;
  feedUrl: string;
  blurb: string;
};

export const SUGGESTED_SOURCES: SuggestedSource[] = [
  {
    id: "skottke",
    name: "Kottke",
    host: "kottke.org",
    folder: "independent",
    siteUrl: "https://kottke.org",
    feedUrl: "https://feeds.kottke.org/main",
    blurb: "The oldest one-person link blog on the web.",
  },
  {
    id: "ssimonw",
    name: "Simon Willison",
    host: "simonwillison.net",
    folder: "ai",
    siteUrl: "https://simonwillison.net",
    feedUrl: "https://simonwillison.net/atom/everything/",
    blurb: "Working notes on language models, written as they happen.",
  },
  {
    id: "sdense",
    name: "Dense Discovery",
    host: "densediscovery.com",
    folder: "design",
    siteUrl: "https://www.densediscovery.com",
    feedUrl: "https://www.densediscovery.com/feed/",
    blurb: "A weekly on design, technology and doing good work.",
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
  {
    id: "sverge",
    name: "The Verge",
    host: "theverge.com",
    folder: "technology",
    siteUrl: "https://www.theverge.com",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    blurb: "Technology news, with the feed still intact.",
  },
  {
    id: "screativeboom",
    name: "Creative Boom",
    host: "creativeboom.com",
    folder: "design",
    siteUrl: "https://www.creativeboom.com",
    feedUrl: "https://www.creativeboom.com/feed/",
    blurb: "News and interviews for the creative industries.",
  },
  {
    id: "sstratechery",
    name: "Stratechery",
    host: "stratechery.com",
    folder: "technology",
    siteUrl: "https://stratechery.com",
    feedUrl: "https://stratechery.com/feed/",
    blurb: "Ben Thompson on the strategy of technology businesses.",
  },
];

export const SUGGESTED_BY_ID = new Map(SUGGESTED_SOURCES.map((s) => [s.id, s]));
