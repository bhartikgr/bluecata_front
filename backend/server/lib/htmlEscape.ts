/**
 * v25.17 Lane A NH4/NH5/NH9 — HTML escape helper for email-body template
 * interpolation. Multiple stores (roundInvitationsStore, companyProfileStore,
 * founderCrmStore) were interpolating user-controlled values raw into email
 * `bodyHtml`, producing a stored-XSS vector in recipient mail clients.
 *
 * Usage:
 *   import { escapeHtml as e } from "./lib/htmlEscape";
 *   bodyHtml: `<p>${e(args.investorName)} invited you …</p>`
 */
export function escapeHtml(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
