/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 7 (second half) — the stub PDF served `â` and declared a wrong length.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `minimalPdf()` is the graceful fallback served when a dataroom row has neither
 * in-memory bytes nor a durable storage key. QA opened one and read:
 *
 *     "1. Certificate of Incorporation.pdf â preview unavailable"
 *
 * ROOT CAUSE, PROVED BY THE BYTES: the source used `\u2014` (EM DASH), which is
 * three UTF-8 bytes `e2 80 94`. The stream is drawn with `/BaseFont /Helvetica`
 * and NO `/Encoding`, and a PDF *simple* font is SINGLE-BYTE — so each byte
 * becomes its own glyph and `0xe2` renders as `â`.
 *
 * SECOND, INDEPENDENT BUG: `/Length` was `44 + text.length`, mixing JS UTF-16
 * code units with a byte count. Measured on QA's exact filename it declared 101
 * for a stream of 90 bytes.
 *
 * These assertions read the PRODUCED BUFFER — not the source, not a description
 * of it — and the first two exist to prove the harness can tell the two states
 * apart at all.
 */
import { describe, it, expect } from "vitest";
import { minimalPdf } from "../dataroomStore";

/** The exact filename from the QA report. */
const QA_NAME = "1. Certificate of Incorporation.pdf";

/** Re-implements ONLY the parser, never the producer: pull `/Length N` and the
 *  bytes actually between `stream\n` and `\nendstream`. */
function readStream(buf: Buffer): { declared: number; actual: number; content: string } {
  const s = buf.toString("latin1");
  const m = /\/Length (\d+) >> stream\n/.exec(s);
  if (!m) throw new Error("no content stream object found");
  const start = m.index + m[0].length;
  const end = s.indexOf("\nendstream", start);
  if (end < 0) throw new Error("unterminated stream");
  const content = s.slice(start, end);
  return { declared: Number(m[1]), actual: Buffer.byteLength(content, "latin1"), content };
}

describe("QA ITEM 7 · the fallback PDF", () => {
  it("0 · CONTROL — the harness parses a real stream and would notice a mismatch", () => {
    const parsed = readStream(minimalPdf(QA_NAME));
    /* PRECONDITIONS: something was actually parsed. */
    expect(parsed.content.length).toBeGreaterThan(0);
    expect(parsed.declared).toBeGreaterThan(0);
    expect(parsed.content).toContain("BT /F1 18 Tf");
    /* And the parser is not blind to a mismatch: an off-by-one hand-built
       header is detected. */
    const rigged = Buffer.from("x 0 obj << /Length 999 >> stream\nAB\nendstream", "latin1");
    const r = readStream(rigged);
    expect(r.declared).toBe(999);
    expect(r.actual).toBe(2);
    expect(r.declared).not.toBe(r.actual);
  });

  it("1 · NO BYTE ABOVE 0x7E SURVIVES — the `â` cannot be produced", () => {
    const buf = minimalPdf(QA_NAME);
    const bad = [...buf].filter((b) => b > 0x7e);
    expect(bad).toEqual([]);
    /* The three bytes of the em dash, named explicitly. */
    expect(buf.includes(Buffer.from([0xe2, 0x80, 0x94]))).toBe(false);
    expect(buf.toString("latin1")).not.toContain("\u00e2");
    /* And the sentence still reads correctly, with an ASCII hyphen. */
    expect(buf.toString("latin1")).toContain(`(${QA_NAME} - preview unavailable)`);
  });

  it("2 · `/Length` NOW MATCHES THE BYTES — measured, not asserted from the source", () => {
    const { declared, actual } = readStream(minimalPdf(QA_NAME));
    expect(declared).toBe(actual);
    /* CORRECTED FROM A GUESS TO A MEASUREMENT. The specification measured the
       OLD stream at 88 characters / 90 bytes against a declared 101 — 90 bytes
       because the em dash occupied three of them. With the dash replaced by a
       one-byte ASCII hyphen the same stream is 88 bytes, and 88 is what the
       code now declares. I first asserted 90, ran it, and corrected the
       assertion to what the bytes actually are. */
    expect(actual).toBe(88);
    expect(declared).toBe(88);
    /* The old, wrong declaration is gone. */
    expect(declared).not.toBe(101);
    /* And the 2-byte difference from the spec's 90 is exactly the em dash. */
    expect(90 - actual).toBe(Buffer.byteLength("\u2014", "utf8") - 1);
  });

  it("3 · A NON-ASCII FILENAME IS SAFE TOO — Turkish and Korean hit the same bug", () => {
    for (const name of ["Şirket Ana Sözleşmesi.pdf", "회사 정관.pdf", "Résumé — final.pdf"]) {
      const buf = minimalPdf(name);
      expect([...buf].filter((b) => b > 0x7e)).toEqual([]);
      const { declared, actual } = readStream(buf);
      expect(declared).toBe(actual);
      /* The unrepresentable characters become a visible placeholder rather than
         a byte the viewer will silently mis-decode into a different letter. */
      expect(buf.toString("latin1")).toContain("preview unavailable");
    }
  });

  it("4 · the document is still a PDF and still says what it is", () => {
    const buf = minimalPdf(QA_NAME);
    const s = buf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Type /Catalog");
    expect(s).toContain("/BaseFont /Helvetica");
    expect(s).toContain("preview unavailable");
  });

  it("5 · an empty title still produces a valid document rather than an empty one", () => {
    const { declared, actual, content } = readStream(minimalPdf(""));
    expect(declared).toBe(actual);
    expect(content).toContain("Document - preview unavailable");
  });
});
