/**
 * WAVE 23 · ITEM 3 (REVIEW A MAJOR) — falsification harness for the fourth
 * cross-currency sum: `mfcrmAcctStore.fundAdminReport().rebills`.
 *
 * BOTH POLES:
 *   POLE A  MIXED currencies ⇒ the scalar must be null / unavailable, the
 *           reason must be `needs_fx_conversion`, the per-currency breakdown
 *           must be exact, and NO invented total may appear anywhere in the
 *           payload (specifically: the old wrong sum, 200, must not occur).
 *   POLE B  SINGLE currency ⇒ the scalar must still be a real number, equal to
 *           the exact per-currency total, with the correct currency code. The
 *           fix must not break the ordinary one-currency install.
 *
 * Plus: empty set ⇒ 0 USD (0 is 0 in every currency), non-pending rows are
 * excluded, and a zero-valued row in a second currency still counts as a
 * second currency (a `mixed` state cannot be dodged by a zero).
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave23/item3_mfcrm_currency_harness.ts
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let asserts = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}

async function main() {
  const { applyMfcrmSchema } = await import("../../server/lib/mfcrmSchema.ts");
  const { managedFounderStore } = await import("../../server/managedFounderStore.ts");
  const { mfcrmAcctStore } = await import("../../server/mfcrmAcctStore.ts");
  const { rawDb } = await import("../../server/db/connection.ts");
  applyMfcrmSchema();

  const actor = "u_w23";
  let n = 0;
  function partner(): string {
    const pid = `p_w23_${++n}`;
    managedFounderStore.setCapabilityProfile(
      pid,
      { classified: true, sourcesCapital: false, paysOnBehalf: true, fundAdmin: true },
      actor,
    );
    return pid;
  }
  const rebill = (pid: string, minor: number, currency: string) =>
    mfcrmAcctStore.recordRebill(
      pid,
      { companyId: "co_a", description: `${currency} fee`, amountMinor: minor, currency },
      actor,
    );

  /* ── POLE A — MIXED currencies (the reviewer's exact reproduction) ─────── */
  {
    const pid = partner();
    rebill(pid, 100, "USD");
    rebill(pid, 100, "JPY");
    const r: any = mfcrmAcctStore.fundAdminReport(pid);
    eq(r.rebills.total, 2, "POLE A: both rebills counted");
    eq(r.rebills.pendingAmountMinor, null, "POLE A: mixed ⇒ scalar is null, never 200");
    eq(r.rebills.pendingAmount.available, false, "POLE A: scalar is explicitly unavailable");
    eq(r.rebills.pendingAmount.currency, null, "POLE A: no currency label is invented");
    eq(r.rebills.pendingAmount.reason, "needs_fx_conversion", "POLE A: the reason is stated");
    eq(r.rebills.pendingAmount.currencies, ["JPY", "USD"], "POLE A: contributing currencies are listed");
    eq(
      r.rebills.pendingByCurrency,
      [
        { currency: "JPY", minor: 100 },
        { currency: "USD", minor: 100 },
      ],
      "POLE A: per-currency breakdown is exact and ungrouped across currencies",
    );
    // The strongest form: the wrong number must not be anywhere in the payload.
    const flat = JSON.stringify(r);
    ok(!/[:,]200[,}\]]/.test(flat), `POLE A: the invented cross-currency total 200 appears nowhere (${flat})`);
  }

  /* ── POLE B — SINGLE currency still produces a real scalar ─────────────── */
  {
    const pid = partner();
    rebill(pid, 100, "USD");
    rebill(pid, 250, "USD");
    const r: any = mfcrmAcctStore.fundAdminReport(pid);
    eq(r.rebills.pendingAmountMinor, 350, "POLE B: single currency ⇒ the real total is still emitted");
    eq(r.rebills.pendingAmount.available, true, "POLE B: scalar is available");
    eq(r.rebills.pendingAmount.currency, "USD", "POLE B: the source currency is reported");
    eq(r.rebills.pendingAmount.minor, 350, "POLE B: scalar matches the bucket");
    eq(r.rebills.pendingByCurrency, [{ currency: "USD", minor: 350 }], "POLE B: breakdown matches");
  }
  {
    // …and it is not hardcoded to USD.
    const pid = partner();
    rebill(pid, 5000, "JPY");
    const r: any = mfcrmAcctStore.fundAdminReport(pid);
    eq(r.rebills.pendingAmountMinor, 5000, "POLE B: JPY-only total is emitted");
    eq(r.rebills.pendingAmount.currency, "JPY", "POLE B: JPY is reported as JPY, not relabelled USD");
  }

  /* ── Edges ─────────────────────────────────────────────────────────────── */
  {
    const pid = partner();
    const r: any = mfcrmAcctStore.fundAdminReport(pid);
    eq(r.rebills.total, 0, "EDGE: no rebills at all");
    eq(r.rebills.pendingAmountMinor, 0, "EDGE: nothing pending ⇒ 0 (0 is 0 in every currency)");
    eq(r.rebills.pendingAmount.currency, "USD", "EDGE: the empty case reports the default currency");
    eq(r.rebills.pendingByCurrency, [], "EDGE: empty breakdown");
  }
  {
    // A zero-valued row in a second currency STILL makes the set mixed — a
    // mixed state must not be dodgeable by a zero amount.
    const pid = partner();
    rebill(pid, 100, "USD");
    rebill(pid, 0, "JPY");
    const r: any = mfcrmAcctStore.fundAdminReport(pid);
    eq(r.rebills.pendingAmountMinor, null, "EDGE: a zero-value second currency still means mixed");
    eq(
      r.rebills.pendingByCurrency,
      [
        { currency: "JPY", minor: 0 },
        { currency: "USD", minor: 100 },
      ],
      "EDGE: the zero bucket is still reported",
    );
  }
  {
    // Non-pending rows must be excluded from the pending buckets entirely —
    // including their currency, which must not create a phantom mixed state.
    const pid = partner();
    const usd = rebill(pid, 100, "USD");
    const jpy = rebill(pid, 900, "JPY");
    void usd;
    // The store exposes no status mutator, so flip the row directly — the
    // production settle path writes the same column.
    rawDb().prepare("UPDATE mf_acct_rebill SET status = 'rebilled' WHERE id = ?").run(jpy.id);
    const r: any = mfcrmAcctStore.fundAdminReport(pid);
    eq(r.rebills.total, 2, "EDGE: total still counts every rebill row");
    eq(r.rebills.pendingAmountMinor, 100, "EDGE: a settled JPY row does not make the PENDING set mixed");
    eq(r.rebills.pendingAmount.currency, "USD", "EDGE: only the pending currency is reported");
    eq(r.rebills.pendingByCurrency, [{ currency: "USD", minor: 100 }], "EDGE: settled rows excluded");
  }

  if (failures.length > 0) {
    console.error(`FAIL item3_mfcrm_currency_harness: ${failures.length}/${asserts} asserts failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS item3_mfcrm_currency_harness: ${asserts} asserts, 0 failures`);
  process.exit(0);
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
