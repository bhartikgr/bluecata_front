/* ════════════════════════════════════════════════════════════════════════════
   WAVE 209 · POST-BUILD REVIEW PASS (c) — THE ATTACK SUITE.
   ════════════════════════════════════════════════════════════════════════════
   The disarm harness (`build_log/wave209/w209_disarm.sh`) asks the opposite
   question to this file. It puts each defect BACK and requires the guarding test
   to go red. This file leaves the fix in place and ATTACKS it: it takes the role
   of a hostile browser and tries, by every route available to a client, to get a
   fabricated or defaulted network address into the durable evidential record.

   Every attack below must FAIL to plant its value. If any one of them succeeds,
   this wave has not actually closed the class of defect it claims to close — it
   has only closed the one instance the owner happened to notice.

   NO REPLICA (handbook §8). Real express app, real `registerRoutes`, real HTTP
   over a real socket, real `saveTermSheet`, real hash chain. The only thing
   invented here is the ATTACKER'S payload, which is the point.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { clearTermSheetStore, getLatestRevision, verifyChain } from "../termSheetStore";
import {
  isSignerAddressCaptured,
  NON_ADDRESS_TOKENS,
  normaliseServerObservedAddress,
  SIGNER_ADDRESS_NOT_CAPTURED,
  signerAddressDisplay,
} from "../../shared/wave209SignerAddress";
import { signSES, verifySES, type SESSignaturePayload } from "../../client/src/lib/esign/ses";

let app: Express;
let server: http.Server;
let port: number;

/* RFC 5737 documentation space plus RFC 3849 for IPv6. No client address can
   legitimately be in any of these blocks, so their presence in a stored record
   is proof of fabrication rather than a matter of opinion. */
const DOCUMENTATION_PREFIXES = ["192.0.2.", "198.51.100.", "203.0.113.", "2001:db8:"];

beforeAll(async () => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  app.use((req, _res, next) => {
    const r = req as express.Request & { cookies?: Record<string, string> };
    if (!r.cookies) r.cookies = {};
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => clearTermSheetStore());

type CallResponse = { status: number; body: any };

/** Real HTTP, with attacker-controlled headers where a header is the attack. */
function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "x-user-id": "u_admin", ...extraHeaders };
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function realSignature(over: Partial<SESSignaturePayload> = {}) {
  const p: SESSignaturePayload = {
    documentId: "ts-rnd_atk",
    documentType: "termsheet",
    signerName: "Hostile Client",
    signerEmail: "attacker@capavate.test",
    signerRole: "founder",
    intentText: "I agree to the term sheet.",
    ipAddress: SIGNER_ADDRESS_NOT_CAPTURED,
    userAgent: SIGNER_ADDRESS_NOT_CAPTURED,
    timestamp: "2026-08-29T12:00:00.000Z",
    sessionId: "ses_atk",
    prevHash: "0".repeat(64),
    ...over,
  };
  return signSES(p);
}

function body(over: Record<string, unknown> = {}) {
  return {
    roundId: "rnd_atk",
    companyId: "co_atk",
    source: "generated",
    region: "us-de",
    instrument: "safe",
    templateId: "tpl_yc_safe",
    templateName: "YC SAFE",
    sections: [{ id: "sec_1", heading: "Valuation Cap", body: "ten million", edited: false }],
    citations: [],
    status: "draft",
    ...over,
  };
}

/** The whole persisted row as JSON — nothing is exempt from the search. */
function storedRowText(roundId: string): string {
  const rev = getLatestRevision(roundId);
  expect(rev, "the attack must actually have produced a stored revision, or it proves nothing").toBeTruthy();
  return JSON.stringify(rev);
}

describe("W209-ATK · a hostile client cannot plant a fabricated address in the durable record", () => {
  /* ATTACK 1. The obvious one: send the exact fabricated value the old
     `captureSessionMetadata()` produced, in the field the server writes. */
  it("A-1. a client-supplied serverObservedSignerIp in documentation space is overwritten, not stored", async () => {
    const res = await call("POST", "/api/founder/term-sheets", body({ serverObservedSignerIp: "198.51.100.42" }));
    expect(res.status).toBe(200);
    const text = storedRowText("rnd_atk");
    for (const prefix of DOCUMENTATION_PREFIXES) {
      expect(text, `the attacker's ${prefix} value reached the stored row`).not.toContain(prefix);
    }
    const stored = getLatestRevision("rnd_atk")!.payload.serverObservedSignerIp;
    expect(stored).toBe(normaliseServerObservedAddress("127.0.0.1"));
    expect(verifyChain("rnd_atk").ok).toBe(true);
  });

  /* ATTACK 2. Same field, but every documentation range and the IPv6 one, one
     save each. A fix that pattern-matched only the range the owner named would
     pass attack 1 and fail here. */
  it("A-2. every documentation range is refused, not just the one the owner reported", async () => {
    const claims = ["192.0.2.7", "198.51.100.7", "203.0.113.7", "2001:db8::7"];
    for (let i = 0; i < claims.length; i++) {
      clearTermSheetStore();
      const roundId = `rnd_atk_${i}`;
      const res = await call("POST", "/api/founder/term-sheets", body({ roundId, serverObservedSignerIp: claims[i] }));
      expect(res.status).toBe(200);
      const text = storedRowText(roundId);
      expect(text, `claim ${claims[i]} survived into the row`).not.toContain(claims[i]);
      expect(res.body.serverObservedSignerIp).not.toBe(claims[i]);
    }
  });

  /* ATTACK 3. Not address-shaped fiction — a NON-ADDRESS token dressed as one.
     `"unknown"` is what `server/lib/rateLimit.ts` returns when it has no peer,
     and the honest response is the explicit sentinel, never the token itself
     presented as an observation. */
  it("A-3. a non-address token cannot be stored as though it were an observed address", async () => {
    for (const token of NON_ADDRESS_TOKENS) {
      expect(isSignerAddressCaptured(token), `${token} was accepted as a captured address`).toBe(false);
      /* `normaliseServerObservedAddress` encodes absence as `null` on the STORED
         row and the renderer turns that `null` into the words. The token itself
         must never survive as though it were an observation, which is the claim. */
      expect(normaliseServerObservedAddress(token)).toBeNull();
      expect(signerAddressDisplay(normaliseServerObservedAddress(token))).toBe(SIGNER_ADDRESS_NOT_CAPTURED);
    }
    clearTermSheetStore();
    const res = await call("POST", "/api/founder/term-sheets", body({ roundId: "rnd_atk_tok", serverObservedSignerIp: "unknown" }));
    expect(res.status).toBe(200);
    const stored = getLatestRevision("rnd_atk_tok")!.payload.serverObservedSignerIp;
    expect(isSignerAddressCaptured(stored)).toBe(true);
    expect(stored).toBe(normaliseServerObservedAddress("127.0.0.1"));
  });

  /* ATTACK 4. Spoof the forwarding headers. This is the classic way to make a
     server "observe" an address of the attacker's choosing. The assertion is
     deliberately NOT "the header is ignored" — a correctly configured proxy
     deployment may honour it — but "whatever is honoured, a documentation-space
     address never lands in the row". */
  it("A-4. spoofed X-Forwarded-For / X-Real-IP headers cannot put documentation space in the row", async () => {
    const headerSets: Record<string, string>[] = [
      { "x-forwarded-for": "198.51.100.99" },
      { "x-forwarded-for": "203.0.113.5, 192.0.2.1" },
      { "x-real-ip": "192.0.2.44" },
      { "x-forwarded-for": "2001:db8::dead" },
      { forwarded: "for=198.51.100.7" },
    ];
    for (let i = 0; i < headerSets.length; i++) {
      clearTermSheetStore();
      const roundId = `rnd_atk_hdr_${i}`;
      const res = await call("POST", "/api/founder/term-sheets", body({ roundId }), headerSets[i]);
      expect(res.status).toBe(200);
      const text = storedRowText(roundId);
      for (const prefix of DOCUMENTATION_PREFIXES) {
        expect(text, `header set ${JSON.stringify(headerSets[i])} planted ${prefix}`).not.toContain(prefix);
      }
      const stored = getLatestRevision(roundId)!.payload.serverObservedSignerIp;
      expect(isSignerAddressCaptured(stored), "the stored value must still be a real observation or the explicit sentinel").toBe(true);
    }
  });

  /* ATTACK 5. Go around the server field entirely and plant the fiction inside
     the SIGNATURE object, which the server must not touch. The point of this
     test is honesty about the limit of the fix: a signature is the CLIENT's
     statement, the server cannot re-hash it without invalidating it, so a
     hostile client CAN still put a string of its choosing in `signature.ipAddress`.
     What this wave guarantees is that (i) Capavate's own code no longer does it,
     and (ii) the server's independent observation is stored beside it, so a
     reader can tell the two apart. Asserting anything stronger would be a false
     claim, so this test pins the ACTUAL guarantee. */
  it("A-5. a client can still self-report in signature.ipAddress — and the server's own observation is stored beside it, distinguishable", async () => {
    const sig = realSignature({ ipAddress: "198.51.100.200" });
    const res = await call("POST", "/api/founder/term-sheets", body({ roundId: "rnd_atk_sig", status: "signed", signature: sig }));
    expect(res.status).toBe(200);

    const rev = getLatestRevision("rnd_atk_sig")!;
    const storedSig = (rev.payload as { signature?: typeof sig }).signature!;

    /* The client's claim is preserved verbatim — it must be, because rewriting it
       would break its own hash and destroy the signature as evidence. */
    expect(storedSig.ipAddress).toBe("198.51.100.200");
    expect(verifySES(storedSig), "the signature must still verify; the server must not have touched it").toBe(true);

    /* And the server's INDEPENDENT observation sits beside it, so the record
       distinguishes "what the signer said" from "what we saw". */
    const observed = rev.payload.serverObservedSignerIp;
    expect(observed).toBe(normaliseServerObservedAddress("127.0.0.1"));
    expect(observed).not.toBe(storedSig.ipAddress);
    expect(verifyChain("rnd_atk_sig").ok).toBe(true);
  });

  /* ATTACK 6. Try to make the server store NOTHING at all in the field — an
     omission is the failure mode R187.1 item 3 warns about, because a reader
     cannot distinguish "absent" from "never asked". */
  it("A-6. the field is never silently absent — a save always carries either an observation or the sentinel", async () => {
    clearTermSheetStore();
    const res = await call("POST", "/api/founder/term-sheets", body({ roundId: "rnd_atk_abs" }));
    expect(res.status).toBe(200);
    const rev = getLatestRevision("rnd_atk_abs")!;
    expect(Object.keys(rev.payload)).toContain("serverObservedSignerIp");
    const v = rev.payload.serverObservedSignerIp;
    /* Either a real observation, or an explicit `null` that the renderer turns
       into the words "not captured". What is forbidden is a MISSING key (a reader
       cannot tell "absent" from "never asked") or a blank string. */
    expect(signerAddressDisplay(v).trim()).not.toBe("");
    expect(v === null || isSignerAddressCaptured(v)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.body, "serverObservedSignerIp")).toBe(true);
  });

  /* ANTI-VACUITY. If the route stopped storing revisions at all, every "not
     .toContain" assertion above would pass on an empty string. This proves the
     attacks were run against a real, populated, chain-valid row. */
  it("A-7. anti-vacuity — the attacks above ran against real stored rows", async () => {
    clearTermSheetStore();
    await call("POST", "/api/founder/term-sheets", body({ roundId: "rnd_atk_vac" }));
    const text = storedRowText("rnd_atk_vac");
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("rnd_atk_vac");
    expect(text).toContain("serverObservedSignerIp");
    /* And the search itself works: a documentation prefix IS detectable in a
       string that contains one, so the negative assertions are not no-ops. */
    expect(`${text}198.51.100.1`).toContain("198.51.100.");
  });
});
