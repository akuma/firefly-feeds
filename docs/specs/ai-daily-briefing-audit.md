# AI Daily Briefing implementation audit · 2026-10-14

The v1 spec was checked against the existing implementation. The repository had
already added the basic domain, pipeline, storage and navigation; this change
completes missing recovery, validation and mobile behavior while retaining the
user's in-progress Settings changes.

| Area              | Corrected behavior / evidence                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts         | Model prompts now contain actual shared strict JSON schemas. JSON Mode is enabled for OpenAI-style providers and native Ollama. Nested malformed input is rejected before a paid request. JSON-mode prompts include a complete format example; failures show safe field-level details rather than hiding the errors array.                                                          |
| Output truncation | Shortlist is capped at 12 selected groups, not 60 annotations; budgets are 6000/8000 tokens, with 16000 for DeepSeek composition. Paragraph/evidence and word targets are explicit. The one allowed repair requests a smaller edition without bypassing evidence checks. Errors identify Selecting or Writing.                                                                      |
| Editorial gate    | Reassessment can promote an exploratory group; floor six remains mandatory. Duplicate event groups and deep-read recommendations are rejected. Whole low-scoring topics are omitted only if there are no other validation errors; the count is shown. One/six-article generation is tested, without a minimum-ten gate. Interest affects shortlist order only.                      |
| Material quality  | RSS summaries and truncated originals are no longer labelled full. Oversized paragraphs retain openings/middle/end; separators and UTF-8 total request bytes count against budgets.                                                                                                                                                                                                 |
| Extraction        | Fresh full feed bodies need no new briefing fetch. Empty nominal successes retain the previous body. Existing conditional requests, retry windows and shared in-flight work remain.                                                                                                                                                                                                 |
| Recovery          | Frozen article/source records survive RSS changes. Each completed article is checkpointed. Partial work no longer incorrectly marks the entire enrichment stage complete. Cancel prevents publication and releases ownership.                                                                                                                                                       |
| Calls             | Dispatch is counted before the request, including a reply lost to cancellation. Explicit resumes cannot exceed three calls. Network failures are not automatically rebilled. Fresh Generate allocates a new slot even after a failed run.                                                                                                                                           |
| Tabs              | Global transactional ownership applies across edition slots. Heartbeat and conditional checkpoint/publication writes prevent stale owners from overwriting a takeover. Fresh generation reads latest database history.                                                                                                                                                              |
| Storage           | Existing v3 is retained; additive v4 is correct. Tests preserve records from populated v2/v3 stores. Editions keep citation metadata, revisions and actual usage when provided.                                                                                                                                                                                                     |
| UI                | Phone briefing is directly readable; four tabs, history selector, archive dates, generation time/timezone, natural paragraphs, consolidated citations, font preference and return position. Existing paper/type/ink tokens remain.                                                                                                                                                  |
| Settings          | Classification and generation are separate. An explicit default-off switch gates navigation/model fields and cancels generation plus connection tests. Gemini and Custom API (OpenAI/Anthropic formats) are supported; Qwen/Kimi/GLM presets are removed while stored values are retained. Connection tests remain explicit and may be billed. Focus topics remain capped at three. |
| Workers           | A local-runtime reproduction found `redirect: error` is unsupported. Calls now use `manual` and reject 3xx without forwarding credentials. Upstream errors are sanitized.                                                                                                                                                                                                           |

## Verification boundary

Automated checks cover deterministic contracts, invalid evidence/IDs, output budgets,
empty extraction, interrupted runs, cross-tab ownership, migrations and the real shell.
`bun run good` and `bun run check` both pass, including formatting, zero-warning lint, TypeScript, all tests in 22 files, and the production build. The final regression also ensures repeated cancellation/resume cannot exceed ten extraction attempts.

Browser checks use an isolated Chrome profile with **explicit fictional QA fixtures**
and mocked model replies, not fabricated real news. Tested 1440×1000 desktop and
390×844 phone, light/dark, two-call generation, no horizontal overflow, citation
open/back and preserved scroll. No page runtime errors were observed.

The DeepSeek transport is checked through the project's actual local Workers runtime
using an invalid diagnostic key: reaching its authentication response proves the
connection path, not that a real key/model can produce an editorially sound edition.
No real paid generation or production deployment is claimed.

The spec's **20–30 fixed real datasets and 80% human editorial-quality thresholds
remain unverified**. Synthetic regression cases and mocked browser runs cannot replace
those acceptance criteria. Substring evidence checking also cannot establish semantic
entailment. These are explicit quality-validation limits, not claimed passes.

Runtime evidence: the invalid-key DeepSeek request initially failed before dispatch
with Workers' explicit `Invalid redirect value` exception. After the manual-redirect
fix and dev-server restart on port 5189, the same request returned `PROVIDER_ERROR`
/ `DeepSeek refused the key.` No valid secret was used in that transport check.
The runtime contract is documented in [Cloudflare Request API](https://developers.cloudflare.com/workers/runtime-apis/request/).

Provider/switch follow-up sources: Gemini uses Google's documented
[OpenAI compatibility API](https://ai.google.dev/gemini-api/docs/openai).
Custom API coverage includes both request/response formats, /v1 normalization,
private and mapped-IPv6 rejection, credential-safe redirect refusal, and local
browser dispatch. Switch tests cover default-off, remembered-view protection,
retained editions/configuration, no paid generation on re-enable, and cancellation
of an active run and connection test.

Editorial placement follow-up: a model may put an insight into Top Stories or
recommend a news-group article in Worth Reading. With valid structure and evidence,
these whole items are now omitted and the remaining edition is strictly revalidated;
prose is never moved or rewritten by the program. The footer reports omissions.
Invalid IDs/excerpts still reject the entire response, and an empty result is
INSUFFICIENT_CONTENT. Explicit per-section article-ID lists reduce placement ambiguity.
Regression fixtures reproduce both reported placement errors with thirteen materials;
these are synthetic cases, not a captured DS Flash 4.1 response or a real model run.

Language regression: Written in was lost from Settings while its stored preference
survived; the new pipeline also hardcoded English. The selector and full request
path now reuse the original preference/language table. Regression coverage includes
loading a saved choice, persisting a change without a model request, both model
phases and publication metadata, frozen language on Resume, and server validation.
A complete response containing only an extra plain-text whatHappenedNote is normalized
by deleting that annotation before strict validation. Other unknown keys and bad
evidence are still rejected. This is separate from JSON truncation; the existing
At that stage, the 6000/8000-token phase budgets were unchanged; see the subsequent truncation correction below.

The reading-time display now reuses the reader's existing CJK-aware estimator,
with a Chinese integration fixture preventing a full edition from counting as
one whitespace-delimited word. Fixture dates in pipeline tests are pinned rather
than depending on the wall clock crossing midnight in the tested timezone.

Truncation correction: DeepSeek composition now requests up to 16000 output tokens;
other providers retain the 8000 compose cap. DeepSeek thinking remains disabled.
Compose includes a complete JSON example, as recommended by
[DeepSeek JSON Output documentation](https://api-docs.deepseek.com/guides/json_mode/).
Truncation retry supplies a compact target schema with matching input limits
(two news stories, one recommendation, no Big Picture/context/perspectives,
one short quote per paragraph). A complete answer still uses the strict base
publication contract, avoiding rejection solely for exceeding a compact target.
The requirement persists across cancellation/Resume, including older failed
checkpoints; if selection already used the repair, composition starts compact.
The three-call ceiling and refusal to publish incomplete JSON are unchanged.
Synthetic tests cover these transitions; real paid DS Flash 4.1 generation remains
unverified without the reader's provider session/data.

Writing also requests compact output whenever only one paid call remains,
including after an interrupted selection or a structural-output repair. Specific
validator feedback is retained alongside the compact requirement.
