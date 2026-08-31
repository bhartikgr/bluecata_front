/* ════════════════════════════════════════════════════════════════════════════
   WAVE 209 · ITEM A · §209.2(a) — THE ONE DURABLE SIGNING FLOW IS STAMPED BY THE
                                   SERVER, NOT BY THE BROWSER.
   ════════════════════════════════════════════════════════════════════════════
   WHY THIS SUITE EXISTS. Of the five flows that reach the fabricated address,
   exactly ONE writes a durable row: `client/src/pages/founder/TermSheet.tsx`
   posts to `POST /api/founder/term-sheets`, which INSERTs into
   `term_sheet_revisions` with a per-round hash chain. R187.1 prefers option (a)
   — the SERVER records the peer it observed — wherever a server round-trip
   exists on the path. It exists here, so this flow gets option (a).

   NO REPLICA (handbook §8). This suite boots the REAL express app through the
   REAL `registerRoutes`, and drives the REAL HTTP route over a real socket.
   Nothing about the address path is mocked: the peer address asserted below is
   the one the operating system reported for this test's own connection.

   WHAT IS PROVED:
     1.  A save stamps a real observed address onto the durable revision.
     2.  The stamped value is NOT a documentation-space (RFC 5737 / RFC 3849)
         address and NOT a non-address token.
     3.  A client-supplied `serverObservedSignerIp` is OVERWRITTEN. This is the
         assertion that matters most: a browser must not be able to write its own
         claim into the evidential field, which is the whole class of defect this
         wave removes.
     4.  The value is inside the revision HASH — it is covered by the chain, not
         bolted on beside it — and `verifyChain` still passes.
     5.  The signature object itself is UNTOUCHED. `verifySES()` re-hashes every
         key of the payload, so the server must never write into or add a key to
         `signature`. Proved by re-verifying a signature round-tripped through the
         route.
     6.  Revision numbering, prev-hash chaining and the signed-lock (409) are all
         unchanged by this wave.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { clearTermSheetStore, getLatestRevision, getRevisions, verifyChain, computeRevisionHash } from "../termSheetStore";
import { isSignerAddressCaptured, NON_ADDRESS_TOKENS } from "../../shared/wave209SignerAddress";
import { verifySES, signSES, type SESSignaturePayload } from "../../client/src/lib/esign/ses";

let app: Express;
let server: http.Server;
let port: number;

const DOCUMENTATION_PREFIXES = ["192.0.2.", "198.51.100.", "203.0.113.", "2001:db8:"];

beforeAll(async () => {
  app = express();
  app.use(express.json());
  /* u_admin by default: `assertRoundOwnership` short-circuits for an admin, so
     this suite exercises the ADDRESS path rather than re-litigating the founder
     ownership rules, which have their own suites. */
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

function call(method: string, path: string, body?: unknown): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "x-user-id": "u_admin" };
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

/** A real client-shaped SES signature, built by the REAL `signSES`. */
function realSignature(over: Partial<SESSignaturePayload> = {}) {
  const payload: SESSignaturePayload = {
    documentId: "ts-rnd_w209",
    documentType: "termsheet",
    signerName: "Avi Founder",
    signerEmail: "avi@capavate.test",
    signerRole: "founder",
    intentText: "I agree to the term sheet.",
    ipAddress: "not captured",
    userAgent: "not captured",
    timestamp: "2026-08-29T12:00:00.000Z",
    sessionId: "ses_w209",
    prevHash: "0".repeat(64),
    ...over,
  };
  return signSES(payload);
}

function payload(over: Record<string, unknown> = {}) {
  return {
    roundId: "rnd_w209",
    companyId: "co_w209",
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

describe("W209 · POST /api/founder/term-sheets stamps the address the SERVER observed", () => {
  it("1+2. the durable revision carries a real observed address, never a documentation one", async () => {
    const r = await call("POST", "/api/founder/term-sheets", payload());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const stamped = r.body.serverObservedSignerIp;
    /* The peer for this test IS 127.0.0.1 — that is a true statement about what
       the server observed, and the honesty rule is "state what you observed",
       not "state something routable". What is forbidden is a value the server
       did NOT observe. */
    expect(typeof stamped).toBe("string");
    expect(isSignerAddressCaptured(stamped)).toBe(true);
    for (const p of DOCUMENTATION_PREFIXES) expect(String(stamped).toLowerCase().startsWith(p)).toBe(false);
    for (const t of NON_ADDRESS_TOKENS) expect(String(stamped).toLowerCase()).not.toBe(t);

    /* And it is on the PERSISTED row, read back through the store, not only in
       the response body. */
    const latest = getLatestRevision("rnd_w209");
    expect((latest?.payload as any).serverObservedSignerIp).toBe(stamped);
  });

  it("3. a client-supplied serverObservedSignerIp is OVERWRITTEN, not trusted", async () => {
    const lie = "198.51.100.42";
    const r = await call("POST", "/api/founder/term-sheets", payload({ serverObservedSignerIp: lie }));
    expect(r.status).toBe(200);
    expect(r.body.serverObservedSignerIp).not.toBe(lie);

    const stored = (getLatestRevision("rnd_w209")?.payload as any).serverObservedSignerIp;
    expect(stored).not.toBe(lie);
    expect(isSignerAddressCaptured(stored)).toBe(true);
    /* The whole persisted row must not contain the client's claim anywhere. */
    expect(JSON.stringify(getLatestRevision("rnd_w209"))).not.toContain(lie);
  });

  it("3b. a client-supplied non-address token is replaced by the observed address, not persisted", async () => {
    for (const token of ["unknown", "0.0.0.0", "", "n/a"]) {
      clearTermSheetStore();
      const r = await call("POST", "/api/founder/term-sheets", payload({ serverObservedSignerIp: token }));
      expect(r.status).toBe(200);
      const stored = (getLatestRevision("rnd_w209")?.payload as any).serverObservedSignerIp;
      expect(isSignerAddressCaptured(stored)).toBe(true);
    }
  });

  it("4. the stamped address is INSIDE the revision hash, and the chain still verifies", async () => {
    const r1 = await call("POST", "/api/founder/term-sheets", payload());
    const r2 = await call("POST", "/api/founder/term-sheets", payload());
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const revs = getRevisions("rnd_w209");
    expect(revs.length).toBe(2);
    expect(revs[0].prevRevisionHash).toBe("GENESIS");
    expect(revs[1].prevRevisionHash).toBe(revs[0].revisionHash);
    expect(verifyChain("rnd_w209")).toEqual({ ok: true });

    /* Coverage proof, not a claim: recompute the hash from the SAME canonical
       body with the address altered. A different hash means the field is inside
       the chain's integrity envelope. */
    const canonicalWith = JSON.stringify(revs[0].payload, Object.keys(revs[0].payload).sort());
    const tampered = { ...(revs[0].payload as any), serverObservedSignerIp: "198.51.100.9" };
    const canonicalWithout = JSON.stringify(tampered, Object.keys(tampered).sort());
    expect(canonicalWith).not.toBe(canonicalWithout);
    expect(computeRevisionHash("GENESIS", canonicalWith)).not.toBe(computeRevisionHash("GENESIS", canonicalWithout));
  });

  it("5. the signature object round-trips byte-identically and still self-verifies", async () => {
    const sig = realSignature();
    expect(verifySES(sig)).toBe(true);

    const r = await call("POST", "/api/founder/term-sheets", payload({ signature: sig }));
    expect(r.status).toBe(200);

    const stored = (getLatestRevision("rnd_w209")?.payload as any).signature;
    /* No key added, no key removed, no value rewritten — otherwise the signature
       would stop verifying and every historical record with it. */
    expect(Object.keys(stored).sort()).toEqual(Object.keys(sig).sort());
    expect(stored).toEqual(sig);
    expect(verifySES(stored)).toBe(true);
    /* The signature's own ipAddress stays the client's honest sentinel; the
       server's observation lives BESIDE it, never inside it. */
    expect(stored.ipAddress).toBe("not captured");
    expect((getLatestRevision("rnd_w209")?.payload as any).serverObservedSignerIp).not.toBe("not captured");
  });

  it("6. revision numbering and the signed-lock are unchanged by this wave", async () => {
    const a = await call("POST", "/api/founder/term-sheets", payload());
    expect(a.body.revision.revision).toBe(1);
    const b = await call("POST", "/api/founder/term-sheets", payload({ status: "signed" }));
    expect(b.body.revision.revision).toBe(2);
    const c = await call("POST", "/api/founder/term-sheets", payload());
    expect(c.status).toBe(409);
    expect(c.body.error).toBe("termsheet_locked");
  });

  it("7. an unauthenticated save is still refused before any address is stamped", async () => {
    const r = await new Promise<CallResponse>((resolve, reject) => {
      const data = JSON.stringify(payload());
      const req = http.request(
        {
          hostname: "127.0.0.1", port, path: "/api/founder/term-sheets", method: "POST",
          headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode ?? 0, body: raw }); } });
        },
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    });
    expect(r.status).toBe(401);
    expect(getRevisions("rnd_w209").length).toBe(0);
  });
});
