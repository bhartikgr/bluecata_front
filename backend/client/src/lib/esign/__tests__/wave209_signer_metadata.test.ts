/* ════════════════════════════════════════════════════════════════════════════
   WAVE 209 · ITEM A — THE FABRICATED SIGNER ADDRESS IS GONE, AND ITS ABSENCE
                       IS STATED RATHER THAN LEFT BLANK.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN, QUOTED FROM THE SHIPPED SOURCE. `captureSessionMetadata()` in
   `client/src/lib/esign/ses.ts` — a module whose own header cites
   "ESIGN Act / UETA … eIDAS Article 25 SES" — read:

       ipAddress: `198.51.100.${(sid.charCodeAt(4) + sid.charCodeAt(5)) % 254}`,

   `198.51.100.0/24` is RFC 5737 TEST-NET-2: documentation space, reserved for
   examples, and never a real client address. `signSES()` hashes the canonical
   JSON of the WHOLE payload, so the invented address was sealed inside the
   signature hash of every soft-circle and term-sheet signature this platform
   produced. The sibling `userAgent: "node"` fallback (`ses.ts:63`) was the same
   defect in miniature: a synthesised user agent inside an evidential record.

   WHAT THIS SUITE PROVES, AGAINST THE REAL FUNCTIONS (handbook §8 — no replica,
   no mock of the thing under test):
     (A) `captureSessionMetadata()` returns the explicit sentinel, never an
         address, and NEVER a value in any RFC 5737 / RFC 3849 range.
     (B) The return SHAPE is byte-identical to before: exactly the four original
         keys. This is the assertion that guards every signature already written
         — `verifySES()` re-hashes every key it finds, so an added or dropped key
         would invalidate the entire historical corpus.
     (C) Signatures written BEFORE this wave — including ones carrying the old
         fabricated address — still verify. The fix is forward-only; it does not
         rewrite or break history.
     (D) The predicates treat every non-address token as an absence, and
         `signerAddressDisplay()` never returns a blank.
     (E) `normaliseServerObservedAddress()` passes a real address through and
         refuses `"unknown"` / `"0.0.0.0"` / blank, so a non-address token from
         the hardened resolver can never be persisted as if it were an address.
     (F) `resolveSignerAddressFromServerResponse()` reads the address the SERVER
         stated and invents nothing when the response carries none.
     (G) Both new sentences clear the 240-character `looksHuman` gate, measured
         against the REAL constant in `shared/refusalHeadlineGate.ts` rather than
         assumed — that gate has silently swallowed a message four times here.
     (H) A tree-wide negative assertion: no non-test source file under
         `client/src` contains `198.51.100`.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { captureSessionMetadata, signSES, verifySES, type SESSignaturePayload } from "../ses";
import {
  SIGNER_ADDRESS_NOT_CAPTURED,
  SIGNER_ADDRESS_NOT_CAPTURED_REASON,
  SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE,
  SIGNER_ADDRESS_SERVER_OBSERVED_SENTENCE,
  captureClientSignerAddress,
  isSignerAddressCaptured,
  resolveSignerAddressFromServerResponse,
  signerAddressDisplay,
} from "../wave209SignerMetadata";
import { normaliseServerObservedAddress } from "@shared/wave209SignerAddress";
import { LOOKS_HUMAN_MAX_LENGTH } from "@shared/refusalHeadlineGate";

/** Every documentation range a fabricated address could have come from.
 *  RFC 5737 §3 (IPv4) and RFC 3849 (IPv6). */
const DOCUMENTATION_PREFIXES = ["192.0.2.", "198.51.100.", "203.0.113.", "2001:db8:"];

/* ───────────────────────── (A) the fabrication is gone ──────────────────── */
describe("W209-A · captureSessionMetadata no longer fabricates an address", () => {
  it("returns the explicit sentinel, not an address", () => {
    const meta = captureSessionMetadata();
    expect(meta.ipAddress).toBe(SIGNER_ADDRESS_NOT_CAPTURED);
    expect(meta.ipAddress).toBe("not captured");
    /* The sentinel must not be address-shaped at all: nothing downstream may be
       able to parse it as one. */
    expect(meta.ipAddress).not.toMatch(/^[0-9a-f.:]+$/i);
  });

  it("cannot produce a documentation-space address on ANY session id", () => {
    /* The old expression derived the last octet from two character codes of the
       session id, so it varied per call. Called repeatedly to defeat exactly
       that: 500 real calls, every one asserted. */
    for (let i = 0; i < 500; i++) {
      const meta = captureSessionMetadata();
      for (const prefix of DOCUMENTATION_PREFIXES) {
        expect(meta.ipAddress.toLowerCase().startsWith(prefix)).toBe(false);
      }
      expect(isSignerAddressCaptured(meta.ipAddress)).toBe(false);
    }
  });

  it("never reports a synthesised user agent", () => {
    const meta = captureSessionMetadata();
    /* Under vitest's jsdom-less server environment there is no navigator, so the
       honest answer is the sentinel — NOT the old "node" literal, which claimed
       a user agent the signer never presented. */
    expect(meta.userAgent).not.toBe("node");
    if (typeof navigator === "undefined") {
      expect(meta.userAgent).toBe(SIGNER_ADDRESS_NOT_CAPTURED);
    } else {
      expect(meta.userAgent).toBe(navigator.userAgent);
    }
  });

  it("captureClientSignerAddress() is the single client answer", () => {
    expect(captureClientSignerAddress()).toBe(SIGNER_ADDRESS_NOT_CAPTURED);
  });
});

/* ──────────── (B) the payload shape is unchanged — the history guard ─────── */
describe("W209-B · the SES payload shape is byte-identical", () => {
  it("captureSessionMetadata returns exactly the four original keys", () => {
    const meta = captureSessionMetadata();
    expect(Object.keys(meta).sort()).toEqual(["ipAddress", "sessionId", "timestamp", "userAgent"]);
  });

  it("a signature built from it carries exactly the eleven payload keys plus hash", () => {
    const meta = captureSessionMetadata();
    const sig = signSES({
      documentId: "doc_w209",
      documentType: "termsheet",
      signerName: "Avi Founder",
      signerEmail: "avi@example.com",
      signerRole: "founder",
      intentText: "I agree to the term sheet draft.",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      timestamp: meta.timestamp,
      sessionId: meta.sessionId,
      prevHash: "0".repeat(64),
    });
    expect(Object.keys(sig).sort()).toEqual([
      "documentId", "documentType", "hash", "intentText", "ipAddress",
      "prevHash", "sessionId", "signerEmail", "signerName", "signerRole",
      "timestamp", "userAgent",
    ]);
    expect(verifySES(sig)).toBe(true);
  });
});

/* ──────── (C) signatures already written are unaffected ─────────────────── */
describe("W209-C · pre-wave signatures still verify", () => {
  /* A payload IDENTICAL to the one the pre-wave client produced, fabricated
     address and all. This is a HISTORICAL RECORD, not a fixture standing in for
     production behaviour: item C of this wave is explicitly report-only, and the
     point being proved is that the fix does not retroactively invalidate rows. */
  const historical: SESSignaturePayload = {
    documentId: "doc_w209_historical",
    documentType: "softcircle",
    signerName: "Investor",
    signerEmail: "investor@example.com",
    signerRole: "investor",
    intentText: "Soft-circle USD 250,000. Non-binding indication.",
    ipAddress: "198.51.100.77",
    userAgent: "node",
    timestamp: "2026-05-04T09:12:33.000Z",
    sessionId: "ses_w209_hist",
    prevHash: "0".repeat(64),
  };

  it("a signature carrying the OLD fabricated address still verifies", () => {
    const sig = signSES(historical);
    expect(verifySES(sig)).toBe(true);
  });

  it("the record is still readable and its address is reported as unreliable-shaped, not blanked", () => {
    /* A documentation address is not in NON_ADDRESS_TOKENS on purpose (see the
       module comment): it is a fabrication, not an absence spelled oddly, and
       filtering it at the sink would hide the very rows item C asks the owner to
       decide about. So it renders as itself — the historical row is not silently
       rewritten by this wave. */
    expect(signerAddressDisplay(historical.ipAddress)).toBe("198.51.100.77");
  });
});

/* ──────── (D) the predicates and the renderer ──────────────────────────── */
describe("W209-D · absence is recognised and never rendered blank", () => {
  const absences: unknown[] = [
    undefined, null, "", "   ", 42, {}, [],
    "not captured", "NOT CAPTURED", " not captured ",
    "unknown", "UNKNOWN", "0.0.0.0", "::", "n/a", "N/A", "none", "null", "undefined",
  ];

  it("isSignerAddressCaptured() is false for every absence", () => {
    for (const v of absences) expect(isSignerAddressCaptured(v)).toBe(false);
  });

  it("isSignerAddressCaptured() is true for a real address", () => {
    for (const v of ["203.0.113.9", "8.8.8.8", "10.1.2.3", "2600:1f18::1"]) {
      expect(isSignerAddressCaptured(v)).toBe(true);
    }
  });

  it("signerAddressDisplay() never returns an empty string", () => {
    for (const v of absences) {
      expect(signerAddressDisplay(v)).toBe(SIGNER_ADDRESS_NOT_CAPTURED);
      expect(signerAddressDisplay(v).trim().length).toBeGreaterThan(0);
    }
  });

  it("the stored reason explains the absence without naming an address", () => {
    expect(SIGNER_ADDRESS_NOT_CAPTURED_REASON).toContain("cannot observe its own public network address");
    for (const prefix of DOCUMENTATION_PREFIXES) {
      expect(SIGNER_ADDRESS_NOT_CAPTURED_REASON).not.toContain(prefix);
    }
  });
});

/* ──────── (E) a non-address token can never be persisted as an address ─── */
describe("W209-E · normaliseServerObservedAddress refuses non-addresses", () => {
  it("passes a real address through, trimmed", () => {
    expect(normaliseServerObservedAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(normaliseServerObservedAddress("  8.8.8.8  ")).toBe("8.8.8.8");
  });

  it("returns null — not a plausible substitute — for every non-address", () => {
    /* `server/lib/rateLimit.ts:383` can return the literal "unknown", and
       `server/gdprRoutes.ts:220` carries a "0.0.0.0" fallback. Neither may reach
       a durable signer-address field. */
    for (const v of ["unknown", "0.0.0.0", "::", "", "   ", "n/a", null, undefined, 7]) {
      expect(normaliseServerObservedAddress(v)).toBeNull();
    }
  });
});

/* ──────── (F) the client reads the address the SERVER stated ───────────── */
describe("W209-F · resolveSignerAddressFromServerResponse", () => {
  it("reads the flat field the save route returns", () => {
    expect(resolveSignerAddressFromServerResponse({ ok: true, serverObservedSignerIp: "198.18.0.5" })).toBe("198.18.0.5");
  });

  it("reads it from the nested revision payload", () => {
    expect(
      resolveSignerAddressFromServerResponse({ ok: true, revision: { payload: { serverObservedSignerIp: "198.18.0.6" } } }),
    ).toBe("198.18.0.6");
  });

  it("invents nothing when the response carries no address", () => {
    for (const r of [undefined, null, {}, "text", { ok: true }, { ok: true, serverObservedSignerIp: null }, { ok: true, serverObservedSignerIp: "unknown" }]) {
      expect(resolveSignerAddressFromServerResponse(r)).toBe(SIGNER_ADDRESS_NOT_CAPTURED);
    }
  });
});

/* ──────── (G) the 240-character looksHuman gate, measured not assumed ──── */
describe("W209-G · the new copy clears the looksHuman gate", () => {
  it("both sentences are shorter than the real gate limit", () => {
    expect(LOOKS_HUMAN_MAX_LENGTH).toBe(240);
    expect(SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(SIGNER_ADDRESS_SERVER_OBSERVED_SENTENCE.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
  });

  it("both sentences read as English, not as a code token", () => {
    for (const s of [SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE, SIGNER_ADDRESS_SERVER_OBSERVED_SENTENCE]) {
      expect(s.trim()).toBe(s);
      expect(s.endsWith(".")).toBe(true);
      expect(s.split(" ").length).toBeGreaterThan(12);
      expect(s).not.toMatch(/[{}<>$`]/);
    }
  });
});

/* ──────── (H) tree-wide: no documentation address in client source ─────── */
describe("W209-H · no fabricated address survives anywhere in client source", () => {
  const CLIENT_SRC = resolve(__dirname, "../../../");

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        /* Test directories are EXCLUDED, and that exclusion is the whole point
           of the fixture-vs-production distinction this wave had to make: a
           documentation address supplied as INPUT to `signSES()` by a test is
           correct and must be left alone (`ses.test.ts:11` is exactly that).
           Only files that can reach a production render or record are scanned. */
        if (entry === "__tests__" || entry === "node_modules") continue;
        sourceFiles(full, out);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  /* THE COMMENT TRAP THE HANDBOOK NAMES. `ses.ts` and `wave209SignerMetadata.ts`
     both QUOTE the removed expression in their prose, which is required — a fix
     nobody can read is a fix nobody can review. A grep that counted those would
     report a defect that does not exist. Comments are therefore stripped before
     any conclusion, and the stripper self-checks below so the conclusion cannot
     rest on a stripper that silently did nothing. */
  function stripComments(src: string): string {
    let out = "";
    let i = 0;
    let mode: "code" | "line" | "block" | "single" | "double" | "tick" = "code";
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (mode === "code") {
        if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
        if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
        if (c === "'") mode = "single";
        else if (c === '"') mode = "double";
        else if (c === "`") mode = "tick";
        out += c; i += 1; continue;
      }
      if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i += 1; continue; }
      if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; continue; } if (c === "\n") out += c; i += 1; continue; }
      /* inside a string literal: keep it, honour escapes, and close on the
         matching quote. String literals are KEPT deliberately — the fabricated
         address WAS a string literal, so stripping literals would make this
         assertion vacuous. */
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if ((mode === "single" && c === "'") || (mode === "double" && c === '"') || (mode === "tick" && c === "`")) mode = "code";
      i += 1;
    }
    return out;
  }

  it("the comment stripper actually strips, and keeps string literals", () => {
    expect(stripComments('const a = 1; // 198.51.100.1\n')).not.toContain("198.51.100");
    expect(stripComments('/* 198.51.100.2 */ const b = 2;')).not.toContain("198.51.100");
    expect(stripComments('const c = "198.51.100.3";')).toContain("198.51.100.3");
    expect(stripComments('const d = `198.51.100.4`;')).toContain("198.51.100.4");
    expect(stripComments('const e = "a // b"; // gone\n')).toContain("a // b");
  });

  /* The ONE file that still holds the literal in executable code, with its
     reachability verdict from the wave-209 sweep (finding B3). It is a demo
     seeder that returns before doing anything unless BOTH
     `import.meta.env.MODE !== "production"` AND
     `import.meta.env.VITE_ENABLE_DEMO_SEED === "1"`, and what it seeds is
     in-memory telemetry, never an evidential record. Per R171.1 it was reported,
     not changed. Listing it by name here means the day it stops being the only
     one, THIS TEST FAILS. */
  const KNOWN_NON_EVIDENTIAL = [join("lib", "sprint3Seed.ts")];

  it("zero occurrences of 198.51.100 in executable client source outside the one reported demo seeder", () => {
    const offenders = sourceFiles(CLIENT_SRC)
      .filter((f) => stripComments(readFileSync(f, "utf8")).includes("198.51.100"))
      .filter((f) => !KNOWN_NON_EVIDENTIAL.some((k) => f.endsWith(k)));
    expect(offenders).toEqual([]);
  });

  it("ses.ts holds the literal ONLY in prose — the signing path itself is clean", () => {
    const src = readFileSync(resolve(__dirname, "../ses.ts"), "utf8");
    expect(src).toContain("198.51.100");            // the defect is documented
    expect(stripComments(src)).not.toContain("198.51.100"); // and no longer executed
  });

  it("the scan actually looked at ses.ts — the negative assertion is not vacuous", () => {
    const scanned = sourceFiles(CLIENT_SRC);
    expect(scanned.some((f) => f.endsWith(join("lib", "esign", "ses.ts")))).toBe(true);
    expect(scanned.length).toBeGreaterThan(100);
  });
});
