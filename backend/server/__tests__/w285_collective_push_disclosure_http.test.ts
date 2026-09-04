/* ════════════════════════════════════════════════════════════════════════════
   WAVE 285 · THE "QUEUED PUSHES" COUNTER — MEASURED OVER REAL HTTP.
   ════════════════════════════════════════════════════════════════════════════
   WHAT THE DOCUMENTS SAID, AND WHY THIS FILE EXISTS.

   The Band 15 preflight (§5.1, §5.2) states:

       "Nothing can enqueue a row, so it is permanently zero."
       "`grep -rn \"createSpvOnBehalf\" server/ client/` returns no callers
        anywhere — so the only path that would insert a push cannot be invoked."

   BOTH SENTENCES ARE FALSE, and this file proves it by execution rather than by
   argument:

     · `server/managedFounderRoutes.ts` registers
       POST /api/partner/me/mfcrm/spv-on-behalf, which calls
       `managedFounderStore.createSpvOnBehalf`.
     · `createSpvOnBehalf` INSERTs an `mf_collective_push` row with
       status = 'queued' inside its synchronous transaction.
     · `client/src/pages/partner/PartnerManagedFounders.tsx` (SpvOnBehalfPanel,
       `createM`) POSTs that route from the product UI — wave 20 wired it.

   So the counter CAN move, and a disclosure claiming the figure is "always
   zero" would itself have been a fresh falsehood on the screen.

   WHAT IS ACTUALLY BROKEN is the other end: NOTHING DRAINS THE QUEUE.
   `processCollectivePush` exists only as a word inside a comment, there is no
   scheduler, and the only route that can move a push out of 'queued'
   (POST .../collective-push/:pushId/mark) has no caller on any screen. A queued
   push therefore never reaches the Collective and never leaves the count.

   METHOD NOTES
   ------------
   · REAL Express, REAL routes, REAL sqlite. No mock anywhere in this file.
   · The STORED ROW is read with `rawDb()`, not through a store reader, because
     the store's readers can answer from RAM.
   · Every absence below is asserted against a live baseline with the SAME
     instrument, so an instrument that matches nothing cannot pass as a proof of
     absence, and every count is asserted as `=== n`, never as "a match exists".
   · The before-values are asserted as preconditions BEFORE anything is
     concluded from an after-value.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerMfcrmRoutes } from "../managedFounderRoutes";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";

const REPO = path.resolve(__dirname, "..", "..");
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const MANAGING = "u_avi_managing";
const CO = "co_w285_collective_push";

let app: express.Express;
let engagementId = "";

/** THROWS on failure — a swallowed fixture error is a vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w285 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

/** Queued-push rows for this partner, read STRAIGHT OUT OF SQLITE. */
const storedQueuedCount = (): number =>
  (
    rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM mf_collective_push WHERE partner_id = ? AND status = 'queued'`)
      .get(PARTNER_A) as { n: number }
  ).n;

const storedRow = (pushId: string): Record<string, unknown> | undefined =>
  rawDb().prepare(`SELECT * FROM mf_collective_push WHERE id = ?`).get(pushId) as
    | Record<string, unknown>
    | undefined;

const dashboardQueuedPushes = async (): Promise<unknown> => {
  const r = await request(app).get("/api/partner/me/mfcrm/dashboard").set("x-user-id", MANAGING);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body?.queuedPushes;
};

const createOnBehalf = (name: string) =>
  request(app)
    .post("/api/partner/me/mfcrm/spv-on-behalf")
    .set("x-user-id", MANAGING)
    .send({
      companyId: CO,
      engagementId,
      name,
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
    });

/* ---------- source-scan instrument, used for the absence proofs ---------- */

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "assets") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
};

/** Total occurrences of `needle` across `files`. Occurrences, not files. */
const occurrences = (files: string[], needle: string): number => {
  let n = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let at = src.indexOf(needle);
    while (at >= 0) {
      n += 1;
      at = src.indexOf(needle, at + needle.length);
    }
  }
  return n;
};

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmRoutes(app);
  applyMfcrmSchema();
  seedTestPartnerSandbox({ force: true });
  partnerAttributionStore.create(PARTNER_A, CO, MANAGING);
  managedFounderStore.setCapabilityProfile(
    PARTNER_A,
    {
      classified: true,
      sourcesCapital: true,
      delegatedAgency: true,
      spvWriteAuthority: true,
      collectiveFronting: true,
    },
    MANAGING,
  );
  /* The agreement gate (WAVE 154 / R116.3) sits in front of this route and is
     NOT the subject of this file. Satisfy it explicitly so the only variable
     under test is the queue. */
  run(
    `UPDATE contacts SET partner_agreement_signed_at = ? WHERE id = ? AND kind = 'consortium_partner'`,
    "2026-01-05T00:00:00.000Z",
    PARTNER_A,
  );
  const eng = await request(app)
    .post("/api/partner/me/mfcrm/engagements")
    .set("x-user-id", MANAGING)
    .send({ companyId: CO });
  engagementId = String(eng.body?.engagement?.id ?? "");
  expect(engagementId.length, "fixture engagement must exist").toBeGreaterThan(0);
  /* GATE 3 is per-engagement: Mode A plus an unexpired authority artifact. */
  managedFounderStore.setMode(
    PARTNER_A,
    engagementId,
    "A",
    {
      authorityArtifactRef: "doc_w285_authority_grant",
      authorityExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    },
    MANAGING,
  );
});

describe("WAVE 285 · A — THE COUNTER MOVES. The preflight's \"permanently zero\" is false.", () => {
  it("PRECONDITION — the routes answer, the fixture is real, and the counter is readable", async () => {
    /* Asserted FIRST. An unreachable route and a route answering zero are
       different facts, and a proof that cannot tell them apart proves nothing. */
    const attributed = partnerAttributionStore.listByPartner(PARTNER_A);
    expect(attributed.some((a) => a.companyId === CO)).toBe(true);

    const before = await dashboardQueuedPushes();
    expect(typeof before, "the dashboard must actually return this field").toBe("number");
    expect(before as number).toBeGreaterThanOrEqual(0);
    expect(storedQueuedCount()).toBe(before as number);
  });

  it("a UI-reachable POST enqueues a REAL row, and the STORED row says 'queued'", async () => {
    const beforeStored = storedQueuedCount();
    const beforeDash = (await dashboardQueuedPushes()) as number;
    expect(beforeStored).toBe(beforeDash);

    const res = await createOnBehalf("W285 On-Behalf SPV");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const pushId = String(res.body?.pushId ?? "");
    expect(pushId.startsWith("mfcp_"), JSON.stringify(res.body)).toBe(true);

    /* THE STORED ROW, out of sqlite — not the store's RAM projection. */
    const row = storedRow(pushId);
    expect(row, "no mf_collective_push row was written").toBeTruthy();
    expect(row!.status).toBe("queued");
    expect(row!.partner_id).toBe(PARTNER_A);
    expect(row!.company_id).toBe(CO);
    expect(row!.attempts).toBe(0);
    expect(row!.pushed_at ?? null).toBe(null);

    /* AND THE NUMBER THE SCREEN PRINTS MOVED. This single assertion refutes
       "the tile reads 0 forever". */
    expect(storedQueuedCount()).toBe(beforeStored + 1);
    expect(await dashboardQueuedPushes()).toBe(beforeDash + 1);
  });

  it("a SECOND push increments it again — it is a live count, not a one-off", async () => {
    const before = (await dashboardQueuedPushes()) as number;
    const res = await createOnBehalf("W285 On-Behalf SPV II");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await dashboardQueuedPushes()).toBe(before + 1);
  });
});

describe("WAVE 285 · B — NOTHING DRAINS THE QUEUE. Every absence against a live baseline.", () => {
  const serverFiles = walk(path.join(REPO, "server"));
  const clientFiles = walk(path.join(REPO, "client", "src"));

  it("PRECONDITION — the source-scan instrument is not looking at an empty set", () => {
    /* Rule 9, both directions: the instrument is first shown to FIND things,
       on cases whose answers are known independently of this wave. */
    expect(serverFiles.length).toBeGreaterThan(100);
    expect(clientFiles.length).toBeGreaterThan(100);
    expect(occurrences(serverFiles, "mf_collective_push")).toBeGreaterThan(0);
    expect(occurrences(serverFiles, "UPDATE mf_collective_push")).toBe(2);
    expect(occurrences(clientFiles, "/api/partner/me/mfcrm/spv-on-behalf")).toBeGreaterThan(0);
  });

  it("there is NO worker: `processCollectivePush` occurs exactly once, inside a comment", () => {
    expect(occurrences(serverFiles, "processCollectivePush")).toBe(1);
    const store = fs.readFileSync(path.join(REPO, "server", "managedFounderStore.ts"), "utf8");
    const lines = store.split("\n").filter((l) => l.includes("processCollectivePush"));
    expect(lines.length).toBe(1);
    /* The only occurrence is prose inside a block comment, so it cannot be a
       call, a declaration or an export. */
    expect(lines[0].trim().startsWith("*")).toBe(true);
    expect(occurrences(serverFiles, "processCollectivePush(")).toBe(0);
  });

  it("NO SCREEN can move a push out of 'queued' — zero client callers of the mark route", () => {
    /* The route exists (server side, one registration) and no screen calls it.
       Both halves asserted, so this cannot pass by the route having vanished. */
    expect(occurrences(serverFiles, '"/api/partner/me/mfcrm/collective-push/:pushId/mark"')).toBe(1);
    /* The needle is the FULL API PATH, which is what any real caller must
       contain. A shorter needle ("collective-push") also matches this wave's
       own explanatory comment, and a fixture anchored on the fix's own string
       cannot distinguish the fix from the defect. */
    expect(occurrences(clientFiles, "/api/partner/me/mfcrm/collective-push")).toBe(0);
    expect(occurrences(clientFiles, "markCollectivePush")).toBe(0);
  });

  it("nothing DELETES a push row either, so the count cannot fall that way", () => {
    expect(occurrences(serverFiles, "DELETE FROM mf_collective_push")).toBe(0);
  });

  it("the queued row written above is STILL queued — proved by re-reading sqlite", async () => {
    /* The end-to-end statement of the defect: a push was enqueued through the
       product's own route, and after every request this file makes it is still
       sitting in 'queued'. */
    const rows = rawDb()
      .prepare(`SELECT status FROM mf_collective_push WHERE partner_id = ? AND company_id = ?`)
      .all(PARTNER_A, CO) as { status: string }[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
  });
});

describe("WAVE 285 · C — the disclosure the screen now carries is true of this measured behaviour", () => {
  const page = fs.readFileSync(
    path.join(REPO, "client", "src", "pages", "partner", "PartnerManagedFounders.tsx"),
    "utf8",
  );

  it("the tile's label and value are UNTOUCHED — the fix appends, it does not reword", () => {
    /* Anchored on strings this wave did not write, so it can tell the fix from
       the defect. */
    expect(page).toContain(">Queued pushes</div>");
    expect(page).toContain("{dashQ.data.queuedPushes}");
    /* Counted on the RENDER EXPRESSION, not on the bare identifier: the bare
       identifier also appears in this wave's own explanatory comment and in the
       DTO type, and a count that its own comment inflates is a decoy (W284's
       lesson, V.3.1). There is exactly ONE place the number is printed. */
    expect(
      occurrences(
        [path.join(REPO, "client", "src", "pages", "partner", "PartnerManagedFounders.tsx")],
        "{dashQ.data.queuedPushes}",
      ),
    ).toBe(1);
  });

  it("the disclosure says delivery is not available and that a zero is not a delivery", () => {
    expect(page).toContain("Delivery of queued pushes to the Collective is not available yet.");
    expect(page).toContain("has not reached the Collective");
    expect(page).toContain("not that a deal was delivered");
    /* It must NOT tell the partner the figure is always zero — that claim is
       false, as section A proves by execution. What it says instead is the
       measured direction of travel. */
    expect(page).toContain("figure can rise but never fall");
    const rendered = page.slice(
      page.indexOf("Delivery of queued pushes"),
      page.indexOf("not that a deal was delivered"),
    );
    expect(rendered.length).toBeGreaterThan(80);
    expect(rendered.toLowerCase()).not.toContain("always zero");
    expect(rendered.toLowerCase()).not.toContain("permanently zero");
  });

  it("the enqueue surface carries its own disclosure, and its old sentence is intact", () => {
    expect(page).toContain(
      "Creates the vehicle, records an audit entry in the on-behalf chain, and queues the Collective push — in one transaction.",
    );
    expect(page).toContain("The queued push is not delivered to the Collective.");
  });
});
