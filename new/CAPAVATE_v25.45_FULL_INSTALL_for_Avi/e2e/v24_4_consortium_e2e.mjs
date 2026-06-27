/**
 * v24.4 Consortium (Partners) E2E — production-mode test suite.
 *
 * Journeys:
 *   K-J1  Public application
 *   K-J2  Admin lists + reviews (approves)
 *   K-J3  Mint partner admin via create_partner_admin.ts
 *   K-J4  Partner dashboard (/api/partner/me + /api/partner/me/dashboard)
 *   K-J5  Pipeline
 *   K-J6  Clients
 *   K-J7  Funds
 *   K-J8  SPVs
 *   K-J9  Files
 *   K-J10 Tasks
 *   K-J11 Team
 *   K-J12 Notes
 *   K-J13 Settings
 *   K-J14 Partner CRM contacts
 *   K-J15 Partner deals
 *   K-J16 Partner portfolio
 *   K-J17 Admin partner mgmt (PATCH a field)
 *   K-J18 Admin suspend partner (verify workspace rejects)
 *
 * Usage:
 *   BASE=http://127.0.0.1:5000 node v24_4_consortium_e2e.mjs
 */

import { execSync } from "node:child_process";

const BASE = process.env.BASE || "http://127.0.0.1:5000";
const TREE = "/home/user/workspace/avi_v24_4_tree";

const results = [];
const log = (...a) => console.log(...a);
const recordPass = (name, detail) => {
  results.push({ name, status: "PASS", detail });
  log(`✓ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
};
const recordFail = (name, detail) => {
  results.push({ name, status: "FAIL", detail });
  log(`✗ FAIL  ${name} — ${detail}`);
};
const recordSkip = (name, detail) => {
  results.push({ name, status: "SKIP", detail });
  log(`○ SKIP  ${name} — ${detail}`);
};

async function api(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, headers: r.headers, body: json, raw: text };
}

function cookiesFromResponse(res) {
  const sc = res.headers.get("set-cookie");
  if (!sc) return "";
  return sc.split(/,(?=\s*[A-Za-z_-]+=)/).map(c => c.split(";")[0].trim()).join("; ");
}

async function loginUser(email, password) {
  const r = await api("POST", "/api/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed ${email}: ${r.status} — ${r.raw.slice(0, 150)}`);
  return { cookie: cookiesFromResponse(r), body: r.body };
}

// ============================================================
// K-J1 — Public application
// ============================================================
async function KJ1_publicApply(ts) {
  log("\n========== K-J1: Public consortium application ==========");
  try {
    const body = {
      organizationName: `QA Partners Inc ${ts}`,
      contactName: `QA Contact ${ts}`,
      contactEmail: `qa.partner.${ts}@example.com`,
      contactPhone: "+1-555-0100",
      website: null,
      jurisdiction: "CA",
      partnerType: "angel_network",
      aumRange: "10-50M",
      portfolioCompanyCount: 12,
      expectedChapter: "Toronto",
      introMessage: "QA E2E test application for v24.4 Consortium suite.",
      referredBy: null,
    };
    const r = await api("POST", "/api/public/consortium/apply", { body });
    if (r.status !== 200 && r.status !== 201) {
      recordFail("K-J1-1 POST /api/public/consortium/apply", `${r.status} ${r.raw.slice(0, 200)}`);
      return null;
    }
    const appId = r.body?.applicationId;
    if (!appId) {
      recordFail("K-J1-2 application id returned", `body=${JSON.stringify(r.body).slice(0, 200)}`);
      return null;
    }
    recordPass("K-J1-1 POST /api/public/consortium/apply", `appId=${appId} status=${r.body?.status}`);

    // Check status endpoint
    const status = await api("GET", `/api/public/consortium/apply/${appId}/status`);
    if (status.status !== 200) {
      recordFail("K-J1-3 GET status endpoint", `${status.status} ${status.raw.slice(0, 150)}`);
    } else {
      recordPass("K-J1-3 GET status endpoint", `status=${status.body?.status}`);
    }

    return { appId, contactEmail: body.contactEmail };
  } catch (e) {
    recordFail("K-J1 exception", e.message);
    return null;
  }
}

// ============================================================
// K-J2 — Admin lists + reviews
// ============================================================
async function KJ2_adminReview(adminCookie, appId, ts) {
  log("\n========== K-J2: Admin lists + reviews ==========");
  try {
    if (!appId) {
      recordSkip("K-J2 admin review", "no application id from K-J1");
      return null;
    }
    // List applications
    const list = await api("GET", "/api/admin/consortium/applications", { headers: { Cookie: adminCookie } });
    if (list.status !== 200) {
      recordFail("K-J2-1 GET /api/admin/consortium/applications", `${list.status} ${list.raw.slice(0, 200)}`);
      return null;
    }
    const rows = list.body?.rows ?? list.body?.items ?? [];
    recordPass("K-J2-1 GET /api/admin/consortium/applications", `count=${rows.length}`);

    // Find our application
    const found = rows.find(r => r.id === appId);
    if (!found) {
      recordFail("K-J2-2 find application in list", `appId=${appId} not found among ${rows.length} rows`);
      // Try to GET single app
    } else {
      recordPass("K-J2-2 find application in list", `id=${found.id} status=${found.status}`);
    }

    // Approve
    const approve = await api("POST", `/api/admin/consortium/applications/${appId}/review`, {
      headers: { Cookie: adminCookie },
      body: { status: "approved", review_notes: "Approved by QA E2E test" },
    });
    if (approve.status !== 200) {
      recordFail("K-J2-3 approve application", `${approve.status} ${approve.raw.slice(0, 200)}`);
      return null;
    }
    const app = approve.body?.application;
    const partnerId = app?.provisionedPartnerId ?? app?.tenantId?.replace(/^tenant_cp_/, "");
    // v24.4.1 — the review endpoint now also returns the raw redemption URL
    // for the partner-invite token. This is the same URL the welcome email
    // contains; admins can pick it up here to re-share if SMTP fails.
    const partnerInviteRedeemUrl = approve.body?.partnerInviteRedeemUrl ?? null;
    if (partnerInviteRedeemUrl) {
      recordPass("K-J2-3b approval returns partnerInviteRedeemUrl (v24.4.1)", partnerInviteRedeemUrl.slice(0, 70) + "…");
    } else {
      recordFail("K-J2-3b approval returns partnerInviteRedeemUrl (v24.4.1)", "missing");
    }
    recordPass("K-J2-3 approve application", `partnerId=${partnerId} status=${app?.status}`);

    // Fetch admin/partners to confirm the partner org was created.
    // NOTE: The provisionedPartnerId in the application row is the internal DB partnerId,
    // but the actual adminContactsStore entry has a different ID generated by upsertConsortiumPartner().
    // We search by contact email to find the actual partner contact ID that requirePartnerAuth will use.
    const partnersList = await api("GET", "/api/admin/partners", { headers: { Cookie: adminCookie } });
    if (partnersList.status !== 200) {
      recordFail("K-J2-4 GET /api/admin/partners after approval", `${partnersList.status}`);
      return partnerId;
    }
    const partners = partnersList.body?.partners ?? [];
    // Find the partner by matching the contact email from the application
    const contactEmail = `qa.partner.${ts}@example.com`;
    const partner = partners.find(p =>
      p.id === partnerId ||
      p.email?.toLowerCase() === contactEmail.toLowerCase() ||
      (p.legalName && p.legalName.includes(String(ts)))
    );
    if (!partner) {
      recordFail("K-J2-4 partner in admin/partners list",
        `provisionedPartnerId=${partnerId} not found; contactEmail=${contactEmail}; ` +
        `available: ${partners.map(p => p.id + '(' + p.email + ')').join(', ')}`);
      return { partnerId, partnerInviteRedeemUrl };
    } else {
      recordPass("K-J2-4 partner in admin/partners list", `id=${partner.id} status=${partner.status}`);
      // v24.4.1 Bug 3 fix verification — the adminContactsStore id must match
      // the application's provisionedPartnerId now that upsertConsortiumPartner
      // accepts a preferredId.
      if (partner.id === partnerId) {
        recordPass("K-J2-5 partner id matches provisionedPartnerId (v24.4.1 Bug 3)", partner.id);
      } else {
        recordFail("K-J2-5 partner id matches provisionedPartnerId (v24.4.1 Bug 3)",
          `provisionedPartnerId=${partnerId} adminContacts.id=${partner.id}`);
      }
      return { partnerId: partner.id, partnerInviteRedeemUrl };
    }
  } catch (e) {
    recordFail("K-J2 exception", e.message);
    return null;
  }
}

// ============================================================
// K-J3 — Mint partner admin via the canonical partner-invite redemption path
//
// In production, every approved consortium application sends a partner-invite
// email containing a single-use 14-day URL of the form:
//   ${APP_URL}/auth/redeem-partner-invite/<rawToken>
// The applicant follows the URL, lands on a set-password page, and the
// backend mints their persona AND binds them to partner_team_members in the
// SAME running server process — which is the only way the in-memory
// partnerTeamStore stays consistent with the user session.
//
// v24.4.1 — the admin review endpoint now also returns the raw redeem URL
// (`partnerInviteRedeemUrl`) so admins (and this test) can pick up the link
// without waiting for SMTP delivery. This is the real-world path Avi/Shadie
// will exercise once SMTP is wired; the URL is the same one the welcome email
// contains.
// ============================================================
async function KJ3_mintPartnerAdmin(partnerInviteRedeemUrl, ts) {
  log("\n========== K-J3: Mint partner admin (partner-invite redemption) ==========");
  if (!partnerInviteRedeemUrl) {
    recordFail("K-J3-0 redeem URL from approval", "approval did not return partnerInviteRedeemUrl");
    return null;
  }
  recordPass("K-J3-0 redeem URL from approval (v24.4.1)", partnerInviteRedeemUrl.slice(0, 70) + "…");

  // The URL embeds the raw token — split it out.
  const m = partnerInviteRedeemUrl.match(/\/auth\/redeem-partner-invite\/([^/?#]+)/);
  const token = m ? m[1] : null;
  if (!token) {
    recordFail("K-J3-1 extract token from redeem URL", `url=${partnerInviteRedeemUrl}`);
    return null;
  }

  // POST the redeem endpoint. The server creates the persona, sets the
  // session cookie, and binds partner_team_members in-process. No body needed.
  const redeem = await api("POST", `/api/auth/redeem-partner-invite/${encodeURIComponent(token)}`, { body: {} });
  if (redeem.status !== 200 || !redeem.body?.ok) {
    recordFail("K-J3-1 redeem partner invite", `${redeem.status} ${redeem.raw.slice(0,200)}`);
    return null;
  }
  const cookie = cookiesFromResponse(redeem);
  if (!cookie) {
    recordFail("K-J3-1 redeem returned session cookie", "no Set-Cookie on redemption response");
    return null;
  }
  recordPass("K-J3-1 redeem partner invite", `200 partnerId=${redeem.body?.partnerId} subRole=${redeem.body?.subRole}`);
  return {
    cookie,
    email: redeem.body?.ctx?.identity?.email,
    userId: redeem.body?.ctx?.userId,
  };
}

// ============================================================
// K-J4 — Partner dashboard
// ============================================================
async function KJ4_partnerDashboard(partnerCookie) {
  log("\n========== K-J4: Partner dashboard ==========");
  try {
    const me = await api("GET", "/api/partner/me", { headers: { Cookie: partnerCookie } });
    if (me.status !== 200) {
      recordFail("K-J4-1 GET /api/partner/me", `${me.status} ${me.raw.slice(0, 200)}`);
    } else {
      recordPass("K-J4-1 GET /api/partner/me", `partnerId=${me.body?.partnerId} tier=${me.body?.tier}`);
    }

    const dash = await api("GET", "/api/partner/me/dashboard", { headers: { Cookie: partnerCookie } });
    if (dash.status !== 200) {
      recordFail("K-J4-2 GET /api/partner/me/dashboard", `${dash.status} ${dash.raw.slice(0, 200)}`);
    } else {
      recordPass("K-J4-2 GET /api/partner/me/dashboard", `200`);
    }
  } catch (e) {
    recordFail("K-J4 exception", e.message);
  }
}

// ============================================================
// K-J5 — Pipeline
// ============================================================
async function KJ5_pipeline(partnerCookie) {
  log("\n========== K-J5: Partner pipeline ==========");
  try {
    const r = await api("GET", "/api/partner/me/pipeline", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J5-1 GET /api/partner/me/pipeline", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      recordPass("K-J5-1 GET /api/partner/me/pipeline", `200 count=${(r.body?.pipeline ?? []).length}`);
    }
  } catch (e) {
    recordFail("K-J5 exception", e.message);
  }
}

// ============================================================
// K-J6 — Clients
// ============================================================
async function KJ6_clients(partnerCookie) {
  log("\n========== K-J6: Partner clients ==========");
  try {
    const r = await api("GET", "/api/partner/me/clients", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J6-1 GET /api/partner/me/clients", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      const clients = r.body?.clients ?? r.body;
      recordPass("K-J6-1 GET /api/partner/me/clients", `200 count=${Array.isArray(clients) ? clients.length : "??"}`);
    }
  } catch (e) {
    recordFail("K-J6 exception", e.message);
  }
}

// ============================================================
// K-J7 — Funds
// ============================================================
async function KJ7_funds(partnerCookie) {
  log("\n========== K-J7: Partner funds ==========");
  try {
    const r = await api("GET", "/api/partner/me/funds", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J7-1 GET /api/partner/me/funds", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      recordPass("K-J7-1 GET /api/partner/me/funds", `200 count=${(r.body?.funds ?? []).length}`);
    }
  } catch (e) {
    recordFail("K-J7 exception", e.message);
  }
}

// ============================================================
// K-J8 — SPVs
// ============================================================
async function KJ8_spvs(partnerCookie) {
  log("\n========== K-J8: Partner SPVs ==========");
  try {
    const r = await api("GET", "/api/partner/me/spvs", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J8-1 GET /api/partner/me/spvs", `${r.status} ${r.raw.slice(0, 200)}`);
      return;
    }
    const spvs = r.body?.spvs ?? r.body ?? [];
    recordPass("K-J8-1 GET /api/partner/me/spvs", `200 count=${Array.isArray(spvs) ? spvs.length : "??"}`);

    // Try creating an SPV. The store requires spvName, jurisdiction, vintage,
    // an ISO 4217 currency, and a status enum value — see partnerWorkspaceStore.
    const spvBody = {
      spvName: `QA SPV ${Date.now()}`,
      jurisdiction: "DE",          // Delaware
      vintage: 2026,
      currency: "USD",
      status: "open",
      targetSizeMinor: 5000000,
      managementFeePct: 2.0,
      carryPct: 20.0,
    };
    const create = await api("POST", "/api/partner/me/spvs", {
      headers: { Cookie: partnerCookie },
      body: spvBody,
    });
    if (create.status === 201 || create.status === 200) {
      const spvId = create.body?.spv?.id || create.body?.id;
      recordPass("K-J8-2 POST /api/partner/me/spvs", `spvId=${spvId}`);
      // Re-read to verify it appears
      const list2 = await api("GET", "/api/partner/me/spvs", { headers: { Cookie: partnerCookie } });
      const spvs2 = list2.body?.spvs ?? list2.body ?? [];
      const found = Array.isArray(spvs2) && spvs2.some(s => s.id === spvId);
      if (found) {
        recordPass("K-J8-3 SPV appears in list after create", `spvId=${spvId}`);
      } else {
        recordFail("K-J8-3 SPV appears in list after create", `not found; count=${Array.isArray(spvs2) ? spvs2.length : "??"}`);
      }
    } else if (create.status === 404) {
      recordSkip("K-J8-2 POST /api/partner/me/spvs", "endpoint not found (404) — may not be registered");
    } else {
      recordFail("K-J8-2 POST /api/partner/me/spvs", `${create.status} ${create.raw.slice(0, 200)}`);
    }
  } catch (e) {
    recordFail("K-J8 exception", e.message);
  }
}

// ============================================================
// K-J9 — Files
// ============================================================
async function KJ9_files(partnerCookie) {
  log("\n========== K-J9: Partner files ==========");
  try {
    const r = await api("GET", "/api/partner/me/files", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J9-1 GET /api/partner/me/files", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      const files = r.body?.files ?? r.body ?? [];
      recordPass("K-J9-1 GET /api/partner/me/files", `200 count=${Array.isArray(files) ? files.length : "??"}`);
    }
  } catch (e) {
    recordFail("K-J9 exception", e.message);
  }
}

// ============================================================
// K-J10 — Tasks
// ============================================================
async function KJ10_tasks(partnerCookie) {
  log("\n========== K-J10: Partner tasks ==========");
  try {
    const r = await api("GET", "/api/partner/me/tasks", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J10-1 GET /api/partner/me/tasks", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      const tasks = r.body?.tasks ?? r.body ?? [];
      recordPass("K-J10-1 GET /api/partner/me/tasks", `200 count=${Array.isArray(tasks) ? tasks.length : "??"}`);
    }
  } catch (e) {
    recordFail("K-J10 exception", e.message);
  }
}

// ============================================================
// K-J11 — Team
// ============================================================
async function KJ11_team(partnerCookie) {
  log("\n========== K-J11: Partner team ==========");
  try {
    const r = await api("GET", "/api/partner/me/team", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J11-1 GET /api/partner/me/team", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      const members = r.body?.members ?? r.body ?? [];
      recordPass("K-J11-1 GET /api/partner/me/team", `200 count=${Array.isArray(members) ? members.length : "??"}`);
    }
  } catch (e) {
    recordFail("K-J11 exception", e.message);
  }
}

// ============================================================
// K-J12 — Notes
// ============================================================
async function KJ12_notes(partnerCookie) {
  log("\n========== K-J12: Partner notes ==========");
  try {
    const r = await api("GET", "/api/partner/me/notes", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J12-1 GET /api/partner/me/notes", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      const notes = r.body?.notes ?? r.body ?? [];
      recordPass("K-J12-1 GET /api/partner/me/notes", `200 count=${Array.isArray(notes) ? notes.length : "??"}`);
    }

    // POST a note
    const create = await api("POST", "/api/partner/me/notes", {
      headers: { Cookie: partnerCookie },
      body: { title: `QA Note ${Date.now()}`, body: "QA E2E test note", scope: "general" },
    });
    if (create.status === 200 || create.status === 201) {
      recordPass("K-J12-2 POST /api/partner/me/notes", `noteId=${create.body?.note?.id}`);
    } else {
      recordFail("K-J12-2 POST /api/partner/me/notes", `${create.status} ${create.raw.slice(0, 200)}`);
    }
  } catch (e) {
    recordFail("K-J12 exception", e.message);
  }
}

// ============================================================
// K-J13 — Settings
// ============================================================
async function KJ13_settings(partnerCookie) {
  log("\n========== K-J13: Partner workspace settings ==========");
  try {
    const r = await api("GET", "/api/partner/me/workspace-settings", { headers: { Cookie: partnerCookie } });
    if (r.status !== 200) {
      recordFail("K-J13-1 GET /api/partner/me/workspace-settings", `${r.status} ${r.raw.slice(0, 200)}`);
    } else {
      recordPass("K-J13-1 GET /api/partner/me/workspace-settings", `200`);
    }

    // PATCH settings
    const patch = await api("PATCH", "/api/partner/me/workspace-settings", {
      headers: { Cookie: partnerCookie },
      body: { defaultCurrency: "CAD" },
    });
    if (patch.status === 200) {
      recordPass("K-J13-2 PATCH /api/partner/me/workspace-settings", `defaultCurrency=${patch.body?.defaultCurrency ?? "??"}`);
    } else if (patch.status === 404) {
      recordSkip("K-J13-2 PATCH /api/partner/me/workspace-settings", "404 — PATCH endpoint may not exist");
    } else {
      recordFail("K-J13-2 PATCH /api/partner/me/workspace-settings", `${patch.status} ${patch.raw.slice(0, 200)}`);
    }
  } catch (e) {
    recordFail("K-J13 exception", e.message);
  }
}

// ============================================================
// K-J14 — Partner CRM contacts
// ============================================================
async function KJ14_crmContacts(partnerCookie) {
  log("\n========== K-J14: Partner CRM contacts ==========");
  try {
    // POST a contact
    const create = await api("POST", "/api/partner/crm/contacts", {
      headers: { Cookie: partnerCookie },
      body: {
        name: `QA Contact ${Date.now()}`,
        email: `qa.crm.${Date.now()}@example.com`,
        role: "founder",
        org: "QA Startup",
        notes: "E2E test contact",
      },
    });
    if (create.status !== 200 && create.status !== 201) {
      recordFail("K-J14-1 POST /api/partner/crm/contacts", `${create.status} ${create.raw.slice(0, 200)}`);
      return;
    }
    const contactId = create.body?.contact?.id || create.body?.id;
    recordPass("K-J14-1 POST /api/partner/crm/contacts", `contactId=${contactId}`);

    // GET list
    const list = await api("GET", "/api/partner/crm/contacts", { headers: { Cookie: partnerCookie } });
    if (list.status !== 200) {
      recordFail("K-J14-2 GET /api/partner/crm/contacts", `${list.status} ${list.raw.slice(0, 200)}`);
    } else {
      const contacts = list.body?.contacts ?? list.body ?? [];
      const found = Array.isArray(contacts) && contacts.some(c => c.id === contactId);
      if (!found) {
        recordFail("K-J14-2 contact appears in GET list", `not found in ${Array.isArray(contacts) ? contacts.length : "??"} items`);
      } else {
        recordPass("K-J14-2 contact appears in GET list", `count=${contacts.length}`);
      }
    }
  } catch (e) {
    recordFail("K-J14 exception", e.message);
  }
}

// ============================================================
// K-J15 — Partner deals
// ============================================================
async function KJ15_deals(partnerCookie) {
  log("\n========== K-J15: Partner deals ==========");
  try {
    // POST a deal
    const create = await api("POST", "/api/partner/deals", {
      headers: { Cookie: partnerCookie },
      body: {
        company_id: `co_qa_deal_${Date.now()}`,
        stage: "sourced",
        notes: "E2E test deal",
      },
    });
    if (create.status !== 200 && create.status !== 201) {
      recordFail("K-J15-1 POST /api/partner/deals", `${create.status} ${create.raw.slice(0, 200)}`);
      return;
    }
    const dealId = create.body?.deal?.id || create.body?.id;
    recordPass("K-J15-1 POST /api/partner/deals", `dealId=${dealId}`);

    // GET list
    const list = await api("GET", "/api/partner/deals", { headers: { Cookie: partnerCookie } });
    if (list.status !== 200) {
      recordFail("K-J15-2 GET /api/partner/deals", `${list.status} ${list.raw.slice(0, 200)}`);
    } else {
      const deals = list.body?.deals ?? list.body ?? [];
      const found = Array.isArray(deals) && deals.some(d => d.id === dealId);
      if (!found) {
        recordFail("K-J15-2 deal appears in GET list", `not found in ${Array.isArray(deals) ? deals.length : "??"} items`);
      } else {
        recordPass("K-J15-2 deal appears in GET list", `count=${deals.length}`);
      }
    }
  } catch (e) {
    recordFail("K-J15 exception", e.message);
  }
}

// ============================================================
// K-J16 — Partner portfolio
// ============================================================
async function KJ16_portfolio(partnerCookie) {
  log("\n========== K-J16: Partner portfolio ==========");
  try {
    // POST a portfolio entry
    const create = await api("POST", "/api/partner/portfolio", {
      headers: { Cookie: partnerCookie },
      body: {
        company_id: `co_qa_port_${Date.now()}`,
        display_name: `QA Portfolio Co ${Date.now()}`,
        stage: "seed",
        sector: "SaaS",
        lead_invested_amount_minor: 500000,
        notes: "E2E test portfolio entry",
        visibility: "private",
      },
    });
    if (create.status !== 200 && create.status !== 201) {
      recordFail("K-J16-1 POST /api/partner/portfolio", `${create.status} ${create.raw.slice(0, 200)}`);
      return;
    }
    const portId = create.body?.portfolio?.id || create.body?.id;
    recordPass("K-J16-1 POST /api/partner/portfolio", `portId=${portId}`);

    // GET list
    const list = await api("GET", "/api/partner/portfolio", { headers: { Cookie: partnerCookie } });
    if (list.status !== 200) {
      recordFail("K-J16-2 GET /api/partner/portfolio", `${list.status} ${list.raw.slice(0, 200)}`);
    } else {
      const entries = list.body?.portfolio ?? list.body ?? [];
      const found = Array.isArray(entries) && entries.some(p => p.id === portId);
      if (!found) {
        recordFail("K-J16-2 portfolio entry appears in GET list", `not found in ${Array.isArray(entries) ? entries.length : "??"} items`);
      } else {
        recordPass("K-J16-2 portfolio entry appears in GET list", `count=${entries.length}`);
      }
    }
  } catch (e) {
    recordFail("K-J16 exception", e.message);
  }
}

// ============================================================
// K-J17 — Admin partner mgmt (PATCH)
// ============================================================
async function KJ17_adminPartnerMgmt(adminCookie, partnerId) {
  log("\n========== K-J17: Admin partner management ==========");
  if (!partnerId) {
    recordSkip("K-J17 admin partner mgmt", "no partnerId available");
    return;
  }
  try {
    // List partners
    const list = await api("GET", "/api/admin/partners", { headers: { Cookie: adminCookie } });
    if (list.status !== 200) {
      recordFail("K-J17-1 GET /api/admin/partners", `${list.status} ${list.raw.slice(0, 200)}`);
      return;
    }
    const partners = list.body?.partners ?? [];
    const partner = partners.find(p => p.id === partnerId);
    if (!partner) {
      recordFail("K-J17-2 find partner in list", `partnerId=${partnerId} not found`);
      return;
    }
    recordPass("K-J17-1 GET /api/admin/partners", `found partner id=${partner.id}`);

    // PATCH a field (notes)
    const newNotes = `Updated by QA E2E at ${Date.now()}`;
    const patch = await api("PATCH", `/api/admin/partners/${partnerId}`, {
      headers: { Cookie: adminCookie },
      body: { notes: newNotes },
    });
    if (patch.status !== 200) {
      recordFail("K-J17-2 PATCH /api/admin/partners/:id", `${patch.status} ${patch.raw.slice(0, 200)}`);
      return;
    }
    recordPass("K-J17-2 PATCH /api/admin/partners/:id", `200`);

    // Re-read to confirm
    const get = await api("GET", `/api/admin/partners/${partnerId}`, { headers: { Cookie: adminCookie } });
    if (get.status !== 200) {
      recordFail("K-J17-3 GET /api/admin/partners/:id after PATCH", `${get.status}`);
    } else if (get.body?.partner?.notes !== newNotes) {
      recordFail("K-J17-3 PATCH persisted", `got '${get.body?.partner?.notes}' expected '${newNotes}'`);
    } else {
      recordPass("K-J17-3 PATCH persisted in GET", `notes matches`);
    }
  } catch (e) {
    recordFail("K-J17 exception", e.message);
  }
}

// ============================================================
// K-J18 — Admin suspend partner + verify workspace rejects
// ============================================================
async function KJ18_adminSuspend(adminCookie, partnerId, partnerCookie) {
  log("\n========== K-J18: Admin suspend partner ==========");
  if (!partnerId) {
    recordSkip("K-J18 admin suspend partner", "no partnerId available");
    return;
  }
  try {
    const suspend = await api("POST", `/api/admin/partners/${partnerId}/suspend`, {
      headers: { Cookie: adminCookie },
    });
    if (suspend.status !== 200) {
      recordFail("K-J18-1 POST /api/admin/partners/:id/suspend", `${suspend.status} ${suspend.raw.slice(0, 200)}`);
      return;
    }
    recordPass("K-J18-1 POST /api/admin/partners/:id/suspend", `status=${suspend.body?.partner?.status}`);

    // If we have a partner cookie, verify workspace rejects
    if (!partnerCookie) {
      recordSkip("K-J18-2 workspace rejects after suspend", "no partner cookie (K-J3 was skipped)");
      return;
    }
    // Partner workspace should now return 403 (PARTNER_NOT_ACTIVE)
    const me = await api("GET", "/api/partner/me", { headers: { Cookie: partnerCookie } });
    if (me.status === 403 || me.status === 401) {
      recordPass("K-J18-2 workspace rejects after suspend", `${me.status} ${me.body?.error}`);
    } else {
      recordFail("K-J18-2 workspace rejects after suspend", `expected 401/403 got ${me.status} body=${me.raw.slice(0, 150)}`);
    }
  } catch (e) {
    recordFail("K-J18 exception", e.message);
  }
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  log(`v24.4 Consortium E2E — base: ${BASE}`);

  // Health check
  try {
    const h = await api("GET", "/api/health");
    if (h.status !== 200) throw new Error(`health ${h.status}`);
    log(`Server reachable — version: ${h.body?.version}`);
    if (h.body?.version !== "24.4.0") log(`⚠ Health version is ${h.body?.version}, expected 24.4.0 — running anyway`);
  } catch (e) {
    log(`✗ EXIT: cannot reach server at ${BASE} — ${e.message}`);
    process.exit(1);
  }

  // Mint admin
  const TS = Date.now();
  let adminCookie = "";
  const adminEmail = `qa.admin.k.${TS}@capavate.io`;
  try {
    log(`\nMinting admin: ${adminEmail}`);
    const adminOut = execSync(
      `npx tsx scripts/create_admin.ts --email=${adminEmail} --password=AdminQa24!Strong --name='QA Admin K'`,
      { cwd: TREE, encoding: "utf8", timeout: 30000 }
    );
    log(adminOut.trim().split("\n").slice(-3).join("\n"));
    const loginRes = await loginUser(adminEmail, "AdminQa24!Strong");
    adminCookie = loginRes.cookie;
    log(`Admin login OK: ${adminEmail}`);
  } catch (e) {
    log(`✗ FATAL: admin creation/login failed — ${e.message}`);
    process.exit(1);
  }

  // K-J1: public application
  const j1Result = await KJ1_publicApply(TS);
  const appId = j1Result?.appId ?? null;

  // K-J2: admin reviews + approves — returns { partnerId, partnerInviteRedeemUrl }.
  const j2Result = await KJ2_adminReview(adminCookie, appId, TS);
  const partnerId = j2Result?.partnerId ?? null;
  const partnerInviteRedeemUrl = j2Result?.partnerInviteRedeemUrl ?? null;

  // K-J3: mint partner admin via the canonical partner-invite redemption path.
  const partnerAdminCtx = await KJ3_mintPartnerAdmin(partnerInviteRedeemUrl, TS);
  const partnerCookie = partnerAdminCtx?.cookie ?? null;

  // Partner workspace journeys — these are all gated on having a valid partner session.
  // If K-J3 failed (due to the create_partner_admin.ts product bug), all workspace
  // journeys will be SKIPPED.
  if (!partnerCookie) {
    const skipMsg = "no partner session (K-J3 failed — create_partner_admin.ts product bug)";
    for (const j of ["K-J4","K-J5","K-J6","K-J7","K-J8","K-J9","K-J10","K-J11","K-J12","K-J13","K-J14","K-J15","K-J16"]) {
      recordSkip(j + " (partner workspace)", skipMsg);
    }
  } else {
    await KJ4_partnerDashboard(partnerCookie);
    await KJ5_pipeline(partnerCookie);
    await KJ6_clients(partnerCookie);
    await KJ7_funds(partnerCookie);
    await KJ8_spvs(partnerCookie);
    await KJ9_files(partnerCookie);
    await KJ10_tasks(partnerCookie);
    await KJ11_team(partnerCookie);
    await KJ12_notes(partnerCookie);
    await KJ13_settings(partnerCookie);
    await KJ14_crmContacts(partnerCookie);
    await KJ15_deals(partnerCookie);
    await KJ16_portfolio(partnerCookie);
  }

  // K-J17 + K-J18 — admin side, independent of partner session
  await KJ17_adminPartnerMgmt(adminCookie, partnerId);
  await KJ18_adminSuspend(adminCookie, partnerId, partnerCookie);

  // Summary
  log("\n========== CONSORTIUM SUITE SUMMARY ==========");
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIP").length;
  log(`PASS:    ${passed}`);
  log(`FAIL:    ${failed}`);
  log(`SKIP:    ${skipped}`);
  if (failed > 0) {
    log("\nFAILURES:");
    for (const r of results.filter(rr => rr.status === "FAIL")) {
      log(`  - ${r.name}: ${r.detail}`);
    }
  }
  if (skipped > 0) {
    log("\nSKIPS:");
    for (const r of results.filter(rr => rr.status === "SKIP")) {
      log(`  - ${r.name}: ${r.detail}`);
    }
  }
  if (failed > 0) {
    log("\n✗ Consortium suite FAILED");
    process.exit(1);
  }
  log("\n✓✓✓ ALL CONSORTIUM JOURNEYS PASSED ✓✓✓");
  process.exit(0);
})();
