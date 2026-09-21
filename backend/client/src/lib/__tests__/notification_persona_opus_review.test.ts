/**
 * INDEPENDENT POST-BUILD REVIEW TESTS — persona notifications (slide 13a).
 *
 * Written by the independent reviewer (Opus), not the builder. This file is
 * additive and touches no product source, config, baseline or guard. It proves
 * behaviour by (a) executing the shared classifier and the real react-query
 * key/invalidation semantics, and (b) asserting the ACTUAL MOUNTED CONSUMERS in
 * source — bell, both inbox pages, both shells and App.tsx route table — so a
 * correct helper cannot pass while the mounted screens still do the old thing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import {
  classifyNotificationDestination,
  notificationMatchesSurface,
  isSafeAppPath,
  surfaceForPathname,
  inboxHrefForSurface,
  LEGACY_LINK_ALIASES,
  DATA_ROOM_GRANT_KIND,
  NOTIFICATION_SURFACES,
} from "@shared/notificationDestination";
import { notificationsQueryKey, NOTIFICATIONS_QUERY_ROOT } from "@/lib/useNotifications";
import { planNotificationNavigation } from "@/lib/notificationNavigate";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Copy assertions must judge what a CUSTOMER can read, so block comments, line
 * comments and `data-testid` / identifier strings are stripped first. Asserting
 * against raw source would fail on an engineering comment that explains the
 * repair, which is the opposite of the intent.
 */
function renderedText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/data-testid=\{?"[^"]*"\}?/g, " ")
    .replace(/data-testid=\{`[^`]*`\}/g, " ");
}

const APP = read("client/src/App.tsx");
const BELL = read("client/src/components/NotificationBell.tsx");
const CENTER = read("client/src/pages/NotificationCenter.tsx");
const INVESTOR_INBOX = read("client/src/pages/investor/Notifications.tsx");
const COLLECTIVE_SHELL = read("client/src/components/CollectiveShell.tsx");
const APP_SHELL = read("client/src/components/AppShell.tsx");
const REALTIME = read("client/src/lib/realtimeSync.ts");
const COMMS = read("server/commsStore.ts");
const PROMOTION = read("server/promotionModerationRoutes.ts");
const FACADE = read("server/notificationPersonaRoutes.ts");
const SERVER_ROUTES = read("server/routes.ts");
const MANAGED_FOUNDERS = read("client/src/pages/partner/PartnerManagedFounders.tsx");

/** Every `<Route path="…">` literal registered in App.tsx. */
const mountedRoutes: string[] = Array.from(APP.matchAll(/<Route\s+path="([^"]+)"/g)).map((m) => m[1]);

/** Does a concrete path match any mounted wouter pattern (`:param` segments)? */
function isMounted(concrete: string): boolean {
  const target = concrete.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  return mountedRoutes.some((pattern) => {
    const p = pattern.replace(/\/+$/, "") || "/";
    const re = new RegExp(
      "^" +
        p
          .split("/")
          .map((seg) =>
            seg.startsWith(":") ? (seg.endsWith("?") ? "(?:[^/]*)" : "[^/]+") : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/") +
        "$",
    );
    return re.test(target);
  });
}

describe("OPUS-REVIEW · A · classifier behaviour on real stored values", () => {
  it("repairs the exact legacy alias and keeps query + hash", () => {
    const c = classifyNotificationDestination("/partner/pipeline?tab=x#y", "partner.promotion_approved");
    expect(c).toEqual({ class: "surface", surface: "partner", href: "/collective/partner/pipeline?tab=x#y", repairedLegacy: true });
  });

  it("the alias table holds exactly the one audited entry", () => {
    expect(Object.keys(LEGACY_LINK_ALIASES)).toEqual(["/partner/pipeline"]);
  });

  it("the repaired destination is actually mounted in App.tsx", () => {
    const c = classifyNotificationDestination("/partner/pipeline", "partner.promotion_approved");
    expect(c.class).toBe("surface");
    expect(isMounted((c as { href: string }).href)).toBe(true);
  });

  it("canonical producer literals classify to their own workspace", () => {
    const cases: Array<[string, string]> = [
      ["/collective/partner/pipeline", "partner"],
      ["/collective/partner/posts/p_1", "partner"],
      ["/collective/dealroom", "collective"],
      ["/collective", "collective"],
      ["/founder/dashboard", "founder"],
      ["/investor/portfolio", "investor"],
      ["/admin/inbox", "admin"],
    ];
    for (const [link, surface] of cases) {
      const c = classifyNotificationDestination(link, "any.kind");
      expect(c.class, link).toBe("surface");
      expect((c as { surface: string }).surface, link).toBe(surface);
    }
  });

  it("does not use `kind` as an audience signal (partner.* → founder route stays founder)", () => {
    const c = classifyNotificationDestination("/founder/dashboard", "partner.referral_received");
    expect(c).toMatchObject({ class: "surface", surface: "founder" });
  });

  it("refuses every escape shape instead of navigating", () => {
    const hostile = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<b>",
      "//evil.example/x",
      "https://evil.example/x",
      "/\\evil.example/x",
      "/a/../../b",
      "/a/%2e%2e/b",
      "/a%2fb",
      "/user:pw@host",
      "\t/founder/dashboard",
      "/founder/dash board",
      "/founder\n/dashboard",
      "",
      "relative/path",
      "#/founder",
      "/" + "x".repeat(4096),
    ];
    for (const link of hostile) {
      expect(isSafeAppPath(link), link).toBe(false);
      const c = classifyNotificationDestination(link, "any.kind");
      expect(c.class, link).toBe("unclassified");
      expect(planNotificationNavigation({ link, kind: "any.kind" }).action, link).toBe("none");
    }
    // non-strings must not throw
    for (const link of [null, undefined, 42, {}, []] as unknown[]) {
      expect(classifyNotificationDestination(link, "k").class).toBe("unclassified");
    }
  });

  it("no-link rows are retained as `missing`, never guessed", () => {
    for (const kind of ["dataroom.access_revoked", "kyc.status_changed", "investor_report.published", "message.received"]) {
      expect(classifyNotificationDestination(undefined, kind)).toEqual({ class: "unclassified", reason: "missing" });
    }
  });

  it("structurally safe but shell-less paths are retained, not attributed", () => {
    for (const link of ["/rounds/r_1/updates/u_1", "/posts/p_1", "/settings/privacy", "/notifications"]) {
      expect(classifyNotificationDestination(link, "k"), link).toEqual({ class: "unclassified", reason: "unknown_path" });
    }
  });

  it("the audited data-room grant contract survives with a REAL 64-hex token", () => {
    const token = createHash("sha256").update("independent-review").digest("hex"); // 64 hex, same shape as randomBytes(32).toString("hex")
    const link = `/api/public/data-room/files/f_abc123?grant=${token}`;
    const c = classifyNotificationDestination(link, DATA_ROOM_GRANT_KIND);
    expect(c).toMatchObject({ class: "document", href: link });
    const plan = planNotificationNavigation({ link, kind: DATA_ROOM_GRANT_KIND });
    expect(plan).toEqual({ action: "download", href: link });
    // the download href must NOT be a router destination
    expect(isMounted(link)).toBe(false);
  });

  it("the document contract is narrow: wrong kind, extra params or any other /api path do not classify", () => {
    const token = "a".repeat(64);
    expect(classifyNotificationDestination(`/api/public/data-room/files/f_1?grant=${token}`, "partner.promotion_approved").class).toBe("unclassified");
    expect(classifyNotificationDestination(`/api/public/data-room/files/f_1?grant=${token}&x=1`, DATA_ROOM_GRANT_KIND).class).toBe("unclassified");
    expect(classifyNotificationDestination("/api/public/data-room/files/f_1", DATA_ROOM_GRANT_KIND).class).toBe("unclassified");
    expect(classifyNotificationDestination("/api/admin/users", DATA_ROOM_GRANT_KIND).class).toBe("unclassified");
    expect(classifyNotificationDestination(`/api/public/data-room/files/../../secret?grant=${token}`, DATA_ROOM_GRANT_KIND).class).toBe("unclassified");
  });

  /**
   * CORRECTED AT STABLE_3 (reviewer-owned test; the requirement is stricter, not weaker).
   * My earlier assertions encoded the "shell-family" policy, whose premise was FALSE:
   * `/collective/*` is forced bare (App.tsx:468-469 -> :618 -> :1748), so an unmounted
   * descendant renders the bare 404 with NO persona navigation. A shell prefix alone must
   * therefore NOT buy a persona surface — only a mounted route pattern may.
   */
  it("prefix matching cannot bleed across shells, and an unmounted prefixed path is never a surface", () => {
    expect(classifyNotificationDestination("/founderx/dashboard", "k").class).toBe("unclassified");
    // unmounted, despite living under a real shell prefix -> account history only, no action
    for (const p of ["/collective/partnerx/y", "/collective/partner", "/collective/resources/r_1", "/collective/apply", "/founder/collective/interest/t_1", "/investor/definitely-not-mounted"]) {
      const r = classifyNotificationDestination(p, "k");
      expect(r.class, `${p} must not be attributed to a shell`).toBe("unclassified");
      expect((r as { reason: string }).reason, p).toBe("unknown_path");
    }
    // mounted counterparts of the same shells still classify positively
    const mounted: Array<[string, string]> = [
      ["/collective/partner/pipeline", "partner"],
      ["/collective/partner/notifications", "partner"],
      ["/collective/notifications", "collective"],
      ["/founder/posts/p_1", "founder"],
      ["/investor/posts/p_1", "investor"],
      ["/investor/notifications", "investor"],
    ];
    for (const [p, surface] of mounted) {
      const r = classifyNotificationDestination(p, "k");
      expect(r.class, p).toBe("surface");
      expect((r as { surface: string }).surface, p).toBe(surface);
    }
    // malformed percent escapes are refused outright, not partially decoded
    for (const bad of ["/collective/partner/%zz", "/founder/posts/%2", "/investor/notifications?x=%g1"]) {
      expect(classifyNotificationDestination(bad, "k").class, bad).toBe("unclassified");
    }
  });

  it("STABLE_3 · the classifier no longer asserts the false in-shell-404 policy", () => {
    const policy = read("shared/notificationDestination.ts");
    expect(policy).not.toMatch(/navigation intact/);
    expect(policy).not.toMatch(/POLICY — SHELL-FAMILY CLASSIFICATION/);
    expect(policy).toMatch(/MOUNTED-ROUTE CLASSIFICATION/);
    expect(policy).toMatch(/CLIENT_ROUTE_PATTERNS/);
  });

  it("surface scoping: only the owning workspace lists a row; account lists everything", () => {
    const rows = [
      { link: "/collective/partner/pipeline", kind: "partner.promotion_approved" },
      { link: "/founder/dashboard", kind: "partner.referral_received" },
      { link: "/investor/portfolio", kind: "cap_table.broadcast" },
      { link: undefined, kind: "kyc.status_changed" },
      { link: "javascript:alert(1)", kind: "k" },
      { link: `/api/public/data-room/files/f_1?grant=${"b".repeat(64)}`, kind: DATA_ROOM_GRANT_KIND },
    ];
    expect(rows.filter((r) => notificationMatchesSurface(r, "partner")).length).toBe(1);
    expect(rows.filter((r) => notificationMatchesSurface(r, "founder")).length).toBe(1);
    // NOTE (reviewer): the audited grant row is mapped to the INVESTOR surface
    // (DATA_ROOM_GRANT_SURFACE), so investor legitimately sees 2 here.
    expect(rows.filter((r) => notificationMatchesSurface(r, "investor")).length).toBe(2);
    expect(rows.filter((r) => notificationMatchesSurface(r, "collective")).length).toBe(0);
    expect(rows.filter((r) => notificationMatchesSurface(r, "account")).length).toBe(rows.length);
  });

  it("route-derived surface matches the shell families, and every inbox href is mounted", () => {
    expect(surfaceForPathname("/collective/partner/managed-founders")).toBe("partner");
    expect(surfaceForPathname("/collective/dealroom")).toBe("collective");
    expect(surfaceForPathname("/founder/dashboard")).toBe("founder");
    expect(surfaceForPathname("/investor/portfolio")).toBe("investor");
    expect(surfaceForPathname("/admin/inbox")).toBe("admin");
    expect(surfaceForPathname("/notifications")).toBe("account");
    for (const s of NOTIFICATION_SURFACES) {
      expect(isMounted(inboxHrefForSurface(s)), `${s} → ${inboxHrefForSurface(s)}`).toBe(true);
    }
  });
});

describe("OPUS-REVIEW · B · cache keys and the realtime bridge actually invalidate the new views", () => {
  const uid = "usr_review";

  it("the bridge's notification aggregate keys invalidate every mounted notification query", async () => {
    // Keys as the dispatcher would use them: AGGREGATE_TO_KEYS[e.aggregate] → [k]
    const block = /notification:\s*\[([^\]]+)\]/.exec(REALTIME);
    expect(block, "notification aggregate entry present").toBeTruthy();
    const keys = Array.from(block![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    expect(keys).toContain("notifications"); // the new structured root

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const views = [
      notificationsQueryKey(uid, "partner"),
      notificationsQueryKey(uid, "collective", { unreadOnly: true }),
      notificationsQueryKey(uid, "account", { archived: true }),
    ];
    for (const k of views) qc.setQueryData(k, { userId: uid, total: 0, unread: 0, items: [] });
    for (const k of views) expect(qc.getQueryState(k)!.isInvalidated).toBe(false);

    for (const k of keys) await qc.invalidateQueries({ queryKey: [k] });
    for (const k of views) expect(qc.getQueryState(k)!.isInvalidated, JSON.stringify(k)).toBe(true);
    qc.clear();
  });

  it("the legacy URL key alone would NOT have invalidated them (proves the fix was required)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const k = notificationsQueryKey(uid, "partner");
    qc.setQueryData(k, { userId: uid, total: 0, unread: 0, items: [] });
    await qc.invalidateQueries({ queryKey: ["/api/notifications"] });
    expect(qc.getQueryState(k)!.isInvalidated).toBe(false);
    qc.clear();
  });

  it("one user's invalidation does not touch another user's cached views", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mine = notificationsQueryKey(uid, "partner");
    const theirs = notificationsQueryKey("usr_other", "partner");
    qc.setQueryData(mine, { userId: uid, total: 0, unread: 0, items: [] });
    qc.setQueryData(theirs, { userId: "usr_other", total: 0, unread: 0, items: [] });
    await qc.invalidateQueries({ queryKey: [NOTIFICATIONS_QUERY_ROOT, uid] });
    expect(qc.getQueryState(mine)!.isInvalidated).toBe(true);
    expect(qc.getQueryState(theirs)!.isInvalidated).toBe(false);
    qc.clear();
  });

  it("surface and filters are part of the cache identity (no cross-surface reuse)", () => {
    expect(notificationsQueryKey(uid, "partner")).not.toEqual(notificationsQueryKey(uid, "collective"));
    expect(notificationsQueryKey(uid, "partner", { unreadOnly: true })).not.toEqual(notificationsQueryKey(uid, "partner"));
    expect(notificationsQueryKey(uid, "partner", { archived: true })).not.toEqual(notificationsQueryKey(uid, "partner", { archived: false }));
  });
});

describe("OPUS-REVIEW · C · the MOUNTED consumers, not just the helpers", () => {
  it("no client file navigates a raw stored notification link any more", () => {
    for (const [name, src] of [["NotificationBell", BELL], ["NotificationCenter", CENTER], ["InvestorNotifications", INVESTOR_INBOX]] as const) {
      expect(src, name).not.toMatch(/navigate\(\s*n\.link/);
      expect(src, name).toMatch(/performNotificationNavigation/);
    }
  });

  it("no notification consumer exposes a raw link in a DOM attribute (grant tokens)", () => {
    for (const [name, src] of [["NotificationBell", BELL], ["NotificationCenter", CENTER], ["InvestorNotifications", INVESTOR_INBOX]] as const) {
      expect(src, name).not.toMatch(/data-[a-z-]*link\s*=\s*\{[^}]*\.link/);
      expect(src, name).not.toMatch(/href=\{[^}]*n\.link/);
    }
  });

  it("both shells give the bell a route-derived surface (never the founder role default)", () => {
    expect(COLLECTIVE_SHELL).toMatch(/location\.startsWith\("\/collective\/partner"\)\s*\?\s*"partner"\s*:\s*"collective"/);
    expect(COLLECTIVE_SHELL).toMatch(/<NotificationBell[^>]*surface=\{bellSurface\}/);
    expect(APP_SHELL).toMatch(/surfaceForPathname\(location\)/);
    expect(APP_SHELL).toMatch(/<NotificationBell\s+surface=\{bellSurface\}/);
    expect(BELL).toMatch(/surface\s*=\s*"account"/); // explicit default, no role guess
  });

  it("the shared investor/founder inbox takes its surface from the mounted route", () => {
    expect(INVESTOR_INBOX).toMatch(/surfaceForPathname\(location\)/);
    expect(INVESTOR_INBOX).toMatch(/s === "investor" \|\| s === "founder"/);
  });

  it("App.tsx mounts the persona inboxes in the right shells and keeps the admin campaign page", () => {
    expect(APP).toMatch(/path="\/collective\/partner\/notifications"[\s\S]{0,220}NotificationCenter surface="partner" chrome="collective"/);
    expect(APP).toMatch(/path="\/collective\/notifications"[\s\S]{0,220}NotificationCenter surface="collective" chrome="collective"/);
    expect(mountedRoutes).toContain("/admin/inbox");
    expect(mountedRoutes).toContain("/admin/notifications"); // campaign management NOT replaced
    expect(mountedRoutes).toContain("/partner/pipeline"); // legacy bookmark redirect
    expect(APP).toMatch(/Redirect to=\{`\/collective\/partner\/pipeline\$\{suffix\}`\}/);
  });

  it("the partner/Collective inbox chrome carries no founder glossary link", () => {
    expect(CENTER).toMatch(/chrome === "collective"/);
    const collectiveChrome = renderedText(CENTER.slice(CENTER.indexOf('chrome === "collective"'), CENTER.indexOf("<PageBody>")));
    expect(collectiveChrome).not.toMatch(/Glossary|glossary/);
  });

  it("the inbox no longer claims real-time SSE delivery", () => {
    const text = renderedText(CENTER);
    expect(text).not.toMatch(/Real-time updates via SSE/);
    expect(text).not.toMatch(/instant|push notification/i);
    expect(text).toMatch(/Refreshes automatically/);
  });

  it("unclassified rows are surfaced as account history, labelled, never auto-switched", () => {
    expect(BELL).toMatch(/button-open-account-history/);
    expect(CENTER).toMatch(/WORKSPACE_NOT_IDENTIFIED_LABEL/);
  });

  it("STABLE_2 · the bell menu is controlled and closes only on a real navigation", () => {
    expect(BELL).toMatch(/const \[open, setOpen\] = useState\(false\)/);
    expect(BELL).toMatch(/<DropdownMenu open=\{open\} onOpenChange=\{setOpen\}>/);
    // close on success, stay open (preventDefault) only when nothing happened
    expect(BELL).toMatch(/if \(plan\.action === "none"\) e\.preventDefault\(\);\s*else setOpen\(false\);/);
    // the old unconditional close-suppression is gone
    expect(BELL).not.toMatch(/onSelect=\{\(e\) => \{\s*e\.preventDefault\(\);\s*performNotificationNavigation/);
  });

  it("STABLE_2 · inbox scope is read from the URL, so query-only navigation and Back agree", () => {
    expect(CENTER).toMatch(/import \{ useLocation, useSearch \} from "wouter"/);
    expect(CENTER).toMatch(/const search = useSearch\(\)/);
    expect(CENTER).toMatch(/scopeFromSearch\(search\)/);
    // no pathname-keyed local scope state left to disagree with the URL
    expect(CENTER).not.toMatch(/useState<"workspace" \| "account">/);
    expect(CENTER).toMatch(/params\.set\("scope", "account"\)/);
    expect(CENTER).toMatch(/params\.delete\("scope"\)/);
  });
});

describe("OPUS-REVIEW · D · producers, facade precedence and frozen-file integrity", () => {
  it("the promotion producer emits the canonical mounted partner route", () => {
    expect(PROMOTION).toMatch(/link:\s*"\/collective\/partner\/pipeline"/);
    expect(PROMOTION).not.toMatch(/link:\s*"\/partner\/pipeline"/);
  });

  it("post notifications resolve per RECIPIENT+CHANNEL, not from the author's role or a global role priority", () => {
    // STABLE_2: one exported resolver, used by BOTH producers.
    expect(COMMS).toMatch(/export function postDestinationForRecipient\(/);
    const callSites = COMMS.match(/link:\s*postDestinationForRecipient\([^)]*\)\.href/g) ?? [];
    expect(callSites.length, "immediate + scheduled producers").toBe(2);
    // the superseded global-role-priority helper is gone, not left dangling
    expect(COMMS).not.toMatch(/function postsPathForUser\(/);
    expect(COMMS).not.toMatch(/link:\s*`\/\$\{viewerRole\}\/posts\//);
    // every branch of POST_ROUTE must be a mounted route
    for (const p of ["/collective/partner/posts/p_1", "/founder/posts/p_1", "/investor/posts/p_1"]) {
      expect(isMounted(p), p).toBe(true);
      expect(classifyNotificationDestination(p, "investor_report.published").class, p).toBe("surface");
    }
  });

  /**
   * OPEN, PARENT-REQUIRED (expected to FAIL until the pending change lands):
   * when no evidence identifies the recipient's workspace, the notification must
   * fall back to ACCOUNT HISTORY (an unclassified row the user can still read),
   * not silently to the investor inbox. Today `postDestinationForRecipient`
   * returns `pick("investor", "unresolved_default_investor")`
   * (`server/commsStore.ts`, branch 4).
   */
  it("FINDING · a no-evidence recipient is not defaulted into the investor workspace", () => {
    expect(COMMS).not.toMatch(/unresolved_default_investor/);
  });

  /**
   * F1 REGRESSION GUARD (was failing at SOURCE_STABLE, fixed at SOURCE_STABLE_2).
   * `publishDueScheduledPosts` used to emit a hardcoded shell-less `/posts/:id`,
   * which the classifier treats as `unknown_path` — no persona inbox, dead click.
   * Both producers now go through `postDestinationForRecipient`.
   */
  it("every post notification producer uses the recipient-resolved path", () => {
    const emitted = Array.from(COMMS.matchAll(/link:\s*[`"]([^`"]*posts[^`"]*)[`"]/g)).map((m) => m[1]);
    for (const lit of emitted) {
      expect(lit, `hardcoded post link literal still emitted: ${lit}`).toMatch(/^\/(collective\/partner|founder|investor)\/posts\//);
    }
    expect(classifyNotificationDestination("/posts/p_1", "investor_report.published")).toEqual({
      class: "unclassified",
      reason: "unknown_path",
    });
  });

  it("the facade is registered immediately BEFORE the frozen registration", () => {
    const iFacade = SERVER_ROUTES.indexOf("registerPersonaNotificationRoutes(app);");
    const iFrozen = SERVER_ROUTES.indexOf("registerNotificationsRoutes(app);");
    expect(iFacade).toBeGreaterThan(-1);
    expect(iFrozen).toBeGreaterThan(iFacade);
    expect(SERVER_ROUTES.slice(iFacade, iFrozen).trim().split("\n").length).toBeLessThan(3);
  });

  it("the facade owns exactly the four customer-facing pairs and no other frozen route", () => {
    const registered = Array.from(FACADE.matchAll(/app\.(get|patch|post|put|delete)\("([^"]+)"/g)).map((m) => `${m[1].toUpperCase()} ${m[2]}`);
    expect(new Set(registered)).toEqual(
      new Set(["GET /api/notifications", "PATCH /api/notifications", "POST /api/notifications/read-all", "GET /api/notifications/stream"]),
    );
    expect(registered.some((r) => r.includes("/preferences"))).toBe(false);
  });

  it("the facade never reads or writes the frozen in-memory store", () => {
    expect(FACADE).not.toMatch(/_testNotifications/);
    expect(FACADE).not.toMatch(/from "\.\/notificationsStore"/);
    expect(FACADE).toMatch(/hydrateEntriesStrict/);
    expect(FACADE).toMatch(/mutateEntriesStrict/);
    expect(FACADE).not.toMatch(/hydrateEntries\(/); // lenient read would turn failure into an empty inbox
  });

  it("the frozen notification store is byte-identical to its sacred baseline", () => {
    const actual = createHash("sha256").update(readFileSync(path.join(ROOT, "server/notificationsStore.ts"))).digest("hex");
    const line = read("sacred_baseline/SACRED_SHA256.txt")
      .split("\n")
      .find((l) => l.includes("server/notificationsStore.ts"));
    expect(line).toBeTruthy();
    expect(actual).toBe(line!.trim().split(/\s+/)[0]);
  });

  it("the stream is documented and defaulted as bounded polling, not push", () => {
    expect(FACADE).toMatch(/STREAM_POLL_DEFAULT_MS\s*=\s*15_000/);
    expect(FACADE).toMatch(/STREAM_POLL_MIN_MS\s*=\s*5000/);
    expect(FACADE).toMatch(/bounded polling/i);
  });
});

describe("OPUS-REVIEW · E · Managed Founders copy tells the truth about the queued count", () => {
  it("renders the agreed customer wording", () => {
    expect(MANAGED_FOUNDERS).toMatch(/Pending sharing requests/);
    expect(MANAGED_FOUNDERS).toMatch(/have not been shared with the Collective/);
    expect(MANAGED_FOUNDERS).toMatch(/do not give investors access/);
  });

  it("makes no delivery, availability or implementation claim", () => {
    const text = renderedText(MANAGED_FOUNDERS);
    for (const banned of [/queued pushes/i, /Delivery of/i, /not available yet/i, /always zero/i, /permanently zero/i]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
  });

  it("still renders the single live database-backed value", () => {
    const occurrences = MANAGED_FOUNDERS.match(/\{dashQ\.data\.queuedPushes\}/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});
