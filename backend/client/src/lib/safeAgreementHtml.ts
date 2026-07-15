/**
 * client/src/lib/safeAgreementHtml.ts — W5.1
 *
 * Renders a Markdown legal agreement to SANITIZED HTML for display via
 * dangerouslySetInnerHTML, WITHOUT any third-party dependency (A5.2 default:
 * minimal inline allow-list; reuse the LegalDrawer markdown approach but close
 * its XSS gap).
 *
 * Safety model — ESCAPE FIRST, then apply an allow-list of markdown constructs:
 *   1. HTML-escape the ENTIRE raw source (`& < > " '`). This neutralizes any
 *      `<script>`, inline event handler (`onerror=`), or raw tag in the source —
 *      after this step the string contains ZERO live HTML.
 *   2. Re-introduce ONLY the small allow-list of tags we emit ourselves
 *      (<strong> <em> <a> <h3> <h4> <ul> <li> <blockquote> <p> <br>), built from
 *      the escaped text. Links are restricted to http(s)/mailto and forced to
 *      rel="noopener noreferrer" target="_blank" — a `javascript:` URL cannot
 *      match the link regex, so it renders as inert escaped text.
 * Because live HTML is destroyed in step 1 and only our own literal tags are
 * emitted in step 2, injected markup can never execute.
 */

/** Step 1 — escape every HTML-significant character. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline markdown on ALREADY-ESCAPED text. Emits only allow-listed tags. */
function renderInlineEscaped(escaped: string): string {
  let t = escaped;
  // Bold **text** / __text__
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic *text* / _text_
  t = t.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  t = t.replace(/_([^_]+?)_/g, "<em>$1</em>");
  // Links [label](url) — url limited to http(s)/mailto ONLY. After escaping, a
  // real URL's characters are intact enough to match; `javascript:` can't match.
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" class="underline underline-offset-2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return t;
}

/** Drop the DRAFT watermark line(s) from the source (for the signed/final view). */
export function stripDraftWatermark(md: string): string {
  return md
    .split(/\n/)
    // Remove watermark lines: (a) any heading line that contains the word DRAFT
    // (the document title / version banner), and (b) any standalone DRAFT marker
    // line. Substantive body clauses (non-heading paragraphs) that merely mention
    // "draft" inside a sentence are KEPT.
    .filter((line) => {
      const l = line.trim();
      const isHeading = /^#{1,6}\s/.test(l);
      if (isHeading && /\bdraft\b/i.test(l)) return false;          // heading banner with DRAFT
      if (/-draft\b/i.test(l) && isHeading) return false;           // heading ending in -DRAFT tag
      if (/^#{0,6}\s*draft\b.*$/i.test(l) && l.replace(/[#\s]/g, "").length < 40) return false; // standalone DRAFT marker
      return true;
    })
    .join("\n");
}

/**
 * Render Markdown → sanitized HTML string.
 * @param md      the raw agreement Markdown
 * @param opts.final  when true, strip the DRAFT watermark (signed/executed view)
 */
export function renderAgreementHtml(md: string, opts?: { final?: boolean }): string {
  const source = opts?.final ? stripDraftWatermark(md) : md;
  const lines = source.split(/\n/);
  const out: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) { out.push("</ul>"); listOpen = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const esc = escapeHtml(line);

    if (/^#\s+/.test(line)) {                 // # H1  → h3 (document title scale)
      closeList();
      out.push(`<h3 class="agreement-h1">${renderInlineEscaped(esc.replace(/^#\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {         // ## H2 → h4
      closeList();
      out.push(`<h4 class="agreement-h2">${renderInlineEscaped(esc.replace(/^##\s+/, ""))}</h4>`);
    } else if (/^###\s+/.test(line)) {        // ### H3 → h4
      closeList();
      out.push(`<h4 class="agreement-h3">${renderInlineEscaped(esc.replace(/^###\s+/, ""))}</h4>`);
    } else if (/^[-*]\s+/.test(line)) {       // - list item
      if (!listOpen) { out.push('<ul class="agreement-ul">'); listOpen = true; }
      out.push(`<li>${renderInlineEscaped(esc.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (/^>\s?/.test(line)) {          // > blockquote
      closeList();
      // NOTE: escapeHtml() has already turned the leading ">" into "&gt;", so we
      // must strip the ESCAPED entity here (not the raw ">") or a stray "&gt;"
      // would render inside the blockquote.
      out.push(`<blockquote class="agreement-quote">${renderInlineEscaped(esc.replace(/^&gt;\s?/, ""))}</blockquote>`);
    } else if (line.trim() === "") {          // blank → paragraph break
      closeList();
    } else {                                   // paragraph
      closeList();
      out.push(`<p class="agreement-p">${renderInlineEscaped(esc)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}
