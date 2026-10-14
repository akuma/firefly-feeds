# Briefing providers and enable switch

Approved scope: add Gemini and custom OpenAI/Anthropic-compatible API support;
remove Qwen, Kimi/Moonshot and GLM; control the feature with an explicit switch.

Reuse the existing provider table, Custom API format selector and `prefs.digest`
flag. Gemini uses Google's official OpenAI-compatible endpoint. Custom hosted
URLs use HTTPS and the existing public-target guards; redirects are refused.
Local custom endpoints, like local Ollama, can be called by the user's browser.
Disabling cancels active work and hides navigation/settings, retaining all local
editions and configuration. Disabled mobile navigation keeps Search as its fourth tab.

- [x] Add regression tests for provider table, custom transports, URL guards and toggle lifecycle.
- [x] Update table, API routing and existing Settings/nav/hook controls.
- [x] Preserve stored keys/models when obsolete provider IDs are encountered.
- [x] Update docs and verify browser flow plus both required quality gates.

Additional user-reported regression: distinguish numeric editorial rejection from group mismatch, omit only wholly weak topics, and verify 1/6-article generation without a minimum-count rule.
