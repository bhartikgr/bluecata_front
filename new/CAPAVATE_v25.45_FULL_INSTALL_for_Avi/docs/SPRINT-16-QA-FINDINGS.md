# Sprint 16 — QA Findings

## Test gates (final)
- **Vitest**: 727 / 727 across 81 files (was 667 / 72 baseline; +60 new tests, +9 new files)
- **Math integrity**: 73 / 73 (no regression)
- **Sandbox grep**: clean — only JSDoc comments mention `localStorage` (no live calls)
- **Build**: `npm run build` succeeded — client 1.92 MB JS, server 1.4 MB cjs
- **TypeScript**: pre-existing tsc errors unchanged; no new type errors introduced by Sprint 16

## Visual QA (screenshots in `/home/user/workspace/sprint16-screenshots/`)
- `home.png` — landing OK
- `investor-messages-3tabs.png` — **Cap-Table / Soft-Circle / Cross-Cohort** tab strip renders above the existing MessagesPage; badge counts visible (0/0/0 in fresh sandbox); "no co-investor groups yet" empty-state copy renders. 3-tab reorg lives.
- `founder-messages-3tabs.png` — same tabs sit above the founder cross-surface jump strip and MessagesPage.
- `admin-sync.png`, `investor-dashboard.png` — render unchanged; no regressions.

## What works
1. Track A (sync) — All 7 round-port gaps closed; partner gating in place; demo reset wired to `POST /api/admin/sync/reset-demo`.
2. Track B (design tokens) — Navy-tinted shadows, dashboard 23/55/22 grid token, pill-radius primary/destructive buttons.
3. Track C (comms tiers) —
   - 11 hash chains total (5 Sprint 14 + 6 Sprint 16); all verify clean after activity.
   - Tier 1 cap-table peer (co-investor groups) — create / post / intro endpoints.
   - Tier 2 soft-circle peer + IOI Pulse aggregate (`leaning_yes` / `need_diligence` / `pass`).
   - Tier 3 endorsements (5 fixed chips, 300-char cap, mandatory disclaimer, founder-removal).
   - Cross-cohort DM — combined-cap=3, default opt-OUT, mute path.
   - Round Q&A with founder archive moderation.
   - Diligence volunteer create + slot request.
   - Founder community-signals — aggregate-only, audit-logged.
   - High-value-advocate CRM enrichment with explicit "For informational purposes only" label.
   - 3-tab Messages reorg (Cap-Table / Soft-Circle / Cross-Cohort) shipped.

## Known gaps (intentional / out of scope)
- The new tabbed view sits ABOVE the existing MessagesPage rather than fully replacing it — preserves all Sprint 9/11/14 channel behavior while exposing Sprint 16 tier surfaces. Empty states render in fresh sandbox because the tier features are activity-driven (no seed data created yet).
- TypeScript pre-existing errors in `CapitalizationJourney.tsx`, `MessagesPage.tsx`, `Profile.tsx`, `Company.tsx`, etc. were present before Sprint 16 and remain. They do not block the build (`tsx` runtime, vite build succeeds).
- The Sprint 16 tabs use `useQuery` against `/api/comms/channels-tiered` and gracefully render empty-state with default opt-OUT messaging.

## Privacy & abuse guards verified
1. Cross-cohort DM hard cap = 3 (combined across all senders) — enforced and tested.
2. Endorsement chips are fixed (5), text ≤ 300 chars, disclaimer required — enforced and tested.
3. Soft-circler default opt-OUT for cross-cohort DM — enforced and tested.
4. Founder Q&A archive moderation — enforced and tested.
5. CRM `highValueAdvocates` is advisory; endpoint label "For informational purposes only" — verified.
6. Founder community-signals returns aggregate-only, audit-logged on every view — verified.
