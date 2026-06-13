/**
 * v19 Phase C — correlation ID middleware tests.
 *
 * Coverage:
 *   - middleware sets req.id when no header present (UUID-shaped)
 *   - X-Correlation-ID request header is honored on the response
 *   - X-Request-ID is honored as an alias
 *   - X-Cap-Trace-ID is honored as an alias
 *   - Array-valued header is coerced to first element
 *   - getCorrelationId() returns the id from inside the middleware frame
 *   - getCorrelationId() returns undefined outside an active frame
 *   - control-char-laden header is rejected and a fresh UUID assigned
 *   - very-long header (>200) is rejected and a fresh UUID assigned
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import {
  correlationIdMiddleware,
  getCorrelationId,
  _internal,
} from "../lib/correlationId";

function mountApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.get("/_echo", (req, res) => {
    res.json({
      reqId: (req as any).id,
      fromStorage: getCorrelationId() ?? null,
    });
  });
  return app;
}

function callOnce(
  app: express.Express,
  headers: Record<string, string | string[]> = {},
): Promise<{
  status: number;
  body: any;
  resHeader: string | undefined;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/_echo",
          method: "GET",
          headers,
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            let body: any = null;
            try {
              body = JSON.parse(buf);
            } catch {
              /* keep raw */
            }
            resolve({
              status: res.statusCode ?? 0,
              body,
              resHeader: res.headers["x-correlation-id"] as string | undefined,
            });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

describe("v19 Phase C — correlationIdMiddleware", () => {
  it("assigns a UUID-shaped req.id when no header is present", async () => {
    const r = await callOnce(mountApp());
    expect(r.status).toBe(200);
    expect(typeof r.body.reqId).toBe("string");
    // UUID v4-ish: 8-4-4-4-12 hex.
    expect(r.body.reqId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(r.resHeader).toBe(r.body.reqId);
  });

  it("echoes X-Correlation-ID request header back unchanged", async () => {
    const provided = "trace-abc-123";
    const r = await callOnce(mountApp(), { "x-correlation-id": provided });
    expect(r.body.reqId).toBe(provided);
    expect(r.resHeader).toBe(provided);
  });

  it("honors X-Request-ID as an alias", async () => {
    const r = await callOnce(mountApp(), { "x-request-id": "alias-rid-1" });
    expect(r.body.reqId).toBe("alias-rid-1");
    expect(r.resHeader).toBe("alias-rid-1");
  });

  it("honors X-Cap-Trace-ID as an alias", async () => {
    const r = await callOnce(mountApp(), { "x-cap-trace-id": "cap-trace-9" });
    expect(r.body.reqId).toBe("cap-trace-9");
  });

  it("getCorrelationId returns the same value as req.id inside the request frame", async () => {
    const r = await callOnce(mountApp(), { "x-correlation-id": "frame-1" });
    expect(r.body.fromStorage).toBe("frame-1");
    expect(r.body.fromStorage).toBe(r.body.reqId);
  });

  it("getCorrelationId returns undefined outside any request frame", () => {
    // We're not inside a middleware frame here.
    expect(getCorrelationId()).toBeUndefined();
  });

  it("rejects a header with control characters and assigns a fresh UUID", () => {
    // Node's http client refuses to send a header with control chars, so we
    // invoke the middleware directly with a synthetic request object.
    const bad = "abc\u0001def";
    const fakeReq: any = { headers: { "x-correlation-id": bad } };
    const setHeaders: Record<string, string> = {};
    const fakeRes: any = {
      setHeader: (k: string, v: string) => {
        setHeaders[k] = v;
      },
    };
    let nextCalled = false;
    correlationIdMiddleware(fakeReq, fakeRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(fakeReq.id).not.toBe(bad);
    expect(fakeReq.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(setHeaders["X-Correlation-ID"]).toBe(fakeReq.id);
  });

  it("rejects an over-long header and assigns a fresh UUID", () => {
    const huge = "x".repeat(500);
    const fakeReq: any = { headers: { "x-correlation-id": huge } };
    const fakeRes: any = { setHeader: () => {} };
    correlationIdMiddleware(fakeReq, fakeRes, () => {});
    expect(fakeReq.id).not.toBe(huge);
    expect(fakeReq.id.length).toBeLessThanOrEqual(64);
  });

  it("prefers an array-valued header's first element", () => {
    const fakeReq: any = {
      headers: { "x-correlation-id": ["first-id", "second-id"] },
    };
    const fakeRes: any = { setHeader: () => {} };
    correlationIdMiddleware(fakeReq, fakeRes, () => {});
    expect(fakeReq.id).toBe("first-id");
  });

  it("exposes its header-name list via _internal for callers", () => {
    expect(_internal.HEADER_NAMES.length).toBeGreaterThanOrEqual(3);
    expect(_internal.HEADER_NAMES.map((s) => s.toLowerCase())).toContain(
      "x-correlation-id",
    );
    expect(_internal.HEADER_NAMES.map((s) => s.toLowerCase())).toContain(
      "x-request-id",
    );
  });
});
