# Sprint 17 D5 — Dead-button audit

Walked 33 routes on the deployed proxy URL.

**Total buttons examined**: 632
**Buttons with labels (text / aria-label / icon)**: 630
**Buttons without any label**: 2

A button is flagged "empty" only if it has zero visible text, zero aria-label, and zero icon child. These are inherently inaccessible and risk being interpreted as dead. Per-route breakdown:

| Route | Buttons | Labeled | Empty |
|---|---|---|---|
| / | 2 | 2 | 0 |
| /auth/login | 6 | 6 | 0 |
| /auth/signup | 1 | 1 | 0 |
| /auth/redeem | 1 | 1 | 0 |
| /founder/dashboard | 77 | 77 | 0 |
| /founder/company | 18 | 18 | 0 |
| /founder/captable | 31 | 31 | 0 |
| /founder/rounds | 18 | 18 | 0 |
| /founder/crm | 41 | 41 | 0 |
| /founder/dataroom | 22 | 22 | 0 |
| /founder/messages | 47 | 47 | 0 |
| /founder/reports | 8 | 8 | 0 |
| /founder/activity | 8 | 8 | 0 |
| /founder/settings | 17 | 15 | 2 |
| /investor/dashboard | 89 | 89 | 0 |
| /investor/invitations | 15 | 15 | 0 |
| /investor/portfolio | 14 | 14 | 0 |
| /investor/messages | 44 | 44 | 0 |
| /investor/crm | 30 | 30 | 0 |
| /investor/profile | 16 | 16 | 0 |
| /admin/dashboard | 5 | 5 | 0 |
| /admin/sync | 6 | 6 | 0 |
| /admin/migration | 7 | 7 | 0 |
| /admin/pricing | 8 | 8 | 0 |
| /admin/email | 22 | 22 | 0 |
| /admin/notifications | 6 | 6 | 0 |
| /admin/bridge | 19 | 19 | 0 |
| /admin/companies | 13 | 13 | 0 |
| /admin/investors | 5 | 5 | 0 |
| /admin/users | 10 | 10 | 0 |
| /admin/audit-log | 9 | 9 | 0 |
| /admin/reconciliation | 7 | 7 | 0 |
| /admin/telemetry | 10 | 10 | 0 |

## Per-route empty samples

- /founder/settings: checkbox-visible-co, checkbox-visible-net
