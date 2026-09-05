/**
 * server/lib/tenantId.ts
 *
 * W316 · LAYER 3 — A TENANT ID THAT CANNOT BE OMITTED OR LEFT BLANK.
 *
 * ── WHY A BRAND ─────────────────────────────────────────────────────────────
 * The tree's tenant fence idiom, established by W303 (R247), is
 *
 *     AND (? IS NULL OR tenant_id = ?)      with   tenantId ?? null
 *
 * and `latestValuationEvent(vehicleKind, vehicleId, holdingId?, tenantId?)` is
 * the specimen of what is wrong with it: the tenant is OPTIONAL. Omitting it
 * does not throw, does not warn, and does not fail to compile — it silently
 * widens the read to every tenant on the platform. THREE SEPARATE HAND
 * ENUMERATIONS FAILED to find every such site, because you cannot grep for an
 * argument that is not there.
 *
 * A branded type turns that omission into a COMPILE ERROR at the readers this
 * wave fixes:
 *
 *   · omitting the parameter        → TS2345 / TS2554 (it is required)
 *   · passing a bare `string`       → TS2345 (the brand is missing)
 *   · passing a blank or whitespace → THROWS at `asTenantId`, at the boundary,
 *                                     with the same refusal semantics as
 *                                     `requireTenantForRead` (HTTP 400
 *                                     TENANT_UNRESOLVED)
 *
 * `"default"` IS ACCEPTED. Single-tenant installations legitimately run on that
 * tenant id and refusing it would lock out real, paying users — which this band
 * is expressly forbidden to do. A fence that breaks the product is not a fence,
 * it is an outage.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * This is not a platform-wide guarantee. Retrofitting a branded id onto every
 * `db().prepare(...)` call site in `server/**` would touch frozen files and is
 * far beyond one wave. It is applied where it is affordable — the readers W316
 * fixes — and the BUILD-TIME FENCE (`scripts/lint/tenantScopeFence.ts`) is what
 * covers the ground this cannot.
 */

/** A tenant id that has been through `asTenantId` and is known non-blank. */
export type TenantId = string & { readonly __tenant: unique symbol };

/**
 * A NON-EMPTY set of tenant ids to scope a read to.
 *
 * WHY A SET AND NOT A SINGLE ID. An investor can legitimately hold the same
 * portfolio company under more than one GP, and the marks they are entitled to
 * see are the marks of the tenants they actually hold it under. Scoping such a
 * caller to one tenant would HIDE ROWS THEY LEGITIMATELY OWN, and an over-tight
 * fix that hides a GP's own data is a worse outcome than the exposure it was
 * meant to close. The type is non-empty by construction, so "scope to nothing"
 * — which would return an empty chart to everybody and pass a naive leak test —
 * cannot be expressed.
 */
export type TenantScope = readonly [TenantId, ...TenantId[]];

export class TenantUnresolvedError extends Error {
  readonly code = "TENANT_UNRESOLVED";
  constructor(message: string) {
    super(message);
    this.name = "TenantUnresolvedError";
  }
}

/**
 * The ONLY constructor. Throws rather than returning a widening value, because
 * every alternative — `null`, `""`, `"default"`-on-blank — is a silent widening
 * of a read, and a fence whose failure mode is "read everything" is not a fence.
 */
export function asTenantId(raw: unknown): TenantId {
  if (typeof raw !== "string") {
    throw new TenantUnresolvedError(
      `TENANT_UNRESOLVED: a tenant id must be a string, got ${raw === null ? "null" : typeof raw}. ` +
        "Tenant-scoped reads are refused rather than widened.",
    );
  }
  const t = raw.trim();
  if (!t) {
    throw new TenantUnresolvedError(
      "TENANT_UNRESOLVED: this request has no resolvable tenant, so it cannot be scoped. " +
        "Tenant-scoped reads are refused rather than widened.",
    );
  }
  return t as TenantId;
}

/** Build a non-empty scope. Throws when the input is empty or any member is blank. */
export function asTenantScope(raw: readonly unknown[]): TenantScope {
  const ids = raw.map(asTenantId);
  const seen = new Set<string>();
  const uniq: TenantId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  if (uniq.length === 0) {
    throw new TenantUnresolvedError(
      "TENANT_UNRESOLVED: an empty tenant scope would either read every tenant or none of them. " +
        "Both are wrong, so it is refused.",
    );
  }
  return uniq as unknown as TenantScope;
}

/** `?,?,?` for a scope, so no call site hand-rolls the placeholder count. */
export function tenantPlaceholders(scope: TenantScope): string {
  return scope.map(() => "?").join(",");
}
