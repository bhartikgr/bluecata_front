/**
 * WAVE 216 — THE BYTES RENDERED TO THE SIGNER ARE THE BYTES POSTED FOR HASHING.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE CORE INVARIANT of this wave has two halves, and they live in two runtimes:
 *
 *   HALF ONE (this file, jsdom)  the bytes PAINTED on the signer's screen are the
 *                               bytes the sign request PUTS ON THE WIRE.
 *   HALF TWO (server/__tests__/w216_esignature_intent_and_hash.test.ts, node)
 *                               the bytes on the wire are the bytes HASHED, and a
 *                               signature over any other bytes is REFUSED.
 *
 * Together they are the whole claim. Neither half is a replica: this file mounts
 * the REAL `SpvDetailTabs` and activates the E-signature tab exactly as a partner
 * does, and the other half drives the REAL production route over HTTP.
 *
 * The joint is `renderedStatementText` — one field, asserted on the outbound body
 * here and enforced by the real route there.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO NORMALISING CALL IN THE EQUALITY ASSERTION. THE REASON, IN THE TEST.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `expect(postedBytes).toBe(paintedBytes)` runs on raw strings. There is no
 * `.trim()`, no `.toLowerCase()`, no whitespace collapse, no `.replace(/\s+/g," ")`
 * and no `.normalize()` anywhere between reading the DOM and asserting.
 *
 * That is not fussiness. A normalising call inside an equality assertion is one of
 * the five known ways an inert proof looks correct in review, and it is the ONE
 * that would specifically destroy this proof: the statement is a nine-line block
 * joined by "\n", so ANY whitespace normaliser would make a single-line paraphrase
 * compare equal to the real thing and the test would pass over content that hashes
 * to something else entirely. Byte identity is the whole point; a normalised
 * comparison proves only that two normalisations agree.
 *
 * `textContent` is used rather than `innerText` for the same reason: `textContent`
 * is the character data, unaffected by CSS. `whitespace-pre-line` on the element is
 * presentation only and cannot alter what is compared or what is hashed.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * THE LIMIT OF WHAT HALF ONE CAN PROVE — STATED, NOT IMPLIED
 * ════════════════════════════════════════════════════════════════════════════════
 * Three attempts to disarm D-3 came back green when they should not have. All three
 * were investigated rather than accepted, and the third found A REAL DEFECT IN THE
 * PRODUCT CODE. In order:
 *
 *   · TAMPER, THEN ACT — green with honest bytes. React owns the statement text
 *     node and reverts an out-of-band `textContent` write on the next render.
 *     Reassuring about the product; useless as a proof.
 *
 *   · ACT, THEN TAMPER — green with honest bytes. `signMut.mutationFn` runs a
 *     microtask AFTER the click, not inside it, so the read sees a freshly
 *     re-rendered tree. Even a node DELETED before the click is back by then.
 *
 *   · MOVE THE FIXTURE — green with the WRONG bytes, and that was a real defect.
 *     `readPaintedStatementBytes` used `document.querySelector`, which searches the
 *     whole document and returns the FIRST match, so it read an EARLIER panel's
 *     statement and posted another render's bytes. Exactly the failure this wave
 *     exists to prevent, arriving inside the fix for it. Corrected to an
 *     instance-scoped `useRef` map — see `readPaintedStatementBytes` in
 *     `SpvDetailTabs.tsx` for the full note.
 *
 * So this file does NOT claim the painted bytes are tamper-proof. The honest claim
 * is "the request carries the bytes THIS card renders from THIS envelope's own
 * stored fields", which D-7 proves by MOVING those fields. The refusal of
 * non-matching bytes is the SERVER's fence, proved over the real route in half two.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs } from "../SpvDetailTabs";
import {
  buildWave216SignedStatement,
  WAVE216_INTENT_SENTENCE,
  WAVE216_CONSENT_SENTENCE,
  WAVE216_BLOCKED_HINT,
  WAVE216_ABSENT_FIELD,
} from "@shared/wave216SignedStatement";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const SPV_ID = "spv_13ac1ceb06eeb6c7";
const ENVELOPE_ID = "esenv_w216_0000000000000001";
const RECIPIENT_ID = "esrcp_w216_0000000000000001";

/** Every POST this mount makes, in order, with its body. */
let posts: Array<{ url: string; body: unknown }> = [];

/** The document title the served envelope carries. Moved by D-7. */
let servedTitle = "W216 Subscription Agreement";

/** The e-signature detail the panel reads. One envelope, one unsigned signer. */
function esignDetail() {
  return {
    envelope: {
      id: ENVELOPE_ID,
      documentKind: "subscription_agreement",
      documentRef: "doc_w216_sub",
      documentTitle: servedTitle,
      documentSha256: "f".repeat(64),
      provider: "internal",
      status: "sent",
      createdAt: "2026-08-30T00:00:00.000Z",
      sentAt: "2026-08-30T00:00:01.000Z",
      completedAt: null,
      completionHash: null,
      lastError: null,
    },
    recipients: [
      {
        id: RECIPIENT_ID,
        role: "signer",
        signingOrder: 1,
        partyKind: "lp",
        fullName: "W216 Signer",
        email: "signer@example.com",
        status: "sent",
        signedName: null,
        signatureHash: null,
        signedAt: null,
      },
    ],
    events: [
      { id: "ev1", eventKind: "envelope.sent", toStatus: "sent", createdAt: "2026-08-30T00:00:01.000Z" },
    ],
    nextAction: "Awaiting signature from W216 Signer.",
    documentHashBound: true,
  };
}

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (method === "POST") posts.push({ url, body });
      const payload =
        url.includes("/esignature/config")
          ? { providers: ["internal"], provider: "internal" }
          : url.includes("/esignature")
            ? { envelopes: [esignDetail()] }
            : {};
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    },
  };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const detail: any = {
  spv: {
    status: "open", jurisdiction: "delaware", lpVisibility: "own_only", closeDate: null,
    targetRaiseMinor: 3_000, terms: { vintage: 2026 }, revisionHash: null, updatedAt: null,
  },
  mandate: { mode: "deal_specific", sector: ["Fintech"], geography: ["United States"], stage: ["seed"] },
  fees: [], subscriptions: [], register: [], deployments: [], distributions: [],
  /* One selectable document, so D-6 exercises the real create path rather than
     falling through to its no-document branch. */
  documents: [{ id: "doc_w216_sub", title: "W216 Subscription Agreement", docType: "subscription_agreement" }],
  transfers: [], capitalAccounts: [], closeSummary: undefined,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId={SPV_ID} detail={detail} currency="USD" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
  const trigger = utils.container.querySelector<HTMLElement>('[data-testid="spv-tab-esignature"]');
  expect(trigger, "the E-signature tab trigger must exist").toBeTruthy();
  fireEvent.mouseDown(trigger!);
  fireEvent.click(trigger!);
  return utils;
}

async function q(container: HTMLElement, testid: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      container.querySelector(`[data-testid="${testid}"]`),
      `[data-testid="${testid}"] must be in the tree`,
    ).toBeTruthy();
  });
  return container.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
}

beforeEach(() => {
  posts = [];
  servedTitle = "W216 Subscription Agreement";
});

describe("W216 · the signer's screen and the sign request carry the same bytes", () => {
  it("D-1 the statement block paints on FIRST PAINT, unconditionally", async () => {
    /* WHY FIRST PAINT AND NOT A TOGGLE. Wave 221's first default-off DOM assertion
       was INERT: it passed with the default flipped to ON, because it asserted a
       state the component was in either way. This element is rendered
       unconditionally as the LAST sibling of the envelope card, so asserting it on
       first paint is asserting the thing that actually ships. No click, no state
       change, no fixture toggle stands between the mount and this assertion. */
    const { container } = mount();
    const block = await q(container, "spv-esign-statement-bytes");
    expect((block.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("D-2 the painted bytes are BYTE-IDENTICAL to the shared builder's output", async () => {
    const { container } = mount();
    const block = await q(container, "spv-esign-statement-bytes");
    const painted = block.textContent ?? "";

    const expected = buildWave216SignedStatement({
      vehicleRef: SPV_ID,
      documentKind: "subscription_agreement",
      documentTitle: "W216 Subscription Agreement",
      documentRef: "doc_w216_sub",
    });

    /* RAW EQUALITY. No normalisation on either side — see the file header. */
    expect(painted).toBe(expected);

    /* And the block really is the multi-line statement, not a flattened line: if a
       wrapper ever split the text into several nodes with markup between them, the
       newlines would survive in `textContent` but a paraphrase would not. Nine
       lines, joined by "\n", no trailing newline. */
    expect(painted.split("\n").length).toBe(9);
    expect(painted.endsWith("\n")).toBe(false);
  });

  it("D-3 THE JOINT: the sign request posts EXACTLY the painted bytes", async () => {
    /* This is the assertion the whole wave rests on. It reads the DOM, then drives
       the real `Record signature` button through the real handler, then reads the
       outbound body. Nothing in between is reconstructed. */
    const { container } = mount();
    const painted = (await q(container, "spv-esign-statement-bytes")).textContent ?? "";

    const nameBox = await q(container, "spv-esign-typed-name");
    fireEvent.change(nameBox, { target: { value: "W216 Signer" } });
    const intent = await q(container, "spv-esign-intent");
    fireEvent.click(intent);

    const btn = (await q(container, "spv-esign-sign-btn")) as HTMLButtonElement;
    expect(btn.disabled, "with a name typed and intent given the button must be live").toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(posts.some((p) => p.url.includes("/sign")), "the sign POST must have gone out").toBe(true);
    });
    const signPost = posts.find((p) => p.url.includes("/sign"))!;
    const body = signPost.body as Record<string, unknown>;

    /* THE EQUALITY. Raw strings, both sides. */
    expect(body.renderedStatementText).toBe(painted);
    /* Intent travels as a literal boolean — the route accepts strictly `true`. */
    expect(body.intentAcknowledged).toBe(true);
  });

  it("D-4 the express intent is OFF at first paint and the button says why", async () => {
    /* Not defaulted true, not inferred from a clickable button. Asserted on FIRST
       PAINT for the same reason as D-1. */
    const { container } = mount();
    const intent = (await q(container, "spv-esign-intent")) as HTMLInputElement;
    expect(intent.checked).toBe(false);

    const nameBox = await q(container, "spv-esign-typed-name");
    fireEvent.change(nameBox, { target: { value: "W216 Signer" } });
    const btn = (await q(container, "spv-esign-sign-btn")) as HTMLButtonElement;
    expect(btn.disabled, "a typed name alone must not be enough to sign").toBe(true);

    /* A disabled control must state its reason on screen, not on hover. */
    const hint = await q(container, "spv-esign-intent-hint");
    expect(hint.textContent).toBe(WAVE216_BLOCKED_HINT);
  });

  it("D-5 the intent sentence on screen is the platform's OWN shipped wording", async () => {
    /* No new legal prose was authored for this control. Both sentences are imported
       from `shared/`, so the screen and the stored evidence record cannot drift. */
    const { container } = mount();
    const text = (await q(container, "spv-esign-intent-text")).textContent ?? "";
    expect(text).toContain(WAVE216_INTENT_SENTENCE);
    expect(text).toContain(WAVE216_CONSENT_SENTENCE);
    /* The consent sentence is the one that carries ESIGN/UETA, in the words the
       platform already ships on its SPV launch sign-off. */
    expect(WAVE216_CONSENT_SENTENCE).toContain("ESIGN/UETA");
  });

  it("D-6 the SEND form shows the sender the bytes it is about to bind, and posts them", async () => {
    const { container } = mount();
    const preview = await q(container, "spv-esign-pending-statement-bytes");
    const painted = preview.textContent ?? "";
    expect(painted.split("\n").length).toBe(9);

    /* The create POST carries those same bytes. The client never hashes them: the
       server does, with the one implementation, which is why "rendered equals
       hashed" cannot become "two implementations agree". */
    fireEvent.change(await q(container, "spv-esign-signer-name"), { target: { value: "New Signer" } });
    fireEvent.change(await q(container, "spv-esign-signer-email"), { target: { value: "new@example.com" } });
    /* ═══════════════════════════════════════════════════════════════════════════
       THIS ASSERTION IS UNCONDITIONAL, AND IT WAS NOT ALWAYS.
       ═══════════════════════════════════════════════════════════════════════════
       The first version of D-6 read the document `<select>` by
       `data-testid="spv-esign-document-ref"` — a testid THAT DOES NOT EXIST; the
       real one is `spv-esign-document`. The query returned `null`, `docRef` stayed
       empty, the send button stayed disabled, and the whole create-POST assertion
       sat behind `if (send && !send.disabled)` with a weak `painted.length > 0` in
       the `else`. So D-6 was GREEN while asserting essentially nothing.

       The disarm harness is what surfaced it: deleting `documentStatementText` from
       the create request entirely came back GREEN. Both inert-proof mechanisms were
       present at once — an accessor keyed to a name the component never writes, and
       a fence whose installation was never proved. Fixed by naming the real testid
       and, more importantly, by REMOVING THE ESCAPE HATCH: if this form cannot be
       driven to the point of sending, this test FAILS rather than silently
       degrading to a tautology. */
    const docSel = container.querySelector<HTMLSelectElement>('[data-testid="spv-esign-document"]');
    expect(docSel, 'the document select must exist at [data-testid="spv-esign-document"]').toBeTruthy();
    expect(docSel!.options.length, "the fixture must offer a selectable document").toBeGreaterThan(1);
    fireEvent.change(docSel!, { target: { value: "doc_w216_sub" } });

    const send = container.querySelector<HTMLButtonElement>('[data-testid="spv-esign-send-btn"]');
    expect(send, "the send button must exist").toBeTruthy();
    await waitFor(() => {
      expect(send!.disabled, "the send form must be drivable to an enabled state").toBe(false);
    });
    /* CAPTURED BEFORE THE CLICK, DELIBERATELY. Reading the preview afterwards is
       wrong and this test proved it: `createMut.onSuccess` clears the form, so the
       preview correctly re-renders to its "not on record" declaration and comparing
       against it produced a false RED. The bytes to compare are the ones on screen
       at the moment the sender pressed send. */
    const previewAtSend =
      container.querySelector('[data-testid="spv-esign-pending-statement-bytes"]')!.textContent ?? "";
    expect(previewAtSend).toContain("W216 Subscription Agreement");
    expect(previewAtSend).toContain("doc_w216_sub");

    fireEvent.click(send!);

    await waitFor(() => {
      expect(posts.some((p) => !p.url.includes("/sign")), "a create POST must have been made").toBe(true);
    });
    const create = posts.find((p) => !p.url.includes("/sign"))!;
    const body = create.body as Record<string, unknown>;

    /* The bytes on the wire are the bytes in the preview. Raw equality, no
       normalising call, and the expected side is READ OUT OF THE DOM rather than
       rebuilt, so a builder change cannot make both sides agree on nothing. */
    expect(typeof body.documentStatementText).toBe("string");
    expect(String(body.documentStatementText).length).toBeGreaterThan(0);
    expect(body.documentStatementText).toBe(previewAtSend);
    expect(String(body.documentStatementText).split("\n").length).toBe(9);

    /* And the client does NOT send a hash. One hash implementation, on the server.
       Two implementations agreeing is not the invariant this wave claims. */
    expect("documentSha256" in body).toBe(false);
  });

  /**
   * D-7 — THE FIXTURE MOVES. D-3 is not two constants agreeing.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * WHY THIS TEST EXISTS, AND THE TWO FINDINGS THAT PUT IT HERE
   * ═══════════════════════════════════════════════════════════════════════════════
   * D-3 asserts `posted === painted`. On its own that is exactly the shape of an
   * inert proof — "a fixture no mutation can move". Two constants would satisfy it.
   *
   * THIS TEST FOUND A REAL DEFECT IN THE FIX ITSELF, ON ITS FIRST RUN. With the
   * served title moved, the SCREEN showed the moved title and the REQUEST carried the
   * ORIGINAL one. `readPaintedStatementBytes` was using `document.querySelector`,
   * which searches the whole document and returns the FIRST match — so it read an
   * earlier panel's statement and posted bytes from a different render. A signature
   * carrying bytes other than the ones on the signer's screen is the exact defect
   * this wave exists to remove, and it had arrived inside the remedy for it. Fixed by
   * giving each envelope card its own `useRef` entry, leaving no global lookup to
   * resolve ambiguously.
   *
   * Two earlier, hostile attempts to disarm D-3 came back green with the HONEST bytes
   * on the wire; both were investigated rather than accepted. React reverts an
   * out-of-band `textContent` write on the next render, and `signMut.mutationFn` runs
   * a microtask after the click so the read sees a re-rendered tree — even deleting
   * the node before the click does not stick. Neither is a defect, but neither can
   * prove anything either, which is why this test moves DATA instead of the DOM.
   *
   * The accurate claim is therefore NOT "nothing can alter these bytes", but "the
   * request carries the statement bytes THIS SCREEN RENDERS FROM THIS ENVELOPE'S OWN
   * STORED FIELDS". That is what this test moves: the SERVED envelope's document
   * title changes, and BOTH the painted bytes and the posted bytes must change with
   * it, to the new value, in the same place. Two constants cannot pass this.
   *
   * The fence against bytes that do not match what was stored is the SERVER's, and
   * it is proved over the real route in
   * server/__tests__/w216_esignature_intent_and_hash.test.ts (H-3): a signature whose
   * posted statement hashes to anything other than the stored digest is REFUSED and
   * nothing is written. This test proves the client feeds that fence real data.
   */
  it("D-7 the painted AND posted bytes both track the envelope's stored fields", async () => {
    servedTitle = "W216 MOVED TITLE — Side Letter B";
    const { container } = mount();
    const painted = (await q(container, "spv-esign-statement-bytes")).textContent ?? "";

    /* The moved value is on screen — so the render reads the envelope, not a
       constant. */
    expect(painted).toContain("W216 MOVED TITLE — Side Letter B");
    expect(painted).not.toContain("W216 Subscription Agreement");

    fireEvent.change(await q(container, "spv-esign-typed-name"), { target: { value: "W216 Signer" } });
    fireEvent.click(await q(container, "spv-esign-intent"));
    fireEvent.click(await q(container, "spv-esign-sign-btn"));

    await waitFor(() => {
      expect(posts.some((p) => p.url.includes("/sign"))).toBe(true);
    });
    const body = posts.find((p) => p.url.includes("/sign"))!.body as Record<string, unknown>;

    /* The moved value is on the wire too, and the two are still byte-identical.
       RAW equality — no normalisation, for the reason in the file header. */
    expect(body.renderedStatementText).toBe(painted);
    expect(String(body.renderedStatementText)).toContain("W216 MOVED TITLE — Side Letter B");

    /* And it is NOT the other envelope's statement: the same builder with the
       original title produces different bytes, so this assertion could fail. */
    const other = buildWave216SignedStatement({
      vehicleRef: SPV_ID,
      documentKind: "subscription_agreement",
      documentTitle: "W216 Subscription Agreement",
      documentRef: "doc_w216_sub",
    });
    expect(body.renderedStatementText).not.toBe(other);
  });

  it("D-8 an absent document reference is DECLARED absent, never blanked and never zero", async () => {
    /* R201.2 — a guard against MISSING data is not a guard against INVENTED data,
       and invented data usually arrives as a zero. The builder is given nothing for
       three of its four facts; every one of them must say so in words. */
    const stated = buildWave216SignedStatement({
      vehicleRef: SPV_ID,
      documentKind: "",
      documentTitle: null,
      documentRef: undefined,
    });
    expect(stated).toContain(WAVE216_ABSENT_FIELD);
    /* Three absent facts, three declarations — not one declaration and two blanks. */
    expect(stated.split(WAVE216_ABSENT_FIELD).length - 1).toBe(3);
    /* No bare label, no dash-as-value, no zero. */
    expect(stated).not.toMatch(/:\s*$/m);
    expect(stated).not.toMatch(/:\s*(0|-|—|n\/a|null|undefined)\s*$/im);
  });
});
