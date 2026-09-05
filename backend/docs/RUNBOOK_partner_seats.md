# Runbook — duplicate Consortium Partner seats

W-COLLECTIVE Wave 1 (v4 §1.4 as corrected by v5 §F).

## What the problem is

A Consortium Partner's paid tier grants a fixed number of **seats**. A seat is one
ACTIVE row in `partner_team_members`. `partnerTeamStore.add()` refuses to create a
second active row for the same `(partner_id, user_id)`, but rows created before
that guard — or restored from a stale import/backup, or minted by two processes
racing — can still leave **two active rows for one human**.

Consequences the partner actually sees:

* the workspace Team banner reports `2 seats` for one person;
* the duplicate consumes tier capacity, so an invitation can be refused with
  `PARTNER_TIER_SEAT_LIMIT_REACHED` while a seat looks free;
* an over-limit organisation can exist without anyone being told.

## How to find affected organisations

```
GET /api/admin/partners/seat-report        (requireAdmin)
```

Read-only. Response shape:

| field | meaning |
| --- | --- |
| `partners[]` | one row per `consortium_partner` contact |
| `activeSeats` | seat ROWS — exactly the number `assertTierSeats()` enforces on |
| `distinctSeatUsers` | how many distinct humans those rows represent |
| `duplicateSeatCount` | `activeSeats - distinctSeatUsers`, per organisation |
| `duplicateSeatIdsByUserId` | the specific NON-representative row ids, per user |
| `seatLimit` | effective limit (per-partner override, else tier default) |
| `overLimit` | `activeSeats > seatLimit` |
| `seatCountSource` | `durable` normally; `ram_fallback` means the DB read failed and the number is from the in-process projection — re-run before acting |
| `affected[]` | the subset with `duplicateSeatCount > 0` |

Do not act on a row whose `seatCountSource` is `ram_fallback`.

## Why the endpoint does not fix it for you

Collapsing a seat is **billing-visible**. It can change whether a partner is
within their tier, and which of two rows survives determines the surviving
`subRole` (permission tier) and `joinedAt`. That is a decision for an operator
with the partner informed, not a bulk button. There is deliberately no
merge/delete action on this endpoint.

## Remediation, per organisation

1. Re-run the report. Confirm `seatCountSource: "durable"`.
2. For the affected `userId`, list all its active rows:
   ```sql
   SELECT id, sub_role, status, joined_at, created_by, is_seed
     FROM partner_team_members
    WHERE partner_id = :partnerId AND user_id = :userId AND status = 'active'
    ORDER BY joined_at;
   ```
3. Decide the survivor. `dedupeActiveTeamMembers()`'s own preference order is a
   good default and is what the workspace already displays: most-privileged
   `sub_role`, then newest `joined_at`, then lowest `id`. If the two rows carry
   different `sub_role`s, confirm the intended permission tier with the partner —
   the display currently shows the more privileged one, which may not be what the
   managing partner believes is in force.
4. Retire the loser through the normal path so the audit chain and the
   `partner.team_member_removed` event fire:
   ```
   DELETE /api/partner/team/:userId       (managing_partner session)
   ```
   Do **not** `UPDATE`/`DELETE` the row directly in SQL — that skips the audit
   append and the notification fan-out, and leaves the RAM projection stale until
   the next restart.
   `partnerTeamStore.remove()` refuses to remove the last managing partner
   (`LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED`); if the duplicate IS the last
   managing partner, promote the survivor first.
5. Re-run the report. `duplicateSeatCount` must be `0` for that organisation.
6. If the organisation was `overLimit`, confirm with billing whether the freed
   seat should be re-sold or the tier adjusted.

## Known ledger item

`u_834e8cd5998b` was merged on LIVE. The owner-visible consequence recorded at
the time was that the workspace still showed **2 seats** for that single human.
That is the signature of this exact defect: the merge fixed the identity, not the
duplicate seat row. Work it with the procedure above.

## What deliberately did NOT change

* `partnerTeamStore.listByPartner()` is **not** de-duplicated. It backs F3
  authorization, promotion moderation and notification fan-out — collapsing it
  would silently drop a row from an authorization set. De-duplication stays in
  `dedupeActiveTeamMembers()` and is applied at DISPLAY call sites only.
* `countActiveSeats()` counts seat ROWS, not humans. Collapsing it would hand
  affected partners free capacity beyond what they pay for.
