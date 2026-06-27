/**
 * v25.17 Lane D NC3 — Defence against javascript:/data: URL XSS.
 *
 * Several admin/founder/investor screens render user-supplied URL fields
 * (linkedinUrl, twitterUrl, website, refLinks, etc.) into an <a href={...}>
 * without validating the protocol. A malicious user can store
 * `javascript:alert(1)` in their profile and any admin viewing that profile
 * gets script execution under the admin origin.
 *
 * `safeHref` accepts any candidate URL and returns either:
 *   - The original URL when the protocol is http/https/mailto/tel
 *   - A safe placeholder ("#") when the protocol is anything else (incl. javascript:, data:, vbscript:, file:)
 *   - "#" for null/undefined/empty inputs
 *
 * Use everywhere a user-supplied URL is rendered into href={...}.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function safeHref(input: string | null | undefined): string {
  if (!input) return "#";
  const trimmed = String(input).trim();
  if (!trimmed) return "#";
  // Block javascript: and similar even if obfuscated (e.g. "  javaScript :")
  const lowered = trimmed.toLowerCase().replace(/\s+/g, "");
  if (lowered.startsWith("javascript:") || lowered.startsWith("data:") || lowered.startsWith("vbscript:") || lowered.startsWith("file:")) {
    return "#";
  }
  // Permit relative URLs (start with / or ./ or ../ or #)
  if (/^([./#?]|[a-z0-9])/i.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (ALLOWED_PROTOCOLS.has(u.protocol)) return trimmed;
    return "#";
  } catch {
    // Not a valid absolute URL — treat as relative
    return trimmed;
  }
}

/**
 * Strict variant for href={...} where we KNOW the URL should be absolute (http/https).
 * Returns null when the URL is invalid so callers can hide the link entirely.
 */
export function safeExternalHref(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
    return null;
  } catch {
    return null;
  }
}
