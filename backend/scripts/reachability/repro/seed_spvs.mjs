/* WAVE 40 — seed international SPVs into the local repro server via the REAL
 * HTTP API (no direct DB writes), so the browser probe exercises the same
 * write path production uses. Covers a BVI vehicle, a CAD-denominated vehicle
 * and a JPY (exponent 0) vehicle. */
const BASE = process.env.BASE || "http://localhost:5199";
const EMAIL = process.env.W40_EMAIL;
const PASSWORD = process.env.W40_PASSWORD;

const login = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
console.log("login", login.status, cookie.slice(0, 60));

const H = { "content-type": "application/json", cookie };

const sign = await fetch(BASE + "/api/partner/me/agreement", {
  method: "POST",
  headers: H,
  body: JSON.stringify({ signatureName: "W40 Probe Signer" }),
});
console.log("agreement", sign.status, (await sign.text()).slice(0, 160));

const spvs = [
  { name: "W40 Asian Biotech BVI", jurisdiction: "bvi", carryBasis: "whole_spv", currency: "USD", targetRaiseMinor: 500000000, jurisdictionCountry: "British Virgin Islands" },
  { name: "W40 Maple Growth CAD", jurisdiction: "canadian_lp", carryBasis: "per_deployment", currency: "CAD", targetRaiseMinor: 120000, jurisdictionCountry: "Canada" },
  { name: "W40 Tokyo Yen Fund", jurisdiction: "other", carryBasis: "whole_spv", currency: "JPY", targetRaiseMinor: 5000000, jurisdictionCountry: "Japan" },
  { name: "W40 Cayman Master", jurisdiction: "cayman", carryBasis: "whole_spv", currency: "USD", targetRaiseMinor: 2500000, jurisdictionCountry: "Cayman Islands" },
];

for (const s of spvs) {
  const body = {
    ...s,
    spvType: "spv",
    signoffLegalName: "W40 Probe Signer",
    signoffAccepted: true,
    terms: { vintage: 2026, jurisdictionCountry: s.jurisdictionCountry },
  };
  const r = await fetch(BASE + "/api/partner/me/spv", { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  console.log(s.name, r.status, t.slice(0, 300));
}

const list = await fetch(BASE + "/api/partner/me/spv", { headers: H });
const j = await list.json();
console.log("LIST", (j.spvs || []).map((x) => [x.id, x.name, x.jurisdiction, x.currency, x.terms?.jurisdictionCountry]));
