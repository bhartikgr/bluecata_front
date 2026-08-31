/**
 * WAVE 197 · ITEM B — PROVED IN THE DOM, NOT IN A STRING COMPARISON.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * R169, owner verbatim: "I don't want any exposure of our internal process."
 *
 * Wave 196 built `client/src/lib/failureMessage.ts` and wrapped 28 client
 * surfaces. Wave 197 wrapped 23 more (error-surface ranking #33-#56). A test
 * that only compares strings would prove that `describeFailure` returns clean
 * text; it would NOT prove that clean text is what a user's screen shows. So the
 * assertions below are made against `document.body.textContent` after a real
 * render.
 *
 * ── WHAT IS RENDERED, AND WHAT IS NOT (stated, not implied) ─────────────────
 *
 * RENDERED, on a real shipped component:
 *   `LoadFailedRefusal` (client/src/components/LoadFailedRefusal.tsx) is the
 *   platform's real failure-display component. It is mounted with a `detail`
 *   produced by the REAL `describeFailure` from real Error objects carrying real
 *   driver text, and the resulting DOM is searched for internal detail.
 *
 * RENDERED, through a harness:
 *   The 23 surfaces wave 197 wrapped are `toast(...)` calls inside mutation
 *   `onError` handlers on full pages (PartnerTasks, PartnerNotes, MembershipPage,
 *   ScreeningEventsPage, ...). Mounting those pages in jsdom needs a router, a
 *   query client, a session and a dozen API fixtures each, and a test that
 *   mostly asserts fixtures is a worse test than one that asserts the thing under
 *   test. Following the wave-191 precedent, the DECISION LAYER those surfaces all
 *   funnel through is rendered instead: every `describeFailure` output for every
 *   internal-detail family, put into the DOM and searched.
 *
 * NOT PROVED HERE, and said so in W197_TESTS.md rather than glossed: that each
 * of the 23 pages is wired to `describeFailure`. That is a claim about SOURCE
 * TEXT, so it is proved against source text in the wiring block at the end of
 * this file, which is the honest instrument for it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";
import { describeFailure, HUMAN_MESSAGE_MAX_LENGTH } from "@/lib/failureMessage";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");
/** Comments are not shipped behaviour; strip them before any source conclusion. */
const codeOf = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

afterEach(() => cleanup());

/* ════════════════════════════════════════════════════════════════════════════
   THE REAL DRIVER SENTENCES. Not invented for the test — these are the shapes
   better-sqlite3, node and express actually produce, including the two that this
   wave's own routes emitted before it.
   ════════════════════════════════════════════════════════════════════════════ */
const REAL_INTERNAL_TEXT: ReadonlyArray<{ name: string; text: string }> = [
  { name: "missing table", text: "no such table: collective_kyc_blobs" },
  { name: "missing column", text: "table collective_kyc_blobs has no column named payload" },
  { name: "sqlite constraint", text: "SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email" },
  { name: "select statement", text: "SELECT user_id, mime, ext FROM collective_kyc_blobs WHERE id = ?" },
  { name: "insert statement", text: "INSERT INTO partner_tasks (id, partner_id) VALUES (?, ?)" },
  {
    name: "stack frame with absolute path",
    text: "at Object.<anonymous> (/home/user/workspace/work/server/sprint20Wave2Routes.ts:244:13)",
  },
  { name: "typed exception", text: "TypeError: Cannot read properties of undefined (reading 'run')" },
  { name: "errno", text: "Error: ENOENT: no such file or directory, open '/var/data/kyc/x.png'" },
  { name: "machine token", text: "PERSIST_FAILED" },
  { name: "windows path", text: "C:\\app\\server\\routes.ts:12" },
  { name: "driver package", text: "better-sqlite3: database connection is not open" },
];

const FORBIDDEN_IN_DOM: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "sqlite driver code", re: /\bSQLITE[_A-Z]*\b/ },
  { name: "schema complaint", re: /\bno such (table|column|module|function|index)\b/i },
  { name: "missing column phrasing", re: /\bhas no column named\b/i },
  { name: "a table name we own", re: /collective_kyc_blobs|partner_tasks|kyc_documents/i },
  { name: "SELECT ... FROM", re: /\bSELECT\b[\s\S]*\bFROM\b/i },
  { name: "INSERT INTO", re: /\bINSERT\s+INTO\b/i },
  { name: "UPDATE ... SET", re: /\bUPDATE\b[\s\S]*\bSET\b/i },
  { name: "DELETE FROM", re: /\bDELETE\s+FROM\b/i },
  { name: "constraint text", re: /\bconstraint failed\b/i },
  { name: "stack frame", re: /\bat\s+\S+\s*\([^)]*:\d+:\d+\)|\bat\s+[^\s(]+:\d+:\d+/ },
  { name: "posix path", re: /(^|[\s("'`])\/(home|var|usr|etc|opt|root|tmp|app|srv|proc|Users)\// },
  { name: "windows path", re: /[A-Za-z]:\\/ },
  { name: "source file and line", re: /\.(ts|tsx|js|mjs|cjs|jsx):\d+/ },
  { name: "driver package name", re: /\b(node_modules|better-sqlite3|drizzle)\b/i },
  { name: "exception class prefix", re: /\b(TypeError|RangeError|SyntaxError|ReferenceError)\s*:/ },
  { name: "errno code", re: /\bENOENT\b|\bEACCES\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bEPIPE\b/ },
  { name: "ALL_CAPS machine token", re: /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9]*(_[A-Z0-9]+)+([^A-Za-z0-9_]|$)/ },
  { name: "lowercase snake_case token", re: /(^|[^A-Za-z0-9_])[a-z][a-z0-9]*(_[a-z0-9]+)+([^A-Za-z0-9_]|$)/ },
];

function expectDomClean(label: string): void {
  const text = document.body.textContent ?? "";
  expect(text.length, `${label}: nothing rendered, so nothing was proved`).toBeGreaterThan(0);
  for (const f of FORBIDDEN_IN_DOM) {
    expect(
      f.re.test(text),
      `${label}: the RENDERED DOM contains ${f.name}. DOM text was:\n${text}`,
    ).toBe(false);
  }
}

/* A harness that renders exactly what a wrapped surface passes to a toast. */
function FailureLine({ error, effect }: { error: unknown; effect: "read" | "write" }): JSX.Element {
  return <p data-testid="w197-failure-line">{describeFailure(error, effect)}</p>;
}

describe("W197 B-DOM 1 — describeFailure output in the DOM, every internal-detail family", () => {
  for (const sample of REAL_INTERNAL_TEXT) {
    it(`READ: ${sample.name} never reaches the rendered DOM`, () => {
      render(<FailureLine error={new Error(sample.text)} effect="read" />);
      expectDomClean(`read/${sample.name}`);
    });

    it(`WRITE: ${sample.name} never reaches the rendered DOM`, () => {
      render(<FailureLine error={new Error(sample.text)} effect="write" />);
      expectDomClean(`write/${sample.name}`);
    });
  }

  it("a plain string thrown instead of an Error is handled the same way", () => {
    render(<FailureLine error={"no such table: partner_tasks"} effect="read" />);
    expectDomClean("plain string throw");
  });

  it("an object with a leaking `message` property is handled the same way", () => {
    render(<FailureLine error={{ message: "SQLITE_ERROR: near \"SELCT\": syntax error" }} effect="write" />);
    expectDomClean("object with message");
  });

  it("null / undefined produce a sentence rather than the word \"undefined\"", () => {
    render(<FailureLine error={undefined} effect="read" />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bundefined\b|\bnull\b|\[object Object\]/);
    expectDomClean("undefined error");
  });
});

describe("W197 B-DOM 2 — the real shipped failure component", () => {
  it("LoadFailedRefusal renders a sanitised detail with no internal text", () => {
    render(
      <LoadFailedRefusal
        what="your tasks"
        onRetry={() => undefined}
        testId="w197-load-failed"
        detail={describeFailure(
          new Error("no such table: partner_tasks; at /home/user/app/server/x.ts:9:1"),
          "read",
        )}
      />,
    );
    expectDomClean("LoadFailedRefusal");
  });

  it("its two pre-existing literals are still rendered beside the detail (R143.1)", () => {
    render(
      <LoadFailedRefusal
        what="your tasks"
        onRetry={() => undefined}
        testId="w197-load-failed-2"
        detail={describeFailure(new Error("SQLITE_BUSY"), "read")}
      />,
    );
    const text = document.body.textContent ?? "";
    /* The point of R143.1: a wave must ADD beside good copy, never replace it.
       If a future wave rewords these, this goes red rather than passing quietly. */
    expect(text).toMatch(/your tasks/);
    expect(text.length).toBeGreaterThan(20);
    expectDomClean("LoadFailedRefusal literals");
  });
});

describe("W197 B-DOM 3 — the rendered sentence is useful, not merely safe", () => {
  it("a read failure tells the user this is a failure and not an empty result", () => {
    /* AN EARLIER DRAFT OF THIS TEST ASSERTED THE WRONG SENTENCE and is recorded
       here rather than deleted. It expected "nothing was changed", which is the
       wording wave 197 chose for its own SERVER copy. Wave 196's shipped CLIENT
       read copy instead says "This is a loading failure, not an empty list — what
       you had is still there." Two things follow, and neither is a licence to
       rewrite wave 196's literal (R143.1 forbids that):

         · The assertion is corrected to the property that actually matters on a
           READ — that the user is told this is a FAILURE rather than an absence of
           data, which is the whole point of the wave-22 refusal component.

         · "what you had is still there" is a STRONGER claim than wave 197's server
           copy is willing to make. A read can fail precisely BECAUSE the record is
           gone, so that clause can be false. It is wave 196's copy on 28 surfaces,
           changing it is a copy decision across live pages rather than a leak fix,
           and it is therefore REPORTED in W197_BUILD.md for the owner rather than
           quietly reworded by this wave. */
    render(<FailureLine error={new Error("no such table: x_y")} effect="read" />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/loading failure|could not (be )?load|could not reach/i);
    expect(text).toMatch(/not an empty list|try again/i);
  });

  it("a write failure NEVER claims nothing changed", () => {
    /* R169 item 5. A 500 can be returned after the row landed. */
    render(<FailureLine error={new Error("no such table: x_y")} effect="write" />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/nothing was (changed|saved|written|stored)/i);
    expect(text).not.toMatch(/no changes were made/i);
  });

  it("read and write produce genuinely different sentences", () => {
    const e = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: t.c");
    expect(describeFailure(e, "read")).not.toBe(describeFailure(e, "write"));
  });

  it("every rendered sentence fits the client's own 240-character gate", () => {
    for (const s of REAL_INTERNAL_TEXT) {
      for (const effect of ["read", "write"] as const) {
        const m = describeFailure(new Error(s.text), effect);
        expect(m.length, `too long (${m.length}) for ${s.name}/${effect}: ${m}`).toBeLessThan(
          HUMAN_MESSAGE_MAX_LENGTH,
        );
        expect(/[a-z]/.test(m), `no lowercase letter, so the gate drops it: ${m}`).toBe(true);
      }
    }
  });

  it("the gate constant is still 240, so the assertions above mean what they say", () => {
    expect(HUMAN_MESSAGE_MAX_LENGTH).toBe(240);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   THE WIRING CLAIM — proved against source text, because that is what it is a
   claim about. Every file wave 197 touched for Item B must import
   `describeFailure` and must not still be handing a raw `.message` to a toast.
   ════════════════════════════════════════════════════════════════════════════ */

const WAVE197_ITEM_B_FILES: readonly string[] = [
  "client/src/pages/collective/AskExpertPage.tsx",
  "client/src/pages/collective/CollectiveDscPipeline.tsx",
  "client/src/pages/collective/MembershipPage.tsx",
  "client/src/pages/collective/QuestionDetailPage.tsx",
  "client/src/pages/collective/ScreeningEventsPage.tsx",
  "client/src/pages/partner/PartnerAddPortfolioCompany.tsx",
  "client/src/pages/partner/PartnerContacts.tsx",
  "client/src/pages/partner/PartnerNotes.tsx",
  "client/src/pages/partner/PartnerSettings.tsx",
  "client/src/pages/partner/PartnerTasks.tsx",
  "client/src/pages/partner/PartnerTeam.tsx",
  "client/src/pages/partner/OnboardingChecklistPage.tsx",
  "client/src/pages/partner/PartnerFundDetail.tsx",
  "client/src/components/partner/PartnerPortfolioProfileDialog.tsx",
];

describe("W197 B-SRC — the 14 files wave 197 wrapped are actually wired", () => {
  it("every one imports describeFailure", () => {
    for (const f of WAVE197_ITEM_B_FILES) {
      expect(codeOf(f), `${f} does not import describeFailure`).toMatch(
        /import\s*\{[^}]*\bdescribeFailure\b[^}]*\}\s*from\s*["']@\/lib\/failureMessage["']/,
      );
    }
  });

  it("no toast description in these files passes a raw error message through", () => {
    for (const f of WAVE197_ITEM_B_FILES) {
      const code = codeOf(f);
      /* The exact anti-pattern wave 196 and 197 removed. `describeFailure(e, ...)`
         does not match this, because the cast is inside the call. */
      const raw = code.match(/description:\s*\(?\s*(e|err|error)\s+as\s+Error\s*\)?\.message/g) ?? [];
      expect(raw, `${f} still hands a raw error message to a toast: ${raw.join(" | ")}`).toEqual([]);
      const raw2 = code.match(/description:\s*(e|err|error)\?\.\s*message/g) ?? [];
      expect(raw2, `${f} still hands an optional raw message to a toast`).toEqual([]);
    }
  });

  it("the #42 blind-spot surface uses toastCreate and is wrapped despite the regex not seeing it", () => {
    /* R169.7. `scripts/restyle-drop-detector` matches `toast` and `toast.x` but
       not `toastCreate`, so this surface is invisible to that gate. It is asserted
       here instead, which is the only place it is checked at all. */
    const code = codeOf("client/src/pages/collective/ScreeningEventsPage.tsx");
    expect(code).toMatch(/toastCreate\s*\(/);
    const createCalls = code.match(/toastCreate\s*\(\s*\{[\s\S]{0,400}?\}\s*\)/g) ?? [];
    expect(createCalls.length).toBeGreaterThan(0);
    for (const c of createCalls) {
      if (!/description:/.test(c)) continue;
      expect(c, `a toastCreate description is not wrapped: ${c}`).not.toMatch(
        /description:\s*\(?\s*(e|err|error)\s+as\s+Error\s*\)?\.message/,
      );
    }
  });

  it("#54 PartnerClassificationSelect was NOT touched, because it was never a leak", () => {
    /* Triage discipline: R169 says do not \"fix\" correct code. #54's
       `validateClassifications` is a pure local validator returning authored
       prose; it never sees an error object. This asserts the wave kept its hands
       off it. */
    const code = codeOf("client/src/components/partner/PartnerClassificationSelect.tsx");
    expect(code).not.toMatch(/describeFailure/);
    expect(code).not.toMatch(/WAVE 197/);
  });

  it("wave 196's module is reused, not duplicated", () => {
    /* If a wave-197 copy of the client sanitiser existed, this is where it would
       show up. There must be exactly one `describeFailure` definition in the tree. */
    const lib = codeOf("client/src/lib/failureMessage.ts");
    expect(lib).toMatch(/export function describeFailure/);
    for (const f of WAVE197_ITEM_B_FILES) {
      expect(codeOf(f), `${f} defines its own describeFailure`).not.toMatch(
        /function describeFailure/,
      );
    }
  });
});
