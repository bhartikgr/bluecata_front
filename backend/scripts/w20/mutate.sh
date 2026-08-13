#!/usr/bin/env bash
# WAVE 20 — falsification harness.
#
# A green suite proves nothing until you have made the product wrong and watched
# the suite go red. Ten times in this project a check that passed was checking
# nothing, so each mutation below reintroduces a SPECIFIC defect the wave claims
# to prevent, runs the suite, and requires it to FAIL.
#
# Every mutation is applied with an anchor that occurs EXACTLY ONCE in its file
# (asserted before the edit). A tree hash is taken before and after, so the run
# proves the tree was restored byte-identically — restore verbatim, never
# allowlist.
#
#   bash scripts/w20/mutate.sh
#
set -uo pipefail
cd "$(dirname "$0")/../.."

SUITE="client/src/pages/partner/__tests__/wave20_partner_surface.test.tsx"
FILES=(
  "client/src/lib/partner/mfcrmPersona.ts"
  "client/src/pages/partner/PartnerMfcrmPersonas.tsx"
  "client/src/components/partner/PartnerShell.tsx"
  "client/src/components/partner/SpvDetailTabs.tsx"
  "client/src/pages/partner/PartnerManagedFounders.tsx"
  "client/src/pages/partner/PartnerDashboard.tsx"
  "client/src/components/collective/widgets/VentureMarketsCard.tsx"
  "$SUITE"
)

hash_tree() { for f in "${FILES[@]}"; do sha256sum "$f"; done | sha256sum | cut -d' ' -f1; }
BEFORE_HASH="$(hash_tree)"
WORK="$(mktemp -d)"
for f in "${FILES[@]}"; do mkdir -p "$WORK/$(dirname "$f")"; cp "$f" "$WORK/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$WORK/$f" "$f"; done; }
trap restore EXIT

PASS=0; MISS=0; N=0
declare -a MISSED=()

# mutate <id> <file> <find> <replace> <what-it-would-ship>
mutate() {
  local id="$1" file="$2" find="$3" repl="$4" why="$5"
  N=$((N+1))
  local count
  count="$(python3 - "$file" "$find" <<'PY'
import sys
print(open(sys.argv[1]).read().count(sys.argv[2]))
PY
)"
  if [ "$count" != "1" ]; then
    echo "MUT $id  ANCHOR NOT UNIQUE (found $count) in $file — extend the anchor"
    MISS=$((MISS+1)); MISSED+=("$id (ambiguous anchor)"); return
  fi
  python3 - "$file" "$find" "$repl" <<'PY'
import sys
p,f,r=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read(); assert s.count(f)==1
open(p,"w").write(s.replace(f,r))
PY
  if npx vitest run "$SUITE" >/tmp/w20_mut.log 2>&1; then
    echo "MUT $id  *** MISSED *** — suite still green while: $why"
    MISS=$((MISS+1)); MISSED+=("$id — $why")
  else
    echo "MUT $id  detected"
    PASS=$((PASS+1))
  fi
  restore
}

# control <id> <file> <find> <replace> <why-it-is-a-no-op>
# A NEGATIVE control: the edit must leave the suite GREEN. Without these, a
# suite that fails on literally any edit would score 100% while proving nothing.
CTRL_BAD=0
control() {
  local id="$1" file="$2" find="$3" repl="$4" why="$5"
  python3 - "$file" "$find" "$repl" <<'PY2'
import sys
p,f,r=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read(); assert s.count(f)==1, f"anchor not unique: {s.count(f)}"
open(p,"w").write(s.replace(f,r))
PY2
  if npx vitest run "$SUITE" >/tmp/w20_ctl.log 2>&1; then
    echo "CTL $id  correctly green — $why"
  else
    echo "CTL $id  *** BAD CONTROL *** suite went red on a no-op: $why"
    CTRL_BAD=$((CTRL_BAD+1))
  fi
  restore
}

echo "=== WAVE 20 falsification harness ==="

# ---------------------------------------------------------------- W-6 gates
mutate M01 client/src/lib/partner/mfcrmPersona.ts \
  'if (!capability.classified) return null;' \
  'if (false) return null;' \
  "an UNCLASSIFIED firm resolves to a persona and is shown tools the server will 403"

mutate M02 client/src/lib/partner/mfcrmPersona.ts \
  'if (!capability || !capability.classified) {
    return { action, allowed: false, blockedBy: action.gates.length > 0 ? action.gates[0] : null };' \
  'if (false) {
    return { action, allowed: false, blockedBy: action.gates.length > 0 ? action.gates[0] : null };' \
  "an unreadable capability profile FAILS OPEN — every action treated as permitted"

mutate M03 client/src/lib/partner/mfcrmPersona.ts \
  'if (Boolean((capability as unknown as Record<string, unknown>)[g.key]) !== g.equals) {' \
  'if (false) {' \
  "every capability gate is ignored; a firm without paysOnBehalf is offered the rebill form"

control C01 client/src/lib/partner/mfcrmPersona.ts \
  'serverCode: "INVESTOR_SPINE_FORBIDDEN",
  source: "server/mfcrmLawStore.ts:70-76,:113",' \
  'serverCode: "INVESTOR_SPINE_FORBIDDEN",
  source: "server/mfcrmLawStore.ts:70-76,:113",
  /* comment-only edit */' \
  "a comment-only edit changes no behaviour"

mutate M05 client/src/lib/partner/mfcrmPersona.ts \
  '  key: "sourcesCapital",
  equals: false,' \
  '  key: "sourcesCapital",
  equals: true,' \
  "POLARITY FLIP — a capital-sourcing firm is offered counsel-of-record, which the server forbids"

# M06 WITHDRAWN, with the reasoning recorded rather than the mutation quietly
# dropped. It renamed `serverCode: "PAYS_ON_BEHALF_REQUIRED"` and the suite
# stayed green. Investigated: `serverCode` is DOCUMENTATION on the gate record —
# it names the code the server throws so a reader can find it. Nothing branches
# on it: the UI decides availability from `key`/`equals` (personaActionState),
# the refusal copy comes from `capabilityLabel(key)`, and the runtime 403 text
# comes from `PERSONA_ERROR_COPY` keyed on the error the SERVER actually sends.
# The mutation is therefore a genuine user-visible no-op and it is withdrawn as
# invalid, NOT counted as a coverage gap. Turned into a control instead:
control C02 client/src/lib/partner/mfcrmPersona.ts \
  '  serverCode: "PAYS_ON_BEHALF_REQUIRED",' \
  '  serverCode: "PAYS_ON_BEHALF_REQUIRED_DOC_ONLY",' \
  "serverCode is documentation; nothing branches on it"

mutate M07 client/src/lib/partner/mfcrmPersona.ts \
  '  key: "paysOnBehalf",' \
  '  key: "fundAdmin",' \
  "a gate is repointed at the WRONG capability key — the classic silent mirror drift"

mutate M08 client/src/lib/partner/mfcrmPersona.ts \
  '      { id: "law-conflict-resolve", method: "POST", path: "/api/partner/me/mfcrm/law/conflicts/:conflictId/resolve", label: "Resolve conflict", gates: [] },' \
  '' \
  "a registered server route drops out of the client map and becomes unreachable again"

# ------------------------------------------------------------- XT-10 money
mutate M09 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '  return formatPercentValue(n / 100);' \
  '  return formatPercentValue(n);' \
  "chapter carry of 1250 bps renders as 1250% instead of 12.5%"

mutate M10 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '{formatMinor(Number(r.amount_minor) || 0, (r.currency || "USD").toUpperCase())}' \
  '{"$" + ((Number(r.amount_minor) || 0) / 100).toFixed(2)}' \
  "HARDCODED /100 — a ¥5,000 JPY expense renders as \$50.00 (the live MAJOR defect)"

mutate M11 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '      const code = (r.currency || "USD").toUpperCase();
      acc.set(code, (acc.get(code) ?? 0) + (Number(r.amount_minor) || 0));' \
  '      const code = "USD";
      acc.set(code, (acc.get(code) ?? 0) + (Number(r.amount_minor) || 0));' \
  "CROSS-CURRENCY SUM — JPY+USD+BHD added together and rendered as one USD figure"

mutate M12 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '  const exp = currencyExponentFor(currency);' \
  '  const exp = 2;' \
  "major→minor conversion assumes exponent 2; a JPY amount is written 100× too large"

# --------------------------------------------------------- XT-10 fail-closed
mutate M13 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '      {capQ.isError && <PersonaLoadError err={capQ.error} testId="mfcrm-persona-capability-error" />}

      {!capQ.isLoading && !capQ.isError && !persona && (' \
  '      {false && <PersonaLoadError err={capQ.error} testId="mfcrm-persona-capability-error" />}

      {!capQ.isLoading && !persona && (' \
  "a 403 on the capability read renders 'No persona tools for your firm type' — a fabricated empty state"

mutate M14 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '        {conflictsQ.isError && <PersonaLoadError err={conflictsQ.error} testId="mfcrm-law-conflicts-error" />}
        {!conflictsQ.isLoading && !conflictsQ.isError && conflicts.length === 0 && (' \
  '        {false && <PersonaLoadError err={conflictsQ.error} testId="mfcrm-law-conflicts-error" />}
        {!conflictsQ.isLoading && conflicts.length === 0 && (' \
  "a refused conflict register renders 'No conflicts recorded' to a firm that has them"

mutate M15 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '        {canWrite && personaActionState(act("acct-rebill-create"), capability).allowed && (' \
  '        {canWrite && (' \
  "the rebill form renders beside its own refusal notice — a button guaranteed to 403"

mutate M16 client/src/pages/partner/PartnerMfcrmPersonas.tsx \
  '      <div className="mt-1" data-testid={`${testId}-reason`}>{gateRefusalText(state.blockedBy)}</div>' \
  '      <div className="mt-1" data-testid={`${testId}-reason`}>Unavailable.</div>' \
  "the refusal stops naming WHICH capability is missing, so the partner cannot act on it"

# ------------------------------------------------------------------- FE-15
mutate M17 client/src/components/partner/PartnerShell.tsx \
  '  const persona = resolvePersona(capQ.data?.capability ?? null);
  if (!persona) return null;' \
  '  const persona = resolvePersona(capQ.data?.capability ?? null) ?? MFCRM_PERSONAS_FALLBACK;' \
  "the header invents a persona when the profile is unreadable"

mutate M18 client/src/components/partner/PartnerShell.tsx \
  '              <PartnerPersonaBadge />' \
  '' \
  "the persona badge is dropped from the header"

# -------------------------------------------------------------------- FE-20
mutate M19 client/src/pages/partner/PartnerDashboard.tsx \
  '          <div className="md:col-span-3" data-testid="card-venture-markets">
            <VentureMarketsCard />
          </div>' \
  '' \
  "the markets widget is unmounted again — a component mounted nowhere is not shipped"

mutate M20 client/src/components/collective/widgets/VentureMarketsCard.tsx \
  '        ) : !notConfigured && records.length === 0 ? (' \
  '        ) : false ? (' \
  "a configured provider returning nothing tells the operator to configure a provider"

mutate M21 client/src/components/collective/widgets/VentureMarketsCard.tsx \
  "            {collectiveWidgetErrorText(q.error, 'Couldn\\'t load venture markets.')}" \
  "            {'Couldn\\'t load venture markets.'}" \
  "a correct 403 refusal is reported to the partner as a platform failure"

# ---------------------------------------------------------------------- V-1
mutate M22 client/src/components/partner/SpvDetailTabs.tsx \
  '          <VintageField value={spvVintageDisplay} />' \
  '' \
  "vintage disappears from the SPV detail Overview tab"

mutate M23 client/src/components/partner/SpvDetailTabs.tsx \
  '    if (!Number.isInteger(n) || n < 1990 || n > 9999) return "—";' \
  '    if (!Number.isInteger(n) || n < 1990 || n > 9999) return String(new Date().getFullYear());' \
  "an SPV with NO recorded vintage displays the current year — a fabricated fact"

mutate M24 client/src/components/partner/SpvDetailTabs.tsx \
  'function VintageField({ value }: { value: string }) {
  return (
    <div data-testid="spv-detail-vintage">
      <div className="font-medium">Vintage year</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}' \
  '' \
  "the VintageField component is deleted (and the call site left dangling)"

# ----------------------------------------------------------------- CP-MFC-12
mutate M25 client/src/pages/partner/PartnerManagedFounders.tsx \
  '      <SpvOnBehalfPanel engagement={e} subRole={role.identity.subRole} />' \
  '' \
  "spv-on-behalf goes back to having zero callers"

mutate M26 client/src/pages/partner/PartnerManagedFounders.tsx \
  '        targetRaiseMinor = Math.round(n * Math.pow(10, currencyExponent(currency)));' \
  '        targetRaiseMinor = Math.round(n * 100);' \
  "a ¥50,000,000 target raise is written to the DB as ¥5,000,000,000"

mutate M27 client/src/pages/partner/PartnerManagedFounders.tsx \
  '  SPV_WRITE_AUTHORITY_REQUIRED:
    "Your firm does not hold SPV write authority, which is required to stand up a vehicle on a founder'"'"'s behalf. An administrator enables it on your capability profile.",' \
  '' \
  "a GATE-3 refusal code loses its copy and reaches the partner unexplained"

mutate M28 client/src/pages/partner/PartnerManagedFounders.tsx \
  '    if (Number.isFinite(t) && t <= Date.now()) out.push(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_EXPIRED);' \
  '    if (Number.isFinite(t) && t < Date.now()) out.push(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_EXPIRED);' \
  "client and server disagree on an artifact expiring right now; the form renders and then 403s"

mutate M29 client/src/pages/partner/PartnerManagedFounders.tsx \
  '        {!listQ.isLoading && !listQ.isError && rows.length === 0 && (' \
  '        {!listQ.isLoading && rows.length === 0 && (' \
  "a failed read of on-behalf vehicles renders 'No vehicles have been created'"

echo
echo "=== RESULT: $PASS/$N mutations detected, $MISS missed; $CTRL_BAD bad controls ==="
for m in "${MISSED[@]:-}"; do [ -n "$m" ] && echo "  MISSED: $m"; done

restore
AFTER_HASH="$(hash_tree)"
echo "tree before: $BEFORE_HASH"
echo "tree after : $AFTER_HASH"
if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then echo "TREE RESTORED BYTE-IDENTICALLY"; else echo "*** TREE NOT RESTORED ***"; exit 1; fi
[ "$MISS" -eq 0 ] && [ "$CTRL_BAD" -eq 0 ] || exit 1
