/* W-FIX1a (2026-07-19) — central activity/entity LABEL resolver (A2).
 *
 * The Dashboard activity feed and Messages surfaces were rendering raw entity
 * ids (`u_founder_…`, `company:co_…`, `rnd_…`). This helper is the single place
 * that turns any actor / entity id into a friendly label, so those surfaces
 * can't regress into id-leakage. Read-only; additive; fail-open.
 *
 * SACRED files are only CALLED here, never modified:
 *   - resolveDisplayName (server/lib/displayNameResolver.ts)
 *   - resolveCompanyName (server/lib/userContext.ts)
 *   - getRoundById       (server/roundsStore.ts)
 */
import { resolveDisplayName } from "./displayNameResolver";
import { resolveCompanyName } from "./userContext";
import { getRoundById as roundsGetById } from "../roundsStore";

/** Resolve an actor id (a user) to a friendly display name — never a raw id. */
export function resolveActorLabel(actor: string | null | undefined): string {
  const id = String(actor ?? "").trim();
  if (!id) return "";
  try {
    const r = resolveDisplayName(id);
    if (r?.name) return r.name;
  } catch { /* fail-open */ }
  return "Someone";
}

/**
 * Resolve an activity "entity"/"target" token to a friendly label.
 * Handles the prefixed forms the audit log emits:
 *   company:co_… / co_… / cmp_…   → company name
 *   u_… / usr_…                   → user display name
 *   rnd_…                         → round name
 * Anything else (already-friendly strings, legacy seed labels) passes through.
 */
export function resolveEntityLabel(entity: string | null | undefined): string {
  const raw = String(entity ?? "").trim();
  if (!raw) return "";
  // Split an optional "type:id" form.
  const colon = raw.indexOf(":");
  const type = colon >= 0 ? raw.slice(0, colon).toLowerCase() : "";
  const idPart = colon >= 0 ? raw.slice(colon + 1).trim() : raw;

  const isCompany = type === "company" || /^(co_|cmp_)/i.test(idPart);
  const isUser = type === "user" || /^(u_|usr_)/i.test(idPart);
  const isRound = type === "round" || /^rnd_/i.test(idPart);

  // A resolved label that still embeds a raw id token is treated as unresolved.
  const isClean = (s: string): boolean => !!s && !/(^|[\s:])?(u_|usr_|co_|cmp_|rnd_)[a-z0-9]/i.test(s);
  try {
    if (isCompany) {
      const nm = (resolveCompanyName(idPart) ?? "").trim();
      if (nm && isClean(nm)) return nm;
    } else if (isUser) {
      const r = resolveDisplayName(idPart);
      if (r?.name && isClean(r.name)) return r.name;
    } else if (isRound) {
      const rnd = roundsGetById(idPart) as any;
      const nm = (rnd?.name ?? rnd?.series ?? "").toString().trim();
      if (nm && isClean(nm)) return nm;
    }
  } catch { /* fail-open */ }

  // If it still looks like a raw id, degrade to a generic label rather than leak it.
  if (/^(u_|usr_|co_|cmp_|rnd_|company:|user:|round:)/i.test(raw)) {
    if (isCompany) return "a company";
    if (isUser) return "a user";
    if (isRound) return "a round";
    return "an item";
  }
  return raw;
}
