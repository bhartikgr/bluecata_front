/**
 * v23.9 A4/CP-5 — Company ↔ Consortium-Partner sponsor links.
 *
 * A Capavate company can be sponsored by exactly one consortium partner. This
 * store keeps the link (companyId → partnerId) so the admin panel can attach,
 * detach, and surface the sponsor relationship. In-memory is the source of
 * truth for the link at runtime; reads are O(1).
 */

const links = new Map<string, string>(); // companyId -> partnerId

export function linkConsortiumPartner(companyId: string, partnerId: string): void {
  links.set(companyId, partnerId);
}

export function unlinkConsortiumPartner(companyId: string): boolean {
  return links.delete(companyId);
}

export function getConsortiumPartnerId(companyId: string): string | null {
  return links.get(companyId) ?? null;
}

export function listConsortiumLinks(): Array<{ companyId: string; partnerId: string }> {
  return Array.from(links.entries()).map(([companyId, partnerId]) => ({ companyId, partnerId }));
}

export function clearConsortiumLinks(): void {
  links.clear();
}
