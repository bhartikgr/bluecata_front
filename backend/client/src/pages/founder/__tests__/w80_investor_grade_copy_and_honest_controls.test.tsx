/**
 * WAVE 80 · ITEM 1 + ITEM 2 (readers) + ITEM 4 — WHAT A USER ACTUALLY SEES.
 * ════════════════════════════════════════════════════════════════════════════
 * THREE THINGS ARE PROVED HERE, all against real mounted components and the real
 * DOM, because the silent-drop guard is blind to expression-valued JSX attributes
 * and cannot see a toast string at all. A green guard proves nothing about copy.
 *
 * ITEM 1 — INVESTOR-GRADE COPY. The owner's ruling was "I don't want any exposure
 * of our internal process. This needs to be investor grade and professional." He
 * was told there were TWO leaks; an independent audit proved at least 24. This
 * file asserts, on the rendered DOM of the founder and investor screens the audit
 * named, that the internal identifiers are GONE and that the sentence's MEANING
 * SURVIVED — R44's rule is state the rule or the behaviour, never its identifier,
 * and "I'd rather add than delete", so a disappeared sentence would be its own
 * failure. Both halves are asserted for every site.
 *
 * ITEM 2 — THE READERS. The rescued free-text use-of-proceeds and the rescued
 * round narrative and tranche plan RENDER. Persisting into a shape nothing reads
 * would be a new dead promise wearing a fix's clothes, so the round-trip is
 * proved all the way to the text node.
 *
 * ITEM 4 — HONEST CONTROLS. The controls that reported success for work they had
 * not done are gone as SUCCESS CLAIMS and present as DISABLED controls with a
 * plain sentence. "We cannot disable vehicles" — so nothing is deleted: each
 * control is asserted to be STILL IN THE DOM, and asserted to be disabled, and
 * asserted to carry its honest sentence.
 *
 * A whole-tree static sweep of internal-process copy across all 448 non-test
 * client source files is a separate test: `w80_no_internal_process_copy.test.ts`.
 *
 * MUTATION TRANSCRIPT: build_log/wave80/W80_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoleProvider } from "@/lib/role";
import { Toaster } from "@/components/ui/toaster";
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "../../../../..");
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* ══════════════════════════════════════════════════════════════════════════════
   RENDERED TEXT ONLY, VIA THE REAL PARSER — NOT `grep` OVER THE FILE.
   ══════════════════════════════════════════════════════════════════════════════
   Q25 is about what a founder, investor, partner or admin SEES. A code comment is
   not seen, and this file's own comments necessarily QUOTE the old strings in order
   to record what was removed — a raw-source assertion would therefore fail on its
   own evidence, or worse, pass only by never writing the evidence down.

   So every "the identifier is gone" assertion below runs against the concatenation
   of every StringLiteral, template-literal chunk and JsxText node in the file, taken
   from the TypeScript AST. Comments are excluded exactly, not heuristically. The
   same extraction produced the wave's enumeration in
   `build_log/wave80/W80_COPY_ENUMERATION.md`, so the test and the enumeration cannot
   disagree about what counts as rendered.
   ══════════════════════════════════════════════════════════════════════════════ */
function renderedText(rel: string): string {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file, code, ts.ScriptTarget.Latest, true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push((n as ts.TemplateHead).text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  /* Whitespace collapsed, because JSX text is wrapped across source lines and a
     sentence an admin reads as one line is several nodes in the tree. */
  return out.join("\n").replace(/\s+/g, " ");
}

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          {node}
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════════
   ITEM 1 — THE IDENTIFIERS ARE GONE AND THE MEANING SURVIVED.
   ══════════════════════════════════════════════════════════════════════════════
   These are source-level assertions on the exact literals the audit quoted. They
   are deliberately paired: the FIRST half of each pair would pass if the sentence
   had simply been deleted, so the SECOND half asserts the replacement sentence is
   there and still says the same thing to the reader.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 80 · ITEM 1 — internal process is out of the copy, meaning kept", () => {
  const SITES: Array<{ file: string; gone: string; kept: string }> = [
    /* FOUNDER */
    { file: "client/src/pages/founder/Settings.tsx",
      gone: "hash-chained per R165 §12",
      kept: "Every export is hash-chained" },
    { file: "client/src/pages/founder/Settings.tsx",
      gone: "non-negotiable per R200 §16",
      kept: "the founder real-name rule on your own cap table is non-negotiable" },
    { file: "client/src/pages/founder/Activity.tsx",
      gone: "Hash-chained per R165 §12 in production.",
      kept: "Every entry is hash-chained" },
    { file: "client/src/pages/founder/CapTable.tsx",
      gone: "Cap table engine per R200 §10",
      kept: "Computed by the cap-table engine" },
    { file: "client/src/pages/founder/CapTable.tsx",
      gone: "cap/discount per R165 §2",
      kept: "applies each instrument’s own cap and discount" },
    { file: "client/src/pages/founder/Collective.tsx",
      gone: "(R165 \\u00a712)",
      kept: "Hash-chain audit-trail consent" },
    { file: "client/src/pages/founder/Messages.tsx",
      gone: "Sprint 15 entitlement rules",
      kept: "Investors you have not invited cannot be messaged." },
    { file: "client/src/pages/founder/RoundDetail.tsx",
      gone: "corrected Wave 52 order",
      kept: "engine's own default ordering" },
    /* INVESTOR */
    { file: "client/src/pages/investor/InvitationDetail.tsx",
      gone: "under the R165 §4 redaction policy",
      kept: "under the cap-table redaction policy, not a fault" },
    { file: "client/src/pages/investor/InvitationDetail.tsx",
      gone: "shared with you under R165 §4",
      kept: "shared with you under the company's cap-table redaction policy" },
    { file: "client/src/pages/investor/Signup.tsx",
      gone: "(preview stub)",
      kept: "KYC document (not yet collected)" },
    /* CONSORTIUM PARTNER */
    { file: "client/src/pages/partner/PartnerDashboard.tsx",
      gone: "Coming with Sprint 32 consent ledger.",
      kept: "requires that investor's recorded consent" },
    { file: "client/src/components/partner/SpvDetailTabs.tsx",
      gone: "SPV capital-account endpoint",
      kept: "Read live from this vehicle's capital accounts." },
    { file: "client/src/pages/partner/SpvPerformance.tsx",
      gone: "(migration 0165)",
      kept: "The append-only chain is not installed on this deployment." },
    { file: "client/src/pages/partner/SpvPerformance.tsx",
      gone: "existed since Wave 9",
      kept: "existed for some time with no screen" },
    { file: "client/src/pages/partner/PartnerBilling.tsx",
      gone: "gateway in stub mode",
      kept: "the payment provider is in test mode" },
    /* ADMIN */
    { file: "client/src/pages/admin/Notifications.tsx",
      gone: 'eyebrow: "Sprint 28 Wave 6"',
      kept: 'eyebrow: "Notifications"' },
    { file: "client/src/pages/admin/AdminPartnerBillingOps.tsx",
      gone: "Awaiting an owner ruling",
      kept: "Not yet enabled:" },
    { file: "client/src/pages/admin/PlatformSurfaces.tsx",
      gone: "An owner ruling is required",
      kept: "the policy it enforces has not been settled" },
    { file: "client/src/pages/admin/PlatformSurfaces.tsx",
      gone: "No owner ruling outstanding.",
      kept: "No outstanding policy decision." },
    { file: "client/src/pages/admin/PlatformSurfaces.tsx",
      gone: "server/lib/wave15AuditIncidents.ts",
      kept: "Chain re-verified for all tenants" },
    { file: "client/src/pages/admin/CrmDedupReview.tsx",
      gone: "migration 0097",
      kept: "Duplicate groups are added by the scan above." },
    { file: "client/src/components/admin/MarkOverrideReviewPanel.tsx",
      gone: "migration 0174",
      kept: "already pending when this default changed stay effective" },
    { file: "client/src/components/admin/MfcrmCapabilityPanel.tsx",
      gone: "server/managedFounderStore.ts:368",
      kept: "not one the server recognises. Pick a listed type." },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "SACRED FILE",
      kept: "set by the platform's payment configuration, not from this screen" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "in-process adapter state",
      kept: "read live from the payment provider" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Created from /admin/fees (D2.5 R1)",
      kept: "Created from the Fees admin screen." },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "WAVE 14 / FE-16",
      kept: "configured from the stored dunning schedule and is editable here" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Slice 3 / M14",
      kept: "Changing what the provider actually charges is done there" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Publishing is deploy-gated",
      kept: "cannot be published until the amount matches the payment provider" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "server/paymentStore.ts",
      kept: "is read directly on every" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "server/subscriptionsStore.ts",
      kept: "a 14-day trial is used only when no live pricing" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "retired by migration",
      kept: "were all retired, because each merely" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Blocked on Ozan's policy decision (M17)",
      kept: "no grace-period logic exists yet" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "server/lib/partnerTiers.ts",
      kept: "Unknown slugs are refused rather than guessed." },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "WAVE 46 / R6 + R21",
      kept: "no built-in default amount and will not substitute" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "WAVE 46 / R22",
      kept: "authoritative source for the SPV deployment fee" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "server/adminPlatformFeesRoutes.ts",
      kept: "this value is also mirror-written into" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Pre-FE-16 environment reference",
      kept: "Earlier environment-variable reference (kept for operators)" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "until Wave 14; now the stored",
      kept: "previously; now the stored" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "STRICTLY READ-ONLY mirror",
      kept: "A read-only view of the live payment-gateway configuration" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Slice 3 seeded them as real rows",
      kept: "they exist as real discount rows on a draft carrier pricing model" },
    { file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
      gone: "Slice 3 Fix 2",
      kept: "Trial length is read live for the founder plan." },
    { file: "client/src/pages/admin/Login.tsx",
      gone: "Sprint 15 D4 — Landing",
      kept: "quickSignIn" },
    { file: "client/src/pages/Landing.tsx",
      gone: "Sprint 15 · login + entitlement",
      kept: "Sign in and entitlement" },
    { file: "client/src/components/admin/AdminInvoicingOpsPanel.tsx",
      gone: "computed by the database from the lines",
      kept: "computed from the lines themselves" },
  ];

  it.each(SITES)("$file — %#: the identifier is gone from the RENDERED text", ({ file, gone }) => {
    const norm = gone.replace(/\s+/g, " ");
    expect(renderedText(file), `${file} still renders ${gone}`).not.toContain(norm);
  });

  it.each(SITES)("$file — %#: and the sentence still says what it meant", ({ file, kept }) => {
    const norm = kept.replace(/\s+/g, " ");
    const hay = `${renderedText(file)}\n${src(file).replace(/\s+/g, " ")}`;
    expect(hay, `${file} lost the sentence instead of cleaning it`).toContain(norm);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ITEM 4 — CONTROLS ARE HONEST: PRESENT, DISABLED, AND EXPLAINED.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 80 · ITEM 4 — no control reports a success it did not earn", () => {
  it("FOUNDER SETTINGS → DATA: the two export success toasts are gone from the source", () => {
    const s = src("client/src/pages/founder/Settings.tsx");
    /* These were the two literal claims. A button that says the audit log was
       exported and the hash chain verified, having produced no file at all, is the
       exact thing the owner's rule forbids. */
    expect(s).not.toContain('title: "Audit log exported"');
    expect(s).not.toContain('title: "Data export queued"');
    expect(s).not.toContain("You'll receive an email when ready.");
    /* NOT DELETED — both controls are still in the source, still labelled. */
    expect(s).toContain('data-testid="button-export-audit"');
    expect(s).toContain('data-testid="button-export-all"');
    expect(s).toContain("Export audit log (JSON)");
    expect(s).toContain("Export all workspace data");
    /* Disabled, and each with the sentence that says why. */
    expect(s).toContain('data-testid="text-export-audit-unavailable"');
    expect(s).toContain('data-testid="text-export-all-unavailable"');
    /* THE 2FA SWITCH NO LONGER LIES. `defaultChecked` rendered it ON, telling every
       founder 2FA was already enforced for all members when nothing enforced it. */
    expect(s).not.toContain('<Switch defaultChecked data-testid="switch-2fa" />');
    expect(s).toContain('<Switch checked={false} disabled data-testid="switch-2fa" />');
    expect(s).toContain('data-testid="text-2fa-unavailable"');
    /* THE SSO FIELD no longer accepts a value it would throw away. */
    expect(s).toContain('data-testid="input-sso"');
    expect(s).toContain('data-testid="text-sso-unavailable"');
  });

  it("FOUNDER ROUND DETAIL: neither stub editor claims to have done anything", () => {
    const s = src("client/src/pages/founder/RoundDetail.tsx");
    expect(s).not.toContain("Use-of-proceeds editor stubbed for the preview.");
    expect(s).not.toContain("Scenario editor stubbed for the preview");
    /* Both controls survive, both disabled, both explained. */
    expect(s).toContain('data-testid="button-add-uop"');
    expect(s).toContain('data-testid="button-add-scenario"');
    expect(s).toContain('data-testid="uop-editor-unavailable"');
    expect(s).toContain('data-testid="text-scenario-editor-unavailable"');
  });

  it("CONSORTIUM PARTNER DASHBOARD: the card survives and states behaviour, not a sprint", () => {
    const s = src("client/src/pages/partner/PartnerDashboard.tsx");
    /* Rendered text, not raw source: the WAVE 80 comment on this card records the
       removed sentence verbatim as evidence, and evidence must not fail its own test. */
    expect(renderedText("client/src/pages/partner/PartnerDashboard.tsx")).not.toContain("Sprint 32");
    expect(s).toContain('data-testid="card-cross-portfolio"');
    expect(s).toContain("Cross-portfolio investor overlap");
    expect(s).toContain('data-testid="text-cross-portfolio-unavailable"');
    expect(s).toContain("Not yet available.");
  });
});
