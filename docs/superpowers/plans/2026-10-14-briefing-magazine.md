# Briefing magazine presentation

Approved in conversation: preserve paper tones, Newsreader/mono type and fine
rules; strengthen the issue masthead and section hierarchy, distinguish the
editor's lead news from secondary stories, and make reading recommendations
compact. Apply to saved editions without changing model output or storage.

- [x] Update only the briefing reader's presentation and document the hierarchy.
- [x] Inspect desktop/mobile light/dark using explicit fictional fixture editions.
- [x] Verify citations, empty sections, scroll containment and font preferences.
- [x] Run bun run good and bun run check.

No extra generation requests, dependencies or global style changes are needed.

Verified: 488 tests, both required gates and the production build pass. Browser
checks used isolated fictional fixtures: desktop 1440×1000, phones 390×844 and
360×640, light/dark, Chinese, recommendation-only editions, persisted 23.5px
font preference and citation return. Document height stayed within the viewport;
no runtime errors or horizontal overflow were observed. No paid model was used.

A legacy-edition regression verifies that a perspective-only source remains
visible even when the old sourceArticleIds cache omitted it. Display merges
stored source IDs with all supported paragraph evidence without migrating records.
