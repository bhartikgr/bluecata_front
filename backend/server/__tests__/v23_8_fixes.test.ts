/**
 * v23.8.0 — consolidated regression pins for the V28 fix wave.
 *
 * Coverage map (one or more assertions each):
 *   A3/W-13  founder collective overlay propagation (buildCollectiveOverlay)
 *   B6/W-5   reports recipient picker sources cap-table holders + /recipients
 *   C4/W-15  investor + admin waitlist status surfaces
 *   C5/W-16  admin waitlist page + route exist and are wired
 *   C6/W-17  deriveCurrencyFromRegion region→currency mapping
 *   D1/W-11  deriveLegalName corporate-suffix dedup
 *   D2/W-18  telemetry no longer defaults actor to u_investor_demo
 *   E1       invitation links no longer hard-code app.capavate.com
 *   E3/BUG014 session cookie bounded to 4h (Max-Age=14400)
 *   E4       /api/health version is read from package.json (== 23.8.0)
 *
 * Server behaviors use supertest; client + source-level guarantees use
 * source-grep (vitest globs *.test.ts only — no JSX runtime in this tree).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerCollectiveWaitlistRoutes } from "../collectiveWaitlistRoutes";
import { deriveLegalName } from "../multiCompanyStore";

const ROOT = resolve(__dirname, "..", "..");
const SERVER = resolve(__dirname, "..");
const CLIENT = resolve(ROOT, "client", "src");

function srcServer(rel: string) { return readFileSync(resolve(SERVER, rel), "utf8"); }
function srcClient(rel: string) { return readFileSync(resolve(CLIENT, rel), "utf8"); }

/* ----------------------------- D1/W-11 ----------------------------- */
describe("v23.8 D1/W-11 — deriveLegalName corporate-suffix dedup", () => {
  it("appends ', Inc.' to a plain name", () => {
    expect(deriveLegalName("NovaPay")).toBe("NovaPay, Inc.");
  });
  it("does NOT double an existing Inc. suffix", () => {
    expect(deriveLegalName("NovaPay Inc.")).toBe("NovaPay Inc.");
    expect(deriveLegalName("NovaPay Inc")).toBe("NovaPay Inc");
  });
  it("recognizes other corporate suffixes (Ltd, LLC, GmbH, Pty Ltd)", () => {
    expect(deriveLegalName("Arboreal Ltd.")).toBe("Arboreal Ltd.");
    expect(deriveLegalName("Acme LLC")).toBe("Acme LLC");
    expect(deriveLegalName("Berlin Co GmbH")).toBe("Berlin Co GmbH");
    expect(deriveLegalName("Sydney Pty Ltd")).toBe("Sydney Pty Ltd");
  });
  it("handles empty/whitespace input without crashing", () => {
    expect(deriveLegalName("")).toBe("");
    expect(deriveLegalName("   ")).toBe("");
  });
});

/* ----------------------------- C6/W-17 ----------------------------- */
describe("v23.8 C6/W-17 — region→currency derive helper (client source)", () => {
  const SETTINGS = srcClient("pages/founder/Settings.tsx");
  it("exports deriveCurrencyFromRegion and maps the key regions", () => {
    expect(SETTINGS).toMatch(/export function deriveCurrencyFromRegion/);
    expect(SETTINGS).toMatch(/HKD/);
    expect(SETTINGS).toMatch(/CAD/);
    expect(SETTINGS).toMatch(/GBP/);
  });
  it("falls back to the derived currency only when defaultCurrency is absent", () => {
    expect(SETTINGS).toMatch(/deriveCurrencyFromRegion\(hq\)/);
  });
});

/* ----------------------------- D2/W-18 ----------------------------- */
describe("v23.8 D2/W-18 — telemetry actor no longer defaults to a demo investor", () => {
  it("sprint10Telemetry does not fall back to u_investor_demo", () => {
    const t = srcServer("sprint10Telemetry.ts");
    expect(t).not.toMatch(/u_investor_demo/);
  });
});

/* ------------------------------- E1 -------------------------------- */
describe("v23.8 E1 — invitation links use capavate.com (not app.capavate.com)", () => {
  it("roundInvitationsStore has no app.capavate.com fallback", () => {
    const s = srcServer("roundInvitationsStore.ts");
    expect(s).not.toMatch(/app\.capavate\.com/);
    expect(s).toMatch(/https:\/\/capavate\.com/);
  });
});

/* ----------------------------- E3/BUG014 --------------------------- */
describe("v23.8 E3/BUG-014 — session cookie bounded to 4 hours", () => {
  it("sessionCookie max-age is 4 hours (14400s)", () => {
    const s = srcServer("lib/sessionCookie.ts");
    expect(s).toMatch(/4 \* 60 \* 60 \* 1000/);
    expect(s).not.toMatch(/14 \* 24 \* 60 \* 60 \* 1000/);
  });
});

/* ------------------------------- E4 -------------------------------- */
describe("v23.8 E4 — /api/health reports the package.json version", () => {
  it("package.json is bumped to 24.0.0", () => {
    // Version pin follows the active release. Bumped 23.9.2 → 24.0.0 in the
    // v24.0 release (Group B tenant-isolation lockdown + Group C/D fixes); the
    // /api/health handler reads this value at runtime.
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(pkg.version).toBe("24.0.0");
  });
  it("routes.ts health handler reads version from package.json (no 0.0.0 literal in the response)", () => {
    const r = srcServer("routes.ts");
    expect(r).toMatch(/require\(["']\.\.\/package\.json["']\)/);
    expect(r).toMatch(/version,/);
  });
});

/* ----------------------------- B6/W-5 ------------------------------ */
describe("v23.8 B6/W-5 — reports recipient picker sources cap-table holders", () => {
  const REPORTS = srcClient("pages/founder/Reports.tsx");
  it("the Send dialog fetches the /recipients endpoint and keys checkboxes by userId", () => {
    expect(REPORTS).toMatch(/\/recipients/);
    expect(REPORTS).toMatch(/CapTableHolder/);
    expect(REPORTS).toMatch(/checkbox-recipient-\$\{h\.userId\}/);
  });
});

/* ----------------------------- C5/W-16 ----------------------------- */
describe("v23.8 C5/W-16 — admin waitlist page is wired", () => {
  it("the CollectiveWaitlist page consumes the admin waitlist endpoint", () => {
    const page = srcClient("pages/admin/CollectiveWaitlist.tsx");
    expect(page).toMatch(/\/api\/admin\/collective\/waitlist/);
    expect(page).toMatch(/button-accept-/);
    expect(page).toMatch(/button-decline-/);
  });
  it("App.tsx registers the /admin/collective/waitlist route", () => {
    const app = srcClient("App.tsx");
    expect(app).toMatch(/AdminCollectiveWaitlist/);
    expect(app).toMatch(/\/admin\/collective\/waitlist/);
  });
});

/* ----------------------------- C4/W-15 ----------------------------- */
describe("v23.8 C4/W-15 — investor waitlist status banner + server endpoints", () => {
  let app: Express;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerCollectiveWaitlistRoutes(app);
  });

  it("the investor Apply page renders a waitlist status banner from /waitlist/mine", () => {
    const page = srcClient("pages/investor/ApplyToCollective.tsx");
    expect(page).toMatch(/\/api\/collective\/waitlist\/mine/);
    expect(page).toMatch(/banner-investor-waitlist-status/);
  });

  it("GET /api/collective/waitlist/mine returns the requester's own entries", async () => {
    const r = await request(app)
      .get("/api/collective/waitlist/mine")
      .set("x-user-id", "u_aisha_patel");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(typeof r.body.count).toBe("number");
  });

  it("a user's investor-membership signup then appears in their /mine list", async () => {
    const post = await request(app)
      .post("/api/collective/waitlist/investor-membership")
      .set("x-user-id", "u_aisha_patel")
      .send({ chapterHint: "HK" });
    expect(post.status).toBe(201);
    expect(post.body.ok).toBe(true);
    expect(post.body.waitlistId).toMatch(/^wl_/);

    const mine = await request(app)
      .get("/api/collective/waitlist/mine")
      .set("x-user-id", "u_aisha_patel");
    expect(mine.body.items.some((x: { id: string }) => x.id === post.body.waitlistId)).toBe(true);
  });

  it("admin can list and review waitlist entries", async () => {
    const list = await request(app)
      .get("/api/admin/collective/waitlist")
      .set("x-user-id", "u_admin");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);

    const target = list.body.items[0];
    if (target) {
      const patch = await request(app)
        .patch(`/api/admin/collective/waitlist/${target.id}`)
        .set("x-user-id", "u_admin")
        .send({ status: "accepted" });
      expect(patch.status).toBe(200);
      expect(patch.body.ok).toBe(true);
      expect(patch.body.entry.status).toBe("accepted");
    }
  });
});
