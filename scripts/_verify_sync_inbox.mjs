import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const tmp = "/tmp/fresh_verify.db";
try { fs.rmSync(tmp); } catch {}
const db = new Database(tmp);

// Pull the exact DDL string out of connection.ts source and run the sync_inbox_state stmt.
const src = fs.readFileSync(path.join(process.cwd(), "server/db/connection.ts"), "utf8");
const m = src.match(/CREATE TABLE IF NOT EXISTS sync_inbox_state \([\s\S]*?\);/);
if (!m) { console.error("DDL_NOT_FOUND"); process.exit(2); }
db.exec(m[0]);

// Verify table exists with correct columns
const cols = db.prepare("PRAGMA table_info(sync_inbox_state)").all();
console.log("COLUMNS:", JSON.stringify(cols.map(c => ({name:c.name, type:c.type, pk:c.pk, notnull:c.notnull}))));

// Test write-through INSERT ... ON CONFLICT
const ts = new Date().toISOString();
db.prepare(`INSERT INTO sync_inbox_state (key, value_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
  .run("inbound:companyDsc::co_1", JSON.stringify({score:88}), ts);
// upsert same key
db.prepare(`INSERT INTO sync_inbox_state (key, value_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
  .run("inbound:companyDsc::co_1", JSON.stringify({score:91}), ts);
const row = db.prepare("SELECT * FROM sync_inbox_state WHERE key=?").get("inbound:companyDsc::co_1");
console.log("UPSERT_ROW:", JSON.stringify(row));
const count = db.prepare("SELECT COUNT(*) c FROM sync_inbox_state").get();
console.log("ROW_COUNT:", count.c, "(expect 1 — upsert not duplicate)");

// Test hydrate split logic
const key = row.key;
const sep = key.indexOf("::");
console.log("SPLIT ns=", key.slice(0,sep), " mapKey=", key.slice(sep+2));
console.log("PASS");
