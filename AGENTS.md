# AGENTS.md

Firefly Feeds is an editorial RSS reader built with Next.js App Router on **vinext** (Vite 8 / Rolldown), React 19, Tailwind CSS v4, and Bun.

## Working agreement

- Default to Chinese unless the user explicitly asks for another language.
- Make the smallest coherent change that solves the task.
- Do not refactor unrelated code.
- Preserve existing behavior and user data unless the task explicitly requires changing them.
- Prefer existing project patterns over introducing new abstractions or dependencies.
- Never claim something is verified unless the relevant checks actually passed.
- Keep final responses brief: what changed, what was verified, and any remaining issue.

## Repository map

- `app/` — routes, shell, and server endpoints
- `components/` — UI components
- `lib/store.tsx` — application state
- `lib/storage/` — persistence layer
- `app/api/` — feed fetching, on-demand full-text extraction, and the request guards
- `docs/` — architecture and design documentation

### Sources of truth

Read the relevant document before changing a subsystem:

- UI and visual system → `docs/DESIGN.md` and `app/globals.css`
- Feed pipeline and application architecture → `docs/ARCHITECTURE.md`
- Persistence, migrations, and replication → `docs/STORAGE.md`
- Setup and product overview → `README.md`

If behavior changes, update the relevant documentation in the same change.

## Commands

```bash
bun run dev
bun run build

bun run format
bun run format:check
bun run lint
bun run typecheck
bun run test

bun run good
bun run check
```

Use the narrowest relevant test during development.

Before finishing a source-code change:

```bash
bun run good
bun run check
```

Both must pass before reporting the change as verified.

Run a single test file:

```bash
bun run test -- <file>
```

Run a single test case:

```bash
bun run test -- -t "<name>"
```

## Critical constraints

- Persisted data is a compatibility surface. Storage names, keys, and record-shape changes require migration handling.
- Browser code must not fetch publisher feeds directly; keep feed network access server-side.
- Do not render publisher HTML with `dangerouslySetInnerHTML`; use the existing article representation.
- Full text is fetched only when the reader opens a story whose feed body was a summary — never as a background crawl — and never to defeat a paywall, login, or challenge.
- Never fabricate authors, publications, URLs, or artwork for real articles.
- Follow the existing design system rather than introducing a new visual language casually.

## Code conventions

- TypeScript is strict. Do not use `any`.
- Prettier owns formatting and Tailwind class ordering.
- oxlint warnings are failures.
- Comments explain **why**, not what.
- Server-only code belongs under `app/api/**`.
- Do not replace existing local utilities or dependencies without a concrete reason.

## Testing

- Tests are colocated as `*.test.ts` / `*.test.tsx`.
- Add regression tests for deterministic bug fixes.
- Prefer fixture-based tests for feed and parsing behavior.
- Use the existing fresh-database helper for persistence tests.
- Scope DOM queries when desktop and mobile UI coexist in the test tree.

## Change discipline

- Do not add dependencies unless the existing stack cannot solve the problem cleanly.
- Do not introduce a new state layer, persistence layer, or abstraction without a clear need.
- User-visible failures must provide meaningful feedback.
- Keep documentation, tests, and implementation consistent.
