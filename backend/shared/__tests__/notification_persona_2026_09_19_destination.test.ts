/* ════════════════════════════════════════════════════════════════════════════
   2026-09-19 · SLIDE 13a — SHARED NOTIFICATION DESTINATION CLASSIFIER.
   ════════════════════════════════════════════════════════════════════════════
   Pins the contract every consumer (server facade, bell, center, persona inbox)
   relies on:
     · exact legacy alias repair (path-only, query/hash preserved, one trailing
       slash tolerated, nothing broader);
     · strict refusal of anything that could leave the origin or confuse the
       router — including dot segments in EVERY spelling (`..`, `.%2e`, `%2e.`,
       `%2E%2E`, mixed case), encoded separators, backslashes, control chars,
       credentials/authority markers, and any path the WHATWG parser rewrites;
     · the ONE narrow protected-document contract (kind + exact API path + a
       single `grant=` parameter), attributed to the audited recipient surface;
     · shell-prefix attribution with exact-or-child semantics (`/founderx` is
       NOT founder);
     · unknown paths are RETAINED as `unclassified` (never guessed to a shell).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import {
  classifyNotificationDestination,
  parseSafeAppLink,
  isSafeAppPath,
  isProtectedDocumentContract,
  notificationMatchesSurface,
  inboxHrefForSurface,
  surfaceForPathname,
  surfaceLabel,
  LEGACY_LINK_ALIASES,
  DATA_ROOM_GRANT_KIND,
  DATA_ROOM_GRANT_SURFACE,
  NOTIFICATION_SURFACES,
  WORKSPACE_NOT_IDENTIFIED_LABEL,
} from "../notificationDestination";

const GRANT = "a".repeat(64); // the producer's token shape: 64 hex chars
const DOC_LINK = `/api/public/data-room/files/file_123?grant=${GRANT}`;

describe("legacy alias — the live defect row", () => {
  it("repairs the exact stored `/partner/pipeline` to the mounted partner route, flagged as repaired", () => {
    const c = classifyNotificationDestination("/partner/pipeline", "partner.promotion_approved");
    expect(c).toEqual({ class: "surface", surface: "partner", href: "/collective/partner/pipeline", repairedLegacy: true });
  });
  it("preserves query and hash and tolerates ONE trailing slash", () => {
    expect(classifyNotificationDestination("/partner/pipeline?tab=approved#row", "x")).toMatchObject({
      class: "surface", surface: "partner", href: "/collective/partner/pipeline?tab=approved#row", repairedLegacy: true,
    });
    expect(classifyNotificationDestination("/partner/pipeline/", "x")).toMatchObject({ surface: "partner", repairedLegacy: true });
  });
  it("does NOT alias anything broader than the exact key", () => {
    for (const l of ["/partner/pipeline/child", "/partner/pipelines", "/partner", "/partner/", "/partner/settings", "/Partner/pipeline"]) {
      const c = classifyNotificationDestination(l, "x");
      expect(c.class, l).toBe("unclassified");
      expect((c as { reason: string }).reason, l).toBe("unknown_path");
    }
  });
  it("the alias table is exactly the audited legacy key", () => {
    expect(LEGACY_LINK_ALIASES).toEqual({ "/partner/pipeline": "/collective/partner/pipeline" });
    expect(Object.isFrozen(LEGACY_LINK_ALIASES)).toBe(true);
  });
  it("the repaired href is itself classified to the same surface (idempotent)", () => {
    const c = classifyNotificationDestination("/partner/pipeline", "x") as { href: string };
    expect(classifyNotificationDestination(c.href, "x")).toMatchObject({ class: "surface", surface: "partner", repairedLegacy: false });
  });
});

describe("unsafe URL refusal — every spelling is refused BEFORE any decision", () => {
  const UNSAFE: Array<[string, string]> = [
    ["https://evil.example/collective/partner/pipeline", "absolute URL"],
    ["//evil.example/collective/partner", "protocol-relative"],
    ["javascript:alert(1)", "scheme"],
    ["collective/partner/pipeline", "relative (no leading slash)"],
    ["/collective/partner/../../admin", "literal dot-dot"],
    ["/collective/partner/.%2e/.%2e/admin", "mixed literal+encoded dot segment (Sol #1)"],
    ["/collective/partner/%2e./%2e./admin", "encoded+literal dot segment (Sol #1)"],
    ["/collective/partner/%2e%2e/%2e%2e/admin", "fully encoded dot-dot"],
    ["/collective/partner/%2E%2E/admin", "upper-case encoded dot-dot"],
    ["/collective/partner/./pipeline", "single dot segment"],
    ["/collective/partner/%2e/pipeline", "encoded single dot"],
    ["/collective/partner/../../../../admin", "double traversal past root"],
    ["/founder/%2fadmin", "encoded slash"],
    ["/founder/%5cadmin", "encoded backslash"],
    ["/founder\\admin", "raw backslash"],
    ["/founder/ admin", "space"],
    ["/founder/\tadmin", "tab"],
    ["/founder/\nadmin", "newline"],
    ["/founder/a%2ebc", "any encoded dot inside a segment"],
    ["/user@evil.example/collective", "@ in path"],
    ["/founder:8080/x", ": in path"],
    ["/founder/é", "non-ASCII (parser percent-encodes → path changes)"],
    ["", "empty"],
    ["/" + "a".repeat(2100), "over-long"],
  ];
  for (const [link, why] of UNSAFE) {
    it(`refuses ${why}: ${JSON.stringify(link).slice(0, 60)}`, () => {
      expect(parseSafeAppLink(link), why).toBeNull();
      expect(isSafeAppPath(link), why).toBe(false);
      const c = classifyNotificationDestination(link, "partner.promotion_approved");
      expect(c).toEqual({ class: "unclassified", reason: link === "" ? "missing" : "unsafe" });
      // never attributed to any shell, so never listed in any persona view
      for (const s of NOTIFICATION_SURFACES) {
        if (s === "account") continue;
        expect(notificationMatchesSurface({ link, kind: "x" }, s), `${why} → ${s}`).toBe(false);
      }
    });
  }
  it("malformed percent escapes are REFUSED as written (spec: never decode/rewrite to make a link fit) — path, query and hash", () => {
    for (const l of ["/founder/%zz", "/founder/%2", "/founder/posts/p%", "/founder/posts/p1?x=%G1", "/founder/posts/p1#%zz",
                     "/api/public/data-room/files/f1?grant=abcdefgh%zz"]) {
      expect(parseSafeAppLink(l), l).toBeNull();
      expect(classifyNotificationDestination(l, "dataroom.access_granted"), l).toEqual({ class: "unclassified", reason: "unsafe" });
    }
    // well-formed escapes are structurally fine (and still only classify when the route is mounted)
    expect(parseSafeAppLink("/founder/posts/p%20x")?.path).toBe("/founder/posts/p%20x");
    expect(classifyNotificationDestination("/founder/posts/p%20x", "x")).toMatchObject({ class: "surface", surface: "founder" });
  });
  it("non-string / missing links are `missing`, never thrown", () => {
    for (const v of [undefined, null, 42, {}, [], true]) {
      const c = classifyNotificationDestination(v as unknown, "x");
      expect(c.class).toBe("unclassified");
      expect((c as { reason: string }).reason).toBe(v === undefined || v === null ? "missing" : "unsafe");
    }
  });
  it("parseSafeAppLink returns the parsed (unchanged) path and preserves search/hash", () => {
    expect(parseSafeAppLink("/collective/partner/pipeline?x=1#y")).toEqual({
      path: "/collective/partner/pipeline", search: "?x=1", hash: "#y", href: "/collective/partner/pipeline?x=1#y",
    });
  });
});

describe("shell attribution — MOUNTED ROUTES ONLY, partner before collective, retained unknowns", () => {
  it("attributes mounted routes under each shell prefix (exact, :param, trailing slash)", () => {
    expect(classifyNotificationDestination("/collective/partner/pipeline", "x")).toMatchObject({ surface: "partner" });
    expect(classifyNotificationDestination("/collective/partner/pipeline/", "x")).toMatchObject({ surface: "partner" });
    expect(classifyNotificationDestination("/collective/partner/spvs/s1/performance", "x")).toMatchObject({ surface: "partner" });
    expect(classifyNotificationDestination("/collective/companies/abc", "x")).toMatchObject({ surface: "collective" });
    expect(classifyNotificationDestination("/collective", "x")).toMatchObject({ surface: "collective" });
    expect(classifyNotificationDestination("/founder/rounds/r1", "x")).toMatchObject({ surface: "founder" });
    expect(classifyNotificationDestination("/investor/portfolio", "x")).toMatchObject({ surface: "investor" });
    expect(classifyNotificationDestination("/admin/users", "x")).toMatchObject({ surface: "admin" });
    // `/admin/:rest*` is a real mounted catch-all (AdminNotFound inside admin chrome)
    expect(classifyNotificationDestination("/admin/anything/deep", "x")).toMatchObject({ surface: "admin" });
  });
  it("shell-PREFIXED but UNMOUNTED paths are `unknown_path` (they would render the bare app 404 without the persona's nav)", () => {
    for (const l of [
      "/collective/partner/qa-unregistered-target", // parent browser control
      "/collective/partner", "/collective/partner/", // no bare partner index route is mounted
      "/collective/resources/abc", "/collective/portfolio/x", "/collective/deals/abc", "/collective/partnerx/pipeline",
      "/founder/collective/interest/t1", "/founder/posts", "/founder/posts/p1/extra", "/founder/nope",
      "/investor/reports/r1", "/investor/nope/x",
    ]) {
      expect(classifyNotificationDestination(l, "x"), l).toEqual({ class: "unclassified", reason: "unknown_path" });
      expect(notificationMatchesSurface({ link: l, kind: "x" }, "account"), l).toBe(true);
      for (const s of ["partner", "collective", "founder", "investor", "admin"] as const) {
        expect(notificationMatchesSurface({ link: l, kind: "x" }, s), `${l} → ${s}`).toBe(false);
      }
    }
  });
  it("`/founderx`, `/collectivex`, `/adminx` are NOT their shells (Sol: prefix must be exact-or-child)", () => {
    for (const l of ["/founderx", "/founder-x/y", "/collectivex/partner", "/adminx", "/investors"]) {
      expect(classifyNotificationDestination(l, "x"), l).toEqual({ class: "unclassified", reason: "unknown_path" });
    }
  });
  it("unknown but safe paths are retained as `unclassified` (account-only), never guessed", () => {
    for (const l of ["/", "/settings", "/notifications", "/rounds/r1/updates/u1", "/posts/p1", "/partner/foo"]) {
      expect(classifyNotificationDestination(l, "x"), l).toEqual({ class: "unclassified", reason: "unknown_path" });
      expect(notificationMatchesSurface({ link: l, kind: "x" }, "account")).toBe(true);
      expect(notificationMatchesSurface({ link: l, kind: "x" }, "partner")).toBe(false);
    }
  });
  it("kind prefixes NEVER decide the surface (a partner.* kind with a founder link is founder)", () => {
    expect(classifyNotificationDestination("/founder/rounds", "partner.promotion_approved")).toMatchObject({ surface: "founder" });
    expect(classifyNotificationDestination(undefined, "partner.promotion_approved")).toEqual({ class: "unclassified", reason: "missing" });
  });
});

describe("protected document contract — narrow, kind-bound, attributed to the audited recipient surface", () => {
  it("the exact producer shape classifies as a document on surface `investor`", () => {
    expect(DATA_ROOM_GRANT_KIND).toBe("dataroom.access_granted");
    expect(DATA_ROOM_GRANT_SURFACE).toBe("investor");
    expect(isProtectedDocumentContract(DOC_LINK, DATA_ROOM_GRANT_KIND)).toBe(true);
    expect(classifyNotificationDestination(DOC_LINK, DATA_ROOM_GRANT_KIND)).toEqual({ class: "document", href: DOC_LINK, surface: "investor" });
    expect(notificationMatchesSurface({ link: DOC_LINK, kind: DATA_ROOM_GRANT_KIND }, "investor")).toBe(true);
    expect(notificationMatchesSurface({ link: DOC_LINK, kind: DATA_ROOM_GRANT_KIND }, "founder")).toBe(false);
    expect(notificationMatchesSurface({ link: DOC_LINK, kind: DATA_ROOM_GRANT_KIND }, "account")).toBe(true);
  });
  it("the same link on ANY other kind is NOT a document (unknown_path, retained)", () => {
    for (const k of ["partner.promotion_approved", "dataroom.access_revoked", "dataroom.access_granted ", undefined, null, 1]) {
      expect(isProtectedDocumentContract(DOC_LINK, k)).toBe(false);
      expect(classifyNotificationDestination(DOC_LINK, k), String(k)).toEqual({ class: "unclassified", reason: "unknown_path" });
    }
  });
  it("the data-room kind with any OTHER link is not a document", () => {
    const wrong = [
      "/api/public/data-room/files/file_123", // no grant
      `/api/public/data-room/files/file_123?grant=${GRANT}&x=1`, // two params
      `/api/public/data-room/files/file_123?x=1&grant=${GRANT}`, // two params, other order
      `/api/public/data-room/files/file_123?grant=${GRANT}#frag`, // hash present
      `/api/public/data-room/files/file_123/extra?grant=${GRANT}`, // deeper path
      `/api/public/data-room/files/?grant=${GRANT}`, // empty file id
      `/api/public/data-room/file/file_123?grant=${GRANT}`, // wrong path
      `/api/public/data-room/files/file_123?grant=short`, // token too short
      `/api/public/data-room/files/file_123?grant=${GRANT}%2e`, // encoded dot
      `/api/public/data-room/files/fi le?grant=${GRANT}`, // space
      `/api/public/data-room/files/file_123?token=${GRANT}`, // wrong param name
    ];
    for (const l of wrong) {
      expect(isProtectedDocumentContract(l, DATA_ROOM_GRANT_KIND), l).toBe(false);
      const c = classifyNotificationDestination(l, DATA_ROOM_GRANT_KIND);
      expect(c.class, l).toBe("unclassified");
    }
  });
  it("nothing else under /api/ is ever a destination", () => {
    for (const l of ["/api", "/api/", "/api/notifications", "/api/admin/users", "/api/public/x"]) {
      expect(classifyNotificationDestination(l, "x"), l).toEqual({ class: "unclassified", reason: "unknown_path" });
    }
  });
});

describe("surface helpers used by the shells", () => {
  it("inboxHrefForSurface names the mounted inbox of each surface", () => {
    expect(inboxHrefForSurface("partner")).toBe("/collective/partner/notifications");
    expect(inboxHrefForSurface("collective")).toBe("/collective/notifications");
    expect(inboxHrefForSurface("founder")).toBe("/founder/notifications");
    expect(inboxHrefForSurface("investor")).toBe("/investor/notifications");
    expect(inboxHrefForSurface("admin")).toBe("/admin/inbox");
    expect(inboxHrefForSurface("account")).toBe("/notifications");
  });
  it("every inbox href classifies to its own surface (data plane and nav plane agree)", () => {
    for (const s of NOTIFICATION_SURFACES) {
      if (s === "account") continue;
      expect(classifyNotificationDestination(inboxHrefForSurface(s), "x"), s).toMatchObject({ class: "surface", surface: s });
      expect(surfaceForPathname(inboxHrefForSurface(s)), s).toBe(s);
    }
  });
  it("surfaceForPathname derives the mounted shell from the route (exact-or-child)", () => {
    expect(surfaceForPathname("/collective/partner/pipeline")).toBe("partner");
    expect(surfaceForPathname("/collective/partner")).toBe("partner");
    expect(surfaceForPathname("/collective/deals")).toBe("collective");
    expect(surfaceForPathname("/founder/rounds")).toBe("founder");
    expect(surfaceForPathname("/founderx")).toBe("account");
    expect(surfaceForPathname("/investor")).toBe("investor");
    expect(surfaceForPathname("/admin/inbox")).toBe("admin");
    expect(surfaceForPathname("/notifications")).toBe("account");
    expect(surfaceForPathname("/")).toBe("account");
  });
  it("labels", () => {
    expect(surfaceLabel("partner")).toBe("Consortium Partner");
    expect(surfaceLabel("account")).toBe("Across your account");
    expect(WORKSPACE_NOT_IDENTIFIED_LABEL).toBe("Workspace not identified");
  });
});
