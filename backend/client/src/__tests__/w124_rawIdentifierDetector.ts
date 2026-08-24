/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 124 · FINDING 1 — THE DETECTOR, AS A FENCE.
   ═══════════════════════════════════════════════════════════════════════════
   This is the wave-124 scan (`build_log/wave124/w124_rawid_scan_v2.ts`) lifted
   into a form a test can execute, so the claim "no raw internal identifier and
   no machine state key reaches a human on these screens" is PROVEN by running
   the same instrument that measured the population, not by grepping for a few
   known strings.

   It is deliberately a syntax-level detector over the TypeScript AST. A grep
   cannot tell `{d.holderId}` — a person reads a database key — from
   `data-testid={`row-${d.holderId}`}` — a machine reads a database key — and the
   second is EXPLICITLY ALLOWED because the suite depends on those testids.

   HUMAN-READ positions reported: H1 a JSX text child · H2 a human-copy JSX
   attribute · H3 a human-copy object property · H4 an argument to a rendering
   call. MACHINE-READ positions are never reported.

   The instrument was validated before it was trusted: a planted positive was
   caught and a planted negative was ignored, on a file with zero pre-existing
   hits, which was then restored and hash-verified. Evidence:
   `build_log/wave124/control_scan.txt`, `control_hash_before.txt`,
   `control_hash_after.txt`.

   NOT a test file itself — it exports; vitest collects only `*.test.ts(x)`.
   ═══════════════════════════════════════════════════════════════════════════ */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export type Hit = {
  file: string; line: number; cls: "IDENT" | "KEY"; pos: string;
  tag: string; text: string;
};

/* ── the machine-name vocabulary ───────────────────────────────────────────── */
/* An identifier-shaped property name. */
const IDENT_NAME =
  /^(id|.*Id|.*_id|.*Ids|.*Uuid|.*Ref|.*_ref|.*Key|.*_key|.*Slug|.*_slug|.*Hash)$/;
/* A state / classification key. */
const KEY_NAME =
  /^(status|state|stage|type|kind|role|plan|tier|scope|code|event|eventType|instrument|jurisdiction|cadence|.*Status|.*State|.*Stage|.*Type|.*Kind|.*Role|.*Plan|.*Tier|.*Scope|.*Code|_status|.*_state|.*_stage|.*_type|.*_kind|.*_status)$/;

/* Names that LOOK machine but are human copy or a number in this tree. */
/* Two families were REMOVED from the vocabulary after sampling 22 hits by hand,
   because they are false positives and counting them would inflate the number:
     - `*Reason` in this tree holds SENTENCES, not keys (`CloseRoundPanel.tsx:137`
       sets `ipAddressUnavailableReason` to `IP_NOT_CAPTURED_REASON`, a sentence;
       `PartnerBilling.tsx:143` sets `planUnresolvedReason` to
       `serverRefusalMessage(error)`).
     - `mimeType` / `contentType`: `application/pdf` beside a file is the
       conventional readable presentation of a media type, not jargon.
   `*Reason` is dropped from KEY_NAME above; the type family is listed here. */
const NOT_MACHINE = new Set([
  "name", "companyName", "legalName", "displayName", "title", "label", "text",
  "message", "description", "email", "topic", "count", "total", "amount",
  "keyTerms", "keyPeople", "idea",
  "mimeType", "mime_type", "contentType", "mediaType",
]);

/* Wrappers whose presence means the value WAS humanised. Anything that is a
   label/format/humanise call, or a lookup into a *_LABEL* map. */
const LABELLED =
  /(Label|label|humanize|Humanize|fmt|format|Display|display|describe|Describe|toLocale|titleCase|sentence|pretty|Pretty)/;

/* Human-copy JSX attributes. */
const COPY_ATTRS = new Set([
  "label", "title", "description", "placeholder", "hint", "alt", "tooltip",
  "subtitle", "eyebrow", "warning", "positive", "heading", "caption",
  "emptyText", "what", "statement", "helpText", "legend",
]);
/* Attributes a MACHINE reads. Never reported. */
const MACHINE_ATTRS = new Set([
  "data-testid", "testId", "key", "href", "to", "id", "className", "class",
  "style", "value", "name", "type", "htmlFor", "role", "queryKey", "code",
  "variant", "tone", "size", "src", "form", "ref", "onClick", "onChange",
]);
/* Human-copy object-literal property names (stats arrays, guidance objects). */
const COPY_PROPS = new Set([
  "label", "hint", "title", "description", "text", "message", "statement",
  "warning", "positive", "eyebrow", "caption", "subtitle", "what",
]);
/* Object properties a machine reads. */
const MACHINE_PROPS = new Set([
  "id", "key", "code", "error", "refusal", "testId", "value", "href", "to",
  "queryKey", "type", "kind", "field", "column", "name",
]);
/* Calls that put their argument in front of a person. */
const RENDER_CALL =
  /^(toast|alert|confirm|prompt|notify|setError|setMessage|setStatusText|setToast|setRefusal)(\.[A-Za-z_$][\w$]*)?$/;

const MACHINE_TAGS = new Set(["code", "pre", "script", "style"]);

/* Peel the wrappers that do not humanise: `x ?? "—"`, `x || "—"`, `String(x)`,
   parentheses. A ternary is NOT peeled — a choice between two literals is a
   decision, and reporting it would inflate the count. */
function peel(e: ts.Expression): ts.Expression {
  let cur: ts.Expression = e;
  for (let i = 0; i < 8; i++) {
    if (ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
    if (
      ts.isBinaryExpression(cur) &&
      (cur.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        cur.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      (ts.isStringLiteral(cur.right) || ts.isNoSubstitutionTemplateLiteral(cur.right))
    ) { cur = cur.left; continue; }
    if (
      ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) &&
      cur.expression.text === "String" && cur.arguments.length === 1
    ) { cur = cur.arguments[0]; continue; }
    break;
  }
  return cur;
}

/** The machine class of a bare value expression, or null when it is not one. */
function machineClass(e0: ts.Expression, sf: ts.SourceFile): "IDENT" | "KEY" | null {
  const e = peel(e0);
  /* WAVE 124 SCAN v2 — the ONE family v1 missed, found by hand in
     `PartnerContacts.tsx:553` (`{p.displayName || p.companyId}`): a fallback or a
     ternary whose OTHER branch is machine-named. v1 peeled `x ?? "literal"` only,
     so a human-named left operand hid a machine-named right operand completely.
     v2 classifies BOTH branches. Everything else about v1 is unchanged, so v2 is
     a strict superset and v1's validated controls still hold for it. */
  if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return machineClass(e.left, sf) ?? machineClass(e.right, sf);
  }
  if (ts.isConditionalExpression(e)) {
    return machineClass(e.whenTrue, sf) ?? machineClass(e.whenFalse, sf);
  }
  const full = e.getText(sf);
  if (full.length > 70) return null;
  if (LABELLED.test(full)) return null;          /* already humanised */
  let name: string | null = null;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) name = e.name.text;
  else if (ts.isIdentifier(e)) name = e.text;
  else if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression))
    name = e.argumentExpression.text;
  if (!name) return null;
  if (NOT_MACHINE.has(name)) return null;
  if (IDENT_NAME.test(name)) return "IDENT";
  if (KEY_NAME.test(name)) return "KEY";
  return null;
}

/** Machine-named interpolations inside a template literal. */
function templateHits(
  t: ts.TemplateExpression, sf: ts.SourceFile,
): Array<"IDENT" | "KEY"> {
  const out: Array<"IDENT" | "KEY"> = [];
  for (const span of t.templateSpans) {
    const c = machineClass(span.expression, sf);
    if (c) out.push(c);
  }
  return out;
}

export function scanFiles(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
  const sf = ts.createSourceFile(
    f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  );
  const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const push = (n: ts.Node, cls: "IDENT" | "KEY", pos: string, tag: string, text: string) =>
    hits.push({ file: rel, line: at(n), cls, pos, tag, text: text.replace(/\s+/g, " ").slice(0, 90) });

  const enclosingTag = (n: ts.Node): string => {
    let p: ts.Node | undefined = n.parent;
    while (p) {
      if (ts.isJsxElement(p)) return p.openingElement.tagName.getText(sf);
      if (ts.isJsxSelfClosingElement(p)) return p.tagName.getText(sf);
      p = p.parent;
    }
    return "?";
  };
  const insideMachineTag = (n: ts.Node): boolean => {
    let p: ts.Node | undefined = n.parent;
    while (p) {
      if (ts.isJsxElement(p) && MACHINE_TAGS.has(p.openingElement.tagName.getText(sf))) return true;
      p = p.parent;
    }
    return false;
  };

  const visit = (n: ts.Node): void => {
    /* H1 — a JSX text child. */
    if (
      ts.isJsxExpression(n) && n.expression && n.parent &&
      (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) &&
      !insideMachineTag(n)
    ) {
      const cls = machineClass(n.expression, sf);
      if (cls) push(n, cls, "H1-jsx-text", enclosingTag(n), `{${n.expression.getText(sf)}}`);
      else if (ts.isTemplateExpression(n.expression)) {
        for (const c of templateHits(n.expression, sf))
          push(n, c, "H1-jsx-text-template", enclosingTag(n), n.expression.getText(sf));
      }
    }

    /* H2 — a human-copy JSX attribute. */
    if (ts.isJsxAttribute(n) && n.initializer) {
      const an = n.name.getText(sf);
      if (COPY_ATTRS.has(an) && !MACHINE_ATTRS.has(an) && !an.startsWith("aria-")) {
        const init = n.initializer;
        if (ts.isJsxExpression(init) && init.expression) {
          const cls = machineClass(init.expression, sf);
          if (cls) push(n, cls, `H2-attr:${an}`, enclosingTag(n), n.getText(sf));
          else if (ts.isTemplateExpression(init.expression))
            for (const c of templateHits(init.expression, sf))
              push(n, c, `H2-attr:${an}`, enclosingTag(n), n.getText(sf));
        }
      }
    }

    /* H3 — a human-copy object-literal property. */
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
      const pn = n.name.text;
      if (COPY_PROPS.has(pn) && !MACHINE_PROPS.has(pn)) {
        const cls = machineClass(n.initializer, sf);
        if (cls) push(n, cls, `H3-prop:${pn}`, "obj", n.getText(sf));
        else if (ts.isTemplateExpression(n.initializer))
          for (const c of templateHits(n.initializer, sf))
            push(n, c, `H3-prop:${pn}`, "obj", n.getText(sf));
      }
    }

    /* H4 — an argument to a rendering call. */
    if (ts.isCallExpression(n) && RENDER_CALL.test(n.expression.getText(sf))) {
      for (const a of n.arguments) {
        const cls = machineClass(a, sf);
        if (cls) push(n, cls, "H4-render-call", n.expression.getText(sf), n.getText(sf));
        else if (ts.isTemplateExpression(a))
          for (const c of templateHits(a, sf))
            push(n, c, "H4-render-call", n.expression.getText(sf), n.getText(sf));
      }
    }

    ts.forEachChild(n, visit);
  };
  visit(sf);
}
  return hits;
}
