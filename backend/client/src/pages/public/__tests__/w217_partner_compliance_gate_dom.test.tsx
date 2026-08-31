/**
 * WAVE 217 · R190.8 · Decision A9 — THE PARTNER COMPLIANCE GATE, PROVED IN A
 * MOUNTED DOM AGAINST THE REAL SERVER, END TO END, BYTE FOR BYTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A REPLICA (handbook §8 failure mode 1)
 * ═════════════════════════════════════════════════════════════════════════════
 * The component mounted below is `ConsortiumApplyPage`, imported from
 * `client/src/pages/public/ConsortiumApplyPage.tsx` — the SAME default export
 * that production's router mounts, once, at `client/src/App.tsx:637`:
 *
 *     <Route path="/apply/consortium" component={ConsortiumApplyPage} />
 *
 * There is no second registration form in the tree (`PartnerSignup.tsx` is a
 * marketing CTA with a `<Link href>` and no request). Nothing is stubbed, no
 * markup is retyped, and no prop is injected: the page is mounted exactly as the
 * router mounts it, with no props at all.
 *
 * AND THE SERVER IS THE REAL SERVER. `global.fetch` is bridged to `supertest`
 * over an express app that mounts `registerConsortiumApplyRoutes` — the same
 * exported registrar production calls once at `server/routes.ts:1911`. So when
 * the page's own `onSubmit` runs, the bytes it puts on the wire travel the real
 * `publicApplyRateLimit` → `publicApplyHandler` → `verifyComplianceAttestation`
 * → `submitApplication` path and land in the real table. The bridge replaces the
 * transport, never the handler.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NO NORMALISING CALL IN THE BYTE COMPARISON, AND THE REASON, WRITTEN DOWN
 * ═════════════════════════════════════════════════════════════════════════════
 * §C compares the bytes RENDERED on screen with the bytes STORED in the
 * database. On neither side of that `toBe` is there a `.trim()`, a
 * `.toLowerCase()`, a `.replace(/\s+/g, " ")`, a `.normalize()`, or any other
 * call that could alter a byte.
 *
 * THE REASON: a wave shipped a GREEN test that was blind to its own subject
 * because a helper in its comparison path called `.trim()` — which erased
 * exactly the difference the test existed to detect (R200). A normalising call
 * inside an equality assertion is mechanism 2 of the six known inert-proof
 * mechanisms. The subject of this test IS the bytes. Normalising them would
 * delete the subject and leave a test that passes for any input whose visible
 * words happen to match, which is precisely what must not be allowed for a
 * quoted clause of a signed agreement.
 *
 * §C also proves the assertion is NOT blind, by feeding it a one-character
 * variant and requiring the comparison to fail. An equality assertion that has
 * never been shown to be capable of failing is not evidence.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SCOPED QUERIES ONLY (inert-proof mechanism 6)
 * ═════════════════════════════════════════════════════════════════════════════
 * Every DOM read below goes through `within(container)` off the `render()`
 * return value, never through the global `screen`. An unscoped query reads a
 * different element than the one under test when two renders coexist in one
 * jsdom document, and that has produced a passing test about the wrong node.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS PROVED
 * ═════════════════════════════════════════════════════════════════════════════
 *   §A  the acknowledgement renders, unticked, with §4 quoted
 *   §B  the quoted clause is a byte-exact slice of the SIGNED agreement text —
 *       so it cannot diverge, because it is not a copy
 *   §C  the bytes RENDERED are byte-identical to the bytes STORED, proved by
 *       driving the page's own submit through the real route and reading the row
 *       back — and the comparison is proved capable of failing
 *   §D  the gate is SERVER-enforced, not a disabled button: a direct POST that
 *       never runs the page's `disabled=` expression is REFUSED
 *   §E  the evidence field is labelled optional and does not block
 *   §F  no word claiming a verification is rendered anywhere on the page
 *   §G  ordinary work is NOT gated — the page renders and every ordinary field
 *       is reachable and editable before any declaration is made
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import express from "express";
import request from "supertest";

import ConsortiumApplyPage from "../ConsortiumApplyPage";
import {
  CONSORTIUM_AGREEMENT_TEXT,
  CONSORTIUM_AGREEMENT_VERSION,
} from "@shared/consortiumAgreement";
import {
  COMPLIANCE_CLAUSE_MARKER,
  COMPLIANCE_EVIDENCE_LABEL,
  COMPLIANCE_FORBIDDEN_WORDS,
  COMPLIANCE_HEADING,
  COMPLIANCE_TICK_LABEL,
  PARTNER_COMPLIANCE_ATTESTATION_VERSION,
  REGULATORY_STATUS_VALUES,
  complianceAttestationText,
  complianceClauseQuote,
} from "@shared/wave217PartnerComplianceAttestation";
import {
  registerConsortiumApplyRoutes,
  getApplication,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../../../../../server/consortiumApplyStore";
import { applyW217Migration } from "../../../../../server/__tests__/_w217ComplianceSchema";

/* ══════════════════════════════════════════════════════════════════════════════
 * THE BRIDGE — real handler, real store, real table; only the socket is replaced
 * ════════════════════════════════════════════════════════════════════════════ */

let app: express.Express;

/** Every request the mounted page actually made, in order. */
const wire: Array<{ url: string; body: unknown; status: number }> = [];

beforeAll(() => {
  // The five columns live in `migrations/0222_*.sql` and are invisible to the
  // `:memory:` bootstrap inside the untouchable `server/db/connection.ts`
  // (R203.1). The installer reads the ALTER statements out of the migration
  // file, so this harness cannot drift from what a deploy applies.
  applyW217Migration();
  app = express();
  app.use(express.json());
  registerConsortiumApplyRoutes(app);

  // `fetch` is bridged, NOT mocked: the response body and status come from the
  // real express app. If the gate refuses, this returns the real 422.
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    input: string,
    init?: { method?: string; body?: string },
  ) => {
    const url = String(input);
    const parsed = init?.body ? JSON.parse(String(init.body)) : undefined;
    const res = await request(app)
      .post(url)
      .set("Content-Type", "application/json")
      .send(parsed);
    wire.push({ url, body: parsed, status: res.status });
    return {
      ok: res.status < 400,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };
});

beforeEach(() => {
  wire.length = 0;
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

afterEach(() => {
  cleanup();
});


/* ══════════════════════════════════════════════════════════════════════════════
 * FIELD ACCESS — by the page's OWN structure, scoped, never by global `screen`
 *
 * Most ordinary fields on this page carry no `data-testid`; they are native
 * controls inside the page's own `<Field label=…>` wrapper, which renders a
 * `<label className="cv-field">` containing a `.cv-field__label` caption and a
 * `.cv-field-controls` box. This helper finds a control by that caption, in the
 * mounted container only. It THROWS on a miss and on an ambiguity, so a renamed
 * label makes the test fail rather than silently read a different node
 * (inert-proof mechanism 6 — an unscoped query reading a different element).
 */
function fieldControl(
  container: HTMLElement,
  caption: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const labels = Array.from(
    container.querySelectorAll<HTMLElement>("label.cv-field"),
  ).filter((l) => {
    const cap = l.querySelector(".cv-field__label");
    // Trim the caption side only — the page appends " *" for required fields.
    // NOTHING here touches the SUBJECT of this test, which is the declaration
    // text compared in §C; this is element lookup, not an equality assertion.
    return (cap?.textContent ?? "").replace(/\s*\*\s*$/, "").trim() === caption;
  });
  if (labels.length !== 1) {
    throw new Error(
      `fieldControl("${caption}") matched ${labels.length} fields, expected exactly 1`,
    );
  }
  const el = labels[0].querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(".cv-field-controls input, .cv-field-controls select, .cv-field-controls textarea");
  if (!el) throw new Error(`fieldControl("${caption}") found no control`);
  return el;
}

/** The page's single real <form>. There is no test id on it; there is one form. */
function theForm(container: HTMLElement): HTMLFormElement {
  const forms = container.querySelectorAll("form");
  if (forms.length !== 1) {
    throw new Error(`expected exactly 1 form, found ${forms.length}`);
  }
  return forms[0] as HTMLFormElement;
}

const ORG = "Beta Partners Limited";
const SIGNER = "Bernice Example";

/** Fills every ordinary field. Deliberately makes NO declaration. */
function fillOrdinaryFields(c: HTMLElement) {
  const q = within(c);
  fireEvent.change(fieldControl(c, "Organization name"), { target: { value: ORG } });
  fireEvent.change(fieldControl(c, "First name"), { target: { value: "Bernice" } });
  fireEvent.change(fieldControl(c, "Last name"), { target: { value: "Example" } });
  fireEvent.change(fieldControl(c, "Contact email"), {
    target: { value: "bernice@beta-partners.test" },
  });
  fireEvent.change(q.getByTestId("select-consortium-jurisdiction"), {
    target: { value: "Hong Kong" },
  });
  fireEvent.change(fieldControl(c, "Intro message"), {
    target: { value: "We back seed-stage SaaS out of Hong Kong." },
  });
  fireEvent.change(q.getByTestId("input-consortium-agreement-signature"), {
    target: { value: SIGNER },
  });
}

/** Makes the W2-I agreement tick and the WAVE 217 compliance declaration. */
function makeDeclarations(c: HTMLElement, status: string) {
  const q = within(c);
  fireEvent.click(q.getByTestId("checkbox-consortium-agreement-accept"));
  fireEvent.change(q.getByTestId("select-consortium-regulatory-status"), {
    target: { value: status },
  });
  fireEvent.click(q.getByTestId("checkbox-consortium-compliance-attest"));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * §A — THE ACKNOWLEDGEMENT RENDERS, UNTICKED
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §A — the acknowledgement renders on the real page", () => {
  it("mounts the real page and renders the compliance block, the quote, the sentence and the tick", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    expect(q.getByTestId("consortium-compliance-block")).toBeTruthy();
    expect(q.getByTestId("consortium-compliance-clause-quote")).toBeTruthy();
    expect(q.getByTestId("text-consortium-compliance-attestation")).toBeTruthy();
    expect(q.getByTestId("checkbox-consortium-compliance-attest")).toBeTruthy();
    expect(q.getByTestId("select-consortium-regulatory-status")).toBeTruthy();
    expect(container.textContent!.includes(COMPLIANCE_HEADING)).toBe(true);
    expect(container.textContent!.includes(COMPLIANCE_TICK_LABEL)).toBe(true);
  });

  it("the tick starts UNCHECKED and no regulatory status is pre-selected", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    const tick = q.getByTestId("checkbox-consortium-compliance-attest") as HTMLInputElement;
    expect(tick.checked).toBe(false);
    // A pre-selected status would be the platform answering a legal question on
    // the applicant's behalf. "" is not one of the five enum values, so the
    // server refuses it — "never chose" stays distinguishable from "chose".
    const sel = q.getByTestId("select-consortium-regulatory-status") as HTMLSelectElement;
    expect(sel.value).toBe("");
    expect(REGULATORY_STATUS_VALUES as readonly string[]).not.toContain("");
  });

  it("offers exactly the five statuses and no sixth", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    const sel = q.getByTestId("select-consortium-regulatory-status") as HTMLSelectElement;
    const real = Array.from(sel.options)
      .map((o) => o.value)
      .filter((v) => v !== "");
    expect(real).toEqual([...REGULATORY_STATUS_VALUES]);
    expect(real.length).toBe(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §B — THE QUOTED CLAUSE IS A SLICE, NOT A COPY
 *
 * The whole point of slicing at render (R197.4, wave 213's helper) is that the
 * screen CANNOT diverge from the signed document, because there is only one
 * copy of the words. That is proved here by containment in the executed text,
 * with no normalisation on either side.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §B — the rendered clause is a byte-exact slice of the signed agreement", () => {
  it("the rendered quote is byte-identical to the slicer's output", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const rendered = within(container).getByTestId(
      "consortium-compliance-clause-quote",
    ).textContent;
    const sliced = complianceClauseQuote();
    expect(sliced).not.toBeNull();
    // NO NORMALISATION. See the file header for why.
    expect(rendered).toBe(sliced);
  });

  it("those exact bytes occur inside CONSORTIUM_AGREEMENT_TEXT — so the screen is not a second version", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const rendered = within(container).getByTestId(
      "consortium-compliance-clause-quote",
    ).textContent!;
    expect(rendered.length).toBeGreaterThan(200);
    expect(CONSORTIUM_AGREEMENT_TEXT.includes(rendered)).toBe(true);
    expect(rendered.startsWith(COMPLIANCE_CLAUSE_MARKER)).toBe(true);
  });

  it("the containment assertion is NOT blind: one added character breaks it", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const rendered = within(container).getByTestId(
      "consortium-compliance-clause-quote",
    ).textContent!;
    // A whitespace-only mutation. A test that collapsed whitespace would pass
    // this and therefore prove nothing about the bytes.
    const nudged = rendered.replace(" ", "  ");
    expect(nudged).not.toBe(rendered);
    expect(CONSORTIUM_AGREEMENT_TEXT.includes(nudged)).toBe(false);
  });

  it("the agreement whose §4 is quoted is the version the applicant signs", () => {
    const { container } = render(<ConsortiumApplyPage />);
    expect(container.textContent!.includes(CONSORTIUM_AGREEMENT_VERSION)).toBe(true);
    expect(
      PARTNER_COMPLIANCE_ATTESTATION_VERSION.includes(CONSORTIUM_AGREEMENT_VERSION),
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §C — RENDERED BYTES === STORED BYTES
 *
 * The page's own `onSubmit` runs. The bytes it puts on the wire are the bytes
 * the real handler verifies and the real store writes. Then the row is read
 * back and compared to what is still on screen.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §C — the bytes rendered are the bytes stored", () => {
  it("drives the real page's real submit through the real route and stores the rendered sentence verbatim", async () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    makeDeclarations(container, "exempt");

    // Read the sentence OFF THE SCREEN before submitting. This is the subject.
    const renderedSentence = q.getByTestId(
      "text-consortium-compliance-attestation",
    ).textContent!;
    expect(renderedSentence.length).toBeGreaterThan(300);

    fireEvent.submit(theForm(container));
    await waitFor(() => expect(wire.length).toBe(1));
    expect(wire[0].status).toBe(201);

    const sent = wire[0].body as Record<string, unknown>;
    // 1. What the page put on the wire is exactly what it showed.
    expect(sent.complianceAttestationText).toBe(renderedSentence);

    // 2. What the SERVER STORED is exactly what the page showed. This is the
    //    end-to-end byte identity, read out of the real table. No `.trim()`,
    //    no case fold, no whitespace collapse — see the file header.
    const row = getApplication(wireApplicationId())!;
    expect(row).toBeTruthy();
    expect(row.complianceAttestationText).toBe(renderedSentence);
    expect(row.regulatoryStatus).toBe("exempt");
    expect(row.jurisdiction).toBe("Hong Kong");
    expect(row.complianceAttestationVersion).toBe(
      PARTNER_COMPLIANCE_ATTESTATION_VERSION,
    );
    // The server observed the timestamp; the page never sent one.
    expect(typeof row.complianceAttestedAt).toBe("string");
    expect(sent.complianceAttestedAt).toBeUndefined();
  });

  it("the byte comparison is PROVED CAPABLE OF FAILING — a one-space variant is not equal", async () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    makeDeclarations(container, "licensed");
    const rendered = q.getByTestId(
      "text-consortium-compliance-attestation",
    ).textContent!;
    fireEvent.submit(theForm(container));
    await waitFor(() => expect(wire.length).toBe(1));
    const row = getApplication(wireApplicationId())!;

    // The stored bytes equal the rendered bytes …
    expect(row.complianceAttestationText).toBe(rendered);
    // … and they do NOT equal a variant differing by one space. If any
    // normalising call sat in this path, THIS assertion would fail, and that is
    // why it is here: it is the control for the assertion above.
    const variant = rendered.replace(". ", ".  ");
    expect(variant).not.toBe(rendered);
    expect(row.complianceAttestationText).not.toBe(variant);
    // Nor a case variant, nor an untrimmed variant.
    expect(row.complianceAttestationText).not.toBe(rendered.toLowerCase());
    expect(row.complianceAttestationText).not.toBe(` ${rendered} `);
  });

  it("MOVE THE FIXTURE: a different organisation name changes both the rendered AND the stored bytes", async () => {
    // The cheap, high-yield technique. If the test could not notice the subject
    // moving, it would be proving nothing. Both sides must move together.
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    fireEvent.change(fieldControl(container, "Organization name"), {
      target: { value: "Gamma Ventures GmbH" },
    });
    makeDeclarations(container, "registered");
    const rendered = q.getByTestId(
      "text-consortium-compliance-attestation",
    ).textContent!;
    expect(rendered.includes("Gamma Ventures GmbH")).toBe(true);
    expect(rendered.includes(ORG)).toBe(false);
    fireEvent.submit(theForm(container));
    await waitFor(() => expect(wire.length).toBe(1));
    const row = getApplication(wireApplicationId())!;
    expect(row.complianceAttestationText).toBe(rendered);
    expect(row.complianceAttestationText!.includes("Gamma Ventures GmbH")).toBe(true);
    // And it is the SERVER's own rebuild, not a string the client chose.
    expect(row.complianceAttestationText).toBe(
      complianceAttestationText("Gamma Ventures GmbH", SIGNER),
    );
  });
});

/** The id the real route returned for the single request this test made. */
function wireApplicationId(): string {
  const ids = _consortiumApplyInternal.appsCache;
  const keys = Array.from(ids.keys()) as string[];
  expect(keys.length).toBe(1);
  return keys[0];
}

/* ══════════════════════════════════════════════════════════════════════════════
 * §D — SERVER-ENFORCED, NOT A DISABLED BUTTON
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §D — the gate is server-enforced, not the disabled button", () => {
  it("the submit control IS disabled until the declaration is made — a courtesy, not the gate", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    const btn = q.getByTestId("button-consortium-apply-submit") as HTMLButtonElement;
    fillOrdinaryFields(container);
    expect(btn.disabled).toBe(true); // no tick, no status
    fireEvent.click(q.getByTestId("checkbox-consortium-agreement-accept"));
    expect(btn.disabled).toBe(true); // still no compliance tick
    fireEvent.click(q.getByTestId("checkbox-consortium-compliance-attest"));
    expect(btn.disabled).toBe(true); // still no status chosen
    fireEvent.change(q.getByTestId("select-consortium-regulatory-status"), {
      target: { value: "unsure" },
    });
    expect(btn.disabled).toBe(false);
  });

  it("BYPASSING the page entirely — a direct POST that never runs that expression is REFUSED 422", async () => {
    // This is the whole reason the button is not the gate. `curl` does not
    // evaluate `disabled=`. Both public paths are driven, because both are
    // bound to the same handler and a gate proved on one is a gate walked
    // around by typing the other.
    for (const path of [
      "/api/public/consortium/apply",
      "/api/consortium-applications",
    ]) {
      _resetPublicApplyBucketsForTests();
      const r = await request(app).post(path).send({
        organizationName: ORG,
        contactName: SIGNER,
        contactEmail: "bernice@beta-partners.test",
        jurisdiction: "Hong Kong",
        partnerType: "vc",
        aumRange: "10-50M",
        portfolioCompanyCount: 3,
        expectedChapter: "chap_keiretsu_canada",
        introMessage: "Bypassing the form.",
        // NO complianceAttested, NO text, NO regulatoryStatus.
      });
      expect(r.status).toBe(422);
      // `error`, NOT `code`. The handler writes
      // `res.status(422).json({ error: compliance.code, message })` at
      // `server/consortiumApplyStore.ts:2189`. I wrote `code` first and this
      // assertion failed against `undefined` — which is the useful outcome: an
      // assertion keyed to a field the writer never writes is inert-proof
      // mechanism 5, and it would have passed silently had I written
      // `expect(r.body.code).toBeUndefined()` or filtered rather than compared.
      expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
      expect(typeof r.body.message).toBe("string");
      expect(r.body.message.length).toBeLessThan(240);
    }
  });

  it("a FORGED declaration — the right shape, the wrong bytes — is REFUSED, not stored", async () => {
    _resetPublicApplyBucketsForTests();
    const paraphrase =
      "I confirm we comply with all applicable laws and hold every licence we need.";
    const r = await request(app).post("/api/public/consortium/apply").send({
      organizationName: ORG,
      contactName: SIGNER,
      contactEmail: "bernice@beta-partners.test",
      jurisdiction: "Hong Kong",
      partnerType: "vc",
      aumRange: "10-50M",
      portfolioCompanyCount: 3,
      expectedChapter: "chap_keiretsu_canada",
      introMessage: "Paraphrasing a signed clause.",
      agreementSignedName: SIGNER,
      complianceAttested: true,
      complianceAttestationText: paraphrase,
      regulatoryStatus: "licensed",
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("COMPLIANCE_TEXT_MISMATCH"); // `error`, not `code`
    // And the paraphrase is nowhere in the response, so it was not echoed back
    // as if it had been accepted.
    expect(JSON.stringify(r.body).includes(paraphrase)).toBe(false);
    expect(_consortiumApplyInternal.appsCache.size).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §E — THE EVIDENCE FIELD IS OPTIONAL AND DOES NOT BLOCK
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §E — the evidence reference is optional on screen and in fact", () => {
  it("is labelled optional, is not `required`, and does not disable submit when blank", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    const input = q.getByTestId(
      "input-consortium-compliance-evidence",
    ) as HTMLInputElement;
    expect(input.required).toBe(false);
    expect(input.value).toBe("");
    expect(COMPLIANCE_EVIDENCE_LABEL.toLowerCase().includes("optional")).toBe(true);
    expect(container.textContent!.includes(COMPLIANCE_EVIDENCE_LABEL)).toBe(true);
    fillOrdinaryFields(container);
    makeDeclarations(container, "exempt");
    const btn = q.getByTestId("button-consortium-apply-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // blank evidence, still submittable
  });

  it("an EXEMPT applicant with a BLANK evidence reference registers successfully — the owner's own case", async () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    makeDeclarations(container, "exempt");
    expect(
      (q.getByTestId("input-consortium-compliance-evidence") as HTMLInputElement).value,
    ).toBe("");
    fireEvent.submit(theForm(container));
    await waitFor(() => expect(wire.length).toBe(1));
    expect(wire[0].status).toBe(201);
    const row = getApplication(wireApplicationId())!;
    expect(row.regulatoryStatus).toBe("exempt");
    expect(row.complianceEvidenceRef ?? null).toBe(null);
  });

  it("an UNSURE applicant is recorded and NOT refused", async () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    makeDeclarations(container, "unsure");
    fireEvent.submit(theForm(container));
    await waitFor(() => expect(wire.length).toBe(1));
    expect(wire[0].status).toBe(201);
    expect(getApplication(wireApplicationId())!.regulatoryStatus).toBe("unsure");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §F — NO CLAIM OF VERIFICATION IS RENDERED
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §F — the page never says the platform verified anything", () => {
  it("renders none of the forbidden words in the compliance block", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const block = within(container).getByTestId("consortium-compliance-block");
    const text = `${block.textContent ?? ""} ${
      within(container).getByTestId("text-consortium-compliance-attestation").textContent ?? ""
    } ${within(container).getByTestId("text-consortium-regulatory-help").textContent ?? ""} ${
      within(container).getByTestId("text-consortium-compliance-evidence-help").textContent ?? ""
    }`;
    const lower = text.toLowerCase();
    for (const w of COMPLIANCE_FORBIDDEN_WORDS) {
      expect(lower.includes(w.toLowerCase())).toBe(false);
    }
    // The list itself is non-empty, so the loop above is not vacuous.
    expect(COMPLIANCE_FORBIDDEN_WORDS.length).toBeGreaterThanOrEqual(5);
  });

  it("says out loud that Capavate records the declaration and does not check it", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const sentence = within(container).getByTestId(
      "text-consortium-compliance-attestation",
    ).textContent!;
    expect(sentence.includes("Capavate records this declaration")).toBe(true);
    expect(sentence.includes("does not check it")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §G — ORDINARY WORK IS NOT GATED
 *
 * The harm to weigh hardest is trapping a partner out of their own account.
 * This gate sits on ONE public, pre-account route. Nothing about reading the
 * page, filling it in, reading the agreement, or changing an answer is blocked.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 DOM §G — nothing ordinary is blocked", () => {
  it("every ordinary field is present and editable with NO declaration made", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    expect((fieldControl(container, "Organization name") as HTMLInputElement).value).toBe(ORG);
    expect(
      (q.getByTestId("select-consortium-jurisdiction") as HTMLSelectElement).value,
    ).toBe("Hong Kong");
    expect(
      (fieldControl(container, "Intro message") as HTMLTextAreaElement).value.length,
    ).toBeGreaterThan(0);
    // The tick is still untouched, and the page has made no request.
    expect(
      (q.getByTestId("checkbox-consortium-compliance-attest") as HTMLInputElement).checked,
    ).toBe(false);
    expect(wire.length).toBe(0);
  });

  it("the pre-existing W2-I agreement surface is intact — nothing was replaced", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    // Every pre-wave control still exists with its original test id. R143.1:
    // this wave appends siblings; it replaces nothing.
    expect(q.getByTestId("consortium-agreement-text")).toBeTruthy();
    expect(q.getByTestId("checkbox-consortium-agreement-accept")).toBeTruthy();
    expect(q.getByTestId("input-consortium-agreement-signature")).toBeTruthy();
    expect(q.getByTestId("button-consortium-apply-submit")).toBeTruthy();
    expect(
      q.getByTestId("consortium-agreement-text").textContent,
    ).toBe(CONSORTIUM_AGREEMENT_TEXT);
  });

  it("a status change after the tick keeps the declaration and does not clear the form", () => {
    const { container } = render(<ConsortiumApplyPage />);
    const q = within(container);
    fillOrdinaryFields(container);
    makeDeclarations(container, "licensed");
    fireEvent.change(q.getByTestId("select-consortium-regulatory-status"), {
      target: { value: "registered" },
    });
    expect(
      (q.getByTestId("checkbox-consortium-compliance-attest") as HTMLInputElement).checked,
    ).toBe(true);
    expect((fieldControl(container, "Organization name") as HTMLInputElement).value).toBe(ORG);
    expect((q.getByTestId("button-consortium-apply-submit") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
