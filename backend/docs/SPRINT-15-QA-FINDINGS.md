# Sprint 15 QA Findings

## Playwright Walk Summary
Walked 16 routes via headless Chromium against the production build. All loaded without console errors after the hook-ordering fix.

| Route                                  | Body chars | Notes                              |
|----------------------------------------|-----------:|------------------------------------|
| `/`                                    | 692        | Landing two-path layout            |
| `/auth/login`                          | 537        | Unified login                      |
| `/auth/login?portal=founder`           | 537        | Founder branch                     |
| `/auth/login?portal=investor`          | 612        | Investor branch (preset emails)    |
| `/auth/signup`                         | 454        | Founder-only signup                |
| `/auth/forgot`                         | 288        | Magic link reset                   |
| `/auth/redeem`                         | 312        | "We don't recognise" for empty token |
| `/auth/redeem?token=demo7-novapay-…`   | (valid)    | Boxed company/round/expires + ToS  |
| `/select-company`                      | 421        | Maya 3-company picker              |
| `/founder/dashboard`                   | 8519       | Full Sprint 11/12 dashboard        |
| `/investor/dashboard`                  | 5602       | Aisha (State 3) full Sprint 10     |
| `/investor/invitations`                | 2060       | Sprint 10 invitations index        |
| `/admin/dashboard`                     | 1630       | Admin overview                     |
| `/founder/captable`                    | 2802       | Cap-table screen                   |
| `/founder/rounds`                      | 1671       | Rounds list                        |
| `/admin/companies`                     | 912        | Admin companies                    |

## Bugs Found & Fixed Pre-Deploy

### 1. Hook ordering violation in InvestorDashboard (Critical)
- **Symptom**: minified React error #310 ("Rendered more hooks than during the previous render") on /investor/dashboard.
- **Cause**: my initial D7 wiring early-returned `<InvestorState1Nudge>` before subsequent useQuery calls in the parent component, breaking hook order on re-render when ctx flipped from undefined → loaded.
- **Fix**: moved the State 1 short-circuit to after every hook (useEntitlement + 3 useQuery + useState), keeping the call order stable. Re-walked all 16 routes — zero console/page errors.

### 2. Demo redemption token format
- Initial Playwright pass used a placeholder token (`cap_demo_alpha`) which correctly hit the `not_found` 404 path. Confirmed the design copy ("We don't recognise this invitation") renders.
- Verified valid path with the real token from `/api/dev/demo-tokens` — preview boxed Company/Round/Expires + locked email + ToS checkbox + "View this round" CTA all render exactly per design Part 6.

## Remaining items (deferred / not in scope)
- Production magic-link backend (Sprint 15 ships the stub; full implementation is a Sprint 16 candidate).
- Real password hashing (current login is a persona-resolver; password is collected on client and not yet validated server-side beyond length).
- `/select-surface` rare-power-user picker (referenced in design Part 6) — deferred since no demo persona has founder + investor + collective overlap.
- Admin impersonation audit log entry surface (only the gate exists; the audit-trail UI is a Sprint 12 concern).

## Verification
- Tests: 667 / 667 (delta +79 from baseline 588)
- Math gate: 73 / 73 OK
- Sandbox grep: 2 JSDoc-only references (CapCollectiveToggle.tsx:15, theme.tsx:9)
- Light mode: preserved
- Sprint 7 token gating: preserved (auth shell delegates to invitationStore + sha256Hex)
