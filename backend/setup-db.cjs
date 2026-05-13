const Database = require("better-sqlite3");
const fs = require("fs");

const db = new Database("data.db");
const sql = fs.readFileSync(
  "server/db/migrations/0001_sprint17_sync_and_auth.sql",
  "utf8",
);

const stmts = sql
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
let ok = 0;

for (const stmt of stmts) {
  try {
    db.exec(stmt + ";");
    ok++;
  } catch (e) {
    console.warn("skip:", e.message.slice(0, 60));
  }
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all();
console.log("Tables:", tables.map((t) => t.name).join(", "));
console.log("Done:", ok, "statements OK");
db.close();
