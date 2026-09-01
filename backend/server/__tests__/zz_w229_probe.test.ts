import { it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
let app: express.Express;
beforeAll(() => { app = express(); app.use(express.json()); registerPartnerRoutes(app); seedTestPartnerSandbox({ force: true }); });
it("probe", async () => {
  const r = await request(app).post("/api/partner/me/team/invitations").set("x-user-id","u_avi_managing").send({ email: "w229probe@example.com", subRole: "viewer" });
  console.log("INVITE", r.status, JSON.stringify(r.body));
  const d = await request(app).get("/api/partner/me/dashboard").set("x-user-id","u_avi_managing");
  console.log("DASH KEYS", Object.keys(d.body));
  console.log("SEATS", JSON.stringify(d.body.seats ?? null), "pendingInvitations", d.body.pendingInvitations);
  const t = await request(app).get("/api/partner/me/team").set("x-user-id","u_avi_managing");
  console.log("TEAM", t.body.pendingCount, "invitations", (t.body.invitations||[]).length);
});
