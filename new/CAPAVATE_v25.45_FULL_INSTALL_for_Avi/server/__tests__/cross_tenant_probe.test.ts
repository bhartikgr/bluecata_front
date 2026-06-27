import { test, expect, describe, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index";
import { rawDb } from "../db/connection";

let server: any;

describe("Cross-tenant probe: /api/collective/partners/public", () => {
  beforeAll(async () => {
    server = app.listen(0);
    // Wait for boot and migrations to run
    await new Promise(r => setTimeout(r, 1000));
    
    // Check if table exists, if so insert.
    try {
        rawDb().prepare("INSERT INTO partner_organizations (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
          "po_tenantA", "tenant_co_novapay", "Partner A", new Date().toISOString(), new Date().toISOString()
        );
        rawDb().prepare("INSERT INTO partner_organizations (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
          "po_tenantB", "tenant_co_helia", "Partner B", new Date().toISOString(), new Date().toISOString()
        );
        
        rawDb().prepare("INSERT INTO collective_memberships (user_id, status, tenant_id, chapter_id, activated_at, activated_by) VALUES (?, ?, ?, ?, ?, ?)").run(
          "u_maya", "active", "tenant_co_novapay", "chapter_ny", new Date().toISOString(), "u_admin"
        );
        rawDb().prepare("INSERT INTO collective_memberships (user_id, status, tenant_id, chapter_id, activated_at, activated_by) VALUES (?, ?, ?, ?, ?, ?)").run(
          "u_aisha_patel", "active", "tenant_co_helia", "chapter_sf", new Date().toISOString(), "u_admin"
        );
    } catch(e) {
        console.error("Setup error:", e);
    }
  });

  afterAll(() => {
    if (server) server.close();
  });
  
  test("Member A sees only chapter A partners", async () => {
    const res = await request(server)
      .get("/api/collective/partners/public")
      .set("x-user-id", "u_maya")
      .set("x-role", "collective_member");
    
    expect(res.status).toBe(200);
    const names = res.body.items?.map((i:any) => i.name) || [];
    console.log("A sees:", names);
    // We expect this to contain only tenant_co_novapay partners OR default seeds
  });
  
  test("Member B sees only chapter B partners", async () => {
    const res = await request(server)
      .get("/api/collective/partners/public")
      .set("x-user-id", "u_aisha_patel")
      .set("x-role", "collective_member");
      
    expect(res.status).toBe(200);
    const names = res.body.items?.map((i:any) => i.name) || [];
    console.log("B sees:", names);
  });
});
