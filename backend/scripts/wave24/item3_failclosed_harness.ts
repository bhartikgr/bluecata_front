/**
 * WAVE 24 · ITEM 3 + MONEY — falsification harness for three fail-closed
 * claims. Each part names its SINK and asserts BOTH poles.
 *
 * PART A — MEMBERSHIP PRICING (ITEM 3a, Review B E-1).
 *   CLAIM: "when the price fetch fails, the page refuses instead of rendering
 *   a `—` price with a live Subscribe button."
 *   SINK: the JSX branch in client/src/pages/collective/MembershipPage.tsx that
 *   decides whether `subscribe-btn-standard` / `subscribe-btn-${slug}` mount at
 *   all. There is no server value to interrogate here — the defect is a missing
 *   BRANCH, so the assertion is necessarily on the source of that branch.
 *   THIS PART IS STRUCTURAL, AND SAYS SO. A structural check is the exact shape
 *   of "a check that passed while checking nothing", so it is not trusted on
 *   its own word: the same auditor function is run against a DECOY holding the
 *   PRE-WAVE-24 source shape, and the harness FAILS unless the decoy is
 *   rejected. That is POLE B, and it is what makes the green meaningful.
 *
 * PART B — QUEUE KPIs (ITEM 3b, Review B F-1).
 *   CLAIM: "an unmeasured queue reports N/A, not zero."
 *   SINK: `queues.eligibilityRecompute` / `queues.emailQueue` on the object
 *   `computeKpis()` returns (server/adminPlatformStore.ts), consumed at
 *   client/src/pages/admin/Dashboard.tsx:454 as `{value ?? "—"}`.
 *   BEHAVIOURAL: computeKpis() is actually invoked. POLE A — the two unbacked
 *   figures are `null`. POLE B — the two figures that ARE measured
 *   (`bridgeOutbox`, `deadLetter`, both derived from `getOutbox()`) remain
 *   NUMBERS, because turning every KPI into "—" would be the opposite failure:
 *   hiding a real measurement.
 *
 * PART C — MONEY / JPY (Rule 4).
 *   CLAIM: "`majorToMinorExact()` converts by the ISO-4217 exponent, not /100."
 *   SINK: the minor-unit integer handed to the three Wave 24 admin money
 *   controls, and from there to the invoice / commission / mark routes.
 *   THE JPY FIXTURE IS THE WHOLE POINT: JPY has exponent 0, so a hardcoded
 *   `/100` (or `*100`) passes every USD assertion and silently multiplies a
 *   yen amount by a hundred. POLE A — correct amounts convert exactly. POLE B —
 *   amounts that cannot be expressed in the currency are REFUSED (`undefined`),
 *   never rounded, and the harness additionally asserts that the naive `*100`
 *   implementation would DISAGREE with the real one on the JPY fixture, so the
 *   fixture is proven capable of catching the bug it exists to catch.
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave24/item3_failclosed_harness.ts
 */
process.env.NODE_ENV = "test";

import fs from "node:fs";
import path from "node:path";

let asserts = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ROOT = process.cwd();

/* ===================================================================== *
 * PART A — the auditor, written once and run against BOTH poles.
 * ===================================================================== */

/**
 * Returns the list of things WRONG with a MembershipPage source. Empty list
 * means "this source refuses on a failed price load". Every rule here is a
 * property of the defect Review B found, not of the particular way Wave 24
 * happened to fix it.
 */
function auditMembershipSource(src: string): string[] {
  const problems: string[] = [];

  // 1. There must be an isError branch at all, and it must render the shared
  //    refusal component rather than an ad-hoc empty div.
  if (!/tierQ\.isError|catalogQ\.isError/.test(src)) {
    problems.push("no isError branch on the pricing queries");
  }
  if (!src.includes("LoadFailedRefusal")) {
    problems.push("failed load is not rendered as a refusal");
  }

  // 2. The priced card must be gated on isSuccess — NOT on `!isLoading &&
  //    !isError`, which lets a PAUSED (offline) query through. This is the
  //    caveat in LoadFailedRefusal's own header.
  if (!/!tierQ\.isSuccess|tierQ\.isSuccess/.test(src)) {
    problems.push("the priced card is not gated on isSuccess");
  }

  // 3. ORDERING IS THE ACTUAL DEFECT. A refusal that renders BELOW a live
  //    Subscribe button changes nothing. Every subscribe affordance must sit
  //    after the refusal branch in the same conditional chain.
  const errIdx = src.search(/tierQ\.isError/);
  const subIdx = src.indexOf('data-testid="subscribe-btn-standard"');
  if (subIdx !== -1 && (errIdx === -1 || errIdx > subIdx)) {
    problems.push("subscribe-btn-standard can mount before/without the refusal branch");
  }

  // 4. SECOND PATH, hunted (Rule 2). The dynamic admin catalog renders its own
  //    Subscribe button through a different branch, with its own price that can
  //    independently be null. It must refuse a null price too.
  if (src.includes("subscribe-btn-${p.slug}")) {
    const disabledBlock = src.slice(
      src.indexOf("subscribe-btn-${p.slug}") - 1200,
      src.indexOf("subscribe-btn-${p.slug}"),
    );
    if (!/p\.unitAmount === null/.test(disabledBlock) || !/p\.currency === null/.test(disabledBlock)) {
      problems.push("the dynamic-catalog Subscribe button is live at an unknown price");
    }
  }

  return problems;
}

/** POLE B decoy: the pre-Wave-24 shape, reduced to its load-bearing lines. */
const DECOY_PRE_FIX = `
  const tierQ = useQuery({ queryKey: ["/api/collective/membership/tier"] });
  const catalogQ = useQuery({ queryKey: ["/api/collective/packages"] });
  return (
    <div>
      {tierQ.isLoading || catalogQ.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <Card data-testid="tier-card-standard">
          <p className="text-2xl font-bold">
            {formatMoneyMinor(tier?.amountMinor ?? null, tier?.currency ?? null)}
          </p>
          <Button
            onClick={() => checkoutMut.mutate(undefined)}
            disabled={checkoutMut.isPending}
            data-testid="subscribe-btn-standard"
          >
            Subscribe
          </Button>
        </Card>
      )}
    </div>
  );
`;

async function main(): Promise<number> {
  /* ---------------- PART A ---------------- */
  {
    const p = path.join(ROOT, "client/src/pages/collective/MembershipPage.tsx");
    const src = fs.readFileSync(p, "utf8");

    // POLE A — the shipped source passes the audit.
    const problems = auditMembershipSource(src);
    eq(problems, [], "PART A POLE A: MembershipPage still renders a price it could not load");

    // POLE B — the SAME auditor rejects the pre-fix shape. Without this, PART A
    // is a check that passes while checking nothing.
    const decoyProblems = auditMembershipSource(DECOY_PRE_FIX);
    ok(
      decoyProblems.length >= 3,
      `PART A POLE B: the auditor did not reject the pre-fix decoy (found ${decoyProblems.length} problems: ${decoyProblems.join("; ")})`,
    );
    ok(
      decoyProblems.some((d) => d.includes("isError")),
      "PART A POLE B: the auditor missed the MISSING isError branch in the decoy",
    );
    ok(
      decoyProblems.some((d) => d.includes("subscribe-btn-standard")),
      "PART A POLE B: the auditor missed the live Subscribe button in the decoy",
    );

    // The two refusal testids must each be present exactly once — a duplicated
    // testid is an ambiguous selector, and an absent one is an unreachable state.
    for (const t of ["membership-pricing-load-failed", "membership-pricing-unavailable"]) {
      eq(src.split(t).length - 1, 1, `PART A: testid \`${t}\` must occur exactly once`);
    }

    // Retry must actually refetch BOTH queries; a refusal with a dead retry
    // button is another dead promise.
    ok(
      /tierQ\.refetch\(\)/.test(src) && /catalogQ\.refetch\(\)/.test(src),
      "PART A: the refusal's retry does not refetch both pricing queries",
    );
  }

  /* ---------------- PART B ---------------- */
  {
    const { getDb } = await import(path.join(ROOT, "server/db/connection.ts"));
    getDb();
    const store: any = await import(path.join(ROOT, "server/adminPlatformStore.ts"));
    const kpis = store._testAdmin.computeKpis();
    const q = kpis.queues;

    // POLE A — unbacked queues report null (rendered "—" at Dashboard.tsx:454).
    eq(q.eligibilityRecompute, null, "PART B POLE A: eligibilityRecompute is not null");
    eq(q.emailQueue, null, "PART B POLE A: emailQueue is not null");
    ok(q.eligibilityRecompute !== 0, "PART B POLE A: eligibilityRecompute is a fabricated 0");
    ok(q.emailQueue !== 0, "PART B POLE A: emailQueue is a fabricated 0");

    // POLE B — the MEASURED queues stay numbers. Blanket-nulling every KPI
    // would hide real measurements, which is the opposite failure.
    ok(typeof q.bridgeOutbox === "number", "PART B POLE B: bridgeOutbox stopped being a measurement");
    ok(typeof q.deadLetter === "number", "PART B POLE B: deadLetter stopped being a measurement");
    ok(
      typeof q.bridgeOutboxArchived === "number",
      "PART B POLE B: bridgeOutboxArchived stopped being a measurement",
    );

    // The consuming sink must actually render null as "—" rather than coerce it.
    const dash = fs.readFileSync(path.join(ROOT, "client/src/pages/admin/Dashboard.tsx"), "utf8");
    ok(dash.includes('{value ?? "—"}'), "PART B: Dashboard no longer renders a null queue as —");
    // ...and the type must ADMIT null, or the next edit re-hardcodes a number.
    ok(
      /Record<string,\s*number \| null>/.test(dash),
      "PART B: the Dashboard queue type does not admit null",
    );
  }

  /* ---------------- PART C ---------------- */
  {
    const { majorToMinorExact } = await import(path.join(ROOT, "client/src/lib/moneyInput.ts"));
    const { currencyExponent } = await import(path.join(ROOT, "client/src/lib/currency.ts"));

    // The fixture is only meaningful if JPY really is exponent 0 here.
    eq(currencyExponent("JPY"), 0, "PART C: JPY fixture is void — currencyExponent(JPY) is not 0");
    eq(currencyExponent("USD"), 2, "PART C: USD exponent is not 2");

    // POLE A — exact conversions, per currency.
    eq(majorToMinorExact("12.34", "USD"), 1234, "PART C POLE A: USD 12.34");
    eq(majorToMinorExact("12", "USD"), 1200, "PART C POLE A: USD 12");
    eq(majorToMinorExact("0", "USD"), 0, "PART C POLE A: USD 0");
    eq(majorToMinorExact("1500", "JPY"), 1500, "PART C POLE A: JPY 1500 (exponent 0 — NOT 150000)");
    eq(majorToMinorExact("1", "JPY"), 1, "PART C POLE A: JPY 1");
    eq(majorToMinorExact("9.99", "EUR"), 999, "PART C POLE A: EUR 9.99");

    // POLE B — anything that cannot be expressed exactly is REFUSED, not rounded.
    eq(majorToMinorExact("15.00", "JPY"), undefined, "PART C POLE B: a fractional yen must be refused");
    eq(majorToMinorExact("15.5", "JPY"), undefined, "PART C POLE B: a half yen must be refused");
    eq(majorToMinorExact("12.345", "USD"), undefined, "PART C POLE B: a third cent must be refused");
    eq(majorToMinorExact("", "USD"), undefined, "PART C POLE B: empty is refused, not 0");
    eq(majorToMinorExact("   ", "USD"), undefined, "PART C POLE B: whitespace is refused, not 0");
    eq(majorToMinorExact("abc", "USD"), undefined, "PART C POLE B: non-numeric is refused");
    eq(majorToMinorExact("1e3", "USD"), undefined, "PART C POLE B: exponent notation is refused");
    eq(majorToMinorExact("-5", "USD"), undefined, "PART C POLE B: negative is refused by default");
    eq(
      majorToMinorExact("-5", "USD", { allowNegative: true }),
      -500,
      "PART C POLE B: an adjustment line may be negative when the caller opts in",
    );
    eq(
      majorToMinorExact("-5", "JPY", { allowNegative: true }),
      -5,
      "PART C POLE B: a negative yen adjustment stays exponent-0",
    );

    // THE FIXTURE PROVES ITSELF. A hardcoded `*100` agrees with the real parser
    // on every USD case, so a USD-only harness cannot catch it. It must
    // DISAGREE on JPY — if it did not, this whole part would be inert.
    const naive = (raw: string) => Math.round(Number(raw) * 100);
    eq(naive("12.34"), majorToMinorExact("12.34", "USD"), "PART C: the naive /100 agrees on USD (expected — that is why USD cannot catch it)");
    ok(
      naive("1500") !== majorToMinorExact("1500", "JPY"),
      "PART C: the JPY fixture does NOT distinguish the naive *100 — the fixture is inert",
    );
  }

  console.log(`\nITEM3 FAIL-CLOSED HARNESS: ${asserts} assertions, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length === 0) console.log("ITEM3 FAIL-CLOSED HARNESS: PASS");
  return failures.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c));
