# Briefing citation contract v2 implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development.

**Goal:** New writing replies cite article IDs without copying excerpts; legacy runs retain v1 validation and prompts.

**Architecture:** Keep the storage/input envelope and shortlist schema at v1. Freeze optional `composeContractVersion: 1 | 2` in prepared inputs and published editions (missing means legacy v1). Writing output schemaVersion follows this contract. Both transports, final publication, compact repairs and Resume select the same schema from the frozen input, never from the reply. Preserve old excerpts and source snapshots.

**Tech Stack:** TypeScript, React, vinext, IndexedDB, Vitest, Bun.

- [x] Add failing v2 regression tests for the r7 quotation boundary, missing/unknown/wrong-group citations, version mismatch, normal/compact prompts and transport agreement.
- [x] Add version-aware schemas/types/validators and prompts; keep legacy prompt instructions intact. V2 evidence is `{ articleId }`; strip model-added excerpt fields as unknown output, without requiring or validating them.
- [x] Freeze v2 on new runs and v1 on unmarked Resume. Preserve the original prompt version on published resumed runs. Test new publication, legacy Resume, saved-edition protection and call budgets.
- [x] Update the reading notice and architecture/storage/design docs; retain historical excerpts and existing omission statistics.
- [x] Run focused tests, then `bun run good` and `bun run check`. Review the diff for unchanged selection/network budgets. Both gates passed with 646 tests and a production build.

Delivery: commit only change A, push its branch and open a PR targeting `feat/ai-daily-digest`.

Rollback: switch new runs back to v1 while retaining v2 read support. Never delete or rewrite saved editions or checkpoints.
