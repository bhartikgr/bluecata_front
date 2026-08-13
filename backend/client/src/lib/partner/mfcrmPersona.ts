/**
 * WAVE 20 / W-6 — Persona resolution across the 17 Managed-Founder persona routes.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 * ---------------------------------------------------------------------------
 * `server/managedFounderPersonaRoutes.ts` registers **17** routes (verified by
 * counting `app.<verb>(` in that file, not taken from the brief) under
 * `/api/partner/me/mfcrm/{angel,acct,law}/*`, mounted at `server/routes.ts:1014`.
 * Every one of them is gated — some by an explicit capability assert, some by
 * the shape of the capability profile — and **no client knew which persona a
 * partner is, or which of those gates it passes.** Grep for `mfcrm/angel`,
 * `mfcrm/acct` or `mfcrm/law` under `client/` returned **zero** callers before
 * this wave.
 *
 * This module is the single place that answers, from the DB-backed capability
 * profile and nothing else:
 *
 *   1. WHICH persona surface belongs to this partner  (`resolvePersona`)
 *   2. WHETHER a given persona action is permitted     (`personaActionState`)
 *   3. WHY it is not, in the partner's own words       (`missingCapability`)
 *
 * ---------------------------------------------------------------------------
 * IT MIRRORS THE SERVER — AND IS FENCED SO IT CANNOT DRIFT
 * ---------------------------------------------------------------------------
 * Every gate below was read at the cited line. This map is a MIRROR for the
 * purpose of explaining a refusal before it happens; it is **not** the
 * authority. The server remains the authority and still fails closed on its
 * own. A test
 * (`client/src/lib/partner/__tests__/wave20_w6_persona_resolution.test.ts`)
 * parses the three persona stores and fails if a gate is added, removed or
 * repointed without this table being updated — otherwise this file becomes the
 * classic "a check that passes may be checking nothing".
 *
 * ---------------------------------------------------------------------------
 * NO HARDCODING
 * ---------------------------------------------------------------------------
 * Both dimensions are DB-driven and read from one row of `mf_capability_profile`
 * via `GET /api/partner/me/mfcrm/capability`
 * (`server/managedFounderRoutes.ts:70`):
 *   - `partnerType`  — the admin-set firm class, which persona the partner IS
 *   - the boolean capability flags — which actions that persona may take
 * There is no partner list, no environment switch and no literal fallback here.
 *
 * FAIL-CLOSED: an unreadable, absent or unclassified profile resolves to NO
 * persona and NO permitted action. The caller must RENDER that refusal — see
 * `PartnerMfcrmPersonas.tsx`, which does.
 */

/** The capability profile as `GET /api/partner/me/mfcrm/capability` returns it.
 *  Mirrors `CapabilityProfile` (`server/managedFounderStore.ts:41-56`) exactly;
 *  no field here is invented. */
export interface MfcrmCapability {
  partnerId: string;
  partnerType: string | null;
  classified: boolean;
  sourcesCapital: boolean;
  delegatedAgency: boolean;
  spvWriteAuthority: boolean;
  advisoryCoseat: boolean;
  documentCustody: boolean;
  paysOnBehalf: boolean;
  attributionTracking: boolean;
  collectiveFronting: boolean;
  chapterScoping: boolean;
  fundAdmin: boolean;
  updatedAt: string | null;
}

/** The three persona surfaces the 17 routes are divided into. */
export type MfcrmPersonaId = "angel" | "acct" | "law";

/**
 * The capability keys that actually gate a persona route. Declared as a
 * readonly ARRAY and not a `Set`: this tsconfig targets below es2015 without
 * `downlevelIteration`, so spreading a `Set` is TS2802 (the error Wave 7B hit,
 * and rule 9 of this wave's brief).
 */
export type MfcrmGateKey =
  | "chapterScoping"
  | "paysOnBehalf"
  | "documentCustody"
  | "fundAdmin"
  | "spvWriteAuthority";

/** A gate stated as "this flag must hold this value", so the LAW persona's
 *  `sources_capital === false` requirement is expressible in the same shape as
 *  the ordinary "flag must be true" gates rather than special-cased. */
export interface MfcrmGate {
  /** Capability field the server reads. */
  key: keyof MfcrmCapability;
  /** Value it must equal for the route to pass. */
  equals: boolean;
  /** The error code the server throws when it does not. */
  serverCode: string;
  /** Where that was verified, `file:line`. */
  source: string;
}

export interface MfcrmPersonaAction {
  /** Stable id, used for test ids and as a React key. */
  id: string;
  /** HTTP method + path exactly as registered. */
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** Human label for the control this action sits behind. */
  label: string;
  /** Gates that must ALL pass. Empty = ungated on the server (read paths
   *  mostly), which is recorded as an empty array rather than omitted so the
   *  fence can tell "no gate" from "not yet mapped". */
  gates: readonly MfcrmGate[];
}

export interface MfcrmPersonaDef {
  id: MfcrmPersonaId;
  /** The `partner_type` value that makes this persona the partner's own. */
  partnerType: string;
  label: string;
  /** One sentence describing the surface, shown above it. */
  blurb: string;
  actions: readonly MfcrmPersonaAction[];
}

/* Gate constants — each read at the line named in `source`. */
const GATE_CHAPTER_SCOPING: MfcrmGate = {
  key: "chapterScoping",
  equals: true,
  serverCode: "CHAPTER_SCOPING_REQUIRED",
  source: "server/mfcrmAngelStore.ts:50-53",
};
const GATE_PAYS_ON_BEHALF: MfcrmGate = {
  key: "paysOnBehalf",
  equals: true,
  serverCode: "PAYS_ON_BEHALF_REQUIRED",
  source: "server/mfcrmAcctStore.ts:75,:98",
};
const GATE_DOCUMENT_CUSTODY: MfcrmGate = {
  key: "documentCustody",
  equals: true,
  serverCode: "DOCUMENT_CUSTODY_REQUIRED",
  source: "server/mfcrmAcctStore.ts:74,:128",
};
const GATE_FUND_ADMIN: MfcrmGate = {
  key: "fundAdmin",
  equals: true,
  serverCode: "FUND_ADMIN_REQUIRED",
  source: "server/mfcrmAcctStore.ts:79,:151",
};
/** LAW: `assertInvestorSpineDisabled` throws when `sourcesCapital` is TRUE, so
 *  the gate is "sources_capital must be false" — the inverse polarity, which is
 *  exactly why `equals` exists on `MfcrmGate` instead of assuming `true`. */
const GATE_INVESTOR_SPINE_DISABLED: MfcrmGate = {
  key: "sourcesCapital",
  equals: false,
  serverCode: "INVESTOR_SPINE_FORBIDDEN",
  source: "server/mfcrmLawStore.ts:70-76,:113",
};

export const MFCRM_PERSONAS: readonly MfcrmPersonaDef[] = [
  {
    id: "angel",
    partnerType: "angel_network",
    label: "Angel network",
    blurb: "Chapters and chapter-level carry for an angel network.",
    actions: [
      { id: "angel-chapters-list", method: "GET", path: "/api/partner/me/mfcrm/angel/chapters", label: "Chapters", gates: [] },
      { id: "angel-chapter-create", method: "POST", path: "/api/partner/me/mfcrm/angel/chapters", label: "Create chapter", gates: [GATE_CHAPTER_SCOPING] },
      { id: "angel-chapter-carry", method: "PATCH", path: "/api/partner/me/mfcrm/angel/chapters/:chapterId/carry", label: "Set chapter carry", gates: [GATE_CHAPTER_SCOPING] },
      { id: "angel-engagement-chapter", method: "POST", path: "/api/partner/me/mfcrm/angel/engagements/:engagementId/chapter", label: "Assign engagement to chapter", gates: [GATE_CHAPTER_SCOPING] },
      { id: "angel-carry-report", method: "GET", path: "/api/partner/me/mfcrm/angel/carry-report", label: "Chapter carry report", gates: [] },
    ],
  },
  {
    id: "acct",
    partnerType: "accounting",
    label: "Accounting firm",
    blurb: "Firm-of-record, rebillable expenses, document custody and fund administration.",
    actions: [
      { id: "acct-firm-of-record", method: "POST", path: "/api/partner/me/mfcrm/acct/firm-of-record", label: "Stamp firm-of-record", gates: [] },
      { id: "acct-rebill-create", method: "POST", path: "/api/partner/me/mfcrm/acct/rebill", label: "Record rebillable expense", gates: [GATE_PAYS_ON_BEHALF] },
      { id: "acct-rebill-list", method: "GET", path: "/api/partner/me/mfcrm/acct/rebill", label: "Rebillable expenses", gates: [] },
      { id: "acct-custody-create", method: "POST", path: "/api/partner/me/mfcrm/acct/custody", label: "Add document to custody", gates: [GATE_DOCUMENT_CUSTODY] },
      { id: "acct-custody-list", method: "GET", path: "/api/partner/me/mfcrm/acct/custody", label: "Documents in custody", gates: [] },
      { id: "acct-fund-admin-report", method: "GET", path: "/api/partner/me/mfcrm/acct/fund-admin-report", label: "Fund administration report", gates: [GATE_FUND_ADMIN] },
    ],
  },
  {
    id: "law",
    partnerType: "law",
    label: "Law firm",
    blurb: "Matters, counsel-of-record and the conflict register. Conflicts are flagged, never blocking.",
    actions: [
      { id: "law-matter-create", method: "POST", path: "/api/partner/me/mfcrm/law/matters", label: "Open matter", gates: [] },
      { id: "law-matter-list", method: "GET", path: "/api/partner/me/mfcrm/law/matters", label: "Matters", gates: [] },
      { id: "law-counsel-of-record", method: "POST", path: "/api/partner/me/mfcrm/law/counsel-of-record", label: "Stamp counsel-of-record", gates: [GATE_INVESTOR_SPINE_DISABLED] },
      { id: "law-conflict-flag", method: "POST", path: "/api/partner/me/mfcrm/law/conflicts", label: "Flag conflict", gates: [] },
      { id: "law-conflict-list", method: "GET", path: "/api/partner/me/mfcrm/law/conflicts", label: "Conflict register", gates: [] },
      { id: "law-conflict-resolve", method: "POST", path: "/api/partner/me/mfcrm/law/conflicts/:conflictId/resolve", label: "Resolve conflict", gates: [] },
    ],
  },
];

/** The number of persona routes this table claims to cover. Asserted against
 *  the route file itself by the W-6 fence, so a new route added to
 *  `managedFounderPersonaRoutes.ts` without a row here fails the build. */
export const MFCRM_PERSONA_ROUTE_COUNT = MFCRM_PERSONAS.reduce((n, p) => n + p.actions.length, 0);

/** Human copy for each capability flag a partner can be missing. Named after
 *  the flag, not the error code, because the partner has to ask an admin to set
 *  the FLAG. */
const CAPABILITY_LABEL: Record<string, string> = {
  chapterScoping: "Chapter scoping",
  paysOnBehalf: "Pays on behalf",
  documentCustody: "Document custody",
  fundAdmin: "Fund administration",
  spvWriteAuthority: "SPV write authority",
  sourcesCapital: "Sources capital",
};

export function capabilityLabel(key: string): string {
  return CAPABILITY_LABEL[key] ?? key;
}

/**
 * Which persona surface is this partner's own?
 *
 * FAIL-CLOSED. Returns `null` when the profile is absent, unreadable, not yet
 * classified, or classified as a firm class that has no persona surface (an
 * investment bank, accelerator, incubator or generic professional-services firm
 * — all real `partner_type` values, none of which owns any of the 17 routes).
 * Callers MUST render that `null` as an explanation, never as an empty list.
 */
export function resolvePersona(capability: MfcrmCapability | null | undefined): MfcrmPersonaDef | null {
  if (!capability) return null;
  if (!capability.classified) return null;
  const t = capability.partnerType;
  if (!t) return null;
  for (const p of MFCRM_PERSONAS) {
    if (p.partnerType === t) return p;
  }
  return null;
}

export interface MfcrmActionState {
  action: MfcrmPersonaAction;
  allowed: boolean;
  /** The first gate that fails, or null when the action is permitted. */
  blockedBy: MfcrmGate | null;
}

/**
 * Is one persona action permitted by this profile?
 *
 * FAIL-CLOSED on a null profile: every action is refused, and `blockedBy`
 * reports the action's first declared gate so the UI can still name a reason.
 * An ungated action on a null profile is also refused — the partner has no
 * readable capability row at all, which is a worse state than a missing flag,
 * and pretending the call would succeed is exactly the fabricated-success shape
 * rule 3 forbids.
 */
export function personaActionState(
  action: MfcrmPersonaAction,
  capability: MfcrmCapability | null | undefined,
): MfcrmActionState {
  if (!capability || !capability.classified) {
    return { action, allowed: false, blockedBy: action.gates.length > 0 ? action.gates[0] : null };
  }
  for (const g of action.gates) {
    if (Boolean((capability as unknown as Record<string, unknown>)[g.key]) !== g.equals) {
      return { action, allowed: false, blockedBy: g };
    }
  }
  return { action, allowed: true, blockedBy: null };
}

/** Convenience: state for every action of a persona, in declaration order. */
export function personaActionStates(
  persona: MfcrmPersonaDef,
  capability: MfcrmCapability | null | undefined,
): MfcrmActionState[] {
  return persona.actions.map((a) => personaActionState(a, capability));
}

/**
 * The sentence shown when an action is refused. Names the flag and who can set
 * it, because the partner cannot set it themselves — only an administrator can
 * (`POST /api/admin/mfcrm/capability/:partnerId/seed` and the matching `PATCH`,
 * `server/managedFounderRoutes.ts:444,:465`, surfaced in the admin UI at
 * `client/src/components/admin/MfcrmCapabilityPanel.tsx`).
 */
export function gateRefusalText(gate: MfcrmGate | null): string {
  if (!gate) {
    return "Your firm's capability profile has not been classified yet. An administrator must classify it before this surface can be used.";
  }
  const label = capabilityLabel(String(gate.key));
  return gate.equals
    ? `Requires the “${label}” capability, which an administrator must enable on your firm's capability profile.`
    : `Requires “${label}” to be off on your firm's capability profile. An administrator must change it.`;
}
