import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { splitStatements as protectedSplit } from "../migrate";
import { splitStatements as runtimeSplit } from "../sqlStatementSplitter";

const root = process.cwd();
function functionText(name: string) {
  const text = fs.readFileSync(path.join(root, "server/db", name), "utf8");
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "splitStatements");
  if (!fn) throw new Error("splitStatements not found");
  return fn.getText(source);
}
describe("install runtime SQL splitter isolation", () => {
  it("preserves exact protected function text and exposes no import or CLI side effects", () => {
    expect(functionText("sqlStatementSplitter.ts")).toBe(functionText("migrate.ts"));
    const source = ts.createSourceFile("pure.ts", fs.readFileSync(path.join(root,
      "server/db/sqlStatementSplitter.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    expect(source.statements).toHaveLength(1);
    expect(ts.isFunctionDeclaration(source.statements[0])).toBe(true);
  });
  for (const dir of ["migrations", "server/db/migrations"]) {
    const files = fs.readdirSync(path.join(root, dir)).filter(n => n.endsWith(".sql")).sort();
    for (const name of files) {
      it(`matches protected parser: ${dir}/${name}`, () => {
        const sql = fs.readFileSync(path.join(root, dir, name), "utf8");
        expect(runtimeSplit(sql)).toEqual(protectedSplit(sql));
      });
    }
  }
  const specimens = [
    "SELECT ';'; SELECT 2;",
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT CASE WHEN 1 THEN ';' ELSE 'x' END; SELECT 2; END;",
    "-- ; comment\nSELECT 1; /* ; block */ SELECT `a;b` FROM x;",
    "BEGIN IMMEDIATE; SELECT 1; COMMIT;",
  ];
  for (const [i, sql] of specimens.entries())
    it(`matches protected parser specimen ${i}`, () => expect(runtimeSplit(sql)).toEqual(protectedSplit(sql)));
  for (const n of ["applyWave13SubscriptionShape.ts","applyWave38EventLedgerSchema.ts",
    "applyWave43RoundCloseSchema.ts","applyWave52bRoundMathSchema.ts"])
    it(`imports only the pure helper: ${n}`, () => {
      const source = fs.readFileSync(path.join(root,"server/lib",n),"utf8");
      expect(source).toContain('import { splitStatements } from "../db/sqlStatementSplitter"');
      expect(source).not.toContain('from "../db/migrate"');
    });
});
