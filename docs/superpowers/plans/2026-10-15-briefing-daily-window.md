# Daily briefing window and revision semantics

Approved: each local date is one issue, using the 24 hours ending at Generate.
Regenerate uses current articles/preferences and may retain same-issue content.
Only prior dates contribute no-repeat history; news may recur with material updates.
A thin window stays thin. No week-old reading quota. Resume keeps frozen inputs.

- [x] Add failing candidate-window and same-day/cross-day history regressions.
- [x] Use a single fair-sampled 24-hour candidate pool; retain diagnostics shape.
- [x] Exclude same-date revisions from frozen history; supply prior-issue history to Writing.
- [x] Persist optional coverage start for new runs/editions and display local-time range.
- [x] Verify compatibility, regeneration and range display in browser; update docs.
- [x] Run good and check, including production build.

No new dependencies, storage migration or automatic model calls. Existing editions
without coverage metadata are not relabelled as having a strict 24-hour window.
