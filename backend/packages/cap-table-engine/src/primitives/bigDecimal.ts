/**
 * BigDecimal — thin wrapper around decimal.js configured with 38 significant digits.
 * Used for prices, ownership percentages, FX rates, and any intermediate fractional math.
 */
import BaseDecimal from "decimal.js";

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 81 · ITEM 1 (D3) — THE ENGINE'S PRECISION AND ROUNDING NO LONGER
   DEPEND ON IMPORT ORDER.
   ═══════════════════════════════════════════════════════════════════════════
   WHAT WAS WRONG, measured. This line used to be

       Decimal.set({ precision: 38, rounding: Decimal.ROUND_HALF_EVEN });

   which mutates the ONE decimal.js default constructor shared by every module
   in the process. `packages/math-fns/src/index.ts:17` mutates the SAME
   constructor to `{ precision: 40, rounding: ROUND_HALF_UP }`, and
   `@capavate/math-fns` is imported by six server modules — so in the real
   server process the LAST writer won and this engine ran at 40 / ROUND_HALF_UP,
   not at the 38 / ROUND_HALF_EVEN it declares.

   IT MOVED A SHARE COUNT. Full ratchet, 7,777,777 protected shares, OIP 1.00 /
   NIP 0.875 (exact answer 8,888,888):

       engine imported alone              38 / HALF_EVEN ->  8,888,887
       engine + @capavate/math-fns        40 / HALF_UP   ->  8,888,888
       @capavate/math-fns + engine        38 / HALF_EVEN ->  8,888,887

   Same fixture, three import graphs, two different equity figures. Transcript:
   `build_log/wave81/W81_measure_BEFORE.txt`.

   THE FIX, AND WHY IT IS A CLONE AND NOT A `set`. `Decimal.clone(config)`
   returns a SEPARATE constructor carrying its own precision and rounding. A
   clone shares decimal.js's single prototype object, so `instanceof`, every
   method signature and every returned instance type are unchanged — the only
   thing that changes is that no other module can reach in and re-configure
   this engine's arithmetic, and this engine no longer re-configures anybody
   else's. A global mutation from a library is the defect; a scoped clone is the
   mechanism.

   ROUND_HALF_EVEN IS THE AUTHORITATIVE SETTING FOR CAP-TABLE MATHS. Banker's
   rounding is the financial standard (IEEE 754 default; it does not bias a long
   series of roundings upward the way HALF_UP does), it is what this module has
   always declared, and it is what the QA document already sent to the tester
   publishes as the engine's observed behaviour. The engine's 38 / HALF_EVEN
   therefore wins, and this file is where it is now actually enforced.

   `packages/math-fns/src/index.ts` KEEPS its `Decimal.set`, deliberately, and
   the reason is recorded there: eight modules — one of them SACRED and so not
   editable — read the BARE global constructor, and removing that pin drops them
   to decimal.js's default precision 20, which breaks the waterfall
   reconciliation the QA document publishes. Measured in
   `build_log/wave81/W81_ROUNDING_AUTHORITY.md`. After this edit that `set` is
   the ONLY global mutation in the tree, so the global is deterministic too, and
   `server/__tests__/w81_rounding_authority.test.ts` pins both facts.
   ═══════════════════════════════════════════════════════════════════════════ */
export const Decimal = BaseDecimal.clone({
  precision: 38,
  rounding: BaseDecimal.ROUND_HALF_EVEN,
}) as unknown as typeof BaseDecimal;
/* The INSTANCE type is unchanged: a clone's instances are decimal.js instances. */
export type Decimal = BaseDecimal;

export type DecimalLike = Decimal | string | number;

export function D(v: DecimalLike): Decimal {
  /* Cross-clone `instanceof` holds — decimal.js gives every clone the same
     prototype object — so an already-constructed Decimal is still passed
     through untouched, exactly as before. */
  if (v instanceof BaseDecimal) return v;
  return new Decimal(v);
}

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

export function decToString(d: Decimal, dp = 12): string {
  return d.toFixed(dp);
}

/* WAVE 81 — `Decimal` is exported at its declaration above (value + type),
   so the former `export { Decimal };` re-export of the BASE constructor is gone.
   Consumers keep the identical import specifier and the identical types; what
   they now receive is the SCOPED constructor. */
