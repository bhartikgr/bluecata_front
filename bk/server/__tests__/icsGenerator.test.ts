/**
 * server/__tests__/icsGenerator.test.ts — v18 Phase A.
 *
 * Tests the pure RFC5545 ICS generator at server/lib/icsGenerator.ts.
 *
 * Coverage:
 *   - CRLF line endings on every content line and trailing newline
 *   - Required properties (BEGIN/END VCALENDAR/VEVENT, VERSION, PRODID,
 *     UID, DTSTAMP, DTSTART, DTEND, SUMMARY, STATUS)
 *   - RFC5545 3.3.11 TEXT escaping for `\`, `;`, `,`, `\n`
 *   - RFC5545 3.1 line folding at 75 octets (ASCII + multi-byte UTF-8)
 *   - DTSTART/DTEND UTC format `YYYYMMDDTHHMMSSZ`
 *   - Duration math (start + durationMinutes*60 == end)
 *   - STATUS:CANCELLED honored
 *   - ORGANIZER with CN= param (no email and with email)
 *   - Optional DESCRIPTION / LOCATION omitted when empty
 *   - Input validation errors
 */

import { describe, it, expect } from "vitest";
import {
  generateIcs,
  escapeText,
  formatIcsUtc,
  foldLine,
} from "../lib/icsGenerator";

const FIXED_STAMP = 1_710_000_000; // 2024-03-09T16:00:00Z
const FIXED_START = 1_715_000_000; // 2024-05-06T12:53:20Z

function lines(ics: string): string[] {
  // Split on CRLF for inspection. Drop a trailing empty caused by the final CRLF.
  const parts = ics.split("\r\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Reverse RFC5545 folding so we can inspect logical content lines.
 * A continuation line starts with SPACE or HTAB and is joined to the
 * previous line with the leading whitespace removed (3.1).
 */
function unfold(ics: string): string[] {
  const raw = lines(ics);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

describe("icsGenerator — generateIcs", () => {
  it("emits a minimal valid VCALENDAR with required properties + CRLF endings", () => {
    const ics = generateIcs({
      uid: "evt_minimal@capavate.collective",
      title: "Pitch — NovaPay seed round",
      scheduledFor: FIXED_START,
      durationMinutes: 60,
      dtstamp: FIXED_STAMP,
    });

    // Every content line must terminate with CRLF — confirm raw bytes.
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/); // no bare LF anywhere

    const logical = unfold(ics);
    // BEGIN/END pair counts (exactly one VEVENT block).
    const vcalBegins = logical.filter((l) => l === "BEGIN:VCALENDAR").length;
    const vcalEnds = logical.filter((l) => l === "END:VCALENDAR").length;
    const veventBegins = logical.filter((l) => l === "BEGIN:VEVENT").length;
    const veventEnds = logical.filter((l) => l === "END:VEVENT").length;
    expect(vcalBegins).toBe(1);
    expect(vcalEnds).toBe(1);
    expect(veventBegins).toBe(1);
    expect(veventEnds).toBe(1);

    // Required properties present.
    expect(logical).toContain("VERSION:2.0");
    expect(logical).toContain("PRODID:-//Capavate Collective//Screening Events//EN");
    expect(logical).toContain("CALSCALE:GREGORIAN");
    expect(logical).toContain("METHOD:PUBLISH");
    expect(logical).toContain("UID:evt_minimal@capavate.collective");
    expect(logical).toContain(`DTSTAMP:${formatIcsUtc(FIXED_STAMP)}`);
    expect(logical).toContain(`DTSTART:${formatIcsUtc(FIXED_START)}`);
    expect(logical).toContain(`DTEND:${formatIcsUtc(FIXED_START + 60 * 60)}`);
    expect(logical).toContain("STATUS:CONFIRMED");
    // SUMMARY value — comma-free in this title, so unescaped.
    expect(logical).toContain("SUMMARY:Pitch — NovaPay seed round");

    // No optional DESCRIPTION/LOCATION/ORGANIZER lines.
    expect(logical.some((l) => l.startsWith("DESCRIPTION:"))).toBe(false);
    expect(logical.some((l) => l.startsWith("LOCATION:"))).toBe(false);
    expect(logical.some((l) => l.startsWith("ORGANIZER"))).toBe(false);
  });

  it("computes DTEND as DTSTART + durationMinutes*60", () => {
    const ics = generateIcs({
      uid: "evt_dur@capavate.collective",
      title: "Office hours",
      scheduledFor: FIXED_START,
      durationMinutes: 45,
      dtstamp: FIXED_STAMP,
    });
    const logical = unfold(ics);
    const start = logical.find((l) => l.startsWith("DTSTART:"))!;
    const end = logical.find((l) => l.startsWith("DTEND:"))!;
    expect(start).toBe(`DTSTART:${formatIcsUtc(FIXED_START)}`);
    expect(end).toBe(`DTEND:${formatIcsUtc(FIXED_START + 45 * 60)}`);
  });

  it("emits UTC DTSTAMP/DTSTART/DTEND in YYYYMMDDTHHMMSSZ form", () => {
    const ics = generateIcs({
      uid: "evt_utc@capavate.collective",
      title: "T",
      scheduledFor: FIXED_START,
      durationMinutes: 60,
      dtstamp: FIXED_STAMP,
    });
    const logical = unfold(ics);
    for (const prop of ["DTSTAMP", "DTSTART", "DTEND"]) {
      const line = logical.find((l) => l.startsWith(`${prop}:`))!;
      expect(line).toMatch(/^[A-Z]+:\d{8}T\d{6}Z$/);
    }
  });

  it("escapes `,`, `;`, `\\`, and newlines per RFC5545 3.3.11", () => {
    const ics = generateIcs({
      uid: "evt_esc@capavate.collective",
      title: "A, B; C\\D",
      description: "line 1\nline 2\r\nline 3",
      location: "Room 1, Floor 2; back\\office",
      scheduledFor: FIXED_START,
      durationMinutes: 60,
      dtstamp: FIXED_STAMP,
    });
    const logical = unfold(ics);
    expect(logical).toContain("SUMMARY:A\\, B\\; C\\\\D");
    expect(logical).toContain("DESCRIPTION:line 1\\nline 2\\nline 3");
    expect(logical).toContain("LOCATION:Room 1\\, Floor 2\\; back\\\\office");
  });

  it("emits STATUS:CANCELLED when input.status is CANCELLED", () => {
    const ics = generateIcs({
      uid: "evt_cancel@capavate.collective",
      title: "T",
      scheduledFor: FIXED_START,
      durationMinutes: 60,
      dtstamp: FIXED_STAMP,
      status: "CANCELLED",
    });
    expect(unfold(ics)).toContain("STATUS:CANCELLED");
  });

  it("emits ORGANIZER with CN= param and mailto: URI", () => {
    const ics = generateIcs({
      uid: "evt_org@capavate.collective",
      title: "T",
      scheduledFor: FIXED_START,
      durationMinutes: 60,
      dtstamp: FIXED_STAMP,
      organizer: { name: "Aisha Patel", email: "aisha@capavate.local" },
    });
    expect(unfold(ics)).toContain(
      `ORGANIZER;CN="Aisha Patel":mailto:aisha@capavate.local`,
    );
  });

  it("emits ORGANIZER with sentinel mailto when only name provided", () => {
    const ics = generateIcs({
      uid: "evt_org2@capavate.collective",
      title: "T",
      scheduledFor: FIXED_START,
      durationMinutes: 60,
      dtstamp: FIXED_STAMP,
      organizer: { name: "Solo Organizer" },
    });
    expect(unfold(ics)).toContain(
      `ORGANIZER;CN="Solo Organizer":mailto:noreply@capavate.local`,
    );
  });

  it("validates required inputs", () => {
    expect(() => generateIcs(null as unknown as any)).toThrow(/input required/);
    expect(() =>
      generateIcs({
        uid: "",
        title: "T",
        scheduledFor: FIXED_START,
        durationMinutes: 60,
      } as any),
    ).toThrow(/uid required/);
    expect(() =>
      generateIcs({
        uid: "u",
        title: "",
        scheduledFor: FIXED_START,
        durationMinutes: 60,
      } as any),
    ).toThrow(/title required/);
    expect(() =>
      generateIcs({
        uid: "u",
        title: "t",
        scheduledFor: "nope" as unknown as number,
        durationMinutes: 60,
      } as any),
    ).toThrow(/scheduledFor/);
    expect(() =>
      generateIcs({
        uid: "u",
        title: "t",
        scheduledFor: FIXED_START,
        durationMinutes: 0,
      } as any),
    ).toThrow(/durationMinutes/);
  });
});

describe("icsGenerator — escapeText", () => {
  it("escapes backslash first to avoid double-escape", () => {
    expect(escapeText("a\\,b")).toBe("a\\\\\\,b");
  });
  it("escapes semicolon, comma, newline", () => {
    expect(escapeText("x,y;z")).toBe("x\\,y\\;z");
    expect(escapeText("a\nb\r\nc\rd")).toBe("a\\nb\\nc\\nd");
  });
  it("returns empty for non-string input", () => {
    expect(escapeText(undefined as unknown as string)).toBe("");
    expect(escapeText(123 as unknown as string)).toBe("");
  });
});

describe("icsGenerator — formatIcsUtc", () => {
  it("formats unix seconds as YYYYMMDDTHHMMSSZ", () => {
    // 2024-05-06T12:53:20Z
    expect(formatIcsUtc(1_715_000_000)).toBe("20240506T125320Z");
    // 1970-01-01T00:00:00Z
    expect(formatIcsUtc(0)).toBe("19700101T000000Z");
  });
  it("truncates fractional seconds", () => {
    expect(formatIcsUtc(0.999)).toBe("19700101T000000Z");
  });
});

describe("icsGenerator — foldLine (RFC5545 3.1)", () => {
  it("does not fold lines ≤ 75 ASCII chars", () => {
    const line = "A".repeat(75);
    expect(foldLine(line)).toBe(line);
    expect(foldLine(line)).not.toContain("\r\n");
  });

  it("folds ASCII lines at 75 octets, continuation starts with a single SPACE", () => {
    const line = "B".repeat(150);
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // First segment is exactly 75 octets.
    expect(parts[0].length).toBe(75);
    // Every continuation starts with a single SPACE and is ≤ 75 octets total.
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].startsWith(" ")).toBe(true);
      expect(Buffer.byteLength(parts[i], "utf8")).toBeLessThanOrEqual(75);
    }
    // Round-trips: unfolding reassembles the original.
    const unfolded =
      parts[0] + parts.slice(1).map((p) => p.slice(1)).join("");
    expect(unfolded).toBe(line);
  });

  it("respects 75-OCTET (not character) limit for multi-byte UTF-8", () => {
    // "—" (U+2014) is 3 bytes in UTF-8. 30 of them = 90 bytes > 75.
    const line = "—".repeat(30);
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    // No segment may exceed 75 octets.
    for (const seg of parts) {
      expect(Buffer.byteLength(seg, "utf8")).toBeLessThanOrEqual(75);
    }
    // No segment splits a multi-byte codepoint — every segment is valid UTF-8.
    for (const seg of parts) {
      // round-trip via Buffer guarantees no broken sequences.
      const buf = Buffer.from(seg, "utf8");
      expect(buf.toString("utf8")).toBe(seg);
    }
    // Round-trips.
    const unfolded =
      parts[0] + parts.slice(1).map((p) => p.slice(1)).join("");
    expect(unfolded).toBe(line);
  });

  it("produces folded output that round-trips for very long mixed strings", () => {
    const mixed = "X".repeat(50) + "—".repeat(20) + "Y".repeat(50);
    const folded = foldLine(mixed);
    const parts = folded.split("\r\n");
    const unfolded =
      parts[0] + parts.slice(1).map((p) => p.slice(1)).join("");
    expect(unfolded).toBe(mixed);
  });
});
