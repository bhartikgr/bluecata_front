/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 284 · THE WRITE ORDERING. REAL EXPRESS, REAL SQLITE, NO MOCK ANYWHERE.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `spvEngineStore.advanceSubscription` assigned `kycRef`,
 * `accreditationRef`, `subscriptionDocRef`, `wiredMinor`, `status` and
 * `updatedAt` DIRECTLY onto the object held in `subsBySpv` — the object every
 * reader in the store returns — and only THEN called `_persistSub`, which is
 * fail-closed and throws `STRICT_PERSIST_FAILED` when the row does not reach
 * SQLite. There was no rollback. A PATCH whose durable write failed therefore
 * left memory holding a status and a wired amount the database did not have, and
 * because `listSubscriptions` reads memory rather than SQLite, EVERY subsequent
 * read agreed with the version that was never stored — for the life of the
 * process.
 *
 * HOW THE FAILURE IS INJECTED, AND WHY IT IS NOT A MOCK. Two SQLite triggers are
 * created on `spv_subscription`, scoped by `NEW.id` to ONE subscription, that
 * `RAISE(ABORT)`. `_persistSub` uses `INSERT … ON CONFLICT DO UPDATE`, so both a
 * BEFORE INSERT and a BEFORE UPDATE trigger are installed. The write then fails
 * inside the real driver, on the real database, through the real code path —
 * `persist()` catches it and throws `STRICT_PERSIST_FAILED`. Nothing is stubbed,
 * nothing is spied on, and every assertion about the stored row is read back
 * with `rawDb()`.
 *
 * THE TRIGGERS ARE THE FIXTURE, AND THE FIX DOES NOT TOUCH THEM (R258.3). They
 * live in the database schema; wave 284 changed three TypeScript files and no
 * SQL. Their installation is PROVED rather than assumed — §B1 counts them in
 * `sqlite_master` AND drives a direct `rawDb()` UPDATE to see one fire — because
 * a fence that exists proves nothing until it is shown to be in the path.
 *
 * WHAT THIS FILE REFUSES TO PROVE THROUGH THE STORE'S OWN READERS ALONE. Every
 * claim about what was stored is a `rawDb()` read of `spv_subscription`. Every
 * claim about what a GP would SEE is an HTTP read of
 * `GET /api/partner/me/spv/:spvId`, whose `subscriptions` array is
 * `listSubscriptions` — pure memory. The whole point of the wave is that those
 * two must AGREE, so both are read and compared to each other. Asserting one and
 * inferring the other would prove a replica.
 *
 * MAIL SAFETY. Run with `SMTP_MODE=dry_run` on the command line: import-time
 * demo seeding sends before `beforeAll` can run. §0 proves inertness by driving
 * a send and reading the id shape, not by reading the flag.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { getConfig, patchConfig, sendMail } from "../emailTransport";

const MANAGING = "u_avi_managing";

let app: express.Express;

function post(path: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", MANAGING).send(body ?? {});
}
function patchReq(path: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", MANAGING).send(body ?? {});
}
function put(path: string, body?: unknown) {
  return request(app).put(path).set("x-user-id", MANAGING).send(body ?? {});
}
function get(path: string) {
  return request(app).get(path).set("x-user-id", MANAGING);
}

/** THE STORED ROW. Never the store's readers. */
function dbRow(subId: string): Record<string, unknown> | undefined {
  return rawDb()
    .prepare("SELECT * FROM spv_subscription WHERE id = ?")
    .get(subId) as Record<string, unknown> | undefined;
}

/** WHAT A GP WOULD SEE — the memory projection, fetched over HTTP. */
async function ramRow(spvId: string, subId: string): Promise<Record<string, unknown> | undefined> {
  const r = await get(`/api/partner/me/spv/${spvId}`);
  expect(r.status).toBe(200);
  const subs = r.body.subscriptions as Array<Record<string, unknown>>;
  expect(Array.isArray(subs)).toBe(true);
  return subs.find((s) => s.id === subId);
}

/** The one comparison this wave exists to make, rendered as a single string so a
 *  failure PRINTS both sides rather than reporting `false`. */
function agreement(ram: Record<string, unknown> | undefined, db: Record<string, unknown> | undefined): string {
  return [
    `ram.status=${String(ram?.status)}`,
    `db.status=${String(db?.status)}`,
    `ram.wiredMinor=${String(ram?.wiredMinor)}`,
    `db.wired_minor=${String(db?.wired_minor)}`,
    `ram.subscriptionDocRef=${String(ram?.subscriptionDocRef)}`,
    `db.subscription_doc_ref=${String(db?.subscription_doc_ref)}`,
  ].join(" ");
}

const T_UPD = "w284_block_sub_update";
const T_INS = "w284_block_sub_insert";

function installFailureTriggers(subId: string): void {
  /* Defensive: a PREVIOUS case that failed mid-way may not have reached its own
     DROP. Leaving a stale trigger behind would make the NEXT case fail with
     "trigger already exists" instead of the reason it was written to test, which
     is precisely the "read WHY it failed, not THAT it failed" hazard. Every
     caller still asserts the count is 0 before and 2 after, so this cannot hide
     a missing fence. */
  dropFailureTriggers();
  rawDb().exec(
    `CREATE TRIGGER ${T_UPD} BEFORE UPDATE ON spv_subscription FOR EACH ROW
       WHEN NEW.id = '${subId}'
       BEGIN SELECT RAISE(ABORT, 'W284 injected persistence failure (update)'); END;
     CREATE TRIGGER ${T_INS} BEFORE INSERT ON spv_subscription FOR EACH ROW
       WHEN NEW.id = '${subId}'
       BEGIN SELECT RAISE(ABORT, 'W284 injected persistence failure (insert)'); END;`,
  );
}

function dropFailureTriggers(): void {
  rawDb().exec(`DROP TRIGGER IF EXISTS ${T_UPD}; DROP TRIGGER IF EXISTS ${T_INS};`);
}

function triggerCount(): number {
  const r = rawDb()
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN (?, ?)")
    .get(T_UPD, T_INS) as { n?: number } | undefined;
  return Number(r?.n ?? 0);
}

async function createSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    currency: "USD", /* WAVE 306 W1 — stated, not defaulted: preserves this fixture's prior behaviour exactly. */
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  return String(r.body.spv.id);
}

async function subscribe(spvId: string, investorId: string, commitmentMinor: number): Promise<string> {
  const r = await post(`/api/partner/me/spv/${spvId}/subscriptions`, { investorId, commitmentMinor });
  expect(r.status).toBe(201);
  return String(r.body.subscription.id);
}

beforeAll(() => {
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 0 — MAIL IS INERT, PROVED BY DRIVING A SEND, NOT BY READING A FLAG.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §0 — no mail leaves this run", () => {
  it("a driven send returns a dry_ id", async () => {
    expect(getConfig().mode).toBe("dry_run");
    const out = await sendMail({ to: "nobody@capavate.test", subject: "W284 probe", html: "<p>probe</p>" });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION A — PRECONDITIONS, ASSERTED FIRST (R258.3 / standing rule 5).
   Everything below concludes something from a row NOT changing. That conclusion
   is worthless unless this harness is first shown able to change it.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §A — the harness can really move this row, and no trigger is installed yet", () => {
  it("PRECONDITION — a real subscription exists in SQLite and memory, and they already agree", async () => {
    const spvId = await createSpv("W284 A Precondition Vehicle");
    const subId = await subscribe(spvId, "inv_w284_a", 500000);

    /* The row is genuinely in the database. A missing row would make every
       "unchanged" assertion below vacuously true. */
    const db = dbRow(subId);
    expect(db).toBeTruthy();
    expect(String(db?.id)).toBe(subId);

    const ram = await ramRow(spvId, subId);
    expect(ram).toBeTruthy();
    expect(agreement(ram, db)).toBe(
      "ram.status=review db.status=review ram.wiredMinor=0 db.wired_minor=0 " +
        "ram.subscriptionDocRef=null db.subscription_doc_ref=null",
    );

    /* NO TRIGGER IS INSTALLED. If one leaked in from another test the control
       advance below would fail and the whole file would be measuring nothing. */
    expect(triggerCount()).toBe(0);
  });

  it("CONTROL — with no trigger installed, a PATCH succeeds and BOTH sides move together", async () => {
    const spvId = await createSpv("W284 A Control Vehicle");
    const subId = await subscribe(spvId, "inv_w284_a_ctrl", 500000);

    const r = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
      to: "wire_funded",
      wiredMinor: 250000,
    });
    expect(r.status).toBe(200);

    const db = dbRow(subId);
    const ram = await ramRow(spvId, subId);
    /* The advance really happened, in BOTH seats, with the SAME figures. This is
       the positive control for every "they agree" assertion in §B: agreement on
       an unchanged row is easy, agreement on a changed one is the real claim. */
    expect(agreement(ram, db)).toBe(
      "ram.status=wire_funded db.status=wire_funded ram.wiredMinor=250000 db.wired_minor=250000 " +
        "ram.subscriptionDocRef=null db.subscription_doc_ref=null",
    );
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION B — THE INJECTED PERSISTENCE FAILURE. THIS IS THE WHOLE WAVE.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §B — when the durable write fails, memory and the database still agree", () => {
  it("B1 — the injected failure is PROVED installed and PROVED to fire before anything is concluded from it", async () => {
    const spvId = await createSpv("W284 B1 Fence Installation Vehicle");
    const subId = await subscribe(spvId, "inv_w284_b1", 500000);
    expect(triggerCount()).toBe(0);

    installFailureTriggers(subId);
    /* IT EXISTS … */
    expect(triggerCount()).toBe(2);
    /* … AND IT IS IN THE PATH. A direct UPDATE of the row, through the same
       driver the store uses, is refused with the message the trigger raises.
       Without this line the triggers would be a fence whose installation is
       unproved, and every refusal below could be coming from somewhere else. */
    expect(() =>
      rawDb().prepare("UPDATE spv_subscription SET status = 'wire_funded' WHERE id = ?").run(subId),
    ).toThrowError(/W284 injected persistence failure/);

    dropFailureTriggers();
    expect(triggerCount()).toBe(0);
  });

  it("B2 — THE PROOF: a PATCH whose write fails leaves the stored row untouched AND memory agreeing with it", async () => {
    const spvId = await createSpv("W284 B2 Ordering Vehicle");
    const subId = await subscribe(spvId, "inv_w284_b2", 500000);

    const dbBefore = dbRow(subId);
    const ramBefore = await ramRow(spvId, subId);
    expect(dbBefore).toBeTruthy();
    expect(ramBefore).toBeTruthy();
    expect(String(dbBefore?.status)).toBe("review");

    installFailureTriggers(subId);
    expect(triggerCount()).toBe(2);

    const r = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
      to: "wire_funded",
      wiredMinor: 400000,
    });

    /* CONSEQUENCE BEFORE SHAPE.

       (1) THE STORED ROW DID NOT MOVE. Read with rawDb(), whole row, JSON
           compared — so a change to any column, not just the two this PATCH
           names, prints here. */
    const dbAfter = dbRow(subId);
    expect(JSON.stringify(dbAfter)).toBe(JSON.stringify(dbBefore));

    /* (2) MEMORY DID NOT MOVE EITHER. This is the assertion that fails on the
           pre-284 code: the old order had already written `status` and
           `wiredMinor` onto the live object before `_persistSub` threw. */
    const ramAfter = await ramRow(spvId, subId);
    expect(agreement(ramAfter, dbAfter)).toBe(
      "ram.status=review db.status=review ram.wiredMinor=0 db.wired_minor=0 " +
        "ram.subscriptionDocRef=null db.subscription_doc_ref=null",
    );

    /* (3) AND THEY AGREE, stated as its own claim rather than inferred from the
           two above: the figures a GP reads on screen are the figures in the
           database, after a failed write. */
    expect(agreement(ramAfter, dbAfter)).toBe(agreement(ramBefore, dbBefore));

    /* (4) THEN SHAPE. The caller is told the write failed — honestly, as a
           server failure, because that is what it is. It is NOT reported as a
           success and NOT reported as a client error. */
    expect(r.status).toBe(500);
    expect(String(r.body.error)).toContain("STRICT_PERSIST_FAILED");

    /* (5) THE FIXTURE IS RELEASED AND THE ROW IS STILL WRITABLE. This proves the
           refusal came from the trigger and not from a vehicle that had become
           permanently unwritable — and that the fix does not strand the row. */
    dropFailureTriggers();
    expect(triggerCount()).toBe(0);
    const retry = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
      to: "wire_funded",
      wiredMinor: 400000,
    });
    expect(retry.status).toBe(200);
    const dbRetry = dbRow(subId);
    const ramRetry = await ramRow(spvId, subId);
    expect(agreement(ramRetry, dbRetry)).toBe(
      "ram.status=wire_funded db.status=wire_funded ram.wiredMinor=400000 db.wired_minor=400000 " +
        "ram.subscriptionDocRef=null db.subscription_doc_ref=null",
    );
  });

  it("B3 — the four field arguments are not written to memory either when the write fails", async () => {
    const spvId = await createSpv("W284 B3 Field Arguments Vehicle");
    const subId = await subscribe(spvId, "inv_w284_b3", 500000);
    const dbBefore = dbRow(subId);

    installFailureTriggers(subId);
    const r = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
      to: "wire_funded",
      wiredMinor: 111111,
      kycRef: "kyc_w284_b3_never_stored",
      accreditationRef: "acc_w284_b3_never_stored",
      subscriptionDocRef: "sig_w284_b3_never_stored",
    });
    expect(r.status).toBe(500);

    const dbAfter = dbRow(subId);
    const ramAfter = await ramRow(spvId, subId);
    /* Neither seat holds any of the three references. Under the old order all
       three were on the live object the instant `_persistSub` threw, so a GP's
       screen showed an e-signature reference for a document nothing recorded. */
    expect(
      [
        `db.kyc=${String(dbAfter?.kyc_ref)}`,
        `ram.kyc=${String(ramAfter?.kycRef)}`,
        `db.acc=${String(dbAfter?.accreditation_ref)}`,
        `ram.acc=${String(ramAfter?.accreditationRef)}`,
        `db.doc=${String(dbAfter?.subscription_doc_ref)}`,
        `ram.doc=${String(ramAfter?.subscriptionDocRef)}`,
      ].join(" "),
    ).toBe("db.kyc=null ram.kyc=null db.acc=null ram.acc=null db.doc=null ram.doc=null");
    expect(JSON.stringify(dbAfter)).toBe(JSON.stringify(dbBefore));

    dropFailureTriggers();
    expect(triggerCount()).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION C — THE ARGUMENT MUTATION. `_persistSub` WRITES `revisionHash` BACK
   INTO ITS ARGUMENT, AND THE REORDERING HAD TO CARRY THAT BACK.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §C — the revision hash the write computes reaches memory", () => {
  it("after a successful advance, the memory row's revisionHash IS the stored curr_hash", async () => {
    const spvId = await createSpv("W284 C Revision Hash Vehicle");
    const subId = await subscribe(spvId, "inv_w284_c", 500000);

    const r = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
      to: "wire_funded",
      wiredMinor: 222222,
    });
    expect(r.status).toBe(200);

    const db = dbRow(subId);
    const ram = await ramRow(spvId, subId);
    /* PRECONDITION: there IS a hash to compare. An empty string on both sides
       would satisfy an equality check while proving nothing. */
    expect(String(db?.curr_hash ?? "").length).toBeGreaterThan(32);
    /* THE CLAIM: `_persistSub` mutates the object it is GIVEN, which is now the
       candidate copy — so the reorder publishes that copy to memory AFTER the
       write, not before, or this would be the empty pre-write value. */
    expect(String(ram?.revisionHash)).toBe(String(db?.curr_hash));
    /* And the response body — what the route actually returned — carries it too. */
    expect(String(r.body.subscription.revisionHash)).toBe(String(db?.curr_hash));
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION D — OVER-REACH. THE REORDERING MUST NOT BREAK A WORKING MONEY ACTION.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §D — the commit path that supplies its own e-signature still works", () => {
  it("`to: committed` with `subscriptionDocRef` in the SAME call is accepted and stored", async () => {
    const spvId = await createSpv("W284 D Commit Vehicle");
    const investorId = "inv_w284_d";
    const subId = await subscribe(spvId, investorId, 500000);
    const comp = await put(`/api/partner/me/compliance/${investorId}`, {
      kycStatus: "verified",
      accreditationStatus: "self_certified",
    });
    expect(comp.status).toBe(200);

    /* THE E-SIGN GATE READS THE VALUE SUPPLIED IN THIS CALL. Wave 284 moved the
       four assignments onto a candidate copy; if the gate had been left reading
       `sub` it would see no `subscriptionDocRef` and refuse with
       GATE_SUBSCRIPTION_ESIGN_REQUIRED (HTTP 422). A 422 here means the reorder
       broke the main commit path, which nine suites use. */
    const r = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
      to: "committed",
      subscriptionDocRef: `sig_${investorId}`,
    });
    expect(`${r.status} ${String(r.body?.error ?? "-")}`).toBe("200 -");

    const db = dbRow(subId);
    const ram = await ramRow(spvId, subId);
    expect(agreement(ram, db)).toBe(
      `ram.status=committed db.status=committed ram.wiredMinor=0 db.wired_minor=0 ` +
        `ram.subscriptionDocRef=sig_${investorId} db.subscription_doc_ref=sig_${investorId}`,
    );
  });

  it("a refusal raised BEFORE the write still leaves both seats untouched", async () => {
    const spvId = await createSpv("W284 D Refusal Vehicle");
    const investorId = "inv_w284_d_refuse";
    const subId = await subscribe(spvId, investorId, 500000);
    const dbBefore = dbRow(subId);

    /* No compliance profile, no e-signature: the KYC gate refuses. 422, and the
       row is untouched in both seats — the pre-existing behaviour, re-measured
       rather than assumed, because the gates now read the candidate copy. */
    const r = await patchReq(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, { to: "committed" });
    expect(r.status).toBe(422);
    expect(String(r.body.error)).toBe("GATE_KYC_REQUIRED");

    const dbAfter = dbRow(subId);
    const ramAfter = await ramRow(spvId, subId);
    expect(JSON.stringify(dbAfter)).toBe(JSON.stringify(dbBefore));
    expect(String(ramAfter?.status)).toBe("review");
  });
});
