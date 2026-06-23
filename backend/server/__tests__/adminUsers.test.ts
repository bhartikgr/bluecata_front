/**
 * Sprint 17 D7 — admin user management tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerAdminUsersRoutes } from "../lib/adminUsersRoutes";
import { getDb } from "../db/connection";

let app: express.Express;
beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  registerAdminUsersRoutes(app);
});

describe("Admin user management API", () => {
  it("lists seed users", async () => {
    const r = await request(app).get("/api/admin/users");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.users)).toBe(true);
    expect(r.body.users.length).toBeGreaterThanOrEqual(7);
  });

  it("filters by role", async () => {
    const r = await request(app).get("/api/admin/users?role=admin");
    expect(r.status).toBe(200);
    expect(r.body.users.every((u: { role: string }) => u.role === "admin")).toBe(true);
  });

  it("filters by status (suspended seed exists)", async () => {
    const r = await request(app).get("/api/admin/users?status=suspended");
    expect(r.status).toBe(200);
    expect(r.body.users.every((u: { status: string }) => u.status === "suspended")).toBe(true);
  });

  it("text search matches name + email", async () => {
    const r = await request(app).get("/api/admin/users?q=maya");
    expect(r.status).toBe(200);
    expect(r.body.users.some((u: { email: string }) => u.email === "maya@novapay.ai")).toBe(true);
  });

  it("invites a new user + returns redeem token", async () => {
    const r = await request(app).post("/api/admin/users").send({
      email: "newuser+invite@example.com", name: "New User", role: "founder",
    });
    expect(r.status).toBe(201);
    expect(r.body.user?.email).toBe("newuser+invite@example.com");
    expect(typeof r.body.redeemToken).toBe("string");
    expect(r.body.redeemToken.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects bad email on invite", async () => {
    const r = await request(app).post("/api/admin/users").send({ email: "not-an-email" });
    expect(r.status).toBe(400);
  });

  it("PATCH suspends a user", async () => {
    const r = await request(app).patch("/api/admin/users/u_jane").send({ status: "suspended" });
    expect(r.status).toBe(200);
    expect(r.body.user?.status).toBe("suspended");
  });

  it("PATCH 404s on unknown id", async () => {
    const r = await request(app).patch("/api/admin/users/u_does_not_exist").send({ status: "suspended" });
    expect(r.status).toBe(404);
  });

  it("force-logout returns ok + count", async () => {
    const r = await request(app).post("/api/admin/users/u_maya/force-logout").send({});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.sessionsRevoked).toBe("number");
  });

  it("reset-password issues a redeem token", async () => {
    const r = await request(app).post("/api/admin/users/u_maya/reset-password").send({});
    expect(r.status).toBe(200);
    expect(typeof r.body.redeemToken).toBe("string");
    expect(r.body.redeemToken.length).toBeGreaterThanOrEqual(32);
  });

  it("export CSV emits a header row + at least one user row", async () => {
    const r = await request(app).get("/api/admin/users/export");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    const lines = r.text.split("\n");
    expect(lines[0]).toMatch(/^id,email,name,role/);
    expect(lines.length).toBeGreaterThan(2);
  });
});
