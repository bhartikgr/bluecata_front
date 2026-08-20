/**
 * server/roundMathRoutes.ts — WAVE 52c · B1 + B2 + B3 + B4 + B5 + B6.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * Waves 52 / 52b landed correct engine arithmetic that PRODUCTION NEVER CALLED.
 * Three independent reviews established two facts:
 *
 *   B1  `resolveW52PricingOrder()` was exported and called by NOTHING outside a
 *       package test. The owner had been told the flag was the rollback
 *       mechanism; flipping it in production changed nothing.
 *   B2  `roundMathDisclosureStore.ts` was imported ONLY by its own test, so
 *       migration 0189's tables were never created at runtime and
 *       `residual_disposition` was never written. AC-17 and §10 item 7 were
 *       unmet in practice while looking met in SQL.
 *
 * This module is the production path. It is registered from `server/routes.ts`
 * and it is the ONLY place the two are joined:
 *
 *   GET  /api/founder/round-math/pricing-order        the resolved flag
 *   GET  /api/founder/rounds/:id/round-math           the arithmetic, flag-driven
 *   POST /api/founder/rounds/:id/residual-disposition record a residual
 *   (middleware) /api/founder/captable/commit-funded[-batch]
 *                                                     a real commit persists
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SACRED
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTHING sacred is edited. `server/captableCommitStore.ts` is sacred and its
 * commit handler could not be touched, so the B2 write is a MIDDLEWARE
 * REGISTERED BEFORE IT on the same two paths, which observes the response the
 * sacred handler produces and persists afterwards. It cannot change the commit's
 * outcome: the sacred handler's status and body are forwarded byte-for-byte, and
 * the persistence runs inside a try/catch that can only log. A disclosure record
 * must never be able to fail a money commit.
 *
 * `server/db/connection.ts` is reached only through the store's ordinary public
 * helpers. No migration is added: 0189 already exists, and
 * `applyWave52bRoundMathSchemaOnce` installs its tables from the migration file
 * itself on first use, so the dev/test inline-DDL bootstrap and production agree
 * by construction. That is deliberate — the trap this build has hit before is
 * writing DDL that the test bootstrap never creates.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * R21 — DB-DRIVEN, RESOLVED AT CALL TIME
 * ═══════════════════════════════════════════════════════════════════════════
 * `resolveW52PricingOrder()` is called INSIDE each handler, on every request.
 * It is not hoisted to module scope, not memoised, and not read from
 * `process.env`. A flag cached anywhere in this file would need a restart to
 * flip, and a rollback that needs a restart is not a rollback.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { getRoundById } from "./roundsStore";
import { currencyExponent, toMinor } from "./lib/currency";
import { log } from "./lib/logger";
import {
  runEngine,
  projectPostClose,
  /* WAVE 58b · DEFECT 3 — the ONE fully-diluted base resolver, shared with the
     wizard and the round-detail projection. */
  ledgerFullyDilutedPreMoneyShares,
  resolveFdPreMoneyBase,
  unconvertedConvertibleCount,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";
import {
  computeSubscriptionAmount,
  ROUNDING_DIRECTIONS,
  roundingDeviations,
} from "@capavate/cap-table-engine";
import {
  resolveW52PricingOrder,
  recordResidualDisposition,
  recordConversionStatus,
  listResidualDispositions,
  assessRoundCompleteness,
  RESIDUAL_DISPOSITIONS,
  type ResidualDisposition,
} from "./lib/roundMathDisclosureStore";

/**
 * Reads the company's cap-table rows in the ApiSecurity shape. Injected from
 * `server/routes.ts::buildCompanySecurities` so this route and the
 * `/api/companies/:id/securities` screen see the SAME rows, bridges included.
 * Access control is the ROUTE's job, never the reader's.
 */
export type SecuritiesReader = (companyId: string) => ReadonlyArray<Record<string, unknown>>;

/* ─────────────────────────────────────────────────────────────────────────── */
/* DISCLOSURE COPY — B3 and B6. One definition, served to the screen.          */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * B3. `/founder/rounds/:id` → Projection re-derives the round client-side and so
 * runs the Wave 52 solver. For any company with a SAFE or note the displayed
 * numbers MOVED (Review 3's probe: founder 56.14% → 53.33%, Series A investors
 * 21.05% → 25.00%, price $3.3333 → $2.6667). The NEW numbers are the correct
 * ones. The defect is that an investor or founder saw their ownership change
 * with no explanation on the screen. This is the explanation, and it is served
 * from the server so it cannot drift from the mode that actually produced the
 * arithmetic.
 */
export const PROJECTION_RESTATEMENT_DISCLOSURE = {
  headline: "This projection uses the corrected pricing order",
  body:
    "The price per share is now solved AFTER the option-pool top-up and AFTER any SAFE or " +
    "convertible note converts, and a post-money SAFE's company capitalization excludes this " +
    "round's new pool. Projections displayed before this change were computed on the previous " +
    "order, which priced the round before both. If you have a SAFE or a note on your cap table, " +
    "the price per share shown here is LOWER and the new investors' share count is HIGHER than " +
    "the figure you saw previously. Nothing about your existing committed ledger rows changed: " +
    "those are derived from the price stored on the round, not recomputed.",
  legacyBody:
    "ROLLBACK ACTIVE. This projection is being computed on the PRE-correction pricing order " +
    "because the platform-level pricing-order flag is switched OFF. The price per share is " +
    "solved before the option-pool top-up and before any SAFE or note converts. This " +
    "reproduces three measured arithmetic defects and exists only as a rollback.",
} as const;

/**
 * B6. Every ownership percentage carries its denominator label. §10 item 5 of the
 * document already sent to the external reviewer commits to exactly this, and it
 * is the direct answer to why the same founder is legitimately 40.000% /
 * 48.485% / 51.613% on identical facts.
 */
export const OWNERSHIP_DENOMINATOR_LABELS = {
  fully_diluted: {
    key: "fully_diluted",
    label: "% of fully-diluted shares",
    definition:
      "Denominator = issued common + preferred as-converted + granted options + unallocated " +
      "option pool + warrants + any converted SAFE or note shares. Use this basis for " +
      "economics: dilution, waterfall, what a point is worth.",
  },
  issued_outstanding: {
    key: "issued_outstanding",
    label: "% of issued and outstanding shares",
    definition:
      "Denominator = issued common + issued preferred only. Options, the unallocated pool and " +
      "warrants are EXCLUDED. Use this basis for voting and consent thresholds, because that " +
      "is what a charter and a shareholders' agreement count.",
  },
} as const;

/* ─────────────────────────────────────────────────────────────────────────── */
/* HELPERS                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function assertRoundAccess(
  req: Request,
  res: Response,
  roundId: string,
): { round: NonNullable<ReturnType<typeof getRoundById>>; actor: string } | null {
  const ctx = req.userContext ?? getUserContext(req);
  if (!ctx?.isAuthed) {
    res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    return null;
  }
  const round = getRoundById(String(roundId));
  if (!round) {
    res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" });
    return null;
  }
  const owns = ctx.founder.companies.some((c) => c.companyId === round.companyId);
  if (!owns && !ctx.isAdmin) {
    /* Same 404-not-403 policy the cap-table sinks already use: a 403 tells an
       unauthorised caller that the round exists, which enumerates round ids. */
    res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" });
    return null;
  }
  const actor = ctx.identity?.email ?? `founder:${round.companyId}`;
  return { round, actor };
}

/** Securities for one company, in the shape the shared adapter consumes. */
function securitiesForCompany(read: SecuritiesReader, companyId: string): ApiSecurity[] {
  return (read(companyId) ?? []).map((s) => s as unknown as ApiSecurity);
}

/**
 * Read a PERCENT-AS-WRITTEN pool target from the request. R16 / OR-1: `25` is
 * 25%. There is NO magnitude heuristic and no `/100` anywhere — a value is
 * either a well-formed percent in `[0, 100)` or it is REFUSED by name.
 *
 * Deliberately NOT read from the round's `poolSize` extra. `poolSize` is
 * AMBIGUOUS in this tree: on a priced round the wizard's field is labelled
 * "Pool size (% of fully-diluted)" and on an `option_pool` add-on round the
 * same key carries a SHARE COUNT (WAVE 50 item 4 found a share count being
 * divided by 100 there). Guessing which one a stored row means is precisely the
 * forbidden unit heuristic, so this refuses to guess and the response states
 * that no pool top-up was applied.
 */
function readPoolPercentAsWritten(raw: unknown): { value: string | null; error: string | null } {
  if (raw === undefined || raw === null || raw === "") return { value: null, error: null };
  const s = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { value: null, error: `POOL_PERCENT_NOT_NUMERIC:${s}` };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n >= 100) {
    /* PERCENT-AS-WRITTEN: 100 is 100% and a 100% pool has no solution. A caller
       sending 0.25 means a quarter of ONE percent and gets exactly that. */
    return { value: null, error: `POOL_PERCENT_OUT_OF_RANGE:${s}` };
  }
  return { value: s, error: null };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* B2 — THE COMMIT HOOK                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface CommitResidualOutcome {
  attempted: boolean;
  written: number;
  /** Rows the hook declined to invent, with the reason, by investor id. */
  declined: Array<{ investorId: string; residualMinor: number; reason: string }>;
  conversionRowsWritten: number;
  errors: string[];
}

/**
 * Persist the round-math disclosure for one committed ledger entry.
 *
 * THE RESIDUAL IS COMPUTED, NEVER GUESSED. The Orrick rule is applied by the
 * engine (`computeSubscriptionAmount`): shares ROUNDDOWN, subscription ROUNDUP,
 * residual = committed − subscription.
 *
 * THE DISPOSITION IS NEVER DEFAULTED. §11.4.3 is explicit that each of the seven
 * values closes the post-money identity differently, so:
 *   · a disposition supplied by the caller is validated and stored;
 *   · a NON-ZERO residual with no supplied disposition is NOT stored and is
 *     reported as an INCOMPLETE round by name. Treating a missing decision as
 *     `waived` would quietly hand the money to the company.
 *   · a ZERO residual needs no disposition and none is invented.
 *
 * `assessRoundCompleteness` is called UNCONDITIONALLY, because it is what makes
 * migration 0189 non-inert: it opens the store, which installs 0189's tables on
 * a database that has never seen them.
 */
export function persistCommitRoundMath(input: {
  roundId: string;
  companyId: string;
  investorId: string;
  amountMajor: string;
  currency: string;
  shares: string;
  instrumentClass: "priced" | "unpriced";
  residualDisposition?: unknown;
  dispositionClauseRef?: unknown;
  creditedToCloseRef?: unknown;
  closeRef?: string;
  recordedBy: string;
}): CommitResidualOutcome {
  const out: CommitResidualOutcome = {
    attempted: true,
    written: 0,
    declined: [],
    conversionRowsWritten: 0,
    errors: [],
  };

  const round = getRoundById(input.roundId);
  const currency = input.currency || round?.currency || "USD";
  const exponent = currencyExponent(currency);
  const committedMinor = BigInt(toMinor(Number(input.amountMajor), currency));

  /* AC-17 — an UNPRICED commit gets a STORED conversion status, and it is
     `undetermined`, because at commit time nobody has decided whether the
     instrument converts in this round. Fail-closed: the absence of a decision is
     recorded as an absence, never as `converts_in_this_round`. */
  if (input.instrumentClass === "unpriced") {
    try {
      recordConversionStatus({
        roundId: input.roundId,
        instrumentId: `${input.roundId}:${input.investorId}`,
        instrumentKind: "safe_post",
        conversionStatus: "undetermined",
        companyId: input.companyId,
        recordedBy: input.recordedBy,
        notes:
          "WAVE 52c B2 — recorded at commit through /api/founder/captable/commit-funded. " +
          "Status is undetermined because no conversion decision has been made for this round.",
      });
      out.conversionRowsWritten += 1;
    } catch (err) {
      out.errors.push(`conversion_status:${(err as Error).message}`);
    }
  }

  let residualMinor = 0;
  const pps = round?.pricePerShare;
  if (input.instrumentClass === "priced" && pps != null && Number(pps) > 0) {
    try {
      const rounding = computeSubscriptionAmount({
        committedMinor,
        pricePerShare: String(pps),
        minorUnitExponent: exponent,
      });
      residualMinor = Number(rounding.residualMinor);
      const disposition = String(input.residualDisposition ?? "");
      if (RESIDUAL_DISPOSITIONS.includes(disposition as ResidualDisposition)) {
        recordResidualDisposition({
          roundId: input.roundId,
          investorId: input.investorId,
          closeRef: input.closeRef ?? "initial",
          currency,
          committedMinor: Number(committedMinor),
          appliedMinor: Number(rounding.subscriptionMinor),
          residualMinor,
          residualDisposition: disposition as ResidualDisposition,
          dispositionClauseRef:
            typeof input.dispositionClauseRef === "string" ? input.dispositionClauseRef : null,
          creditedToCloseRef:
            typeof input.creditedToCloseRef === "string" ? input.creditedToCloseRef : null,
          recordedBy: input.recordedBy,
          notes:
            "WAVE 52c B2 — written by the commit path. Shares ROUNDDOWN, subscription ROUNDUP " +
            "(Orrick); residual = committed − subscription.",
        });
        out.written += 1;
      } else if (residualMinor !== 0) {
        out.declined.push({
          investorId: input.investorId,
          residualMinor,
          reason:
            "NO DISPOSITION SUPPLIED. The residual's treatment changes the post-money identity " +
            "and has no defensible default, so nothing was stored and this round is reported " +
            "INCOMPLETE until a disposition is recorded.",
        });
      }
    } catch (err) {
      out.errors.push(`residual:${(err as Error).message}`);
    }
  }

  /* UNCONDITIONAL. This is the call that makes 0189 real at runtime. */
  try {
    assessRoundCompleteness({
      roundId: input.roundId,
      closeRef: input.closeRef ?? "initial",
      residualsByInvestor: { [input.investorId]: residualMinor },
    });
  } catch (err) {
    out.errors.push(`assess:${(err as Error).message}`);
  }

  return out;
}

/**
 * Middleware installed BEFORE the sacred commit handlers on the same paths.
 * It wraps `res.json` so it can observe the sacred handler's own response and
 * persist afterwards. It NEVER alters the status or the body.
 */
function commitRoundMathHook(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  (res as Response).json = ((body: unknown) => {
    try {
      const payload = body as {
        ok?: boolean;
        entry?: Record<string, unknown>;
        entries?: Array<Record<string, unknown>>;
      };
      if (payload?.ok === true) {
        const ctx = req.userContext ?? getUserContext(req);
        const recordedBy = ctx?.identity?.email ?? "commit_route";
        const reqBody = (req.body ?? {}) as Record<string, unknown>;
        const entries = payload.entry ? [payload.entry] : (payload.entries ?? []);
        for (const e of entries) {
          persistCommitRoundMath({
            roundId: String(e.roundId ?? ""),
            companyId: String(e.companyId ?? ""),
            investorId: String(e.investorId ?? ""),
            amountMajor: String(e.amount ?? "0"),
            currency: String(e.currency ?? "USD"),
            shares: String(e.shares ?? "0"),
            instrumentClass:
              String(e.instrumentClass ?? "priced") === "unpriced" ? "unpriced" : "priced",
            residualDisposition: reqBody.residualDisposition,
            dispositionClauseRef: reqBody.dispositionClauseRef,
            creditedToCloseRef: reqBody.creditedToCloseRef,
            closeRef: typeof reqBody.closeRef === "string" ? reqBody.closeRef : undefined,
            recordedBy,
          });
        }
      }
    } catch (err) {
      /* A disclosure record must NEVER be able to fail a money commit. */
      log.warn(`[roundMath/commitHook] persistence failed: ${(err as Error).message}`);
    }
    return originalJson(body);
  }) as Response["json"];
  next();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* REGISTRATION                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

export function registerRoundMathRoutes(app: Express, readSecurities: SecuritiesReader): void {
  /* B2 — MUST be registered before `registerCaptableCommitRoutes(app)`. Express
     matches in order, and the sacred handler ends the request. */
  app.post("/api/founder/captable/commit-funded", commitRoundMathHook);
  app.post("/api/founder/captable/commit-funded-batch", commitRoundMathHook);

  /**
   * B1 — GET /api/founder/round-math/pricing-order
   *
   * The resolved flag, from the database, on every request. This is what the
   * Projection screen reads so the CLIENT-side engine run uses the order the
   * database selected rather than a build-time literal.
   */
  app.get("/api/founder/round-math/pricing-order", requireAuth, (req: Request, res: Response) => {
    const ctx = req.userContext ?? getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const flag = resolveW52PricingOrder();
    return res.json({
      ok: true,
      pricingOrder: flag,
      disclosure: flag.enabled
        ? PROJECTION_RESTATEMENT_DISCLOSURE
        : { ...PROJECTION_RESTATEMENT_DISCLOSURE, body: PROJECTION_RESTATEMENT_DISCLOSURE.legacyBody },
    });
  });

  /**
   * B1 + B3 + B4 + B5 + B6 — GET /api/founder/rounds/:id/round-math
   *
   * The arithmetic, computed SERVER-SIDE through the shared adapter, with the
   * pricing order taken from the database. Flip the `platform_config` row and
   * the `pricePerShare` and `ownership` this route returns change. That is the
   * whole of B1's proof, and it is an HTTP route, not an engine call.
   *
   * Query:
   *   optionPoolPostPercent  PERCENT-AS-WRITTEN (R16). "25" = 25%. Optional.
   */
  app.get("/api/founder/rounds/:id/round-math", requireAuth, (req: Request, res: Response) => {
   try {
    const owned = assertRoundAccess(req, res, String(req.params.id));
    if (!owned) return;
    const { round } = owned;

    /* R21 — resolved HERE, per request, from the database. */
    const flag = resolveW52PricingOrder();

    const secs = securitiesForCompany(readSecurities, String(round.companyId));
    const preMoney = Number(round.preMoney);
    const target = Number(round.targetAmount);
    const currency = round.currency ?? "USD";
    const canProject =
      Number.isFinite(preMoney) && preMoney > 0 && Number.isFinite(target) && target > 0;

    /* ── WAVE 58 · R27 — THE ROUND'S OWN STORED PERCENTAGE IS NOW READ ────────
       THE GAP THIS CLOSES. Until this wave `optionPoolPostPercent` was set ONLY
       by the query parameter below, and the only client of this route
       (`RoundDetail.tsx` Projection) never sent it. So the pool arithmetic
       `compute.ts:457-458` guards was unreachable by any user action — the
       W58 live walkthrough of v26.17.0 proved it, and it refuted the code trace
       that had claimed otherwise.

       The wizard now writes `optionPoolPostPercent` (percent-as-written) and
       `optionPoolMode` onto the round, persisted through `extras_json` and
       re-spread by `roundsStore.rowToRound`. Reading them here is what makes a
       percentage typed in the browser change the price and the ownership
       figures on this route's response.

       THIS IS NOT THE FORBIDDEN UNIT GUESS. The refusal recorded above still
       stands for `poolSize`, which is genuinely ambiguous in this tree (a
       percent on a priced round, a share count on an `option_pool` add-on).
       `optionPoolPostPercent` is a NEW, SINGLE-UNIT key whose only writer is the
       wizard's percent field and whose unit is fixed by R16. Nothing is
       reinterpreted and no stored value changes meaning.

       PRECEDENCE, stated: an explicit query parameter still WINS, so every
       existing caller and every Wave 52c test behaves exactly as before. The
       stored value is the FALLBACK, used only when no parameter was supplied.

       R21: read per request, from the round row, never memoised. */
    const storedPoolPercent = (round as unknown as Record<string, unknown>).optionPoolPostPercent;
    const storedPoolMode = (round as unknown as Record<string, unknown>).optionPoolMode;
    const queryPoolPercent = (req.query as Record<string, unknown>).optionPoolPostPercent;
    const poolSource =
      queryPoolPercent === undefined || queryPoolPercent === null || queryPoolPercent === ""
        ? (storedPoolPercent === undefined || storedPoolPercent === null || storedPoolPercent === ""
            ? "none"
            : "round_stored_option_pool_post_percent")
        : "query_parameter";
    const pool = readPoolPercentAsWritten(
      poolSource === "query_parameter" ? queryPoolPercent : storedPoolPercent,
    );
    /* WAVE 58b · DEFECT 1.3 — the placement the founder actually chose, defaulting
       ONLY when absent, and now APPLIED rather than merely disclosed.
       `compute.ts` models both conventions (see the `denominatorShares` filter),
       so this value is passed straight into the projection below. The default when
       absent is `pre_money`, the market default (Cooley GO, "Negotiating the
       option pool") — the same default the engine uses, so the two cannot drift. */
    const poolMode: "pre_money" | "post_money" =
      storedPoolMode === "post_money" ? "post_money" : "pre_money";
    /* ════════════════════════════════════════════════════════════════
       WAVE 58b · DEFECT 3 — THE SAME BASE RESOLVER THE WIZARD CALLS.
       ════════════════════════════════════════════════════════════════
       `client/src/pages/founder/RoundNew.tsx` and
       `client/src/pages/founder/RoundDetail.tsx` call the identical function with
       the identical two inputs, so no surface can prefer its own denominator. When
       the founder-declared count on the round and the cap-table ledger disagree,
       the pool is NOT applied here and the divergence is reported by name — which
       is the only way to guarantee the founder is never shown two different pool
       share counts for one round. Sizing it against either number and hoping the
       other screen agrees is what produced the 500,000-share divergence. */
    const fdBase = resolveFdPreMoneyBase({
      declaredFdPreMoneyShares: (round as unknown as Record<string, unknown>).fdPreMoneyShares as
        | string
        | number
        | null
        | undefined,
      ledgerFdShares: ledgerFullyDilutedPreMoneyShares(secs),
      outstandingConvertibles: unconvertedConvertibleCount(secs),
    });
    /* A divergent base BLOCKS the pool, and ONLY the pool. Every other figure on
       this response is unaffected, so nothing that already worked stops working.

       SCOPED TO THE STORED PATH, DELIBERATELY. The block exists to stop the FOUNDER
       being shown two different pool share counts for one round — the wizard's and
       this projection's. An explicit `?optionPoolPostPercent=` QUERY PARAMETER has
       no second surface to disagree with: it is a caller instruction, it is the
       Wave 52c diagnostic path, and it predates this wave. Blocking it would be a
       regression in existing functionality dressed up as a safety check (it turned
       `w52c_round_math_reachability.test.ts::B1-6` red, which is how it was found).
       So the query path still applies the pool, and the divergence is still
       REPORTED in `fdBase` below rather than hidden — disclosure without a veto. */
    const poolBlockedByBase = !fdBase.ok && poolSource === "round_stored_option_pool_post_percent";
    if (pool.error) {
      return res.status(422).json({
        ok: false,
        error: pool.error,
        message:
          "optionPoolPostPercent is PERCENT-AS-WRITTEN (owner ruling R16 / OR-1): 25 means 25%. " +
          "It is never rescaled by magnitude and must be a number in [0, 100).",
      });
    }

    let pre;
    let post = null as ReturnType<typeof projectPostClose> | null;
    try {
      pre = runEngine(secs, "fully_diluted", "US", flag.mode);
      if (canProject) {
        post = projectPostClose(
          secs,
          {
            preMoneyValuation: preMoney,
            investmentAmount: target,
            series: String(round.name),
            /* WAVE 58b · DEFECT 1.3 — was the literal `"pre_money" as const`. The
               engine now models both placements, so the founder's stored choice is
               passed through instead of being overwritten. There is still exactly
               ONE implementation of the arithmetic (`compute.ts` → `applyTopUp` →
               `computeEsopTopUp`); the placement selects the pricing denominator
               inside it, it does not fork the formula. */
            ...(pool.value !== null && !poolBlockedByBase
              ? { optionPoolPostPercent: pool.value, optionPoolMode: poolMode }
              : {}),
            /* WAVE 70 · D1 / R60 §2 — the NEW class's terms come from the round's
               OWN stored record. `projectPostClose` used to hardcode
               `antiDilution: "broad_based"` and `participating: false` onto the
               round it synthesised; both are now passed in, and both are omitted
               when the round has nothing on record. Read at request time from the
               database, per R21 — this route never memoises a term. */
            ...(round.antiDilutionType
              ? { antiDilutionType: String(round.antiDilutionType) as never }
              : {}),
          },
          "US",
          flag.mode,
        );
      }
    } catch (err) {
      /* ── WAVE 70 · R58 — A REFUSAL THAT REFUSES *BY NAME* ─────────────────
         The 422 already existed and already carried the message. What it did NOT
         carry was WHICH TERM was missing, in a form a caller can branch on: every
         cause collapsed into the one string `ROUND_MATH_COMPUTE_FAILED`. WAVE 70
         adds five named refusals to this path (a note with no interest rate, a
         legacy `discount` of 100, an unreadable stored cap convention or
         anti-dilution method, and a down round reaching a class with no
         anti-dilution term on record), and each one has to be distinguishable
         here or the fix stops at the engine.
         The HTTP STATUS IS UNCHANGED (422) and the existing `error` value is
         PRESERVED for every cause that produced it before, so no existing client
         branch breaks. `refusal`, `field` and `securityId` are ADDITIVE. */
      const e = err as Error & { code?: string; field?: string; securityId?: string };
      const named = typeof e.code === "string" && e.code !== "";
      return res.status(422).json({
        ok: false,
        error: named ? "ROUND_MATH_TERM_REFUSED" : "ROUND_MATH_COMPUTE_FAILED",
        ...(named
          ? { refusal: e.code, refusalName: e.name, field: e.field ?? null, securityId: e.securityId ?? null }
          : {}),
        message: (err as Error).message,
      });
    }

    const label = OWNERSHIP_DENOMINATOR_LABELS.fully_diluted;
    const rowsOf = (r: typeof pre, totalShares: bigint) =>
      r.rows.map((row) => ({
        /* WAVE 71b — `holderId` IS NOW ON THE WIRE. It was omitted, so the only
           way any caller could recognise the engine's synthesised pool top-up row
           was its DISPLAY NAME. Before Wave 71's D14 that name was the lowercase
           `pool` fallback `views.ts` emits for a row with no `Holder` record —
           i.e. the defect itself — and `w58b_pool_placement_reachability.test.ts`
           duly pinned it. `holderId` is the join key the engine groups by
           (`views.ts`, `reconcile.ts`'s `rowKey`) and `compute.ts` states
           `POOL_TOPUP_HOLDER_ID = "pool"` is deliberately UNCHANGED by D14.
           `holderType` cannot serve instead: post-D14 the synthesised row and a
           founder's own `ESOP Pool` row are both `holderType: "pool", kind:
           "option"`. Purely additive — no existing field, and no number, moves. */
        holderId: row.holderId,
        holderName: row.holderName,
        holderType: row.holderType,
        kind: row.kind,
        shares: row.shares.toString(),
        /* PERCENT-AS-WRITTEN already (views.ts multiplies by 100). Labelled with
           its denominator per B6 / §10 item 5 — never a bare number. */
        ownershipPercent: row.ownershipPercent,
        ownershipPercentUnit: "percent_as_written_r16",
        denominatorKey: label.key,
        denominatorLabel: label.label,
        denominatorShares: totalShares.toString(),
      }));

    /* B5 — the per-investor share derivation and the rounding residual, on the
       round's own target as the worked case. Every direction is disclosed. */
    let subscription: Record<string, unknown> | null = null;
    const ppsForSubscription =
      post?.trace?.find?.((t) => t.formulaId === "round.pricing.order")?.outputs?.pricePerShare ??
      (round.pricePerShare != null ? String(round.pricePerShare) : null);
    if (ppsForSubscription && Number(ppsForSubscription) > 0 && Number.isFinite(target)) {
      const r = computeSubscriptionAmount({
        committedMinor: BigInt(toMinor(target, currency)),
        pricePerShare: String(ppsForSubscription),
        minorUnitExponent: currencyExponent(currency),
      });
      subscription = {
        pricePerShare: String(ppsForSubscription),
        currency,
        minorUnitExponent: currencyExponent(currency),
        committedMinor: Number(BigInt(toMinor(target, currency))),
        shares: r.shares.toString(),
        appliedMinor: Number(r.subscriptionMinor),
        residualMinor: Number(r.residualMinor),
        exactProductMinor: r.exactProductMinor,
        disclosures: r.disclosures,
      };
    }

    let residuals: unknown[] = [];
    let residualStoreError: string | null = null;
    try {
      residuals = listResidualDispositions(String(round.id));
    } catch (err) {
      residualStoreError = (err as Error).message;
    }

    return res.json({
      ok: true,
      roundId: round.id,
      companyId: round.companyId,
      /* B1 — which order produced every number below, and where that came from. */
      pricingOrder: flag,
      /* B3 — the restatement disclosure, served with the arithmetic. */
      disclosure: flag.enabled
        ? PROJECTION_RESTATEMENT_DISCLOSURE
        : { ...PROJECTION_RESTATEMENT_DISCLOSURE, body: PROJECTION_RESTATEMENT_DISCLOSURE.legacyBody },
      /* B6 — the denominator every percentage below is measured against. */
      denominators: OWNERSHIP_DENOMINATOR_LABELS,
      preClose: { totalShares: pre.totalShares.toString(), rows: rowsOf(pre, pre.totalShares) },
      postClose: post
        ? {
            totalShares: post.totalShares.toString(),
            rows: rowsOf(post, post.totalShares),
            pricePerShare:
              post.trace.find((t) => t.formulaId === "round.pricing.order")?.outputs
                ?.pricePerShare ?? null,
            pricingTrace: post.trace.find((t) => t.formulaId === "round.pricing.order") ?? null,
          }
        : null,
      projectable: canProject,
      /* B4 — percent-as-written on the way in, echoed in the same unit. */
      optionPoolTopUp:
        pool.value === null
          ? {
              applied: false,
              reason:
                "No percent-as-written pool target was supplied. The round's stored `poolSize` " +
                "is NOT read here because that key is ambiguous in this tree — a percent on a " +
                "priced round, a share count on an option_pool add-on — and guessing a unit is " +
                "the defect R16 forbids.",
            }
          : {
              applied: true,
              targetPoolPercent: pool.value,
              unit: "percent_as_written_r16",
              /* WAVE 58b · DEFECT 1.3 — was the literal `"pre_money"`, which made
                 this field report a convention the founder had not chosen. */
              mode: poolMode,
              /* WAVE 58 · R27 — WHERE THIS NUMBER CAME FROM. Wave 52c shipped a
                 flag no production code called; naming the source in the
                 response is how this one can be checked rather than believed. */
              source: poolSource,
              placementChosen: poolMode,
              /* WAVE 58b · DEFECT 1.3 — was the literal `"pre_money"`. Both
                 placements are modelled now, so what is MODELLED equals what was
                 CHOSEN, and this field exists so a hostile reader can check that
                 rather than take it on trust. */
              placementModelled: poolMode,
              placementAuthority:
                poolMode === "post_money"
                  ? "Post-money placement leaves the new reserve OUTSIDE the pricing denominator " +
                    "(price = pre-money / fully-diluted-before-the-reserve), so the existing holders " +
                    "and the incoming investor are diluted by it pro-rata. This is a NEGOTIATED " +
                    "DEPARTURE from the NVCA/Cooley model form, which assumes the pre-money " +
                    "convention; Capavate states that rather than implying a consensus that does " +
                    "not exist. The arithmetic is derived from the same target condition as the " +
                    "pre-money branch: (existingPool + S) / (base + newInvestorShares + S) = target."
                  : "Pre-money placement puts the new reserve INSIDE the pricing denominator " +
                    "(price = pre-money / (base + S)), so the existing holders bear it alone. This " +
                    "is the market default: Cooley GO, 'Negotiating the option pool' — 'Most " +
                    "investors require that the full amount of this post-closing percentage be " +
                    "deemed to be part of the pre-closing capitalization for purposes of " +
                    "calculating their price per share, which means it only dilutes existing " +
                    "holders, not the new shares.' Recorded in " +
                    "spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md §4.1 and §4.3.",
              /* WAVE 58b · DEFECT 3 — which base was used, or why none was. */
              fdBase: fdBase.ok
                ? {
                    resolved: true,
                    base: fdBase.base.toString(),
                    source: fdBase.source,
                    ledgerFdShares: fdBase.ledgerFdShares.toString(),
                    declaredFdShares: fdBase.declaredFdShares === null ? null : fdBase.declaredFdShares.toString(),
                    label: fdBase.label,
                  }
                : {
                    resolved: false,
                    code: fdBase.code,
                    reason: fdBase.reason,
                    ledgerFdShares: fdBase.ledgerFdShares.toString(),
                    declaredFdShares: fdBase.declaredFdShares === null ? null : fdBase.declaredFdShares.toString(),
                  },
              poolAppliedToProjection: !poolBlockedByBase,
              ...(poolBlockedByBase
                ? {
                    poolNotAppliedReason:
                      "The option pool was NOT applied to the projection above because the fully-diluted " +
                      "pre-money base could not be settled. Applying it against one of two disagreeing " +
                      "counts would show a pool share count the wizard does not agree with. " +
                      (fdBase.ok ? "" : fdBase.reason),
                  }
                : {}),
              fullyDilutedDefinition:
                "Fully diluted here = issued common + issued preferred + all option-plan shares " +
                "(granted AND unallocated — the data model cannot separate them) + warrants' " +
                "underlying shares + shares from SAFEs/notes converting at this round. It EXCLUDES " +
                "unissued authorised (charter) capital, which Capavate never treats as a denominator.",
            },
      /* B5 — every rounding direction, with the deviations named as deviations. */
      rounding: { directions: ROUNDING_DIRECTIONS, deviations: roundingDeviations() },
      subscription,
      /* B2 — what is actually STORED for this round, read back from 0189. */
      residualDispositions: residuals,
      residualStoreError,
    });
   } catch (err) {
    /* An honest 500 with a reason, never a silent empty body. A disclosure
       route that fails must say why: a blank screen is how the previous waves'
       unreachable work stayed invisible. */
    log.warn(`[roundMath] round-math failed: ${(err as Error).message}`);
    /* ── WAVE 70 · R58 — A REFUSED TERM IS NOT A SERVER FAULT ────────────────
       FOUND BY EXECUTION, not by reading. WAVE 70's named refusals were expected
       to arrive at the INNER `catch` around `runEngine`/`projectPostClose`, but
       `resolveFdPreMoneyBase` and `unconvertedConvertibleCount` adapt the same
       securities EARLIER in this handler, so a note with no stored interest rate
       and a legacy `discount: 100` both reached HERE and were answered 500 —
       the same status the crash they replaced produced, which would have made
       the whole fix invisible to a caller.
       A refused term is a 422 (the client's stored data is incomplete), not a
       500 (this service is broken). The distinction is the entire point: a 500
       tells a founder Capavate is down; a 422 with a named refusal tells them
       which field on which security to fix. Every UNNAMED failure keeps its 500
       and its `ROUND_MATH_UNAVAILABLE` byte for byte. */
    const e = err as Error & { code?: string; field?: string; securityId?: string };
    if (typeof e.code === "string" && e.code !== "") {
      return res.status(422).json({
        ok: false,
        error: "ROUND_MATH_TERM_REFUSED",
        refusal: e.code,
        refusalName: e.name,
        field: e.field ?? null,
        securityId: e.securityId ?? null,
        message: e.message,
      });
    }
    return res.status(500).json({
      ok: false, error: "ROUND_MATH_UNAVAILABLE", message: (err as Error).message,
    });
   }
  });

  /**
   * B2 — POST /api/founder/rounds/:id/residual-disposition
   *
   * The explicit path: a founder records one investor's residual and its
   * enumerated disposition. No default is accepted, at any layer — the type
   * requires it, the store validates it against the enumeration, and 0189's
   * CHECK validates it again in SQL. The CHECK is NOT weakened to make writing
   * easier.
   */
  app.post(
    "/api/founder/rounds/:id/residual-disposition",
    requireAuth,
    (req: Request, res: Response) => {
      const owned = assertRoundAccess(req, res, String(req.params.id));
      if (!owned) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const investorId = typeof body.investorId === "string" ? body.investorId.trim() : "";
      if (!investorId) {
        return res.status(422).json({ ok: false, error: "MISSING_INVESTOR_ID" });
      }
      const disposition = String(body.residualDisposition ?? "");
      if (!RESIDUAL_DISPOSITIONS.includes(disposition as ResidualDisposition)) {
        return res.status(422).json({
          ok: false,
          error: "RESIDUAL_DISPOSITION_NOT_ENUMERATED",
          allowed: RESIDUAL_DISPOSITIONS,
          message:
            "The residual's treatment changes the post-money identity, so it is one of seven " +
            "enumerated values and has no default.",
        });
      }
      const currency =
        (typeof body.currency === "string" && body.currency) || owned.round.currency || "USD";
      const committedMinor = Number(body.committedMinor);
      const appliedMinor = Number(body.appliedMinor);
      const residualMinor = Number(body.residualMinor);
      try {
        const row = recordResidualDisposition({
          roundId: String(owned.round.id),
          investorId,
          closeRef: typeof body.closeRef === "string" ? body.closeRef : "initial",
          currency,
          committedMinor,
          appliedMinor,
          residualMinor,
          residualDisposition: disposition as ResidualDisposition,
          dispositionClauseRef:
            typeof body.dispositionClauseRef === "string" ? body.dispositionClauseRef : null,
          creditedToCloseRef:
            typeof body.creditedToCloseRef === "string" ? body.creditedToCloseRef : null,
          recordedBy: owned.actor,
          notes: typeof body.notes === "string" ? body.notes : null,
        });
        return res.status(200).json({ ok: true, row });
      } catch (err) {
        const message = (err as Error).message;
        return res.status(422).json({ ok: false, error: "RESIDUAL_WRITE_REFUSED", message });
      }
    },
  );
}
