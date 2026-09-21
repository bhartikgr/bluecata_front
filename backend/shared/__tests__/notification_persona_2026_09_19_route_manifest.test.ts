/* ════════════════════════════════════════════════════════════════════════════
   2026-09-19 · SLIDE 13a — MOUNTED-ROUTE MANIFEST PARITY + MATCHER SEMANTICS.
   The classifier may attribute a link to a persona shell ONLY when the path
   matches a route pattern ACTUALLY mounted in client/src/App.tsx. The manifest
   is generated data (scripts/generate-notification-route-manifest.ts, TS AST);
   this suite proves it is in parity with the real JSX right now, that the
   matcher implements the grammar App.tsx uses, and that an unmounted shell
   descendant (the parent's browser control: bare 404 without partner nav) is
   NOT classified — retained in account history, no action.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLIENT_ROUTE_PATTERNS } from "../notificationRouteManifest";
import { extractRoutePatterns, renderManifest } from "../../scripts/generate-notification-route-manifest";
import { classifyNotificationDestination, matchRoutePattern, matchesMountedRoute, notificationMatchesSurface, inboxHrefForSurface, LEGACY_LINK_ALIASES } from "../notificationDestination";

const REPO = path.resolve(__dirname, "..", "..");
const APP = fs.readFileSync(path.join(REPO, "client/src/App.tsx"), "utf8");
const MANIFEST_FILE = fs.readFileSync(path.join(REPO, "shared/notificationRouteManifest.ts"), "utf8");

describe("manifest parity with client/src/App.tsx (TypeScript AST, not regex)", () => {
  it("the checked-in manifest equals a fresh extraction — byte-for-byte rendered file and set equality", () => {
    const fresh = extractRoutePatterns(APP);
    expect(fresh.length).toBeGreaterThan(100);
    expect([...CLIENT_ROUTE_PATTERNS]).toEqual(fresh);
    expect(MANIFEST_FILE).toBe(renderManifest(fresh));
  });
  it("the manifest is immutable data with no client/server imports", () => {
    expect(Object.isFrozen(CLIENT_ROUTE_PATTERNS)).toBe(true);
    expect(MANIFEST_FILE).not.toMatch(/^import /m);
    expect(MANIFEST_FILE).toMatch(/GENERATED FILE — DO NOT EDIT BY HAND/);
    expect(new Set(CLIENT_ROUTE_PATTERNS).size).toBe(CLIENT_ROUTE_PATTERNS.length);
    for (const p of CLIENT_ROUTE_PATTERNS) expect(p.startsWith("/"), p).toBe(true);
  });
  it("the AST extractor ignores Routes without a static string path and reads JSX-expression string literals", () => {
    const src = `const A = () => (<Switch>
      <Route path="/a/:id" component={X} />
      <Route path={"/b"}>{() => null}</Route>
      <Route path={dynamic} component={Y} />
      <Route component={Fallback} />
      <NotRoute path="/nope" />
    </Switch>);`;
    expect(extractRoutePatterns(src)).toEqual(["/a/:id", "/b"]);
  });
  it("every destination this wave emits, every inbox route and the alias target are mounted", () => {
    for (const p of ["/collective/partner/pipeline", "/collective/partner/posts/x", "/founder/posts/x", "/investor/posts/x",
                     "/collective/partner/notifications", "/admin/inbox", "/founder/notifications", "/investor/notifications", "/collective/notifications"]) {
      expect(matchesMountedRoute(p), p).toBe(true);
    }
    for (const s of ["partner", "collective", "founder", "investor", "admin"] as const) expect(matchesMountedRoute(inboxHrefForSurface(s)), s).toBe(true);
    for (const target of Object.values(LEGACY_LINK_ALIASES)) expect(matchesMountedRoute(target), target).toBe(true);
  });
});

describe("matcher grammar (wouter): literal, :param, :param?, :param*, :param+, trailing slash", () => {
  it("literal and :param", () => {
    expect(matchRoutePattern("/founder/posts/:id", "/founder/posts/p1")).toBe(true);
    expect(matchRoutePattern("/founder/posts/:id", "/founder/posts/p1/")).toBe(true);
    expect(matchRoutePattern("/founder/posts/:id", "/founder/posts")).toBe(false);
    expect(matchRoutePattern("/founder/posts/:id", "/founder/posts/")).toBe(false);
    expect(matchRoutePattern("/founder/posts/:id", "/founder/posts/p1/x")).toBe(false);
    expect(matchRoutePattern("/founder/posts/:id", "/Founder/posts/p1")).toBe(false);
    expect(matchRoutePattern("/collective", "/collective")).toBe(true);
    expect(matchRoutePattern("/collective", "/collective/")).toBe(true);
    expect(matchRoutePattern("/collective", "/collective/x")).toBe(false);
  });
  it("optional and rest params", () => {
    expect(matchRoutePattern("/a/:b?", "/a")).toBe(true);
    expect(matchRoutePattern("/a/:b?", "/a/x")).toBe(true);
    expect(matchRoutePattern("/a/:b?", "/a/x/y")).toBe(false);
    expect(matchRoutePattern("/admin/:rest*", "/admin")).toBe(true);
    expect(matchRoutePattern("/admin/:rest*", "/admin/x/y/z")).toBe(true);
    expect(matchRoutePattern("/admin/:rest*", "/adminx")).toBe(false);
    expect(matchRoutePattern("/a/:r+", "/a")).toBe(false);
    expect(matchRoutePattern("/a/:r+", "/a/x/y")).toBe(true);
  });
  it("nothing is decoded: an encoded segment is compared as written", () => {
    expect(matchRoutePattern("/founder/posts", "/founder/p%6fsts")).toBe(false);
  });
});

describe("unmounted shell descendants are NOT classified (structural hole closed)", () => {
  const CONTROL = "/collective/partner/qa-unregistered-target";
  it("the parent's browser control path is unknown_path, account-only, no navigation target", () => {
    expect(matchesMountedRoute(CONTROL)).toBe(false);
    expect(classifyNotificationDestination(CONTROL, "partner.promotion_approved")).toEqual({ class: "unclassified", reason: "unknown_path" });
    expect(notificationMatchesSurface({ link: CONTROL, kind: "partner.promotion_approved" }, "partner")).toBe(false);
    expect(notificationMatchesSurface({ link: CONTROL, kind: "partner.promotion_approved" }, "account")).toBe(true);
  });
  it("the pre-existing unrouted producers (documented, unchanged) are account-only under the corrected policy", () => {
    for (const l of ["/collective/apply", "/collective/dsc", "/collective/resources/r1", "/founder/collective/interest/t1", "/collective/portfolio/pf1", "/investor/reports/rp1", "/rounds/r1/updates/u1", "/posts/p1"]) {
      if (matchesMountedRoute(l)) continue; // if a later wave mounts one, it simply starts classifying — that is the point of the manifest
      expect(classifyNotificationDestination(l, "x"), l).toEqual({ class: "unclassified", reason: "unknown_path" });
    }
  });
  it("a mounted sibling of an unmounted path still classifies (the policy is per route, not per prefix)", () => {
    expect(classifyNotificationDestination("/collective/partner/spvs/s1", "x")).toMatchObject({ class: "surface", surface: "partner" });
    expect(classifyNotificationDestination("/collective/partner/spvs", "x")).toMatchObject({ class: "surface", surface: "partner" });
    expect(classifyNotificationDestination("/collective/partner/spvs/s1/nope", "x")).toEqual({ class: "unclassified", reason: "unknown_path" });
  });
});
