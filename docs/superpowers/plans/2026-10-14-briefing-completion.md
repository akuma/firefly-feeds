# Daily Briefing completion plan

**Goal:** Complete the existing approved briefing spec without changing the reader's visual language or stored user data.

**Architecture:** Keep the existing generative model configuration (separate from classification), additive database version 4, shared extraction helper and browser pipeline. Correct the stale spec references. Share strict JSON schemas between model prompts and runtime validation. Freeze enrichment inputs, persist per-article progress and billing counters, and maintain an atomic cross-tab lease.

- [x] Pin regressions for interrupted enrichment, cancellation, budget exhaustion, immutable input and cross-tab exclusivity.
- [x] Complete pipeline checkpoints, lease renewal/release, validation, history and usage statistics.
- [x] Add bounded streaming request parsing and strict input contracts; include output schemas in prompts; test API guards.
- [x] Make mobile briefing continuously readable, retain article return position, add clear date/history/error states and natural editorial paragraphs.
- [x] Verify migrations and extraction behavior; update spec, architecture, storage, design and README.
- [x] Run focused regressions, browser checks where available, then `bun run good` and `bun run check`. Record any real-provider/editorial validation limits.

Validation: full quality gates passed; final rerun includes cancellation-budget regression. See the linked feature audit for the real-provider and human editorial-quality limits.
