/* ════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 3 — NO INVITATION EVER AGAIN PRINTS A DATABASE IDENTIFIER
   WHERE A COMPANY'S NAME BELONGS.
   ════════════════════════════════════════════════════════════════════════════
   On the live investor invitations list one invitation's company read

       spv_e08dcbdd2921a89c

   The independent verification confirmed this is a CODE FALLBACK, not mistyped
   test data: `server/routes.ts:4228` (list) and `:4391` (detail) both ended

       name: … ?? resolvedCompanyId ?? ""

   and `getCompanyNameById` searches FOUNDER COMPANY MEMBERSHIPS only, so an
   `spv_…` id could never resolve. The platform therefore printed a database key
   where a company's name belongs, on the screen an investor reads BEFORE DECIDING
   TO WIRE MONEY. Wave 124 measured this class at 456 sites across 145 files and
   fixed 8 screens; the investor invitation screens were not among them.

   WHAT IS PROVEN HERE:
     A. an `spv_…` id now resolves to the SPV's REAL NAME — the `spv` table has a
        `name` column and nothing had ever looked for it;
     B. where no name exists anywhere, the output is the Wave 115 REFERENCE LABEL,
        which is plainly a reference and NOT the raw key;
     C. the raw identifier is never returned, for any prefix Wave 124 catalogued;
     D. no name is ever INVENTED — nothing that looks like a company name appears
        for an unknown id;
     E. the return is always a non-empty `string`, because
        `client/src/pages/investor/Invitations.tsx:382` calls `.split(" ")` on it to
        build initials and a `null` would crash the investor's page.

   FAIL-BEFORE: group (C) re-runs the deleted `?? resolvedCompanyId` expression and
   shows it returns the raw `spv_e08dcbdd2921a89c` — the exact string on production.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCompanyNameByIdMock = vi.fn<[string], string | null>();
const engineGetLegacySpvByIdMock = vi.fn<[string], { name: string } | null>();

vi.mock("../multiCompanyStore", () => ({
  getCompanyNameById: (id: string) => getCompanyNameByIdMock(id),
}));
vi.mock("../spvEngineStore", () => ({
  engineGetLegacySpvById: (id: string) => engineGetLegacySpvByIdMock(id),
}));

import { invitationCompanyName, COMPANY_NAME_NOT_RECORDED } from "../lib/invitationCompanyName";

/** The exact identifier a real investor read on the live invitations list. */
const LIVE_ID = "spv_e08dcbdd2921a89c";

beforeEach(() => {
  getCompanyNameByIdMock.mockReset();
  engineGetLegacySpvByIdMock.mockReset();
  getCompanyNameByIdMock.mockReturnValue(null);
  engineGetLegacySpvByIdMock.mockReturnValue(null);
});

describe("W125 · FINDING 3 (A) — the name that was there all along", () => {
  it("resolves an `spv_…` id to the SPV's recorded name", () => {
    engineGetLegacySpvByIdMock.mockReturnValue({ name: "Catalyst Growth SPV I" });
    expect(invitationCompanyName(LIVE_ID)).toBe("Catalyst Growth SPV I");
    expect(engineGetLegacySpvByIdMock).toHaveBeenCalledWith(LIVE_ID);
  });

  it("prefers the founder-company register when the id is a company", () => {
    getCompanyNameByIdMock.mockReturnValue("BluePrint Catalyst Limited");
    expect(invitationCompanyName("co_blueprint")).toBe("BluePrint Catalyst Limited");
    /* No need to consult the SPV store once a real name is in hand. */
    expect(engineGetLegacySpvByIdMock).not.toHaveBeenCalled();
  });

  it("prefers a name the caller already resolved over any lookup", () => {
    expect(invitationCompanyName(LIVE_ID, "Seeded Co")).toBe("Seeded Co");
    expect(getCompanyNameByIdMock).not.toHaveBeenCalled();
  });

  it("ignores blank and whitespace-only names rather than publishing emptiness", () => {
    engineGetLegacySpvByIdMock.mockReturnValue({ name: "   " });
    expect(invitationCompanyName(LIVE_ID, "  ")).toBe("Reference E08DCBDD2921A89C");
  });
});

describe("W125 · FINDING 3 (B) — where no name exists, plain English, never a key", () => {
  it("returns the Wave 115 reference label for the live identifier", () => {
    expect(invitationCompanyName(LIVE_ID)).toBe("Reference E08DCBDD2921A89C");
  });

  it("returns the words when there is no identifier at all", () => {
    expect(invitationCompanyName("")).toBe(COMPANY_NAME_NOT_RECORDED);
    expect(invitationCompanyName(null)).toBe(COMPANY_NAME_NOT_RECORDED);
    expect(invitationCompanyName(undefined)).toBe(COMPANY_NAME_NOT_RECORDED);
  });

  it("a throwing SPV store is not a reason to print an identifier", () => {
    engineGetLegacySpvByIdMock.mockImplementation(() => {
      throw new Error("store not hydrated");
    });
    const out = invitationCompanyName(LIVE_ID);
    expect(out).toBe("Reference E08DCBDD2921A89C");
    expect(out).not.toContain(LIVE_ID);
  });
});

describe("W125 · FINDING 3 (C) — the raw identifier can never be returned", () => {
  /* Every prefix Wave 124's detector catalogues, plus an unprefixed key. */
  const IDS = [
    LIVE_ID,
    "spv_0123456789abcdef",
    "co_9f2b1c4d5e6f7a8b",
    "u_aabbccddeeff0011",
    "ac_aabbccddeeff0011",
    "ext_aabbccddeeff0011",
    "spvlp_aabbccddeeff0011",
    "round_aabbccddeeff0011",
    "inv_aabbccddeeff0011",
    "mp_aabbccddeeff0011",
    "e08dcbdd2921a89c",
  ];

  it("never returns the id, and never contains a machine prefix", () => {
    for (const id of IDS) {
      const out = invitationCompanyName(id);
      expect(out).not.toBe(id);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toMatch(/\b(spv|spvlp|co|u|ac|ext|round|inv|mp)_/);
    }
  });

  it("FAIL-BEFORE — the deleted expression returns exactly what production printed", () => {
    const resolvedCompanyName = getCompanyNameByIdMock(LIVE_ID);
    /* `server/routes.ts:4391`, verbatim as it stood before this wave. */
    const before = resolvedCompanyName ?? LIVE_ID ?? "";
    expect(before).toBe("spv_e08dcbdd2921a89c");
    /* …and what the same input yields now. */
    expect(invitationCompanyName(LIVE_ID)).not.toBe(before);
  });
});

describe("W125 · FINDING 3 (D/E) — no invention, and always a usable string", () => {
  it("does not manufacture anything that reads as a company name", () => {
    const out = invitationCompanyName(LIVE_ID);
    expect(out.startsWith("Reference ")).toBe(true);
    expect(out).not.toMatch(/\b(Inc|LLC|Ltd|Limited|Corp|Holdings|Ventures|SPV|Fund)\b/);
  });

  it("always returns a non-empty string, so the investor page's initials cannot crash", () => {
    for (const id of ["", "  ", LIVE_ID, "co_x", "totally-unknown"]) {
      const out = invitationCompanyName(id);
      expect(typeof out).toBe("string");
      expect(out.trim().length).toBeGreaterThan(0);
      /* What `investor/Invitations.tsx:382` does with it. */
      expect(out.split(" ").map((s) => s[0]).join("").length).toBeGreaterThan(0);
    }
  });
});
