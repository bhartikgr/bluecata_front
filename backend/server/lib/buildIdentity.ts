/**
 * WAVE 242 — ONE BUILD-COMMIT RESOLVER, ONE DOCUMENTED FALLBACK.
 *
 * Before this wave the platform resolved "which commit is this?" in three
 * independent places:
 *
 *   1. `server/routes.ts` (inline in `registerRoutes`): BUILD_SHA → GIT_SHA →
 *      `git rev-parse --short HEAD` → "unknown". Served as `buildSha` on
 *      `GET /api/healthz`.
 *   2. `client/src/components/BuildVersionMarker.tsx:17`: a vite build-time
 *      `VITE_BUILD_SHA` baked into the bundle.
 *   3. `server/lib/sentry.ts`: `release: process.env.GIT_SHA ?? undefined` —
 *      reading **only** GIT_SHA.
 *
 * (2) is not a competing source and needs no change: `BuildVersionMarker.tsx:33`
 * already does `data?.buildSha ?? BUILD_SHA` where `data` comes from a fetch of
 * `/api/healthz` (verified at `:22-30`), so the client already PREFERS the
 * server's answer and uses its own only when the server cannot be reached. That
 * is one authoritative source plus one documented fallback, which is the right
 * shape.
 *
 * (3) was a real disagreement, not a duplication: on a deploy that sets
 * `BUILD_SHA` and not `GIT_SHA` — which is what (1)'s own precedence order says
 * to expect — healthz reported the build and every Sentry event was tagged with
 * NO release at all. Both now call `resolveBuildSha()` here.
 *
 * `buildShaSource()` exists because "unknown" is an absence and an absence must
 * not read as reassurance (R224.1). A developer confirming an install needs to
 * know whether the sha he is looking at was injected by the deploy, derived from
 * a local git checkout, or never resolved — three very different situations that
 * a bare string cannot distinguish.
 *
 * NOT MEMOISED, deliberately, and this was found by a pre-existing test rather
 * than reasoned out: `server/__tests__/wfix4_item7_build_marker.test.ts:83`
 * registers the routes a second time with a different environment and requires
 * the new environment to be reflected. A process-level cache made that test fail
 * with the FIRST registration's sha — a real behaviour change, so the cache was
 * removed rather than the test weakened.
 *
 * The `execSync` cost is instead avoided where it always was: the CALLER resolves
 * once. `server/routes.ts` calls `resolveBuildIdentity()` a single time during
 * `registerRoutes` and closes over both fields, exactly as the inlined IIFE did,
 * so nothing shells out per request on this public, rate-limit-exempt endpoint.
 */
import { execSync } from "node:child_process";

/** Where the resolved value came from. `"unresolved"` means we do not know the
 *  build — it is NOT a claim that the build is fine. */
export type BuildShaSource = "BUILD_SHA_env" | "GIT_SHA_env" | "git_rev_parse" | "unresolved";

export const UNKNOWN_BUILD_SHA = "unknown";

export interface BuildIdentity {
  sha: string;
  source: BuildShaSource;
}

/** Resolve the build commit and record WHICH source produced it. Call this ONCE
 *  per process at startup and close over the result; see the note above. */
export function resolveBuildIdentity(): BuildIdentity {
  if (process.env.BUILD_SHA) return { sha: process.env.BUILD_SHA, source: "BUILD_SHA_env" };
  if (process.env.GIT_SHA) return { sha: process.env.GIT_SHA, source: "GIT_SHA_env" };
  try {
    /* This tree is not a git repository, so in development and in tests this
       branch legitimately fails and we degrade. Never fail boot for it. */
    const out = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (out) return { sha: out, source: "git_rev_parse" };
    return { sha: UNKNOWN_BUILD_SHA, source: "unresolved" };
  } catch {
    return { sha: UNKNOWN_BUILD_SHA, source: "unresolved" };
  }
}

/** The build commit. `"unknown"` when it could not be determined — pair it with
 *  `buildShaSource()` before reporting it anywhere. */
export function resolveBuildSha(): string {
  return resolveBuildIdentity().sha;
}

/** Which of the three precedence steps produced `resolveBuildSha()`. */
export function buildShaSource(): BuildShaSource {
  return resolveBuildIdentity().source;
}

/** For Sentry's `release`, which must be omitted rather than set to the string
 *  "unknown" — a release literally named "unknown" would group every
 *  unidentifiable deploy's errors together as if they were one build. */
export function buildShaForRelease(): string | undefined {
  const sha = resolveBuildSha();
  return sha === UNKNOWN_BUILD_SHA ? undefined : sha;
}

