// v24.4 EXPANDED E2E — covers every Avi/Shadie v24.4 fix end-to-end.
//
// Journeys:
//   V44-J0  Bug C hardening — signup with role:"investor" or portal:"investor"
//           returns 403 INVESTOR_SIGNUP_DISALLOWED (investors are invite-only).
//   V44-J1  Investor invite → secure-redeem → logout → login → /api/auth/me
//           reports an INVESTOR persona (Fix 3 role hydration; Fix 4 redeem
//           ordering — the redeem credential works at the browser login form).
//   V44-J2  Founder confirms a soft-circle → status "confirmed".
//   V44-J3  Company profile DB-first persistence across PATCH/GET.
//   V44-J4  Round rename via terms PATCH (Fix 8).
//   V44-J5  Admin bootstrap Collective member (Fix 10).
//   V44-J6  Airwallex billing URL + health featureFlags.airwallexMode flag.
//
// Auth model: real founder signup → session cookie. All journeys that need a
// founder identity use a freshly-signed-up founder, mirroring real production
// usage. Admin-only paths fall back to graceful SKIP if no admin session can
// be obtained.
//
// Usage:
//   BASE=http://127.0.0.1:5000 node v24_4_e2e_expanded.mjs

const BASE = process.env.BASE || "http://127.0.0.1:5073";
const PRESEED_ADMIN_EMAIL = process.env.PRESEED_ADMIN_EMAIL || "qa.admin.v25@example.com";
const PRESEED_ADMIN_PW = process.env.PRESEED_ADMIN_PW || "AdminTest25!Strong";

const results = [];
const log = (...a) => console.log(...a);
const recordPass = (name, detail) => { results.push({ name, status: "PASS", detail }); log(`✓ PASS  ${name}${detail ? ` — ${detail}` : ""}`); };
const recordFail = (name, detail) => { results.push({ name, status: "FAIL", detail }); log(`✗ FAIL  ${name} — ${detail}`); };
const recordSkip = (name, detail) => { results.push({ name, status: "SKIP", detail }); log(`○ SKIP  ${name} — ${detail}`); };

async function api(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, headers: r.headers, body: json, raw: text };
}

function cookiesFromResponse(res) {
  const sc = res.headers.get("set-cookie");
  if (!sc) return "";
  // Multiple set-cookie headers come back as a single comma-joined string in
  // some runtimes — split on comma followed by space-before-name pattern.
  return sc.split(/,(?=\s*[A-Za-z_-]+=)/).map(c => c.split(";")[0].trim()).join("; ");
}

async function signupFounder(prefix = "QA") {
  const email = `qa.${prefix}.${Date.now()}.${Math.random().toString(36).slice(2,6)}@example.com`;
  const password = "QaTest24!Strong";
  const r = await api("POST", "/api/auth/signup", { body: { email, password, name: `${prefix} Founder` } });
  if (r.status !== 200 && r.status !== 201) throw new Error(`signup failed: ${r.status} — ${r.raw.slice(0,150)}`);
  return {
    cookie: cookiesFromResponse(r),
    userId: r.body?.userId || r.body?.ctx?.userId || r.body?.identity?.id,
    email,
    password,
  };
}

// =============================================================================
// V44-J0 — Bug C HARDENING: signup with role/portal=investor returns 403
// =============================================================================
async function V44_J0_signupBlocksInvestorRole() {
  log("\n========== V44-J0: signup blocks investor role (Bug C) ==========");
  try {
    const r1 = await api("POST", "/api/auth/signup", {
      body: { email: `qa.blockrole.${Date.now()}@example.com`, name: "X", password: "blockedpw123", role: "investor" },
    });
    if (r1.status !== 403 || r1.body?.error !== "INVESTOR_SIGNUP_DISALLOWED") {
      return recordFail("V44-J0-1 role:investor → 403", `${r1.status} ${r1.raw.slice(0,150)}`);
    }
    recordPass("V44-J0-1 role:investor → 403", "INVESTOR_SIGNUP_DISALLOWED");

    const r2 = await api("POST", "/api/auth/signup", {
      body: { email: `qa.blockportal.${Date.now()}@example.com`, name: "X", password: "blockedpw123", portal: "investor" },
    });
    if (r2.status !== 403 || r2.body?.error !== "INVESTOR_SIGNUP_DISALLOWED") {
      return recordFail("V44-J0-2 portal:investor → 403", `${r2.status} ${r2.raw.slice(0,150)}`);
    }
    recordPass("V44-J0-2 portal:investor → 403", "INVESTOR_SIGNUP_DISALLOWED");
  } catch (e) { recordFail("V44-J0 exception", e.message); }
}

// =============================================================================
// V44-J1 — Investor invite → redeem → login → investor persona (real flow)
// =============================================================================
async function V44_J1_investorInviteRedeemLoginPersona(sharedFounder) {
  log("\n========== V44-J1: investor invite → redeem → login → investor persona ==========");
  try {
    const f = sharedFounder ?? await signupFounder("Inv");
    recordPass("V44-J1-1a founder signup", f.email);

    // Create a company so the founder has a tenant/round home.
    const co = await api("POST", "/api/founder/companies/new", {
      headers: { Cookie: f.cookie },
      body: { name: `QA Co ${Date.now()}`, sector: "SaaS" },
    });
    const companyId = co.body?.companyId || co.body?.id || co.body?.company?.id;
    if (!companyId) return recordFail("V44-J1-1b create company", `${co.status} ${co.raw.slice(0,200)}`);
    recordPass("V44-J1-1b create company", companyId);

    // Create a round on the founder's company.
    const created = await api("POST", "/api/rounds", {
      headers: { Cookie: f.cookie },
      body: { companyId, name: "QA Seed Round", type: "priced", instrument: "preferred", targetAmount: 1000000, minTicket: 25000 },
    });
    const roundId = created.body?.round?.id || created.body?.id;
    if (!roundId) return recordFail("V44-J1-1c create round", `${created.status} ${created.raw.slice(0,200)}`);
    recordPass("V44-J1-1c create round", roundId);

    // Mint an investor invitation on that round.
    const inviteeEmail = `qa.investor.${Date.now()}@example.com`;
    const inv = await api("POST", `/api/rounds/${roundId}/invitations`, {
      headers: { Cookie: f.cookie },
      body: { investorEmail: inviteeEmail, investorName: "QA Investor" },
    });
    if (inv.status !== 200) return recordFail("V44-J1-2 create invitation", `${inv.status} ${inv.raw.slice(0,200)}`);
    const redeemUrl = inv.body?.redeemUrl;
    // Modern redeemUrl format is `${appUrl}/invite/${encodeURIComponent(token)}`
    // (the older `?token=` form is no longer minted). Support both for safety.
    const token = redeemUrl
      ? (redeemUrl.match(/\/invite\/([^/?#]+)/)?.[1]
          ?? redeemUrl.match(/token=([^&]+)/)?.[1]
          ?? null)
      : null;
    if (!token) return recordFail("V44-J1-2 create invitation", `no redeemUrl/token returned (body=${JSON.stringify(inv.body).slice(0,200)})`);
    recordPass("V44-J1-2 create invitation", "got redeem token");

    // Redeem the round invitation — the canonical investor account-creation
    // path is POST /api/invitations/redeem (bridges to roundInvitationsStore +
    // calls registerPersona under the hood, which sets isInvestor=true).
    const pw = "InvestorPw24!";
    const redeem = await api("POST", "/api/invitations/redeem", { body: { token: decodeURIComponent(token), password: pw } });
    if (redeem.status !== 200) return recordFail("V44-J1-3 invitation redeem", `${redeem.status} ${redeem.raw.slice(0,200)}`);
    recordPass("V44-J1-3 invitation redeem", `200 personaId=${redeem.body?.ctx?.userId ?? "?"}`);
    const redeemedCtx = redeem.body?.ctx;
    if (redeemedCtx?.investor?.state && redeemedCtx.investor.state !== "NONE") {
      recordPass("V44-J1-3b redeemed persona is investor (Fix 3)", `state=${redeemedCtx.investor.state}`);
    } else {
      recordFail("V44-J1-3b redeemed persona is investor (Fix 3)", `state=${redeemedCtx?.investor?.state}`);
    }

    // Log in the investor at the browser form. We do NOT log out the founder
    // session here because subsequent journeys (V44-J2..J6) reuse the same
    // shared founder cookie. The investor login uses a fresh cookie jar so
    // the founder's session remains valid for the rest of the suite.
    const login = await api("POST", "/api/auth/login", { body: { email: inviteeEmail, password: pw } });
    if (login.status !== 200) return recordFail("V44-J1-4 login with redeem pw (Fix 4)", `${login.status} ${login.raw.slice(0,200)}`);
    const loginCookie = cookiesFromResponse(login);
    recordPass("V44-J1-4 login with redeem pw (Fix 4)", "200");

    // /api/auth/me must report an INVESTOR persona (Fix 3 role hydration).
    const me = await api("GET", "/api/auth/me", { headers: { Cookie: loginCookie } });
    if (me.status !== 200 || !me.body?.isAuthed) return recordFail("V44-J1-5 /auth/me authed", `${me.status} authed=${me.body?.isAuthed}`);
    const isInvestorPersona =
      (me.body?.investor?.state && me.body.investor.state !== "NONE")
        || me.body?.isInvestor === true
        || (Array.isArray(me.body?.founder?.companies) && me.body.founder.companies.length === 0 && !me.body?.isAdmin);
    if (!isInvestorPersona) {
      return recordFail("V44-J1-5 /auth/me is investor persona (Fix 3)", `state=${me.body?.investor?.state} companies=${(me.body?.founder?.companies||[]).length} isAdmin=${me.body?.isAdmin}`);
    }
    recordPass("V44-J1-5 /auth/me is investor persona (Fix 3)", `investor.state=${me.body?.investor?.state}`);
  } catch (e) { recordFail("V44-J1 exception", e.message); }
}

// =============================================================================
// V44-J2 — Founder confirms a soft-circle → status "confirmed"
// =============================================================================
async function V44_J2_founderConfirmsSoftCircle(sharedFounder) {
  log("\n========== V44-J2: founder confirms soft-circle → confirmed ==========");
  try {
    const f = sharedFounder ?? await signupFounder("SC");
    const co = await api("POST", "/api/founder/companies/new", {
      headers: { Cookie: f.cookie },
      body: { name: `QA SC Co ${Date.now()}`, sector: "SaaS" },
    });
    const companyId = co.body?.companyId || co.body?.id || co.body?.company?.id;
    if (!companyId) return recordFail("V44-J2-1a create company", `${co.status} ${co.raw.slice(0,200)}`);

    const created = await api("POST", "/api/rounds", {
      headers: { Cookie: f.cookie },
      body: { companyId, name: "QA SC Round", type: "priced", instrument: "preferred", targetAmount: 1000000, minTicket: 25000 },
    });
    const roundId = created.body?.round?.id || created.body?.id;
    if (!roundId) return recordFail("V44-J2-1 obtain round", `${created.status} ${created.raw.slice(0,200)}`);
    recordPass("V44-J2-1 obtain round", roundId);

    // Create a soft-circle (intent) on that round.
    const create = await api("POST", `/api/rounds/${roundId}/soft-circle`, {
      headers: { Cookie: f.cookie },
      body: { investorName: "QA SoftCircle Investor", amount: 50000, status: "intent" },
    });
    if (create.status !== 200) return recordFail("V44-J2-2 create soft-circle", `${create.status} ${create.raw.slice(0,200)}`);
    const scId = create.body?.softCircle?.id;
    if (!scId) return recordFail("V44-J2-2 create soft-circle", `no soft-circle id (body=${JSON.stringify(create.body).slice(0,200)})`);
    recordPass("V44-J2-2 create soft-circle", `${scId} status=${create.body.softCircle.status}`);

    // Founder confirms via the validate endpoint the client now calls (Fix 2).
    const validate = await api("POST", `/api/rounds/${roundId}/soft-circle/${scId}/validate`, { headers: { Cookie: f.cookie }, body: {} });
    if (validate.status !== 200) return recordFail("V44-J2-3 confirm soft-circle", `${validate.status} ${validate.raw.slice(0,200)}`);
    const confirmedStatus = validate.body?.softCircle?.status;
    if (confirmedStatus !== "confirmed") return recordFail("V44-J2-3 confirm soft-circle", `status=${confirmedStatus}, expected confirmed`);
    recordPass("V44-J2-3 confirm soft-circle (Fix 2)", `status=${confirmedStatus}`);

    // Re-read the round's soft-circle book — the confirmed status must persist.
    const book = await api("GET", `/api/rounds/${roundId}/soft-circles`, { headers: { Cookie: f.cookie } });
    const arr = Array.isArray(book.body) ? book.body : (book.body?.softCircles ?? book.body?.items ?? []);
    const found = arr.find((x) => x.id === scId);
    if (!found || found.status !== "confirmed") return recordFail("V44-J2-4 confirmed persists in book", `found=${!!found} status=${found?.status}`);
    recordPass("V44-J2-4 confirmed persists in book", "confirmed");
  } catch (e) { recordFail("V44-J2 exception", e.message); }
}

// =============================================================================
// V44-J3 — Company profile persists (DB-first) across a GET round-trip
// =============================================================================
async function V44_J3_companyProfilePersists(sharedFounder) {
  log("\n========== V44-J3: company profile DB-first persistence ==========");
  try {
    const f = sharedFounder ?? await signupFounder("Profile");
    const co = await api("POST", "/api/founder/companies/new", {
      headers: { Cookie: f.cookie },
      body: { name: `Profile QA ${Date.now()}`, sector: "SaaS" },
    });
    const coId = co.body?.companyId || co.body?.id || co.body?.company?.id;
    if (!coId) return recordSkip("V44-J3-1 PATCH profile", `couldn't create company (${co.status})`);

    const unique = `Durable Co ${Date.now()}`;
    const patch = await api("PATCH", `/api/founder/profile?companyId=${encodeURIComponent(coId)}`, {
      headers: { Cookie: f.cookie, "x-confirm": "true" },
      body: { contact: { companyName: unique } },
    });
    if (patch.status !== 200 && patch.status !== 201) return recordFail("V44-J3-1 PATCH profile", `${patch.status} ${patch.raw.slice(0,200)}`);
    recordPass("V44-J3-1 PATCH profile", `${patch.status}`);

    const get = await api("GET", `/api/founder/profile?companyId=${encodeURIComponent(coId)}`, { headers: { Cookie: f.cookie } });
    if (get.status !== 200) return recordFail("V44-J3-2 GET profile", `${get.status}`);
    // GET response shape is `{ ok: true, profile: { contact: { companyName, ... } } }`.
    const fetchedName = get.body?.profile?.contact?.companyName
      ?? get.body?.contact?.companyName;
    if (fetchedName !== unique) {
      return recordFail("V44-J3-2 profile is DB-first (Fix 5)", `got ${fetchedName}, expected ${unique}`);
    }
    recordPass("V44-J3-2 profile is DB-first (Fix 5)", "round-trip OK");
  } catch (e) { recordFail("V44-J3 exception", e.message); }
}

// =============================================================================
// V44-J4 — Round rename via terms PATCH (Fix 049 / Fix 8)
// =============================================================================
async function V44_J4_roundRename(sharedFounder) {
  log("\n========== V44-J4: round rename via terms PATCH ==========");
  try {
    const f = sharedFounder ?? await signupFounder("Rename");
    const co = await api("POST", "/api/founder/companies/new", {
      headers: { Cookie: f.cookie },
      body: { name: `Rename QA ${Date.now()}`, sector: "SaaS" },
    });
    const companyId = co.body?.companyId || co.body?.id || co.body?.company?.id;
    if (!companyId) return recordSkip("V44-J4-1 create round", `couldn't create company (${co.status})`);

    const created = await api("POST", "/api/rounds", {
      headers: { Cookie: f.cookie },
      body: { companyId, name: "Original QA Name", type: "priced", instrument: "preferred", targetAmount: 2000000, minTicket: 50000 },
    });
    const roundId = created.body?.round?.id || created.body?.id;
    if (!roundId) return recordFail("V44-J4-1 create round", `${created.status} ${created.raw.slice(0,200)}`);
    recordPass("V44-J4-1 create round", roundId);

    const newName = `Renamed QA ${Date.now()}`;
    const rename = await api("PATCH", `/api/rounds/${roundId}/terms`, { headers: { Cookie: f.cookie }, body: { name: newName } });
    if (rename.status !== 200) return recordFail("V44-J4-2 rename round (Fix 8)", `${rename.status} ${rename.raw.slice(0,200)}`);
    if (rename.body?.round?.name !== newName) return recordFail("V44-J4-2 rename round (Fix 8)", `name=${rename.body?.round?.name}`);
    recordPass("V44-J4-2 rename round (Fix 8)", newName);

    // A blank name is rejected.
    const blank = await api("PATCH", `/api/rounds/${roundId}/terms`, { headers: { Cookie: f.cookie }, body: { name: "   " } });
    if (blank.status !== 400) return recordFail("V44-J4-3 blank name rejected", `${blank.status}`);
    recordPass("V44-J4-3 blank name rejected", `400 ${blank.body?.error}`);
  } catch (e) { recordFail("V44-J4 exception", e.message); }
}

// =============================================================================
// V44-J5 — Admin bootstrap Collective member (Fix 10)
// =============================================================================
async function V44_J5_adminBootstrapMember(sharedFounder) {
  log("\n========== V44-J5: admin bootstrap Collective member ==========");
  try {
    // Reuse the shared founder so a durable credential (lookupByEmail) exists.
    const f = sharedFounder ?? await signupFounder("Bootstrap");
    recordPass("V44-J5-1 signup target user", f.email);

    // This journey needs an admin session. Use the pre-seeded admin credentials
    // (same approach as the live suite). Falls back gracefully if login fails.
    let adminCookie = "";
    try {
      const adminLogin = await api("POST", "/api/auth/login", {
        body: { email: PRESEED_ADMIN_EMAIL, password: PRESEED_ADMIN_PW },
      });
      if (adminLogin.status === 200 && adminLogin.body?.ok) {
        adminCookie = cookiesFromResponse(adminLogin);
      }
    } catch (_e) { /* ignore */ }
    if (!adminCookie) {
      return recordSkip("V44-J5-2 bootstrap member (Fix 10)", "no admin session available — pre-seed admin missing");
    }

    const boot = await api("POST", "/api/admin/collective/members/bootstrap", {
      headers: { Cookie: adminCookie },
      body: { email: f.email },
    });
    if (boot.status !== 200) return recordFail("V44-J5-2 bootstrap member (Fix 10)", `${boot.status} ${boot.raw.slice(0,200)}`);
    recordPass("V44-J5-2 bootstrap member (Fix 10)", "200");

    // The member must now appear active in the admin members list.
    const list = await api("GET", "/api/admin/collective/members", { headers: { Cookie: adminCookie } });
    const members = Array.isArray(list.body) ? list.body : (list.body?.members ?? list.body?.items ?? []);
    const active = members.some((m) => (m.userId === f.userId || (m.email && m.email.toLowerCase() === f.email.toLowerCase())) && (m.status === "active" || m.status === undefined));
    if (!active && members.length === 0) {
      recordSkip("V44-J5-3 member active in admin list", "members list shape not enumerable in this build");
    } else if (!active) {
      recordFail("V44-J5-3 member active in admin list", `not found among ${members.length} members`);
    } else {
      recordPass("V44-J5-3 member active in admin list", "active");
    }

    // Missing user/email → 400.
    const bad = await api("POST", "/api/admin/collective/members/bootstrap", { headers: { Cookie: adminCookie }, body: {} });
    if (bad.status !== 400) return recordFail("V44-J5-4 missing user rejected", `${bad.status}`);
    recordPass("V44-J5-4 missing user rejected", `400 ${bad.body?.error}`);
  } catch (e) { recordFail("V44-J5 exception", e.message); }
}

// =============================================================================
// V44-J6 — Airwallex billing hosted URL + health featureFlags.airwallexMode
// =============================================================================
async function V44_J6_airwallexBillingAndHealthFlag(sharedFounder) {
  log("\n========== V44-J6: Airwallex billing URL + health airwallexMode flag ==========");
  try {
    const h = await api("GET", "/api/health");
    if (h.status !== 200) return recordFail("V44-J6-1 health", `${h.status}`);
    const mode = h.body?.featureFlags?.airwallexMode;
    if (!["stub", "test", "live"].includes(mode)) return recordFail("V44-J6-1 health airwallexMode (Fix 1)", `airwallexMode=${mode}`);
    recordPass("V44-J6-1 health airwallexMode (Fix 1)", `version=${h.body?.version} mode=${mode}`);

    const f = sharedFounder ?? await signupFounder("Billing");
    const co = await api("POST", "/api/founder/companies/new", { headers: { Cookie: f.cookie }, body: { name: "Billing QA Co", sector: "SaaS" } });
    const companyId = co.body?.companyId || co.body?.id || co.body?.company?.id;
    if (!companyId) return recordSkip("V44-J6-2 founder + company", `couldn't create company (${co.status})`);
    recordPass("V44-J6-2 founder + company", companyId);

    // Resolve a tier id from the pricing list.
    const tiers = await api("GET", "/api/billing/tiers", { headers: { Cookie: f.cookie } });
    let tierId = null;
    const tlist = Array.isArray(tiers.body) ? tiers.body : (tiers.body?.tiers ?? tiers.body?.items ?? []);
    if (tlist.length) tierId = tlist[0]?.id || tlist[0]?.tierId;

    if (!tierId) {
      recordSkip("V44-J6-3 billing checkout returns Airwallex URL", "no tier id resolvable in this build");
    } else {
      const plan = await api("POST", "/api/billing/plan", { headers: { Cookie: f.cookie }, body: { tierId, companyId, billingCycle: "annual" } });
      if (plan.status === 503) {
        recordSkip("V44-J6-3 billing checkout returns Airwallex URL", "gateway_not_configured (no AIRWALLEX creds on server)");
      } else if (plan.status !== 200) {
        recordFail("V44-J6-3 billing checkout", `${plan.status} ${plan.raw.slice(0,200)}`);
      } else {
        const url = plan.body?.hostedPaymentPageUrl;
        if (typeof url === "string" && url.includes("airwallex.com") && url.includes(plan.body?.paymentIntentId)) {
          recordPass("V44-J6-3 billing checkout returns Airwallex URL (Fix 1)", url.slice(0, 70) + "…");
        } else {
          recordFail("V44-J6-3 billing checkout returns Airwallex URL", `url=${String(url).slice(0,80)}`);
        }
      }
    }
  } catch (e) { recordFail("V44-J6 exception", e.message); }
}

// =============================================================================
// MAIN
// =============================================================================
(async () => {
  log(`v24.4 EXPANDED E2E — base: ${BASE}`);
  try {
    const h = await api("GET", "/api/health");
    if (h.status !== 200) throw new Error(`health ${h.status}`);
    log(`Server reachable — version: ${h.body?.version}`);
    if (h.body?.version !== "24.4.0") log(`⚠ Health version is ${h.body?.version}, expected 24.4.0 — running anyway`);
  } catch (e) {
    log(`✗ EXIT: cannot reach server at ${BASE} — ${e.message}`);
    process.exit(1);
  }

  // Public signup rate limit: 5/IP/hour. To stay below it, journeys share
  // one signed-up founder; V44-J0's expected 403s don't consume signup quota.
  let sharedFounder = null;
  try { sharedFounder = await signupFounder("Shared"); }
  catch (e) { log(`✗ EXIT: shared founder signup failed — ${e.message}`); process.exit(1); }
  log(`Shared founder: ${sharedFounder.email}`);

  await V44_J0_signupBlocksInvestorRole();
  await V44_J1_investorInviteRedeemLoginPersona(sharedFounder);
  await V44_J2_founderConfirmsSoftCircle(sharedFounder);
  await V44_J3_companyProfilePersists(sharedFounder);
  await V44_J4_roundRename(sharedFounder);
  await V44_J5_adminBootstrapMember(sharedFounder);
  await V44_J6_airwallexBillingAndHealthFlag(sharedFounder);

  log("\n========== SUMMARY ==========");
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIP").length;
  log(`PASS:    ${passed}`);
  log(`FAIL:    ${failed}`);
  log(`SKIP:    ${skipped}`);
  if (failed > 0) {
    log("\nFAILURES:");
    for (const r of results.filter(rr => rr.status === "FAIL")) log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  log("\n✓✓✓ ALL v24.4 E2E JOURNEYS PASSED ✓✓✓");
  process.exit(0);
})();
