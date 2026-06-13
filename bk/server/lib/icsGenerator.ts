/**
 * server/lib/icsGenerator.ts — v18 Phase A.
 *
 * Pure RFC5545 ICS (iCalendar) generator. No third-party dependency; the
 * spec is implemented inline from RFC5545:
 *   https://datatracker.ietf.org/doc/html/rfc5545
 *
 * What we emit:
 *   BEGIN:VCALENDAR
 *   VERSION:2.0
 *   PRODID:-//Capavate Collective//Screening Events//EN
 *   CALSCALE:GREGORIAN
 *   METHOD:PUBLISH
 *   BEGIN:VEVENT
 *   UID:<uid>
 *   DTSTAMP:<now-utc>
 *   DTSTART:<scheduled-utc>
 *   DTEND:<scheduled-utc + durationMinutes>
 *   SUMMARY:<title, escaped>
 *   DESCRIPTION:<description, escaped>
 *   LOCATION:<location, escaped>
 *   ORGANIZER:<organizer mailto/cn>
 *   STATUS:CONFIRMED|CANCELLED
 *   END:VEVENT
 *   END:VCALENDAR
 *
 * RFC5545 conformance details:
 *   - CRLF line endings between every content line (3.1).
 *   - Lines folded at 75 OCTETS (UTF-8 byte count) — a continuation line
 *     starts with a single SPACE (3.1).
 *   - Special characters in text values are escaped per 3.3.11:
 *       backslash (\)  → \\
 *       semicolon (;)  → \;
 *       comma     (,)  → \,
 *       newline   (\n) → \n
 *   - UTC timestamps use the form YYYYMMDDTHHMMSSZ (3.3.5).
 *
 * Deliberate non-goals:
 *   - We do NOT include TZID/VTIMEZONE blocks — the platform stores times
 *     as unix seconds (UTC) and the generator emits "Z" UTC timestamps.
 *     Calendar clients localize on import. This is the simplest correct
 *     RFC5545 form for events without recurrence.
 *   - We do NOT include ATTENDEE lines yet — the v18 Phase A surface uses
 *     an in-app RSVP system (screening_event_attendees) which is the
 *     source of truth. A future iteration can add ATTENDEE lines once
 *     mail-based ITIP responses are wired in (Avi's calendar transport).
 */

/* eslint-disable no-control-regex */

/** Inputs to the generator — purely scalar; no DB types leak through. */
export interface IcsEventInput {
  /** RFC5545 UID — globally unique, stable per event. Required. */
  uid: string;
  /** Human-readable title. */
  title: string;
  /** Multi-line description; newlines are escaped per 3.3.11. */
  description?: string;
  /**
   * Unix seconds since epoch — the event start time. ICS DTSTART will be
   * emitted in UTC ("Z") form.
   */
  scheduledFor: number;
  /** Duration in minutes; defaults to 60. Must be > 0. */
  durationMinutes: number;
  /** Free-form location text (room, address, or video URL). */
  location?: string;
  /**
   * Optional organizer. If `email` is set, it becomes the ORGANIZER URI
   * (`mailto:<email>`). `name` becomes the CN= parameter.
   */
  organizer?: { name?: string; email?: string };
  /**
   * Optional event status. RFC5545 STATUS property for VEVENT permits
   * 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED'. Defaults to 'CONFIRMED'.
   */
  status?: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  /**
   * Optional override for DTSTAMP (the moment the ICS was generated). Unix
   * seconds. Defaults to "now" at call time. Tests pin this for reproducible
   * output.
   */
  dtstamp?: number;
}

/**
 * Generate an RFC5545-conformant ICS body for a single VEVENT.
 *
 * Throws on missing required fields. Returns a string with CRLF line
 * endings, every content line folded at 75 octets per spec.
 */
export function generateIcs(input: IcsEventInput): string {
  if (!input || typeof input !== "object") {
    throw new Error("ics: input required");
  }
  if (!input.uid || typeof input.uid !== "string") {
    throw new Error("ics: uid required");
  }
  if (!input.title || typeof input.title !== "string") {
    throw new Error("ics: title required");
  }
  if (typeof input.scheduledFor !== "number" || !Number.isFinite(input.scheduledFor)) {
    throw new Error("ics: scheduledFor (unix seconds) required");
  }
  if (
    typeof input.durationMinutes !== "number" ||
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes <= 0
  ) {
    throw new Error("ics: durationMinutes must be > 0");
  }

  const startUnix = Math.trunc(input.scheduledFor);
  const endUnix = startUnix + Math.trunc(input.durationMinutes) * 60;
  const stampUnix = Math.trunc(
    typeof input.dtstamp === "number" && Number.isFinite(input.dtstamp)
      ? input.dtstamp
      : Date.now() / 1000,
  );

  const status: "TENTATIVE" | "CONFIRMED" | "CANCELLED" = input.status ?? "CONFIRMED";

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Capavate Collective//Screening Events//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push("BEGIN:VEVENT");
  // UID is NOT a TEXT value (it's a URI/identifier) so we don't escape it,
  // but we DO sanitize control chars and CRLF away to keep the line shape.
  lines.push(`UID:${sanitizeIdentifier(input.uid)}`);
  lines.push(`DTSTAMP:${formatIcsUtc(stampUnix)}`);
  lines.push(`DTSTART:${formatIcsUtc(startUnix)}`);
  lines.push(`DTEND:${formatIcsUtc(endUnix)}`);
  lines.push(`SUMMARY:${escapeText(input.title)}`);
  if (input.description && input.description.length > 0) {
    lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  }
  if (input.location && input.location.length > 0) {
    lines.push(`LOCATION:${escapeText(input.location)}`);
  }
  if (input.organizer && (input.organizer.email || input.organizer.name)) {
    lines.push(buildOrganizer(input.organizer));
  }
  lines.push(`STATUS:${status}`);
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // Apply RFC5545 line folding to each content line, then join with CRLF.
  // The trailing CRLF is REQUIRED — most parsers expect the body to end
  // with `END:VCALENDAR\r\n`.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/* --------------------------------------------------------------- */
/* Internals                                                         */
/* --------------------------------------------------------------- */

/**
 * RFC5545 3.3.11 — TEXT escaping:
 *   backslash → \\
 *   semicolon → \;
 *   comma     → \,
 *   CR/LF     → \n
 *   bare CR   → drop (CRLF normalized first)
 *
 * Order matters: backslash MUST be escaped first.
 */
export function escapeText(value: string): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\n/g, "\\n");
}

/**
 * Strip control characters / CR / LF from an identifier so it stays on a
 * single content line. RFC5545 UID values are URIs/identifiers, not TEXT —
 * commas and semicolons are technically permitted, so we don't escape them;
 * we only protect against breaking the line shape.
 */
function sanitizeIdentifier(value: string): string {
  return value.replace(/[\r\n\x00-\x1F\x7F]+/g, "");
}

/**
 * Format a unix-seconds timestamp as the RFC5545 UTC date-time form:
 *   YYYYMMDDTHHMMSSZ  (3.3.5 "FORM #2: DATE WITH UTC TIME")
 */
export function formatIcsUtc(unixSeconds: number): string {
  const d = new Date(Math.trunc(unixSeconds) * 1000);
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

/**
 * Build the ORGANIZER content line.
 *
 * RFC5545 3.8.4.3 — `ORGANIZER;CN="<name>":mailto:<email>` is the standard
 * shape. CN parameter values that contain DQUOTE, COLON, or SEMICOLON
 * must be DQUOTE-wrapped (we always wrap to keep the shape predictable).
 *
 * If only `name` is provided (no email), we emit the URI as
 * `mailto:noreply@capavate.local` — RFC5545 requires the value to be a
 * URI; using a sentinel preserves validity while reflecting that no
 * routable email was supplied.
 */
function buildOrganizer(org: { name?: string; email?: string }): string {
  const email = (org.email ?? "").trim();
  const name = (org.name ?? "").trim();
  // CN param: escape backslash + DQUOTE; strip control chars.
  let prefix = "ORGANIZER";
  if (name.length > 0) {
    const cn = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
    prefix += `;CN="${cn}"`;
  }
  const uri = email.length > 0
    ? `mailto:${sanitizeIdentifier(email)}`
    : "mailto:noreply@capavate.local";
  return `${prefix}:${uri}`;
}

/**
 * RFC5545 3.1 — line folding.
 *
 * "Lines of text SHOULD NOT be longer than 75 octets, excluding the line
 *  break.  Long content lines SHOULD be split into a multiple line
 *  representations using a line "folding" technique.  That is, a long
 *  line can be split between any two characters by inserting a CRLF
 *  immediately followed by a single linear white-space character (i.e.,
 *  SPACE or HTAB)."
 *
 * Implementation notes:
 *   - 75 OCTETS, not characters — must count UTF-8 bytes.
 *   - The first segment is at most 75 octets. Continuation segments are
 *     `\r\n ` + up to 74 more octets (because the space counts).
 *   - We do NOT split inside a multi-byte UTF-8 sequence — the splitter
 *     walks the string codepoint-by-codepoint and only emits a fold once
 *     the running byte count meets the limit, never mid-codepoint.
 */
export function foldLine(line: string): string {
  const FIRST_LIMIT = 75;
  const CONT_LIMIT = 74; // continuation line: leading SPACE eats one octet
  // Fast path — ASCII-only and short.
  if (line.length <= FIRST_LIMIT && /^[\x20-\x7E]*$/.test(line)) {
    return line;
  }

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let isFirstSegment = true;

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    const limit = isFirstSegment ? FIRST_LIMIT : CONT_LIMIT;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ch;
      currentBytes = chBytes;
      isFirstSegment = false;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) out.push(current);

  // Join with CRLF + single SPACE per RFC5545 3.1.
  return out.join("\r\n ");
}

/* --------------------------------------------------------------- */
/* Test-only exports                                                 */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  escapeText,
  formatIcsUtc,
  foldLine,
  sanitizeIdentifier,
  buildOrganizer,
});
