import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { apiRequestLog, API_LOG_ROUTE_FALLBACK } from "../lib/apiRequestLog";
import fs from "fs";
import path from "path";

describe("API Logging Safety Limits", () => {
  it("Source Wiring: index.ts uses apiRequestLog and does NOT contain res.json capture", () => {
    const indexPath = path.join(__dirname, "../index.ts");
    const source = fs.readFileSync(indexPath, "utf8");
    
    // Positive wiring check
    expect(source).toContain("app.use(apiRequestLog(log));");
    
    // Negative checks for old unsafe capture (ensure the middleware logic itself is gone)
    expect(source).not.toContain("res.json = function");
    expect(source).not.toContain("capturedJsonResponse = bodyJson");
    
    // Since JSON.stringify appears inside an unrelated comment ("// Failures: " + JSON.stringify(lazyCheck.failures)),
    // we specifically target the old logger implementation.
    expect(source).not.toContain("JSON.stringify(capturedJsonResponse)");
  });

  describe("Express Real Response Behaviors", () => {
    let app: express.Express;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeAll(() => {
      app = express();
      logSpy = vi.fn();

      app.use(apiRequestLog(logSpy));
      
      // 1. Nested claimUrl/secrets
      app.get("/api/secure-claim", (req, res) => {
        res.status(201).json({ 
          claimUrl: "https://example.com/auth/redeem?token=secret_123", 
          nested: { password: "abc", email: "hacker@test.com" } 
        });
      });

      // 2. Synthetic token in path parameter (router-local pattern)
      const router = express.Router();
      router.get("/:synthetic_token/redeem", (req, res) => {
        res.json({ success: true, tokenParam: req.params.synthetic_token, q: req.query.q });
      });
      app.use("/api/hidden-prefix", router);

      // 3. Unmatched path
      app.post("/api/does-not-exist", (req, res) => {
        res.status(404).json({ error: "not found", originalUrl: req.originalUrl });
      });

      // 4. Non-API traffic
      app.get("/static/image.png", (req, res) => {
        res.status(200).send("fake_image_bytes");
      });
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    it("1. Nested claimUrl and secrets are returned unchanged but NEVER appear in emitted logs", async () => {
      const res = await request(app).get("/api/secure-claim");
      expect(res.status).toBe(201);
      
      // Response payload is perfectly intact
      expect(res.body.claimUrl).toContain("secret_123");
      expect(res.body.nested.password).toBe("abc");

      // But logs do NOT contain the secrets
      expect(logSpy).toHaveBeenCalledTimes(1);
      const emittedLog = logSpy.mock.calls[0][0] as string;
      expect(emittedLog).toMatch(/^GET \/api\/secure-claim 201 in \d+ms$/);
      expect(emittedLog).not.toContain("secret_123");
      expect(emittedLog).not.toContain("abc");
      expect(emittedLog).not.toContain("claimUrl");
    });

    it("2. Matched route with a path parameter logs the pattern, NOT the real URL/token, ignoring the mount prefix", async () => {
      logSpy.mockClear();
      const res = await request(app).get("/api/hidden-prefix/my_super_secret_token/redeem?q=secret_query");
      expect(res.status).toBe(200);

      // The caller sees their token
      expect(res.body.tokenParam).toBe("my_super_secret_token");
      expect(res.body.q).toBe("secret_query");

      // The log sees ONLY the local pattern, NEVER the token, NEVER the prefix, NEVER the query
      expect(logSpy).toHaveBeenCalledTimes(1);
      const emittedLog = logSpy.mock.calls[0][0] as string;
      expect(emittedLog).toMatch(/^GET \/:synthetic_token\/redeem 200 in \d+ms$/);
      
      expect(emittedLog).not.toContain("my_super_secret_token");
      expect(emittedLog).not.toContain("secret_query");
      expect(emittedLog).not.toContain("/api/hidden-prefix"); // Ignored as instructed
    });

    it("3. Unmatched API traffic receives the safe fallback constant, never the raw URL", async () => {
      logSpy.mockClear();
      const res = await request(app).post("/api/does-not-exist/hacker_path?injection=true");
      expect(res.status).toBe(404);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const emittedLog = logSpy.mock.calls[0][0] as string;
      
      // regex string escaping for literal brackets
      const safePattern = API_LOG_ROUTE_FALLBACK.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      expect(emittedLog).toMatch(new RegExp(`^POST ${safePattern} 404 in \\d+ms$`));
      expect(emittedLog).not.toContain("hacker_path");
      expect(emittedLog).not.toContain("injection");
    });

    it("4. Non-API traffic remains strictly excluded from logging", async () => {
      logSpy.mockClear();
      const res = await request(app).get("/static/image.png");
      expect(res.status).toBe(200);
      expect(res.text).toBe("fake_image_bytes");

      // Middleware bails out without logging
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
