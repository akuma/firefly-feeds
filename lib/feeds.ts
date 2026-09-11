import type { Feed, FeedId, Folder, FolderId, SmartViewId } from "./types";

export type { SmartViewId, ViewId } from "./types";

export const EDITION = {
  weekday: "THURSDAY",
  weekdayShort: "THU",
  month: "SEPTEMBER",
  day: "11",
  year: "2025",
  /** ISO date used for the reader's provenance line. */
  iso: "2025-09-11",
  volume: "IV",
  long: "Thursday, 11 September 2025",
  /** The masthead treats the edition date as a printed object. */
  slug: "11.09.2025",
};

export const FOLDERS: Folder[] = [
  { id: "design", name: "Design" },
  { id: "technology", name: "Technology" },
  { id: "ai", name: "AI" },
  { id: "independent", name: "Independent Web" },
  { id: "culture", name: "Culture" },
];

/** The edition's own subscriptions. User-added sources are merged in at runtime. */
export const SEED_FEEDS: Feed[] = [
  {
    id: "kottke",
    name: "Kottke",
    folder: "independent",
    host: "kottke.org",
    mark: "KO",
    siteUrl: "https://kottke.org",
  },
  {
    id: "simonw",
    name: "Simon Willison",
    folder: "ai",
    host: "simonwillison.net",
    mark: "SW",
    siteUrl: "https://simonwillison.net",
  },
  {
    id: "dense",
    name: "Dense Discovery",
    folder: "design",
    host: "densediscovery.com",
    mark: "DD",
    siteUrl: "https://www.densediscovery.com",
  },
  {
    id: "aeon",
    name: "Aeon",
    folder: "culture",
    host: "aeon.co",
    mark: "AE",
    siteUrl: "https://aeon.co",
  },
  {
    id: "verge",
    name: "The Verge",
    folder: "technology",
    host: "theverge.com",
    mark: "TV",
    siteUrl: "https://www.theverge.com",
  },
  {
    id: "creativeboom",
    name: "Creative Boom",
    folder: "design",
    host: "creativeboom.com",
    mark: "CB",
    siteUrl: "https://www.creativeboom.com",
  },
  {
    id: "stratechery",
    name: "Stratechery",
    folder: "technology",
    host: "stratechery.com",
    mark: "ST",
    siteUrl: "https://stratechery.com",
  },
];

export const FEED_BY_ID: Record<FeedId, Feed> = SEED_FEEDS.reduce(
  (acc, feed) => {
    acc[feed.id] = feed;
    return acc;
  },
  {} as Record<FeedId, Feed>,
);

export const FEEDS = SEED_FEEDS;

export const FOLDER_BY_ID: Record<FolderId, Folder> = FOLDERS.reduce(
  (acc, folder) => {
    acc[folder.id] = folder;
    return acc;
  },
  {} as Record<FolderId, Folder>,
);

export const SMART_VIEWS: { id: SmartViewId; name: string; hint: string }[] = [
  { id: "today", name: "Today", hint: "T" },
  { id: "all", name: "All Stories", hint: "A" },
  { id: "saved", name: "Saved", hint: "S" },
  { id: "later", name: "Later", hint: "L" },
];
