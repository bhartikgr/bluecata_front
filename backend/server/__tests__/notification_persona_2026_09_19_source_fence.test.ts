/* ════════════════════════════════════════════════════════════════════════════
   2026-09-19 · SLIDE 13a — SOURCE FENCES (measured against the tree, not typed in).
   ════════════════════════════════════════════════════════════════════════════
   Each fence below is a MEASUREMENT of the source tree:
     · frozen files are byte-identical to the pre-edit fingerprint;
     · the persona facade is registered BEFORE the frozen notification routes;
     · no production module outside the frozen store imports the frozen RAM
       readers (`listNotifications` / `unreadCount`) — addendum §9;
     · no notification client hands a stored link to the router unexamined
       (`navigate(x.link)`), and nothing classifies by kind prefix;
     · every server-side notification `link:` literal is either a mounted client
       route pattern (client/src/App.tsx), the audited protected-document
       contract, or a DOCUMENTED known-unrouted entry (each with a reason);
     · the approved copy is present verbatim and the retired copy is gone.
   Every absence proof is paired with a presence proof using the SAME instrument
   so a broken instrument cannot pass as a proof of absence.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const REPO = path.resolve(__dirname, "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const sha256 = (rel: string): string => crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO, rel))).digest("hex");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = (abs: string) => path.relative(REPO, abs).split(path.sep).join("/");

/* ───────────────────────────── frozen files ─────────────────────────────── */

describe("frozen files are byte-identical to the pre-edit fingerprint", () => {
  const FROZEN: Record<string, string> = {
    "server/notificationsStore.ts": "141d7265a526f690a07388d9c39da0656966c4240b469298098e8d0bf57fde67",
    "server/lib/userContext.ts": "63d90f5f01d808abb783c6c3114c7639deaaf7dc8018f2fd774344ec78d32aa8",
    "server/lib/rateLimit.ts": "0c2f117299ea503b31356da2f9267f8bd9577345c7d718ad646ebf74b92bccfc",
    "server/paymentGatewayAdapter.ts": "7b5159047803610592ffb4fe32eee18c9261ae027f990073a1131a7a5f980372",
    "server/db/connection.ts": "8a73c3d194c20ceaec2c4c9057bfecc29c78e2b142c295999d8afc63defdeef0",
  };
  for (const [f, h] of Object.entries(FROZEN)) {
    it(`${f} = ${h.slice(0, 12)}…`, () => {
      expect(sha256(f)).toBe(h);
    });
  }
});

/* ───────────────────────────── registration order ──────────────────────── */

describe("server/routes.ts — facade registered before the frozen routes", () => {
  it("registerPersonaNotificationRoutes(app) precedes registerNotificationsRoutes(app), each exactly once", () => {
    const src = read("server/routes.ts");
    const calls = [...src.matchAll(/^\s*register(PersonaNotification|Notifications)Routes\(app\);/gm)].map((m) => m[1]);
    expect(calls).toEqual(["PersonaNotification", "Notifications"]);
  });
  it("the frozen RAM readers are imported by NO production module other than the frozen store (addendum §9)", () => {
    const files = walk(path.join(REPO, "server"));
    const importers = files.filter((f) => {
      const s = fs.readFileSync(f, "utf8");
      return /import\s*\{[^}]*\b(listNotifications|unreadCount)\b[^}]*\}\s*from\s*["'][^"']*notificationsStore["']/.test(s);
    }).map(rel);
    expect(importers).toEqual([]);
    // presence proof for the instrument: the frozen store itself exports them
    expect(read("server/notificationsStore.ts")).toMatch(/export function listNotifications\(/);
    expect(read("server/notificationsStore.ts")).toMatch(/export function unreadCount\(/);
  });
});

/* ────────────────────── client: no stored-link navigation ──────────────── */

describe("client — no notification consumer routes a stored link unexamined", () => {
  const CLIENT_FILES = walk(path.join(REPO, "client", "src"));
  const NAV_STORED_LINK = /\bnavigate\(\s*[A-Za-z_$][\w$]*\.link\s*\)/;
  const HREF_STORED_LINK = /href=\{\s*[A-Za-z_$][\w$]*\.link\s*\}/;
  it("`navigate(x.link)` / `href={x.link}` appear in NO client source file", () => {
    const hits = CLIENT_FILES.filter((f) => {
      const s = fs.readFileSync(f, "utf8");
      // strip block and line comments so the historical explanation in
      // notificationNavigate.ts is not mistaken for code
      const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      return NAV_STORED_LINK.test(code) || HREF_STORED_LINK.test(code);
    }).map(rel);
    expect(hits).toEqual([]);
    // presence proof: the instrument matches the retired shape
    expect(NAV_STORED_LINK.test("onClick={() => navigate(n.link)}")).toBe(true);
    expect(HREF_STORED_LINK.test("<a href={n.link}>")).toBe(true);
  });
  it("every notification consumer goes through the shared classifier / navigation helper", () => {
    for (const f of ["client/src/components/NotificationBell.tsx", "client/src/pages/NotificationCenter.tsx", "client/src/pages/investor/Notifications.tsx"]) {
      const s = read(f);
      expect(s, f).toMatch(/performNotificationNavigation/);
      expect(s, f).toMatch(/useNotifications/);
    }
    expect(read("client/src/lib/notificationNavigate.ts")).toMatch(/classifyNotificationDestination\(row\.link, row\.kind\)/);
  });
  it("nothing classifies a notification by KIND PREFIX (`kind.startsWith(\"partner.\")` etc.)", () => {
    const re = /\bkind\??\.startsWith\(\s*["'`](partner|collective|founder|investor|admin)\./;
    const all = [...CLIENT_FILES, ...walk(path.join(REPO, "server")), ...walk(path.join(REPO, "shared"))];
    const hits = all.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
    expect(re.test(`if (n.kind.startsWith("partner.")) surface = "partner"`)).toBe(true);
  });
  it("the shells mount the bell with an explicit route-derived surface (no role-provider guess)", () => {
    const appShell = read("client/src/components/AppShell.tsx");
    const collectiveShell = read("client/src/components/CollectiveShell.tsx");
    expect(appShell).toMatch(/<NotificationBell surface=\{bellSurface\} \/>/);
    expect((appShell.match(/<NotificationBell\b/g) ?? []).length).toBe(1);
    expect(collectiveShell).toMatch(/<NotificationBell[^>]*surface=\{bellSurface\}[^>]*viewAllHref=\{bellViewAllHref\}|<NotificationBell[^>]*viewAllHref=\{bellViewAllHref\}[^>]*surface=\{bellSurface\}/);
    const bellCode = read("client/src/components/NotificationBell.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(bellCode).not.toMatch(/useRole/);
  });
});

/* ──────────────── server link literals vs mounted client routes ────────── */

/** Known-unrouted server link literals. Each entry is an OWNER-VISIBLE fact, not a suppression. */
const KNOWN_UNROUTED: Array<{ literal: string; file: string; reason: string }> = [
  {
    literal: "/rounds/${roundId}/updates/${updateId}",
    file: "server/track1Routes.ts",
    reason: "PRE-EXISTING. Round-update notice links to an unmounted path (no /rounds/* route in App.tsx). Retained by the classifier as `unknown_path` (account history, 'Workspace not identified'); repointing it is a producer decision for the owner (candidate: /investor/companies/:companyId or /founder/rounds/:id).",
  },
  /* ── PRE-EXISTING unrouted producers, MEASURED by this fence on 2026-09-19 and
        NOT changed in this wave (source declared stable for review; each repoint is
        an owner/producer decision). CORRECTED 2026-09-19 (parent audit): the
        app's Switch fallback renders a BARE 404 outside every shell, so these
        shell-prefixed-but-unmounted links would strip the persona's navigation.
        The classifier therefore classifies MOUNTED ROUTES ONLY (generated manifest
        shared/notificationRouteManifest.ts): these rows are `unknown_path`,
        retained in account history ("Workspace not identified"), readable, no
        navigation action, and NOT listed in any persona workspace. Nearest
        mounted candidates are noted for the owner. ── */
  { literal: "/collective/apply", file: "server/adminCollectiveRoutes.ts", reason: "PRE-EXISTING unrouted (collective shell). Mounted candidates: /collective/syndicate/apply, /apply/consortium, /founder/apply-to-collective." },
  { literal: "/collective/dsc", file: "server/adminDscRoutes.ts", reason: "PRE-EXISTING unrouted (collective shell). Mounted candidates: /collective/dsc/pipeline, /collective/dsc/scores, /collective/dsc/prep." },
  { literal: "/collective/resources/${id}", file: "server/chapterResourcesStore.ts", reason: "PRE-EXISTING unrouted (collective shell). No /collective/resources route is mounted in App.tsx." },
  { literal: "/founder/collective/interest/${thread.id}", file: "server/collectiveInterestStore.ts", reason: "PRE-EXISTING unrouted (founder shell). Mounted candidate: /founder/collective." },
  { literal: "/collective/portfolio/${portfolio.id}", file: "server/partnerWorkspaceV19Store.ts", reason: "PRE-EXISTING unrouted (collective shell). Mounted candidates: /collective/me/portfolio, /collective/partner/portfolio." },
  { literal: "/investor/reports/${r.id}", file: "server/reportsStore.ts", reason: "PRE-EXISTING unrouted (investor shell). No /investor/reports route is mounted (founder has /founder/reports)." },
  {
    literal: "https://capavate.com/auth/redeem?token=… (a secure link is generated when you send)",
    file: "server/routes.ts",
    reason: "NOT a notification link: an email-preview placeholder string in an invitation template payload (`link:` key of a preview object), never passed to emitNotification.",
  },
];

/** wouter pattern → matcher for a server literal whose `${…}` segments are params. */
function routeMatches(pattern: string, literalPath: string): boolean {
  const p = pattern.split("/");
  const l = literalPath.split("/");
  const rest = p[p.length - 1]?.endsWith("*");
  if (!rest && p.length !== l.length) return false;
  if (rest && l.length < p.length - 1) return false;
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.endsWith("*")) return true;
    if (seg.startsWith(":")) { if (!l[i]) return false; continue; }
    if (seg !== l[i]) return false;
  }
  return true;
}

describe("server `link:` literals resolve to mounted client routes (or are documented)", () => {
  const appSrc = read("client/src/App.tsx");
  const ROUTES = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  const SERVER_FILES = walk(path.join(REPO, "server"));
  const LINK_LITERAL = /\blink:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g;

  const literals: Array<{ file: string; raw: string }> = [];
  for (const f of SERVER_FILES) {
    const r = rel(f);
    if (r === "server/notificationPersonaRoutes.ts") continue; // consumer, not producer
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(LINK_LITERAL)) literals.push({ file: r, raw: m[2] });
  }

  it("the instrument sees the producers we know about (presence proof)", () => {
    expect(ROUTES.length).toBeGreaterThan(200);
    expect(ROUTES).toContain("/collective/partner/pipeline");
    expect(ROUTES).toContain("/collective/partner/notifications");
    expect(ROUTES).toContain("/admin/inbox");
    expect(ROUTES).toContain("/partner/pipeline"); // legacy bookmark alias (redirect)
    const raws = literals.map((x) => x.raw);
    expect(raws).toContain("/collective/partner/pipeline");
    expect(raws).toContain("/api/public/data-room/files/${fileId}?grant=${token}");
    expect(literals.some((x) => x.file === "server/promotionModerationRoutes.ts" && x.raw === "/collective/partner/pipeline")).toBe(true);
  });

  it("no server literal is the retired `/partner/pipeline` (the live defect's producer is repointed)", () => {
    const hits = literals.filter((x) => x.raw === "/partner/pipeline" || x.raw.startsWith("/partner/pipeline?"));
    expect(hits).toEqual([]);
  });

  it("every literal is a mounted route pattern, the protected-document contract, or a documented known-unrouted entry", () => {
    const unresolved: string[] = [];
    for (const { file, raw } of literals) {
      if (raw.startsWith("/api/public/data-room/files/")) continue; // audited document contract (classifier: kind-bound)
      const pathOnly = raw.split(/[?#]/)[0];
      // template placeholders behave as one path segment each
      const asPath = pathOnly.replace(/\$\{[^}]*\}/g, "__P__");
      const known = KNOWN_UNROUTED.find((k) => k.literal === raw && k.file === file);
      if (known) continue;
      if (!ROUTES.some((p) => routeMatches(p, asPath))) unresolved.push(`${file} :: ${raw}`);
    }
    expect(unresolved).toEqual([]);
  });

  it("every KNOWN_UNROUTED entry still exists (a stale entry is dead weight) and is really unrouted", () => {
    for (const k of KNOWN_UNROUTED) {
      expect(literals.some((x) => x.file === k.file && x.raw === k.literal), `${k.file} :: ${k.literal}`).toBe(true);
      if (k.literal.startsWith("/")) {
        const asPath = k.literal.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, "__P__");
        expect(ROUTES.some((p) => routeMatches(p, asPath)), `${k.literal} should NOT be routed (else prune the entry)`).toBe(false);
      }
    }
  });

  it("BOTH post producers (immediate + scheduled) use the shared recipient+channel resolver; every branch is a mounted route", () => {
    for (const p of ["/collective/partner/posts/x1", "/founder/posts/x1", "/investor/posts/x1"]) {
      expect(ROUTES.some((r) => routeMatches(r, p)), p).toBe(true);
    }
    const comms = read("server/commsStore.ts");
    expect(comms).toMatch(/link: postDestinationForRecipient\(uid, post, ch\)\.href/);
    expect(comms).toMatch(/link: postDestinationForRecipient\(uid, p, ch\)\.href/);
    expect(comms).not.toMatch(/postsPathForUser/);
    expect(comms).not.toMatch(/link: `\/posts\//);
    expect(comms).not.toMatch(/link: `\/\$\{[^}]*isFounder[^}]*\}\/posts\//);
    // the resolver never invents a persona: its only fallback is a no-link account-history notice
    expect(comms).toMatch(/basis: "unresolved_no_link"/);
    expect(comms).not.toMatch(/unresolved_default_investor/);
  });
});

/* ───────────────────────────────── copy ────────────────────────────────── */

describe("approved copy present verbatim; retired copy gone", () => {
  it("PartnerManagedFounders — tile + disclosure + on-behalf paragraph", () => {
    const s = read("client/src/pages/partner/PartnerManagedFounders.tsx");
    expect(s).toContain("Pending sharing requests");
    expect(s).toContain("Requests recorded for vehicles created on a founder’s behalf. Pending requests have not been shared with the Collective and do not give investors access.");
    expect(s).toContain('Creates a vehicle for this founder and records your action.{" "}');
    expect(s).toContain("Creating the vehicle does not publish it to the Collective or give investors access.");
    expect(s).not.toMatch(/>\s*Queued pushes\s*</);
    expect(s).toMatch(/dashQ\.data\.queuedPushes/); // counter retained
  });
  it("NotificationCenter — no 'Real-time updates via SSE'; plain auto-refresh statement", () => {
    const s = read("client/src/pages/NotificationCenter.tsx");
    expect(s).not.toContain("Real-time updates via SSE");
    expect(s).toContain("Refreshes automatically; preferences in Settings.");
    expect(s).toContain("Workspace not identified");
  });
  it("Collective shell — partner nav and view-all point at the partner inbox; member inbox unchanged", () => {
    const s = read("client/src/components/CollectiveShell.tsx");
    expect(s).toContain('PARTNER_NOTIFICATIONS_HREF = "/collective/partner/notifications"');
    expect(s).toContain('"/collective/notifications"');
  });
  it("App.tsx — persona inboxes mounted; legacy bookmark redirect; campaign page untouched", () => {
    const s = read("client/src/App.tsx");
    expect(s).toMatch(/<Route path="\/collective\/partner\/notifications">/);
    expect(s).toMatch(/<Route path="\/admin\/inbox">/);
    expect(s).toMatch(/<Route path="\/partner\/pipeline">/);
    expect(s).toMatch(/LegacyPartnerPipelineRedirect/);
    expect(s).toMatch(/<Route path="\/admin\/notifications">/);
  });
});
