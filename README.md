# Firefly Feeds

**Not a dashboard. A weekly publication that happens to know your subscriptions.**

Firefly Feeds is an editorial RSS reader for thoughtful, unhurried reading. It
fetches real feeds, parses them on the server, and shapes them into something
closer to a printed edition than an endless stream of rows.

The interface is designed around rhythm, hierarchy, and long-form attention — not
constant refreshing or infinite scrolling.

Everything you read, save, or queue stays on your device. There is no account, no
sync service, and no reading history stored on our servers.

![The Firefly Feeds reading stream, showing the built-in sample edition](docs/preview-sample.webp)

_The built-in sample edition, shown on first launch._

## Features

- **RSS 2.0, Atom and RDF** — normalised into one shape
- **Feed discovery** — paste any site address and it finds the feed
- **An editorial stream** — story layouts chosen by content, never by position
- **A reader, not a panel** — 600px measure, four text sizes, optical sizing
- **Read, save, read later** — the unread count is a queue, not a log
- **Read on reaching the end** — not on clicking
- **Keyboard-first** — press `?` for the whole set
- **Search** across every source, author and headline
- **Dark mode**, and an immersive reading mode
- **Local-first storage** — IndexedDB, no account, no sync service
- **Open the original** in a new tab, from the stream or the reader
- **A sample edition** on first run, so there is something to look at

## Why it is not like the others

**It reads like a publication.** Three paper tones separated by hairlines instead
of cards; a serif for every headline and all reading text, mono for everything
that is metadata; one accent colour, used only where it means something.

**It gives each story the room it earns.** A story with a picture gets a
thumbnail row; one with nothing to summarise gets a bare contents-page line;
everything else gets a headline and a standfirst. Never a coin-flip, never a
shape that hides a summary you could have used.

**It treats "read" as something you did.** Opening a story is not reading it.
Reaching the end is — and so is staying with a short one. Nothing you meant to
glance at disappears from the queue.

**It keeps invented content separate.** The sample edition is clearly labelled,
carries no outbound links, and retires itself the moment you subscribe to
something real.

## Running locally

Requires [Bun](https://bun.sh). No other setup, no environment variables.

```bash
bun install
bun run dev      # development server
bun run build    # production build
bun run start    # production server
```

The quality gate:

|                 |                                                   |
| --------------- | ------------------------------------------------- |
| `bun run good`  | format, lint, typecheck, test                     |
| `bun run check` | the same plus a production build, writing nothing |

## Deploying

Deploy by hand:

```bash
bun run check    # the gate
bun run deploy   # vinext build && vinext-cloudflare deploy
```

Deploying needs Cloudflare credentials: run `bunx wrangler login` once, or set
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment from your
own account. Only the token is a secret; neither belongs in the repository. Bun's
version comes from `packageManager` in `package.json`.

## How it works

**Feeds are read on the server.** `app/api/feed/route.ts` is the only thing that
touches the network, so publishers never need CORS headers and the page makes no
third-party requests until you subscribe to something.

**Bodies become blocks, not HTML.** Feed HTML is translated into the reader's own
block model — paragraphs, headings, quotes, lists, figures. No
`dangerouslySetInnerHTML`, no sanitiser dependency, and no publisher stylesheet
leaking into the reading surface.

**Read state is local, and shaped for replication.** Read, saved and later live
in IndexedDB behind a repository interface, with `updatedAt` on every record and
deletions kept as tombstones — so a sync client has something to work with later,
and a new device re-fetches prose rather than downloading a corpus.

## Screenshots

![Firefly Feeds reading NASA's real RSS feed](docs/preview-real.webp)

_Reading NASA's real RSS feed. Publisher-provided imagery is shown as-is._

![The same edition in dark mode](docs/preview-dark.webp)

_Dark mode._

<img src="docs/preview-mobile.webp" alt="Firefly Feeds on a phone, showing the article as a full-screen reading sheet" width="300" />

_On a phone, the article becomes a full-screen reading sheet._

## Documentation

|                                              |                                                            |
| -------------------------------------------- | ---------------------------------------------------------- |
| [docs/DESIGN.md](docs/DESIGN.md)             | Why it looks like this — paper, type, rhythm               |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How a feed becomes a page, and where the seams are         |
| [docs/STORAGE.md](docs/STORAGE.md)           | The three stores, the repository contract, what sync needs |

Working on the code? [AGENTS.md](AGENTS.md) has the conventions, the layering
rules and the commands.

## Stack

[vinext](https://github.com/cloudflare/vinext) — the Next.js App Router on Vite 8
/ Rolldown — React 19, Tailwind CSS v4, lucide-react, Bun.

Fonts are self-hosted in `public/fonts`, so there is no font CDN in the request
path.

## Built with vibe coding

Firefly Feeds **was built with vibe coding**, using **Pi Coding Agent** and
**DeepSeek-V4.1-Flash**.

The first usable version consumed about **$1.40 in LLM API usage**.

## License

Firefly Feeds is open source under the [MIT License](LICENSE).

The Firefly Feeds name, logo, visual identity, and other brand assets are not included in the MIT License. The license does not grant permission to use these assets to represent modified or derivative versions as official Firefly Feeds products.

Third-party fonts, images, and other assets remain subject to their respective licenses.
