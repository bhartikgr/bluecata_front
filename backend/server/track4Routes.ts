/**
 * v25.0 Track 4 — Cross-Component Data Flow (D1–D3) + Bridge Fixes (F1)
 *
 * Endpoints wired:
 *   D1  GET  /api/admin/founder-channels/:companyId
 *   D2  GET  /api/admin/bridge/events/correlation?entityType=&entityId=
 *   F1  GET  /api/admin/bridge/wait-for?type=&timeoutMs=   (long-poll)
 *
 * D3 (schema migration) is performed at module load:
 *   - ALTER TABLE soft_circles ADD COLUMN source_type TEXT NOT NULL DEFAULT 'direct'
 *   - ALTER TABLE soft_circles ADD COLUMN source_id TEXT
 *   These use PRAGMA table_info checks before altering (idempotent).
 *   The softCircleStore.createSoftCircle is augmented with source fields via
 *   a raw DB update written immediately after creation.
 *
 * Auth:
 *   D1 — admin OR founder owning the company
 *   D2 — admin only
 *   F1 — admin only
 *
 * Business rules:
 *   D1 invariant: byChannel.direct.totalMinor + byChannel.collective.totalMinor
 *                  + byChannel.partner.totalMinor + unattributed.totalMinor === totalRaisedMinor
 *
 * All DB writes are real (rawDb(), no mock data).
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { resolveDisplayName } from "./lib/userPrivacyResolver";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { toMinor } from "./lib/currency"; /* WAVE 33 OQ-33-2 — ISO 4217 exponent, never a hardcoded *100 */
/* WAVE 35 · F3 — the SIXTH cross-currency summation. This handler already
 * SELECTed each row's `currency` (it needs it for the exponent) and then threw
 * it away, adding ¥ minor units and $ minor units into one `totalRaisedMinor`.
 * Same contract, same helpers, as the five sites Wave 21 fixed: bucket per
 * currency, and emit a scalar ONLY when exactly one currency is present. */
import {
  addToBucket,
  singleCurrencyScalar,
  bucketsToArray,
  type CurrencyBuckets,
} from "./lib/currencyScalar";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = "direct" | "collective" | "partner";

interface SoftCircleAttribution {
  id: string;
  company_id: string | null;
  amount_minor: number;
  /* WAVE 35 · F3 — the row's own ISO 4217 code. It was already SELECTed for
   * the exponent; carrying it onto the row is what makes partitioning
   * possible instead of summing across currencies. */
  currency: string;
  source_type: SourceType | null;
  source_id: string | null;
  investor_user_id: string | null;
  investor_name: string;
}

// ── D3: Schema migration (idempotent at module load) ─────────────────────────
//
// The sacred shared/schema.ts defines the *ORM* view of the table; we add
// columns at runtime using raw SQLite ALTER TABLE guarded by PRAGMA checks.
// Default 'direct' ensures existing rows are correctly attributed.

export function ensureSoftCircleSourceColumns(): void {
  try {
    const db = rawDb();
    const info = db.prepare(`PRAGMA table_info(soft_circles)`).all() as Array<{ name: string }>;
    const existingCols = new Set(info.map((c) => c.name));

    if (!existingCols.has("source_type")) {
      db.exec(`ALTER TABLE soft_circles ADD COLUMN source_type TEXT NOT NULL DEFAULT 'direct'`);
      log.info("[track4/D3] Added source_type column to soft_circles");
    }
    if (!existingCols.has("source_id")) {
      db.exec(`ALTER TABLE soft_circles ADD COLUMN source_id TEXT`);
      log.info("[track4/D3] Added source_id column to soft_circles");
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/duplicate column/i.test(msg) && !/no such table/i.test(msg)) {
      log.warn("[track4/D3] ensureSoftCircleSourceColumns failed:", msg);
    }
  }
}

// Run migration at import time.
try { ensureSoftCircleSourceColumns(); } catch { /* non-fatal */ }

/**
 * Patch the source_type/source_id on a soft circle row immediately after
 * creation. Called from the SC creation points in routes.ts and
 * yourDecisionStore.ts (wrapped in best-effort try/catch there).
 *
 * @param scId  - the soft_circle row id
 * @param type  - 'direct' | 'collective' | 'partner'
 * @param sourceId - collective_member_user_id or partner_id (null for direct)
 */
export function setSoftCircleSource(scId: string, type: SourceType, sourceId: string | null): void {
  try {
    rawDb()
      .prepare(
        `UPDATE soft_circles SET source_type = ?, source_id = ? WHERE id = ?`,
      )
      .run(type, sourceId, scId);
  } catch (err) {
    log.warn("[track4/D3] setSoftCircleSource failed for", scId, ":", (err as Error).message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ownsCompany(ctx: ReturnType<typeof getUserContext>, companyId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === companyId);
}

// ── D1: GET /api/admin/founder-channels/:companyId ───────────────────────────

function handleFounderChannels(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { companyId } = req.params as { companyId: string };
  if (!ownsCompany(ctx, companyId)) {
    res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Must be admin or company founder." });
    return;
  }

  let rows: SoftCircleAttribution[];
  try {
    /* WAVE 33 OQ-33-2 sink 5 — the minor-unit fallback used to be computed IN
     * SQL as `CAST(ROUND(sc.amount * 100) AS INTEGER)`, a hardcoded ISO 4217
     * exponent of 2. SQLite cannot apply a per-row exponent in-query, so the
     * raw major amount and the row's own currency are selected instead and
     * the conversion happens in JS through `toMinor`. For JPY (exponent 0)
     * the old form reported every unmigrated soft circle — and therefore the
     * whole founder-channel attribution total — 100x too large. Same numeric
     * type (integer minor units) as before, so no downstream reader changes. */
    const raw = rawDb()
      .prepare(
        // Join through rounds to find SCs by company (company_id may be NULL on the SC row itself
        // when the drizzle ORM doesn't map the field correctly; the canonical company linkage is
        // via the round). Falls back to direct company_id match for legacy rows that store it directly.
        `SELECT sc.id,
                COALESCE(sc.company_id, r.company_id) AS company_id,
                sc.amount_minor AS amount_minor,
                sc.amount AS amount_major,
                COALESCE(sc.currency, r.currency) AS currency,
                sc.source_type,
                sc.source_id,
                sc.investor_user_id,
                sc.investor_name
           FROM soft_circles sc
           LEFT JOIN rounds r ON sc.round_id = r.id
          WHERE COALESCE(sc.company_id, r.company_id) = ?`,
      )
      .all(companyId) as Array<
        Omit<SoftCircleAttribution, "amount_minor" | "currency"> & {
          amount_minor: number | null;
          amount_major: number | null;
          currency: string | null;
        }
      >;
    rows = raw.map((r) => {
      const stored = Number(r.amount_minor) || 0;
      /* WAVE 35 · F3 — the SAME code that picks the exponent below is now also
       * carried onto the row and used to partition every total. Previously it
       * was consumed here and discarded, which is precisely how ¥ and $ ended
       * up in one integer. */
      const cur = String(r.currency ?? "USD").trim().toUpperCase() || "USD";
      return {
        id: r.id,
        company_id: r.company_id,
        amount_minor: stored > 0 ? stored : toMinor(Number(r.amount_major) || 0, cur),
        currency: cur,
        source_type: r.source_type,
        source_id: r.source_id,
        investor_user_id: r.investor_user_id,
        investor_name: r.investor_name,
      };
    });
  } catch (err) {
    log.error("[track4/D1] DB query failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR", message: (err as Error).message });
    return;
  }

  /* WAVE 35 · F3 — every accumulator is now a PER-CURRENCY bucket map. A raw
   * `totalMinor` integer is only derived at emit time, and only when the
   * bucket map holds exactly one currency. */
  type ChannelBucket = { countSCs: number; buckets: CurrencyBuckets };
  const channels: Record<SourceType, ChannelBucket> = {
    direct:     { countSCs: 0, buckets: {} },
    collective: { countSCs: 0, buckets: {} },
    partner:    { countSCs: 0, buckets: {} },
  };
  const unattributed: ChannelBucket = { countSCs: 0, buckets: {} };

  // Partner aggregation: partnerId → { partnerName?, countSCs, buckets }
  const byPartnerMap = new Map<string, { partnerId: string; partnerName: string; countSCs: number; buckets: CurrencyBuckets }>();
  // Collective aggregation: userId → { userId, name, countSCs, buckets }
  const byCollectiveMemberMap = new Map<string, { userId: string; name: string; countSCs: number; buckets: CurrencyBuckets }>();

  const totalBuckets: CurrencyBuckets = {};

  for (const row of rows) {
    const minor = Number(row.amount_minor) || 0;
    const cur = row.currency;
    addToBucket(totalBuckets, cur, minor);

    const st = (row.source_type as SourceType | null) ?? null;

    if (!st || !["direct", "collective", "partner"].includes(st)) {
      // Unattributed (source_type NULL or unexpected value)
      unattributed.countSCs++;
      addToBucket(unattributed.buckets, cur, minor);
      continue;
    }

    channels[st].countSCs++;
    addToBucket(channels[st].buckets, cur, minor);

    if (st === "partner" && row.source_id) {
      const pid = row.source_id;
      if (!byPartnerMap.has(pid)) {
        // Resolve partner name from admin_contacts if available
        let pName = pid;
        try {
          const pRow = rawDb()
            .prepare(`SELECT name FROM admin_contacts WHERE id = ? LIMIT 1`)
            .get(pid) as { name?: string } | undefined;
          if (pRow?.name) pName = pRow.name;
        } catch { /* best-effort */ }
        byPartnerMap.set(pid, { partnerId: pid, partnerName: pName, countSCs: 0, buckets: {} });
      }
      const bucket = byPartnerMap.get(pid)!;
      bucket.countSCs++;
      addToBucket(bucket.buckets, cur, minor);
    }

    if (st === "collective" && row.source_id) {
      const uid = row.source_id;
      if (!byCollectiveMemberMap.has(uid)) {
        let rawMemberName = uid;
        try {
          const uRow = rawDb()
            .prepare(`SELECT name FROM users WHERE id = ? LIMIT 1`)
            .get(uid) as { name?: string } | undefined;
          if (uRow?.name) rawMemberName = uRow.name;
        } catch { /* best-effort — try profilestore_investor_profile */ }
        try {
          if (rawMemberName === uid) {
            const pRow = rawDb()
              .prepare(`SELECT display_name FROM profilestore_investor_profile WHERE investor_id = ? LIMIT 1`)
              .get(uid) as { display_name?: string } | undefined;
            if (pRow?.display_name) rawMemberName = pRow.display_name;
          }
        } catch { /* best-effort */ }
        // v25.45 ROUND 7 — founder-channels exposes the founder's own
        // soft-circle investors who funded THIS company (the endpoint is gated
        // by ownsCompany: the viewer is the founder of, or an admin over, this
        // company). These investors are cap-table counterparties of the founder
        // (isCoMember:true), so the counterparty default reveals the legal name
        // UNLESS the member explicitly opted out (visibleToCoMembers:false →
        // "Private Investor"). Never return raw users.name.
        const memberName = resolveDisplayName(uid, ctx.userId, "externalCapTable", {
          legalName: rawMemberName,
          isCoMember: true,
        });
        byCollectiveMemberMap.set(uid, { userId: uid, name: memberName, countSCs: 0, buckets: {} });
      }
      const bucket = byCollectiveMemberMap.get(uid)!;
      bucket.countSCs++;
      addToBucket(bucket.buckets, cur, minor);
    }
  }

  /* WAVE 35 · F3 — the invariant is now checked PER CURRENCY. Comparing two
   * cross-currency sums would have "passed" while both numbers were
   * meaningless, which is why the old check never caught this. */
  const perCurrencyInvariant: Array<{ currency: string; channelSum: number; total: number; ok: boolean }> = [];
  const allCurrencies = new Set<string>([
    ...Object.keys(totalBuckets),
    ...Object.keys(channels.direct.buckets),
    ...Object.keys(channels.collective.buckets),
    ...Object.keys(channels.partner.buckets),
    ...Object.keys(unattributed.buckets),
  ]);
  for (const c of Array.from(allCurrencies).sort()) {
    const sum =
      (channels.direct.buckets[c] ?? 0) +
      (channels.collective.buckets[c] ?? 0) +
      (channels.partner.buckets[c] ?? 0) +
      (unattributed.buckets[c] ?? 0);
    const tot = totalBuckets[c] ?? 0;
    perCurrencyInvariant.push({ currency: c, channelSum: sum, total: tot, ok: sum === tot });
  }
  const invariantOk = perCurrencyInvariant.every((e) => e.ok);
  if (!invariantOk) {
    log.warn(
      `[track4/D1] Invariant violation for company ${companyId}: ` +
      perCurrencyInvariant.filter((e) => !e.ok).map((e) => `${e.currency} channelSum=${e.channelSum} total=${e.total}`).join("; "),
    );
  }

  // v25.2: surface the sponsoring consortium partner (from consortium_links) even when
  // they haven't sourced any SCs yet. This makes the founder-channels view a complete
  // cross-component attribution picture: "who sponsored this founder" AND "what SCs
  // have they driven."
  let sponsoringPartner: { partnerId: string; partnerName: string; linkedAt: string } | null = null;
  try {
    const linkRow = rawDb()
      .prepare(`SELECT partner_id, linked_at FROM consortium_links WHERE company_id = ? AND unlinked_at IS NULL LIMIT 1`)
      .get(companyId) as { partner_id?: string; linked_at?: string } | undefined;
    if (linkRow?.partner_id) {
      let pName = linkRow.partner_id;
      try {
        const pRow = rawDb()
          .prepare(`SELECT name FROM admin_contacts WHERE id = ? LIMIT 1`)
          .get(linkRow.partner_id) as { name?: string } | undefined;
        if (pRow?.name) pName = pRow.name;
      } catch { /* best-effort */ }
      sponsoringPartner = {
        partnerId: linkRow.partner_id,
        partnerName: pName,
        linkedAt: linkRow.linked_at ?? "",
      };
      // Also ensure the sponsoring partner appears in byPartner (with 0 SCs) so consumers
      // that only look at byPartner still see the relationship.
      if (!byPartnerMap.has(linkRow.partner_id)) {
        byPartnerMap.set(linkRow.partner_id, {
          partnerId: linkRow.partner_id,
          partnerName: pName,
          countSCs: 0,
          buckets: {},
        });
      }
    }
  } catch (err) {
    log.warn(`[track4/D1] consortium_links lookup failed for ${companyId}:`, (err as Error).message);
  }

  /* WAVE 35 · F3 — emit. `totalMinor` keeps its name and its integer type for
   * every existing single-currency reader, but it is now derived through
   * `singleCurrencyScalar` and is NULL when two or more currencies contributed
   * (nulls, not zeros, with the reason and the currency list attached so the
   * renderer can refuse honestly). The per-currency array beside it is the
   * authoritative shape and is ALWAYS present — nothing is dropped. */
  const emitBucket = (b: { countSCs: number; buckets: CurrencyBuckets }) => {
    const scalar = singleCurrencyScalar(b.buckets, "USD");
    return {
      countSCs: b.countSCs,
      totalMinor: scalar.available ? scalar.minor : null,
      currency: scalar.available ? scalar.currency : null,
      byCurrency: bucketsToArray(b.buckets),
      ...(scalar.available ? {} : { unavailableReason: scalar.reason, currencies: scalar.currencies }),
    };
  };

  const totalScalar = singleCurrencyScalar(totalBuckets, "USD");
  const totalRaisedMinor = totalScalar.available ? totalScalar.minor : null;

  res.json({
    ok: true,
    companyId,
    totalRaisedMinor,
    totalRaisedCurrency: totalScalar.available ? totalScalar.currency : null,
    totalRaisedByCurrency: bucketsToArray(totalBuckets),
    ...(totalScalar.available
      ? {}
      : { totalRaisedUnavailableReason: totalScalar.reason, currencies: totalScalar.currencies }),
    byChannel: {
      direct:     emitBucket(channels.direct),
      collective: emitBucket(channels.collective),
      partner:    emitBucket(channels.partner),
    },
    unattributed: unattributed.countSCs > 0 ? emitBucket(unattributed) : undefined,
    byPartner: Array.from(byPartnerMap.values()).map((p) => ({
      partnerId: p.partnerId,
      partnerName: p.partnerName,
      ...emitBucket(p),
    })),
    byCollectiveMember: Array.from(byCollectiveMemberMap.values()).map((m) => ({
      userId: m.userId,
      name: m.name,
      ...emitBucket(m),
    })),
    sponsoringPartner,
    _meta: { invariantOk, perCurrencyInvariant, totalRaisedByCurrency: bucketsToArray(totalBuckets) },
  });
}

// ── D2: GET /api/admin/bridge/events/correlation ──────────────────────────────

interface BridgeHistoryRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_kind: string;
  envelope_json: string;
  status: string;
  enqueued_at: string;
  resolved_at: string;
}

interface CorrelationEvent {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: string;
  sourceComponent: string;
  aggregateId: string;
  aggregateKind: string;
}

function guessSourceComponent(eventType: string): string {
  if (/^(captable|waterfall|cap_table)/.test(eventType)) return "captable-engine";
  if (/^(round|softCircle|termSheet|dataRoom)/.test(eventType)) return "rounds";
  if (/^(kyc|document|investor)/.test(eventType)) return "investor";
  if (/^(crm|contact)/.test(eventType)) return "crm";
  if (/^(formula|eligibility)/.test(eventType)) return "formula-engine";
  if (/^(company|ma_intelligence)/.test(eventType)) return "company";
  if (/^(bridge|audit_log)/.test(eventType)) return "bridge";
  if (/^(safe|note)/.test(eventType)) return "legal";
  if (/^(dsc|governance)/.test(eventType)) return "collective";
  return "platform";
}

function handleBridgeCorrelation(req: Request, res: Response): void {
  const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };

  if (!entityId) {
    res.status(422).json({ ok: false, error: "MISSING_ENTITY_ID", message: "entityId query param is required" });
    return;
  }

  let rows: BridgeHistoryRow[];
  try {
    // Query events where payload references entityId (JSON LIKE or JSON_EXTRACT)
    rows = rawDb()
      .prepare(
        `SELECT id, event_type, aggregate_id, aggregate_kind, envelope_json,
                status, enqueued_at, resolved_at
           FROM bridge_event_history
          WHERE aggregate_id = ?
             OR envelope_json LIKE ?
          ORDER BY enqueued_at ASC
          LIMIT 200`,
      )
      .all(entityId, `%${entityId}%`) as BridgeHistoryRow[];
  } catch (err) {
    log.error("[track4/D2] DB query failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR", message: (err as Error).message });
    return;
  }

  // Deduplicate (UNION effect from two conditions)
  const seen = new Set<string>();
  const dedupedRows = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // Filter by entityType if provided
  const filteredRows = entityType
    ? dedupedRows.filter((r) => {
        try {
          const env = JSON.parse(r.envelope_json) as Record<string, unknown>;
          const payload = env.payload as Record<string, unknown> | undefined;
          // entityType acts as a filter on eventType prefix or aggregateKind
          return (
            r.event_type.startsWith(entityType) ||
            r.aggregate_kind === entityType ||
            (payload && Object.values(payload).some((v) => String(v) === entityType))
          );
        } catch { return true; }
      })
    : dedupedRows;

  // Build event list
  const events: CorrelationEvent[] = filteredRows.map((r) => {
    let payload: unknown = {};
    try {
      const env = JSON.parse(r.envelope_json) as Record<string, unknown>;
      payload = env.payload ?? {};
    } catch { /* best-effort */ }
    return {
      id: r.id,
      type: r.event_type,
      payload,
      occurredAt: r.enqueued_at,
      sourceComponent: guessSourceComponent(r.event_type),
      aggregateId: r.aggregate_id,
      aggregateKind: r.aggregate_kind,
    };
  });

  // Build cross-component chain: group by sourceComponent, track which
  // downstream components received subsequent events referencing same entityId
  const componentMap = new Map<string, { component: string; events: CorrelationEvent[] }>();
  for (const evt of events) {
    const comp = evt.sourceComponent;
    if (!componentMap.has(comp)) {
      componentMap.set(comp, { component: comp, events: [] });
    }
    componentMap.get(comp)!.events.push(evt);
  }

  // Derive chain: for each originating component, identify downstream components
  // by ordering events chronologically and grouping
  const allComponents = Array.from(componentMap.keys());
  const crossComponentChain = allComponents.map((originComp, idx) => {
    const downstreamComponents = allComponents.filter((_, i) => i > idx);
    const downstreamEvents: CorrelationEvent[] = [];
    for (const dc of downstreamComponents) {
      downstreamEvents.push(...(componentMap.get(dc)?.events ?? []));
    }
    return {
      originatingComponent: originComp,
      ownEvents: componentMap.get(originComp)!.events.map((e) => e.id),
      downstreamEvents: downstreamEvents.map((e) => ({
        eventId: e.id,
        type: e.type,
        component: e.sourceComponent,
        occurredAt: e.occurredAt,
      })),
    };
  });

  res.json({
    ok: true,
    entityType: entityType ?? null,
    entityId,
    totalEvents: events.length,
    events,
    crossComponentChain,
  });
}

// ── F1: GET /api/admin/bridge/wait-for — long-poll until event written ────────
//
// Production-grade long-poll: holds the connection open (up to timeoutMs)
// and resolves as soon as a matching event appears in bridge_event_history.
// Polls every 200ms internally; default timeout 10000ms (max 30000ms).
// Uses admin-only auth (requireAdmin middleware wired in registration).

function handleBridgeWaitFor(req: Request, res: Response): void {
  const { type: eventTypeFilter, timeoutMs: timeoutMsStr } = req.query as {
    type?: string;
    timeoutMs?: string;
  };

  if (!eventTypeFilter) {
    res.status(422).json({
      ok: false,
      error: "MISSING_TYPE",
      message: "Query param 'type' (event type or prefix) is required",
    });
    return;
  }

  const timeoutMs = Math.min(
    30000,
    Math.max(200, parseInt(timeoutMsStr ?? "10000", 10) || 10000),
  );

  const POLL_INTERVAL_MS = 200;
  const deadline = Date.now() + timeoutMs;

  // Grab the latest event ID at poll start so we only look for NEW events
  let latestIdAtStart: string | null = null;
  try {
    const latestRow = rawDb()
      .prepare(
        `SELECT id FROM bridge_event_history ORDER BY enqueued_at DESC LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    latestIdAtStart = latestRow?.id ?? null;
  } catch { /* non-fatal */ }

  // Set response timeout header so proxies know the call is intentionally long
  res.setHeader("X-Long-Poll-Timeout-Ms", String(timeoutMs));

  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  function cleanup() {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function poll() {
    if (Date.now() >= deadline) {
      cleanup();
      res.status(408).json({
        ok: false,
        error: "TIMEOUT",
        message: `No matching event of type '${eventTypeFilter}' appeared within ${timeoutMs}ms`,
      });
      return;
    }

    try {
      const db = rawDb();
      // Build query: look for events after latestIdAtStart matching the type filter
      let matchRow: BridgeHistoryRow | undefined;

      if (latestIdAtStart) {
        matchRow = db
          .prepare(
            `SELECT id, event_type, aggregate_id, aggregate_kind, envelope_json,
                    status, enqueued_at, resolved_at
               FROM bridge_event_history
              WHERE event_type LIKE ?
                AND enqueued_at > (
                      SELECT enqueued_at FROM bridge_event_history WHERE id = ? LIMIT 1
                    )
              ORDER BY enqueued_at ASC
              LIMIT 1`,
          )
          .get(`${eventTypeFilter}%`, latestIdAtStart) as BridgeHistoryRow | undefined;
      } else {
        matchRow = db
          .prepare(
            `SELECT id, event_type, aggregate_id, aggregate_kind, envelope_json,
                    status, enqueued_at, resolved_at
               FROM bridge_event_history
              WHERE event_type LIKE ?
              ORDER BY enqueued_at DESC
              LIMIT 1`,
          )
          .get(`${eventTypeFilter}%`) as BridgeHistoryRow | undefined;
      }

      if (matchRow) {
        cleanup();
        let payload: unknown = {};
        try {
          const env = JSON.parse(matchRow.envelope_json) as Record<string, unknown>;
          payload = env.payload ?? {};
        } catch { /* ok */ }
        res.json({
          ok: true,
          found: true,
          event: {
            id: matchRow.id,
            type: matchRow.event_type,
            aggregateId: matchRow.aggregate_id,
            aggregateKind: matchRow.aggregate_kind,
            payload,
            occurredAt: matchRow.enqueued_at,
            status: matchRow.status,
          },
          waitedMs: Date.now() - (deadline - timeoutMs),
        });
      }
      // else: no match yet — next interval will retry
    } catch (err) {
      cleanup();
      res.status(500).json({
        ok: false,
        error: "POLL_ERROR",
        message: (err as Error).message,
      });
    }
  }

  // Handle client disconnect
  req.on("close", cleanup);

  // Start polling
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  // Also poll immediately (first check at 0ms delay)
  poll();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerTrack4Routes(app: Express): void {
  // D1 — founder channel attribution (admin OR founder owns company)
  app.get("/api/admin/founder-channels/:companyId", requireAuth, handleFounderChannels);

  // D2 — bridge event correlation (admin only)
  app.get("/api/admin/bridge/events/correlation", requireAdmin, handleBridgeCorrelation);

  // F1 — bridge wait-for long-poll (admin only)
  app.get("/api/admin/bridge/wait-for", requireAdmin, handleBridgeWaitFor);
}
