/**
 * scripts/silent-drop-guard/__tests__/fixtures.ts
 *
 * Synthetic mini-repo used by the mutation tests (T-1 / T-2).
 *
 * Every mutation runs against a throwaway tree under os.tmpdir(). The
 * production tree, the protected baseline.json and the G-0 snapshot are never
 * touched by a test — that rule is asserted in mutation-bypass.test.ts.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Fixture {
  root: string;
  file(rel: string): string;
  read(rel: string): string;
  write(rel: string, content: string): void;
  destroy(): void;
}

const APP_TSX = `import { Route, Switch } from "wouter";
import AdminFees from "@/pages/admin/AdminFees";
import PartnerSpvEngine from "@/pages/partner/PartnerSpvEngine";
import LegacyReports from "@/pages/LegacyReports";
import RequireAuth from "@/components/RequireAuth";
import CollectiveShell from "@/components/CollectiveShell";

export default function App() {
  return (
    <Switch>
      <Route path="/admin/fees">
        {() => <RequireAuth><CollectiveShell><AdminFees /></CollectiveShell></RequireAuth>}
      </Route>
      <Route path="/collective/partner/spv-engine">
        {() => <RequireAuth><CollectiveShell><PartnerSpvEngine /></CollectiveShell></RequireAuth>}
      </Route>
      <Route path="/reports/legacy">
        {() => <RequireAuth><LegacyReports /></RequireAuth>}
      </Route>
    </Switch>
  );
}
`;

/** Mirrors the real Amount column at AdminFeesConsolidated.tsx:1383,1396-1402. */
const ADMIN_FEES_TSX = `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export default function AdminFees({ codes }: { codes: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Expires</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {codes.map((c) => (
          <TableRow key={c.code} data-testid={\`row-discount-code-\${c.code}\`}>
            <TableCell><code>{c.code}</code></TableCell>
            <TableCell>{c.kind}</TableCell>
            <TableCell className="text-right">
              {c.kind === "percent" ? \`\${c.amount}%\` : \`\${c.amount} days\`}
            </TableCell>
            <TableCell>{c.expiresOn ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
`;

const SPV_ENGINE_TSX = `import { Button } from "@/components/ui/button";

export default function PartnerSpvEngine() {
  return (
    <section data-testid="spv-engine">
      <h1>SPV Engine</h1>
      <Button data-testid="button-create-spv" onClick={handleCreate}>Create SPV</Button>
    </section>
  );
}

function handleCreate() {}
`;

const LEGACY_REPORTS_TSX = `export default function LegacyReports() {
  return (
    <section data-testid="legacy-reports">
      <h1>Legacy Reports</h1>
    </section>
  );
}
`;

const SHELL_TSX = `export const NAV = [
  { href: "/admin/fees", label: "Fees & Billing" },
  { href: "/collective/partner/spv-engine", label: "SPV Engine" },
  { href: "/reports/legacy", label: "Legacy Reports" },
];

export default function CollectiveShell({ children }: { children: any }) {
  return <div className="shell">{children}</div>;
}
`;

const REQUIRE_AUTH_TSX = `export default function RequireAuth({ children }: { children: any }) {
  return <>{children}</>;
}
`;

const UI_TABLE_TSX = `export const Table = (p: any) => <table {...p} />;
export const TableHeader = (p: any) => <thead {...p} />;
export const TableBody = (p: any) => <tbody {...p} />;
export const TableRow = (p: any) => <tr {...p} />;
export const TableHead = (p: any) => <th {...p} />;
export const TableCell = (p: any) => <td {...p} />;
`;

const UI_BUTTON_TSX = `export const Button = (p: any) => <button {...p} />;
`;

const SERVER_ROUTES_TS = `import type { Express } from "express";
export function register(app: Express) {
  app.get("/api/admin/fees", async (_req, res) => res.json([]));
  app.post("/api/admin/fees", async (_req, res) => res.json({}));
  app.delete("/api/admin/fees/:id", async (_req, res) => res.json({}));
}
`;

const FILES: Record<string, string> = {
  "client/src/App.tsx": APP_TSX,
  "client/src/pages/admin/AdminFees.tsx": ADMIN_FEES_TSX,
  "client/src/pages/partner/PartnerSpvEngine.tsx": SPV_ENGINE_TSX,
  "client/src/pages/LegacyReports.tsx": LEGACY_REPORTS_TSX,
  "client/src/components/CollectiveShell.tsx": SHELL_TSX,
  "client/src/components/RequireAuth.tsx": REQUIRE_AUTH_TSX,
  "client/src/components/ui/table.tsx": UI_TABLE_TSX,
  "client/src/components/ui/button.tsx": UI_BUTTON_TSX,
  "server/routes.ts": SERVER_ROUTES_TS,
};

export function makeFixture(name: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sdg-${name}-`));
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
  return {
    root,
    file: (rel) => path.join(root, rel),
    read: (rel) => fs.readFileSync(path.join(root, rel), "utf-8"),
    write: (rel, content) => fs.writeFileSync(path.join(root, rel), content, "utf-8"),
    destroy: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
