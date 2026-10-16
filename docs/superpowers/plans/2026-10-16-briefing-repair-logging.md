# Briefing repair context and bounded logs

**Goal:** Use the existing single repair call to correct the previous failed JSON, and make hosted generation requests traceable without dumping credentials or long content.

- [x] Add bounded, credential-redacted failed-JSON capture and regression tests.
- [x] Carry repair JSON through route/direct generation, the pipeline checkpoint and prompts. Treat it as untrusted data; keep one repair and three calls maximum.
- [x] Carry run ID and call number to the hosted route. Add structured timestamped request/response logs with levels, duration, HTTP status, parameters, errors and short redacted response previews.
- [x] Cover first failure, repaired success, repeated failure, long output, secret redaction and Resume; review the complete request path.
- [x] Update architecture/spec/storage docs without changing other ongoing work. `bun run good` and `bun run check` both passed (604 tests and production build).

Repair JSON is optional, complete, bounded to 64 KiB and saved only in the existing run checkpoint. Oversized or non-JSON output falls back to error feedback. Logs omit headers and article bodies; no additional model call or automatic network retry is introduced.
