/**
 * X-C1 / P1-8 — SPV-backed company exclusion for cap-table co-membership.
 *
 * ── THE EXPOSURE ────────────────────────────────────────────────────────────
 * `spec/ENGINE_REGISTRY.md` C-1 records the owner-approved LP storage model:
 * "an SPV is a company in the entity-agnostic ledger", so `spvEngineRoutes.ts`
 * writes each SPV limited partner into the sacred `captable_commits` ledger
 * with `company_id = spv.id`.
 *
 * That is a deliberate, ratified design for STORAGE. The privacy consequence is
 * not deliberate. Co-membership is derived from `company_id` EQUALITY, and the
 * policy that authorises it (`capTableMembership.ts:5-8`, Ozan 2026-06-25) is
 * about cap-table members as "KNOWN COUNTERPARTIES who are able to collaborate
 * ... to help their portfolio companies". Two passive LPs who happen to have
 * subscribed to the same vehicle are NOT that. They very often must not even
 * know of each other's existence.
 *
 * So the ledger row makes them look like company co-shareholders, and every
 * reader that trusts `company_id` equality unblocks them to each other. The
 * registry calls this "a live privacy exposure, not a theoretical one".
 *
 * ── THE FIX, AND WHY IT IS HERE AND NOT AT THE WRITE SITE ───────────────────
 * The write site cannot change: `captable_commits` is SACRED, append-only and
 * hash-chained. Rewriting or deleting rows breaks `verifyChain()` permanently
 * and irreversibly — the registry is explicit that "every migration path in
 * either direction touches a sacred, chained table". The registry's own
 * recommendation is therefore to fix the READERS: "handle P1-8 separately and
 * urgently by scoping the four `company_id`-equality readers so SPV-backed
 * companies do not leak co-membership."
 *
 * ⚠️ **HISTORICAL COUNT — DO NOT TRUST THE NUMBER BELOW.** When this header was
 * written there were believed to be exactly TWO self-join sinks. **SIX sinks in
 * this family have now been found across four sweeps**, three of them by Review
 * A (v26.16) on routes no earlier sweep looked at, and none of the three used
 * the self-join at all — they authorised with a `capTablePositions.some(...)`
 * equality check and then enumerated the ledger. Searching for the join is
 * therefore NOT a sufficient sweep. `server/lib/capTableSinkScope.ts` (WAVE 35)
 * now holds the ONE shared decision applied at every such site; add new sinks
 * there rather than re-deriving authorisation locally.
 *
 * The two self-join sinks originally identified were:
 *
 *   1. `server/lib/capTableMembership.ts:58` — `areCoMembersOnAnyCapTable()`,
 *      the boolean authorisation gate behind 6 live callers (messagingPolicy,
 *      networkPostAudience, commsStore ×2, collectiveWaveAStore, routes.ts).
 *      ✅ **FIXED under WAIVER-4 (owner-signed 2026-08-11).** The paragraph
 *      below that says it is "still leaking" and "only half closed" was TRUE
 *      when written and is now STALE — Review A (v26.16) re-read the shipped
 *      bytes and confirmed `capTableMembership.ts` carries
 *      `AND ${notSpvBackedSql("ca")}` inside the join. Corrected here in WAVE
 *      35 so the next reviewer is not misled into re-fixing a fixed thing.
 *   2. `server/lib/commsUserDirectory.ts:390` — `durableCapTablePeerIds()`,
 *      the SAME join in LIST form. This one is strictly worse than the gate:
 *      it does not answer "are these two related?", it ENUMERATES the peer
 *      user ids. Its own comment says it "mirrors" the predicate, and a mirror
 *      is exactly the kind of second path that gets fixed a wave late.
 *      ✅ **FIXED — this sink imports the exclusion below.**
 *
 * ── WHY ONLY ONE OF TWO IS FIXED ────────────────────────────────────────────
 * `capTableMembership.ts` is under the sacred SHA manifest. Wave 25 applied the
 * exclusion there, `npm run sacred` failed on the changed hash, and the bytes
 * were restored verbatim rather than re-frozen — re-freezing needs an owner
 * waiver in `spec/OWNER_RULINGS_2026_08_09.md`.
 *
 * Note for whoever picks this up: the filename does NOT appear in
 * `scripts/sacred_check.sh`, so grepping that script says "not sacred". It is
 * enforced by SHA manifest instead. Trust `npm run sacred`, not the grep.
 *
 * ── STATUS CORRECTION (WAVE 35, 2026-08-12) ─────────────────────────────────
 * The two paragraphs above describe the state BEFORE WAIVER-4 was granted. The
 * waiver was granted, the exclusion was applied to `capTableMembership.ts`, and
 * both sacred enforcement points are green on those bytes. **X-C1 is closed for
 * the two self-join sinks.** What is NOT closed by that work is the wider
 * family: an SPV LP passes `gate("investor.onCapTableOf")` for their own
 * vehicle, so every SINK that reads the ledger must scope its own emission.
 * See `capTableSinkScope.ts`.
 *
 * ── DB-DRIVEN, NOT HARDCODED ────────────────────────────────────────────────
 * SPV-hood is asked of the database (`SELECT 1 FROM spv`), never inferred from
 * an id prefix or a name pattern. A new SPV is excluded the moment it is
 * inserted, with no code change and no list to maintain.
 *
 * ── FAILURE DIRECTION IS DELIBERATE ─────────────────────────────────────────
 * Both call sites wrap their query in try/catch and return the DENYING value
 * (`false` / `[]`). If the `spv` table were ever absent this subquery raises,
 * the catch fires, and co-membership is DENIED rather than granted. For a
 * privacy gate that is the correct direction: the failure mode is that two real
 * counterparties are masked to "Private Investor", not that two strangers in a
 * blind vehicle are introduced to each other.
 *
 * The `spv` table is created unconditionally in the baseline schema
 * (`server/db/connection.ts:5166`), so this is a guard against the impossible
 * rather than an expected path. Per A-22 I checked whether a self-heal path
 * re-creates it: it does, which is the direction we want here — the table this
 * exclusion depends on can only come INTO existence, never out of it.
 */
import { rawDb } from "../db/connection";

/**
 * SQL predicate: TRUE when the aliased `captable_commits` row belongs to a real
 * operating company rather than an SPV vehicle.
 *
 * `alias` is the table alias of a `captable_commits` row in the caller's query.
 * It is a compile-time constant at every call site — never user input — and is
 * asserted to be a bare identifier below so this can never become an injection
 * point if that ever stops being true.
 */
export function notSpvBackedSql(alias: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`notSpvBackedSql: unsafe alias ${JSON.stringify(alias)}`);
  }
  return `NOT EXISTS (SELECT 1 FROM spv sx_${alias} WHERE sx_${alias}.id = ${alias}.company_id)`;
}

/**
 * WAVE 32 · CP-SPV-30 capability 5 — THE THIRD SINK, found by hunting a SECOND
 * PATH for the LP-portal privacy boundary rather than by re-reading the two
 * already documented above.
 *
 * ── THE SINK ────────────────────────────────────────────────────────────────
 * `GET /api/investor/companies/:companyId/co-members` — TWO handlers,
 * `sprint21Routes.ts:217` and `collectiveNetworkStore.ts:91`. Neither uses the
 * self-join predicate above, so neither was found by searching for the join;
 * both instead ENUMERATE `listMembersForCompany(companyId)` directly, and the
 * `collectiveNetworkStore` one returns `amount`, `currency` and `shares` PER
 * INVESTOR.
 *
 * Because an SPV is a company in the ledger and every LP is written into it
 * with `company_id = spv.id`, an LP of a vehicle satisfies
 * `gate("investor.onCapTableOf")` FOR THE VEHICLE — the gate does not stop
 * them. So one LP could ask this route for their own vehicle and receive the
 * identity and committed amount of every other LP in it: exactly the exposure
 * WAIVER-4 closed in its boolean form, still open in its LIST form, on a route
 * the earlier sweep did not look at.
 *
 * ── WHY IT WAS INVISIBLE ────────────────────────────────────────────────────
 * Both handlers reach the ledger through a lazy `require()`, which throws under
 * the TypeScript runtimes (`Unexpected token '{'`) and is swallowed by a
 * `catch` that returns `[]`. Under `tsx` and under Vitest the route therefore
 * looks harmless — it returns an empty list to everyone. It is live only in the
 * bundled JS build. A test written against the TS runtime would have "passed"
 * while checking nothing, so those requires were converted to static imports in
 * the same change that added this guard: the path must be EXECUTABLE before a
 * claim about it can mean anything.
 *
 * ── FAILURE DIRECTION ───────────────────────────────────────────────────────
 * Returns TRUE (= "treat as a vehicle, do not enumerate") on any error, which
 * is the DENYING direction and matches `notSpvBackedSql`'s posture: a missing
 * `spv` table hides real counterparties rather than introducing strangers in a
 * blind vehicle to one another.
 *
 * DB-driven: SPV-hood is asked of the database, never inferred from an id
 * prefix or a name pattern, so a new vehicle is excluded on insert with no code
 * change and no list to maintain.
 *
 * The `rawDb` import is STATIC for the reason set out two paragraphs up: a
 * lazily-required dependency in a privacy guard is a guard that silently
 * disappears on the runtime where it was tested.
 */
export function isSpvBackedCompany(companyId: string): boolean {
  if (typeof companyId !== "string" || companyId.trim().length === 0) return true;
  try {
    const row = rawDb()
      .prepare(`SELECT 1 AS hit FROM spv WHERE id = ? LIMIT 1`)
      .get(companyId.trim()) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return true; // deny enumeration rather than risk introducing two blind LPs
  }
}
