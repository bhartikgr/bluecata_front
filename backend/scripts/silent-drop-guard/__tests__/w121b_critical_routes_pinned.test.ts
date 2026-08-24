/**
 * WAVE 121b — CRITICAL POST-G-0 ROUTES ARE PINNED BY NAME, BECAUSE THE G-0
 * BASELINE CANNOT PROTECT THEM.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Reviewer A proved that three investor-facing endpoints could be deleted
 * without `npm run guard` noticing: the scanner saw them only as one opaque
 * `POST <expr:path>` token, because they are registered inside a loop that
 * DESTRUCTURES its binding (`for (const [path, action] of [[…],[…]] as const)`).
 * Wave 121 fixed the scanner, so the guard now names all three individually.
 *
 * THAT FIX ALONE IS NOT ENOUGH, and wave 121 said so honestly. The guard
 * compares the current tree against `scripts/silent-drop-guard/baseline.json`,
 * which is the **G-0 anchor**: generated 2026-07-09 from an immutable,
 * write-stripped tree snapshot, recording 923 routes. A fixed baseline can only
 * protect what existed when it was taken. These endpoints are not in it, so
 * their deletion produces no REMOVED row and the guard still exits 0.
 *
 * THE OBVIOUS FIX IS THE ONE WE MUST NOT TAKE. Regenerating the baseline would
 * re-anchor the audit chain, and that is an explicit OWNER decision reserved to
 * a human (decision 6 of the outstanding six). A gate that can re-anchor itself
 * to bless current reality is not a gate — the snapshot script says as much in
 * its own header: "a guard that can bless its own drift is not a guard".
 *
 * So this fence protects the routes DIRECTLY instead, by name, without touching
 * the anchor. It is deliberately narrow: a short, explicit list of endpoints
 * whose disappearance would be a serious functional loss, each with the reason
 * it is listed. It is not a substitute for the baseline and does not pretend to
 * be — it covers named routes only.
 *
 * ── HOW TO EXTEND IT ────────────────────────────────────────────────────────
 * Add a route here when its silent removal would break something a customer
 * does, AND it was added after 2026-07-09 so the baseline cannot see it. Give a
 * real reason. Do NOT add every route: a list nobody maintains is worse than a
 * short one that is true.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRoutes } from "../extract-inventory.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Each entry is [method+path, why it is pinned].
 *
 * The three investor invitation responses are the reason this file exists: they
 * are how an investor answers a founder's round — accept, decline, or indicate a
 * soft circle. Reviewer A deleted two of them, then all three, and measured the
 * guard's output as byte-identical both times (`before=1185 after=1185,
 * REMOVED []`).
 */
const PINNED: ReadonlyArray<readonly [string, string]> = [
  [
    "POST /api/investor/invitations/:id/accept",
    "An investor accepting a round invitation. Registered inside a DESTRUCTURING " +
      "loop, so every scanner before wave 121 saw it only as an opaque token. Its " +
      "removal would silently strand every outstanding invitation.",
  ],
  [
    "POST /api/investor/invitations/:id/decline",
    "An investor declining. Deleted by Reviewer A with no gate reaction. Declining " +
      "must stay reachable: the alternative is an investor with no way to say no, " +
      "which corrupts the round's own soft-circle totals.",
  ],
  [
    "POST /api/investor/invitations/:id/soft-circle",
    "An investor indicating a soft circle — the first state in the money ladder " +
      "that wave 114 rebuilt the round totals on. If this is removed the derived " +
      "subscribed figure silently loses its input.",
  ],
  [
    "GET /api/founder/dataroom/files/:id",
    "File metadata. Wave 113 moved this into a loop registration to serve the " +
      "founder and investor addresses from one handler, which is what first " +
      "revealed the scanner's blindness (the guard reported it as REMOVED when it " +
      "was not).",
  ],
  [
    "GET /api/founder/dataroom/files/:id/download",
    "The founder's own document download. Same loop registration. A founder " +
      "losing access to his own data room would be a severe regression.",
  ],
  /* ── ADDED AFTER REVIEWER B, WHICH PROVED THE GAP WAS EXPLOITABLE NOW ──────
     Reviewer B deleted the INVESTOR half of the data-room pair from the loop
     arrays at `server/dataroomStore.ts:829` and `:909` and measured:
         before=1224  after=1222
         REMOVED ids in protected baseline: []
         npm run guard  →  exit 0
     All five routes pinned above were still present, so the fence passed too.

     WHY THAT IS SEVERE: `client/src/lib/investor/dataroomOpen.ts:56` shows the
     `/api/dataroom/...` pair is the CLIENT'S ONLY DOWNLOAD ADDRESS for an
     investor. So the entire investor data room could go dark with every gate
     green — during a live fundraise, on the documents an investor reads before
     wiring money.

     The founder addresses were pinned and the investor ones were not, because I
     took the pair from wave 113's log rather than from the client. That is the
     lesson worth recording: **pin the address the CLIENT actually calls, not the
     one the server log happens to name first.** */
  [
    "GET /api/dataroom/files/:id",
    "The INVESTOR-facing file metadata address. Reviewer B proved its deletion " +
      "was invisible to every gate. Wave 113 made this the shared handler for " +
      "both audiences, and wave 120 bound and made revocable the grants that " +
      "protect it — all of which is void if the route itself can vanish.",
  ],
  [
    "GET /api/dataroom/files/:id/download",
    "The INVESTOR'S ONLY DOWNLOAD ADDRESS, per client/src/lib/investor/" +
      "dataroomOpen.ts:56. Its removal takes the whole investor data room dark. " +
      "This is also the address that used to have NO handler at all, so the SPA " +
      "catch-all answered HTTP 200 with an HTML shell and the client's empty " +
      "catch never fired — a silent failure we must not be able to reintroduce.",
  ],
];

/**
 * ⚠ WHAT THIS FENCE DOES NOT DO — stated plainly so nobody mistakes it for
 * complete cover.
 *
 * Reviewer B measured that **258 post-G-0 routes sit outside the G-0 baseline**.
 * This list pins seven of them. It is a targeted fence over the endpoints whose
 * silent removal would be most damaging, NOT a replacement for a baseline.
 *
 * The real fix is to re-anchor the guard baseline, and that is deliberately NOT
 * done here: it is one of the six outstanding OWNER decisions and is reserved to
 * a human, because a gate that can re-anchor itself to bless current reality is
 * not a gate. `scripts/silent-drop-guard/snapshot.sh` says so in its own header.
 */

describe("W121b — critical post-G-0 routes are named in the inventory", () => {
  const routes = extractRoutes(REPO_ROOT);

  it("W121b-01 · the extractor returns a real inventory, not an empty one", () => {
    /* THE INSTRUMENT CHECK. Every assertion below is `toContain` on this array,
       and all of them would pass vacuously in the WRONG direction if extraction
       silently returned nothing — so prove the instrument works before trusting
       it. A gate that finds nothing must fail, which is the same policy the
       restyle detector enforces for itself. */
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(900);
    /* And a known NEGATIVE: a route that does not exist must not be reported,
       otherwise `toContain` proves nothing about the ones that do. */
    expect(routes).not.toContain("POST /api/investor/invitations/:id/there-is-no-such-action");
  });

  for (const [route, why] of PINNED) {
    it(`W121b · ${route} is present and individually named`, () => {
      expect(routes, `${route} must be in the inventory by its concrete path — ${why}`).toContain(
        route,
      );
    });
  }

  it("W121b-99 · every pinned route carries a written reason", () => {
    /* A pin without a reason becomes a pin nobody dares remove and nobody
       understands. This keeps the list honest as it grows. */
    for (const [route, why] of PINNED) {
      expect(why.length, `${route} needs a real reason, not a placeholder`).toBeGreaterThan(60);
    }
    /* Guard against accidental duplication, which would overstate coverage. */
    expect(new Set(PINNED.map(([r]) => r)).size).toBe(PINNED.length);
  });
});
