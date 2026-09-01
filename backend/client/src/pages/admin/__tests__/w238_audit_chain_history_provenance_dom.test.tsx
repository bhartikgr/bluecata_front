/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 238 · FIX B + FIX D — WHAT /admin/audit-chain-verify NOW SAYS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * R176.2 — NEVER PROVE A REPLICA. This mounts the REAL default export of
 * client/src/pages/admin/AuditChainVerifyPage.tsx. Only the network boundary is
 * stubbed, and it is stubbed with the exact JSON shapes the real routes return
 * (server/auditChainRoutes.ts) — including `detailsJson`, which is the column
 * the screen never used to read.
 *
 * The two claims under test:
 *   FIX B — a history row states WHICH verifier produced it. Two verifiers write
 *           that table and they disagree with each other, so a row that does not
 *           say is not evidence.
 *   FIX D — the heading "Audit chain health — all clear" is a report on the
 *           incident register, not a verification performed on page load. The
 *           heading itself is byte-untouched; the clarification is appended.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { RoleProvider } from "@/lib/role";
import AuditChainVerifyPage from "../AuditChainVerifyPage";
import { AUDIT_LOG_CHAIN_TABLE, AUDIT_CHAIN_VERIFIER_LABELS } from "@shared/auditChainHistory";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const PAGE_SRC = fs.readFileSync(path.join(ROOT, "client/src/pages/admin/AuditChainVerifyPage.tsx"), "utf8");

/** The two literals R221.6 / the wave brief forbid changing. Byte-for-byte. */
const HEALTH_HEADING_ALL_CLEAR = '<h2 className="font-semibold">Audit chain health {health.incident ? "— incident(s) open" : "— all clear"}</h2>';
const HISTORY_EMPTY_LITERAL = "No past verifications recorded.";

const CANONICAL_ROW = {
  id: "acv_boot_1",
  tenantId: "tenant_w238",
  chapterId: null,
  tableName: AUDIT_LOG_CHAIN_TABLE,
  verifiedCount: 1,
  brokenCount: 0,
  brokenFirstId: null,
  totalRows: 2,
  durationMs: 3,
  startedAt: "2026-08-30T00:00:00.000Z",
  finishedAt: "2026-08-30T00:00:00.010Z",
  detailsJson: JSON.stringify({ verifier: "verifyTenantAuditChain", source: "boot_verifier", ok: true }),
};
const TWIN_ROW = {
  ...CANONICAL_ROW,
  id: "acv_twin_1",
  startedAt: "2026-08-29T00:00:00.000Z",
  detailsJson: JSON.stringify({ verifier: "verifyChainForTable", ok: true }),
};
/** A row written before wave 238: no verifier field at all. */
const LEGACY_ROW = {
  ...CANONICAL_ROW,
  id: "acv_legacy_1",
  startedAt: "2026-08-28T00:00:00.000Z",
  detailsJson: null,
};
/** A row whose details_json is unparseable. Must not throw, must not be
 *  silently promoted to the canonical verifier. */
const CORRUPT_ROW = { ...CANONICAL_ROW, id: "acv_corrupt_1", startedAt: "2026-08-27T00:00:00.000Z", detailsJson: "{not json" };

let historyRows: unknown[] = [];
let healthBody: Record<string, unknown> = { ok: true, rows: [], incident: false, anchors: [] };

/** The REAL RoleProvider, not a stub: useRole() throws "RoleProvider missing"
 *  without it, and stubbing it would move this file toward a replica. */
function renderPage() {
  return render(
    <RoleProvider>
      <AuditChainVerifyPage />
    </RoleProvider>,
  );
}

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

beforeEach(() => {
  historyRows = [];
  healthBody = { ok: true, rows: [], incident: false, anchors: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/admin/audit-chain-health")) return jsonRes(healthBody);
    if (u.includes("/api/admin/audit/verifiable-tables")) {
      return jsonRes({ ok: true, catalog: [{ name: AUDIT_LOG_CHAIN_TABLE, hashCol: "hash", prevHashCol: "prev_hash" }] });
    }
    if (u.includes("/api/admin/audit/verification-history")) return jsonRes({ ok: true, rows: historyRows });
    return jsonRes({ ok: true });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("W238 §G — the history panel names the verifier that produced each row", () => {
  it("G1 — CONTROL: with no rows the screen still says exactly 'No past verifications recorded.', unchanged", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.textContent).toContain(HISTORY_EMPTY_LITERAL));
    /* R195.5 — the empty state was not deleted or reworded. */
    expect(PAGE_SRC).toContain(HISTORY_EMPTY_LITERAL);
    /* And the absence is explained rather than left to be misread as
       "nothing has ever been verified". */
    const note = container.querySelector('[data-testid="w238-history-provenance-note"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("An empty list means no run has been recorded here, not that");
  });

  it("G2 — a canonical row is labelled as the canonical verifier, by name", async () => {
    historyRows = [CANONICAL_ROW];
    const { container } = renderPage();
    const cell = await waitFor(() => {
      const el = container.querySelector('[data-testid="w238-history-verifier-acv_boot_1"]');
      if (!el) throw new Error("verifier cell not rendered");
      return el;
    });
    expect(cell.textContent).toContain("verifyTenantAuditChain");
    expect(cell.textContent).toContain(AUDIT_CHAIN_VERIFIER_LABELS["verifyTenantAuditChain"]);
    expect(cell.textContent).toContain("chain_genesis re-base applied");
    /* The screen no longer claims nothing was recorded. */
    expect(container.textContent).not.toContain(HISTORY_EMPTY_LITERAL);
  });

  it("G3 — a TWIN row is labelled as the twin and is NOT presented as the canonical one", async () => {
    historyRows = [CANONICAL_ROW, TWIN_ROW];
    const { container } = renderPage();
    const twinCell = await waitFor(() => {
      const el = container.querySelector('[data-testid="w238-history-verifier-acv_twin_1"]');
      if (!el) throw new Error("twin cell not rendered");
      return el;
    });
    expect(twinCell.textContent).toContain("verifyChainForTable");
    expect(twinCell.textContent).toContain("no chain_genesis re-base");
    expect(twinCell.textContent).not.toContain("verifyTenantAuditChain");
    /* The two rows are labelled differently — the column is reading the row,
       not printing a constant. */
    const canonCell = container.querySelector('[data-testid="w238-history-verifier-acv_boot_1"]')!;
    expect(canonCell.textContent).not.toBe(twinCell.textContent);
  });

  it("G4 — a pre-wave-238 row with no verifier field reads 'not recorded', NOT the canonical verifier", async () => {
    historyRows = [LEGACY_ROW, CORRUPT_ROW];
    const { container } = renderPage();
    const legacy = await waitFor(() => {
      const el = container.querySelector('[data-testid="w238-history-verifier-acv_legacy_1"]');
      if (!el) throw new Error("legacy cell not rendered");
      return el;
    });
    expect(legacy.textContent).toBe("not recorded");
    expect(legacy.textContent).not.toContain("verifyTenantAuditChain");
    /* Unparseable details_json must not throw and must not be promoted. */
    const corrupt = container.querySelector('[data-testid="w238-history-verifier-acv_corrupt_1"]')!;
    expect(corrupt.textContent).toBe("not recorded");
  });

  it("G5 — the Verifier column was APPENDED LAST; no pre-existing column moved", async () => {
    historyRows = [CANONICAL_ROW];
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[data-testid="w238-history-verifier-acv_boot_1"]')).not.toBeNull());
    const tables = Array.from(container.querySelectorAll("table"));
    const historyTable = tables.find((t) => t.textContent?.includes("Verifier"))!;
    const headers = Array.from(historyTable.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Started", "Table", "Chapter", "Verified", "Broken", "Duration ms", "Verifier"]);
    const cells = Array.from(historyTable.querySelectorAll("tbody tr td"));
    expect(cells.length).toBe(headers.length);
    expect(cells[cells.length - 1].getAttribute("data-testid")).toBe("w238-history-verifier-acv_boot_1");
  });

  it("G6 — a row that recorded a break still renders its break count; nothing was softened", async () => {
    historyRows = [{ ...CANONICAL_ROW, id: "acv_break_1", brokenCount: 1, verifiedCount: 2, detailsJson: JSON.stringify({ verifier: "verifyTenantAuditChain", ok: false, brokenAtIndex: 2 }) }];
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[data-testid="w238-history-verifier-acv_break_1"]')).not.toBeNull());
    const row = container.querySelector('[data-testid="w238-history-verifier-acv_break_1"]')!.closest("tr")!;
    expect(row.textContent).toContain("1");
    const note = container.querySelector('[data-testid="w238-history-provenance-note"]')!;
    expect(note.textContent).toContain("a row that");
    expect(note.textContent).toContain("recorded a break is kept indefinitely");
  });

  it("G7 — the panel states the append-only contract, so a reader knows a row is not a repairable record", async () => {
    historyRows = [CANONICAL_ROW];
    const { container } = renderPage();
    const note = await waitFor(() => {
      const el = container.querySelector('[data-testid="w238-history-provenance-note"]');
      if (!el) throw new Error("note not rendered");
      return el;
    });
    expect(note.textContent).toContain("rows are appended, never rewritten, re-hashed or re-ordered");
    expect(note.textContent).toContain("two chain");
    expect(note.textContent).toContain("they do not agree");
  });
});

describe("W238 §H — FIX D: 'all clear' is scoped to the incident register", () => {
  it("H1 — the protected heading literal is byte-for-byte unchanged", () => {
    expect(PAGE_SRC).toContain(HEALTH_HEADING_ALL_CLEAR);
  });

  it("H2 — with an empty register the heading still reads 'all clear', and the appended note says what that covers", async () => {
    healthBody = { ok: true, rows: [], incident: false, anchors: [] };
    const { container } = renderPage();
    const note = await waitFor(() => {
      const el = container.querySelector('[data-testid="w238-health-scope-note"]');
      if (!el) throw new Error("scope note not rendered");
      return el;
    });
    expect(container.textContent).toContain("Audit chain health");
    expect(container.textContent).toContain("all clear");
    expect(note.textContent).toContain("the incident register has no open");
    expect(note.textContent).toContain("not a verification performed as");
    /* And it points at the history, which is now populated rather than empty. */
    expect(note.textContent).toContain("Verification");
    expect(note.textContent).toContain("history");
  });

  it("H3 — with an OPEN incident the heading still says 'incident(s) open' and the note is still present", async () => {
    healthBody = {
      ok: true,
      incident: true,
      anchors: [],
      rows: [{ key: "tenant_x", status: "incident", detail: "boot verifier tick: chain broken at link 2 of 5", updatedAt: "2026-08-10T00:00:00.000Z" }],
    };
    const { container } = renderPage();
    await waitFor(() => expect(container.textContent).toContain("incident(s) open"));
    expect(container.querySelector('[data-testid="w238-health-scope-note"]')).not.toBeNull();
    /* R190.10 / R195.5 — the resolve control and the pre-existing detail text
       are still there. Nothing was restricted or removed. */
    expect(container.querySelector('[data-testid="resolve-tenant_x"]')).not.toBeNull();
    expect(container.textContent).toContain("boot verifier tick: chain broken at link 2 of 5");
  });

  it("H4 — the note was appended as the health card's LAST child; the heading is still the card's first", async () => {
    healthBody = { ok: true, rows: [], incident: false, anchors: [] };
    const { container } = renderPage();
    const note = await waitFor(() => {
      const el = container.querySelector('[data-testid="w238-health-scope-note"]');
      if (!el) throw new Error("scope note not rendered");
      return el;
    });
    const cardBody = note.parentElement!;
    expect(cardBody.lastElementChild).toBe(note);
    expect(cardBody.firstElementChild!.querySelector("h2")!.textContent).toContain("Audit chain health");
  });

  it("H5 — the health empty state is untouched (R195.5)", async () => {
    healthBody = { ok: true, rows: [], incident: false, anchors: [] };
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[data-testid="health-empty"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="health-empty"]')!.textContent).toBe("No audit-chain-health rows on file.");
  });
});
