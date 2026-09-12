import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Firefly Feeds — a quiet place to read the web",
  description:
    "An editorial RSS reader for thoughtful, unhurried reading. Feeds, folders, and a reading surface built around rhythm and long-form attention.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9e4d9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d0b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const THEME_BOOT = `(function(){try{
var raw=localStorage.getItem("firefly.feeds.v1");
var t=raw?JSON.parse(raw).theme:null;
if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
if(t==="dark"){document.documentElement.classList.add("dark");}
document.documentElement.style.colorScheme=t;
}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Fonts are self-hosted in public/fonts — no external CDN, so type renders
            identically offline and on networks where Google Fonts is unreachable. */}
        <link
          rel="preload"
          href="/fonts/newsreader-normal-300_700-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/newsreader-italic-300_700-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* The edition date numeral is above the fold, and 2.7KB, so it never
            waits for the stylesheet to be parsed. */}
        <link
          rel="preload"
          href="/fonts/figtree-figures.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {/* One mark: a multi-size .ico for browsers, the same PNG for the ones
            that prefer it, and the touch icon for iOS. */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/mark.png" sizes="64x64" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
