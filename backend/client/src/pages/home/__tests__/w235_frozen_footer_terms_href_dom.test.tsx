/**
 * WAVE 235 — THE FROZEN FOOTER'S "Terms" ANCHOR CARRIES THE CORRECT `href`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAVE 218 LEFT, AND WHAT THIS FILE PROVES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wave 218 intercepted the CLICK on `Footer3.jsx:209`'s mislabelled anchor. That
 * made the link work for one consumer — a human with a mouse and JavaScript — and
 * left it broken for four others, because the markup still said
 * `href="https://capavate.com/privacy-policy"`:
 *
 *   - right-click → "copy link address" copies the privacy policy;
 *   - open-in-new-tab from the context menu loads the privacy policy;
 *   - a crawler indexes "Terms" as pointing at the privacy policy;
 *   - a screen reader announcing the link target announces the privacy policy.
 *
 * None of those paths reaches a React event handler. Wave 235 corrects the
 * ATTRIBUTE, from the same non-sacred parent, using the same exported predicate.
 *
 * WHY THE FIX IS NOT IN THE FILE THAT HAS THE BUG. `Footer3.jsx` is a BASE entry
 * in the enforced 48-entry sacred list (sha
 * `64937e08cc4abaf8205909240c485aff779031f5afb8ee43f63b8458a70bb350`). A tenth
 * waiver is not available to be sought. §W4 asserts the file is byte-identical, so
 * this suite is also the proof that the sacred boundary was respected.
 *
 * ═══ THE ANCHOR COUNT, RECOUNTED — AND IT IS TWO NUMBERS, NOT ONE ═══
 * The brief for this wave, and wave 218's own module header, both said the frozen
 * footer contains NINETEEN anchors. A baseline stated in a brief is a claim, so
 * §W0 counted them. The file contains SEVENTEEN, and wave 218's header is
 * corrected in place.
 *
 * Counting them also turned up something neither figure captured, and it matters
 * more than the arithmetic: only THIRTEEN of the seventeen are in the DOM on
 * arrival. The other four — the investor, founder, CONSORTIUM PARTNER and ADMIN
 * login links — live inside `{openFooterDropdown && (…)}`, a collapsed "Sign In"
 * dropdown at `Footer3.jsx:133-176`. A suite that only ever measured the default
 * render would therefore never have looked at `/admin/login` or
 * `/partner/login` at all, and "only one anchor changed" would have been proved
 * over a set that excluded the two anchors whose corruption would lock people out
 * of the platform. §W0 asserts BOTH figures and §W1 OPENS the dropdown so the
 * comparison runs over all seventeen.
 *
 * ═══ THE NINE INERT-PROOF MECHANISMS, AND WHERE EACH IS CLOSED ═══
 *   (1) a replica instead of the real thing → the real `Home` page, the real
 *       frozen `Footer3`, the real wouter router with `App.tsx`'s two mappings,
 *       and the real `LegalTermsPage`. No fixture footer exists in this file.
 *   (2) a normalising call inside an equality assertion → the label comparison in
 *       §W1/§W6 is `toBe` against raw `textContent` with NOTHING applied to
 *       either side (R200.1). Trimming appears only inside the production
 *       predicate, where it is a DOM label match and not an evidence comparison.
 *   (3) a fixture no mutation can move → §W1 measures the SAME seventeen anchors
 *       in a control mount with no correction and in the real page with it, and
 *       requires exactly one difference. §W3 moves the fixture again by
 *       re-rendering.
 *   (4) a fence whose installation is unproved → §W2 asserts the in-root anchor
 *       WAS corrected in the very same mount that leaves the decoy alone, so the
 *       scoping claim cannot pass by the effect simply never running.
 *   (5) a filter keyed to a field the writer never writes → the predicate and the
 *       correction read and write the same attribute, and §W1 reads that
 *       attribute back off the DOM rather than trusting a return value.
 *   (6) an unscoped DOM query → `screen` is never used; every query is
 *       `container`-scoped. §W2 plants a decoy with the identical href AND the
 *       identical label OUTSIDE `div.home3-root` and requires it untouched.
 *   (7) a runner printing "passed" while exiting nonzero → `Footer3.jsx:20-26`
 *       calls `scrollIntoView`, which jsdom does not implement; on wave 218 that
 *       produced `26 passed` together with exit code 1. It is stubbed below, and
 *       the exit code is read from `$?` on every run recorded for this wave.
 *   (8) an unconditionally-true predicate → every "the correct value is present"
 *       assertion is paired with "the wrong value is absent", and §W5 asserts
 *       both halves of the composed behaviour.
 *   (9) a RED that proves nothing → each disarm for this wave is recorded with its
 *       test count and its named failing assertion in `W235_TESTS.md`.
 *
 * WHAT THIS FILE DOES NOT PROVE.
 *   - Nothing is verified against a deployed site. There is no live access in this
 *     session and nothing here is described as live-fixed.
 *   - It does not prove the SOURCE FILE is correct, because it is not: the bytes
 *     on disk still carry the wrong href and §W4 asserts exactly that. A render
 *     that never executes an effect — server-side output consumed with JavaScript
 *     disabled — still emits the wrong attribute. That residual is stated, not
 *     counted as done.
 *   - jsdom performs no real navigation, so §W5 proves the router's path changed
 *     and the Terms page rendered; it does not prove what a browser's address bar
 *     would show.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClientProvider } from "@tanstack/react-query";

/* THE REAL PRODUCTION MODULES. */
import Home from "@/pages/home/Home";
/* The FROZEN footer, mounted alone as the control: no parent, no correction. */
import Footer3 from "@/components/home3compo/Footer3";
import LegalTermsPage from "@/pages/Terms";
import LegalPrivacyPage from "@/pages/Privacy";
import { queryClient } from "@/lib/queryClient";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import {
  FROZEN_FOOTER_MISLABELLED_TERMS_HREF,
  FROZEN_FOOTER_TERMS_LABEL,
  CORRECT_TERMS_ROUTE,
} from "@/components/FrozenFooterTermsInterception";

const REPO = path.resolve(__dirname, "../../../../..");
const readBytes = (rel: string) => readFileSync(path.join(REPO, rel));
const readText = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

const FOOTER3_REL = "client/src/components/home3compo/Footer3.jsx";
/** From `sacred_baseline/SACRED_SHA256.txt`. */
const FOOTER3_SACRED_SHA = "64937e08cc4abaf8205909240c485aff779031f5afb8ee43f63b8458a70bb350";

/** Anchors written in the frozen file. Wave 218's header said nineteen. See §W0. */
const FROZEN_FOOTER_ANCHOR_SOURCE_COUNT = 17;
/** Anchors in the DOM on arrival — four are inside the collapsed Sign In dropdown. */
const FROZEN_FOOTER_ANCHOR_RENDERED_COUNT = 13;
/** The four that only exist once the dropdown is open. */
const FROZEN_FOOTER_DROPDOWN_ANCHOR_COUNT = 4;

class InertIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", InertIntersectionObserver as unknown as typeof IntersectionObserver);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no server in jsdom"))));
  /* MECHANISM (7). Without this the suite prints passes and exits 1. */
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: function scrollIntoViewStub() {
        /* jsdom has no layout; nothing to do */
      },
      writable: true,
      configurable: true,
    });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.querySelectorAll("[data-w235-decoy]").forEach((n) => n.remove());
});

/** The real marketing page on a real router carrying `App.tsx`'s two mappings. */
function mountRealPublicSite(initialPath = "/") {
  const { hook, history } = memoryLocation({ path: initialPath, record: true });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LegalDrawerProvider>
        <Router hook={hook}>
          <Switch>
            <Route path="/terms-of-service" component={LegalTermsPage} />
            <Route path="/privacy-policy" component={LegalPrivacyPage} />
            <Route path="/" component={Home} />
          </Switch>
        </Router>
      </LegalDrawerProvider>
    </QueryClientProvider>,
  );
  return { ...utils, history, currentPath: () => history[history.length - 1] };
}

/**
 * The one `<footer>` in a mounted marketing page. Throws rather than returning
 * null: a helper that silently returns nothing makes every downstream assertion
 * vacuous, which is mechanism (6).
 */
function frozenFooter(container: HTMLElement): HTMLElement {
  const footers = Array.from(container.querySelectorAll("footer"));
  if (footers.length !== 1) {
    throw new Error(`expected exactly one <footer>, found ${footers.length}`);
  }
  return footers[0] as HTMLElement;
}

function footerAnchors(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(frozenFooter(container).querySelectorAll("a"));
}

/**
 * Opens the frozen footer's "Sign In" dropdown, so the four login anchors — two of
 * which are `/partner/login` and `/admin/login` — enter the DOM and can be
 * measured. Throws if the trigger is missing or the anchors do not appear: a
 * helper that silently opened nothing would shrink §W1's comparison set back to
 * thirteen while the test still reported a pass.
 */
function openSignInDropdown(scope: HTMLElement): void {
  const trigger = scope.querySelector("button.dropdown__trigger--footer");
  if (!trigger) throw new Error("the frozen footer's Sign In dropdown trigger is missing");
  act(() => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const opened = Array.from(scope.querySelectorAll("a")).filter((a) =>
    (a.getAttribute("href") ?? "").includes("login"),
  );
  if (opened.length < FROZEN_FOOTER_DROPDOWN_ANCHOR_COUNT) {
    throw new Error(
      `the Sign In dropdown did not open: expected at least ${FROZEN_FOOTER_DROPDOWN_ANCHOR_COUNT} login anchors, found ${opened.length}`,
    );
  }
}

/** The single "Terms"-labelled anchor. Throws if it is not unique. */
function termsAnchor(container: HTMLElement): HTMLAnchorElement {
  const hits = footerAnchors(container).filter(
    (a) => (a.textContent ?? "").trim() === FROZEN_FOOTER_TERMS_LABEL,
  );
  if (hits.length !== 1) {
    throw new Error(`expected exactly one "Terms" anchor in the frozen footer, found ${hits.length}`);
  }
  return hits[0];
}

/**
 * Dispatches a real click and reports whether the APPLICATION cancelled it.
 * Verdict read at `document` in the bubble phase, BEFORE this helper's own
 * suppression — wave 218 recorded that reading `dispatchEvent`'s return value
 * here measures the helper rather than the application.
 */
function clickAndReportCancelled(el: Element): { cancelled: boolean } {
  let cancelledByApp = false;
  let observed = false;
  const observer = (ev: Event) => {
    observed = true;
    cancelledByApp = ev.defaultPrevented;
    ev.preventDefault();
  };
  document.addEventListener("click", observer, false);
  try {
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  } finally {
    document.removeEventListener("click", observer, false);
  }
  if (!observed) {
    throw new Error("the dispatched click never reached document — the verdict was never observed");
  }
  return { cancelled: cancelledByApp };
}

/* ════════════════════════════════════════════════════════════════════════════
 * §W0 — THE BASELINE, COUNTED RATHER THAN QUOTED.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 235 §W0 — the frozen footer's anchor count, established three ways", () => {
  it("W0: seventeen on disk, THIRTEEN rendered — and the gap is the Sign In dropdown", () => {
    /* The brief and wave 218's module header both said NINETEEN. Both were wrong,
     * and a baseline nobody recounted is how a "only one anchor changed" proof
     * ends up being made over the wrong set. */
    const src = readText(FOOTER3_REL);
    expect((src.match(/<a\b/g) ?? []).length).toBe(FROZEN_FOOTER_ANCHOR_SOURCE_COUNT);
    /* Every anchor in the file carries an href, which is why the two disk counts
     * agree. If they ever diverge, the DOM is the figure to trust. */
    expect((src.match(/href=/g) ?? []).length).toBe(FROZEN_FOOTER_ANCHOR_SOURCE_COUNT);

    /* NEITHER figure is what the visitor's DOM contains on arrival. */
    const control = render(<Footer3 />);
    expect(Array.from(control.container.querySelectorAll("a")).length).toBe(
      FROZEN_FOOTER_ANCHOR_RENDERED_COUNT,
    );

    /* The four missing ones are the login links behind the collapsed dropdown,
     * and two of them are the partner and admin entrances. This is the reason the
     * distinction is asserted rather than noted: a comparison run only over the
     * default render would never have inspected them. */
    openSignInDropdown(control.container as HTMLElement);
    const afterOpen = Array.from(control.container.querySelectorAll("a"));
    expect(afterOpen.length).toBe(FROZEN_FOOTER_ANCHOR_SOURCE_COUNT);
    expect(
      FROZEN_FOOTER_ANCHOR_SOURCE_COUNT - FROZEN_FOOTER_ANCHOR_RENDERED_COUNT,
    ).toBe(FROZEN_FOOTER_DROPDOWN_ANCHOR_COUNT);
    const hrefs = afterOpen.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/partner/login");
    expect(hrefs).toContain("/admin/login");
    expect(hrefs).toContain("https://capavate.com/auth/login?portal=investor");
    expect(hrefs).toContain("https://capavate.com/auth/login?portal=founder");

    /* And the corrected figure is what wave 218's header now says. */
    const mod = readText("client/src/components/FrozenFooterTermsInterception.tsx");
    expect(mod).toContain("contains SEVENTEEN anchors");
    expect(mod).not.toContain("contains NINETEEN anchors");
  });

  it("W0b: the CONTROL — mounted with no parent, the frozen footer is still WRONG", () => {
    /* The defect, measured. `Footer3` alone has no correction effect anywhere near
     * it, so this is what the frozen bytes actually render. Without this the
     * §W1 comparison would have nothing to be a difference FROM. */
    const control = render(<Footer3 />);
    const terms = Array.from(control.container.querySelectorAll("a")).filter(
      (a) => (a.textContent ?? "").trim() === FROZEN_FOOTER_TERMS_LABEL,
    );
    expect(terms.length).toBe(1);
    expect(terms[0].getAttribute("href")).toBe(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §W1 — EXACTLY ONE ATTRIBUTE CHANGED, OVER ALL SEVENTEEN ANCHORS.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 235 §W1 — one anchor's href corrected, sixteen untouched", () => {
  it("W1: control vs real page — one href differs, it is Terms, and every label is identical", () => {
    /* Snapshot the frozen footer as it renders with NO correction. */
    const control = render(<Footer3 />);
    openSignInDropdown(control.container as HTMLElement);
    const controlPairs = Array.from(control.container.querySelectorAll("a")).map((a) => ({
      /* `getAttribute`, never `.href`: jsdom's property getter resolves a relative
       * value against the document base and would report
       * "http://localhost:3000/terms-of-service", hiding the raw bytes a crawler
       * and a screen reader actually consume. */
      href: a.getAttribute("href"),
      /* RAW textContent. No trim, no collapse, no lowercase, on either side. */
      label: a.textContent,
    }));
    /* The dropdown is opened on BOTH sides, so the four login anchors — including
     * `/partner/login` and `/admin/login` — are inside the compared set. */
    expect(controlPairs.length).toBe(FROZEN_FOOTER_ANCHOR_SOURCE_COUNT);
    cleanup();

    const { container } = mountRealPublicSite();
    openSignInDropdown(frozenFooter(container));
    const livePairs = footerAnchors(container).map((a) => ({
      href: a.getAttribute("href"),
      label: a.textContent,
    }));
    expect(livePairs.length).toBe(FROZEN_FOOTER_ANCHOR_SOURCE_COUNT);

    /* Document order is stable because neither wave inserts, removes or moves an
     * element — so the two lists are comparable index by index, and a reorder
     * would surface here as a label mismatch rather than passing quietly. */
    const changed: number[] = [];
    for (let i = 0; i < FROZEN_FOOTER_ANCHOR_SOURCE_COUNT; i++) {
      /* NOTHING IS DELETED and no text is rewritten: every label is byte-equal. */
      expect(livePairs[i].label, `the label of anchor #${i} changed`).toBe(controlPairs[i].label);
      if (livePairs[i].href !== controlPairs[i].href) changed.push(i);
    }

    /* EXACTLY ONE. Not "at least one", and not "the Terms one is right". */
    expect(changed.length, `hrefs changed at indexes ${JSON.stringify(changed)}`).toBe(1);
    const i = changed[0];
    expect(controlPairs[i].href).toBe(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
    expect(livePairs[i].href).toBe(CORRECT_TERMS_ROUTE);
    expect((livePairs[i].label ?? "").trim()).toBe(FROZEN_FOOTER_TERMS_LABEL);
    /* And the two lockout-critical anchors are provably among the sixteen that
     * did NOT change, named rather than merely counted. */
    for (const critical of ["/partner/login", "/admin/login"]) {
      const at = livePairs.findIndex((p) => p.href === critical);
      expect(at, `${critical} is not in the compared set`).toBeGreaterThanOrEqual(0);
      expect(at).not.toBe(i);
      expect(livePairs[at].href).toBe(controlPairs[at].href);
    }
  });

  it("W1b: the Privacy Policy anchor — same href as the defect — is left completely alone", () => {
    /* The correction had to distinguish two anchors carrying the IDENTICAL href.
     * A predicate keyed on href alone would have rewritten this one too, which
     * would have pointed the Privacy Policy link at the Terms of Service. */
    const { container } = mountRealPublicSite();
    const privacy = footerAnchors(container).filter((a) => a.textContent === "Privacy Policy" || (a.textContent ?? "").trim() === "Privacy Policy");
    expect(privacy.length).toBe(1);
    expect(privacy[0].getAttribute("href")).toBe(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
    /* And it is now the ONLY anchor left on that href. */
    const onDefectHref = footerAnchors(container).filter(
      (a) => a.getAttribute("href") === FROZEN_FOOTER_MISLABELLED_TERMS_HREF,
    );
    expect(onDefectHref.length).toBe(1);
    expect(onDefectHref[0]).toBe(privacy[0]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §W2 — THE CORRECTION IS SCOPED TO THE MOUNTING PARENT.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 235 §W2 — scoped to div.home3-root, proved with a decoy outside it", () => {
  it("W2: an identical anchor outside the marketing root is NOT rewritten", () => {
    /* MECHANISM (6). The decoy carries the SAME href and the SAME label as the
     * defect, so a `document`-wide query would rewrite it. It lives in
     * `document.body`, outside the mounted container entirely. */
    const decoy = document.createElement("a");
    decoy.setAttribute("data-w235-decoy", "1");
    decoy.setAttribute("href", FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
    decoy.textContent = FROZEN_FOOTER_TERMS_LABEL;
    document.body.appendChild(decoy);

    const { container } = mountRealPublicSite();

    /* THE POSITIVE HALF FIRST — mechanism (4). If the effect had simply not run,
     * the decoy would be untouched for a reason that proves nothing about scoping.
     * So the in-root anchor is asserted CORRECTED in this same mount. */
    expect(termsAnchor(container).getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);

    /* And the decoy, which satisfies the predicate exactly, was not reached. */
    expect(document.body.contains(decoy)).toBe(true);
    expect(container.contains(decoy)).toBe(false);
    expect(decoy.getAttribute("href")).toBe(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
    expect(decoy.textContent).toBe(FROZEN_FOOTER_TERMS_LABEL);
  });

  it("W2c: the SECOND predicate is as narrow as the first — a gap my own disarms found", () => {
    /* ═══ WHY THIS TEST EXISTS: A DISARM THAT CAME BACK GREEN ═══
     * Disarm D5 widens the corrected-anchor predicate to match on href alone. It
     * turned wave 218's suite RED (B2c, B3) and this suite GREEN, so the mutation
     * was caught — but only because the narrowness assertions happened to have
     * been written in the OTHER file. A wave-235 claim that depends on a
     * wave-218 file for its proof is a claim that can be lost by moving a file,
     * so the property is asserted here as well. Wave 210's legal strip is the
     * real anchor at risk: it points at exactly `/terms-of-service` from inside
     * `div.home3-root`, and an href-only predicate would cancel its clicks.
     */
    const { container, currentPath } = mountRealPublicSite();
    const strip = container.querySelector('[data-testid="public-legal-link-terms"]');
    expect(strip, "wave 210's legal strip Terms link is missing").not.toBeNull();
    /* It is in scope: same route, same root, different label. */
    expect(strip!.getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);
    expect(container.querySelector("div.home3-root")!.contains(strip!)).toBe(true);
    expect(strip!.textContent).not.toBe(FROZEN_FOOTER_TERMS_LABEL);
    /* And it is left entirely alone — not cancelled, and the visitor stays put. */
    expect(clickAndReportCancelled(strip!).cancelled).toBe(false);
    expect(currentPath()).toBe("/");
  });

  it("W2b: the corrected anchor is INSIDE div.home3-root, so the ref really is its scope", () => {
    const { container } = mountRealPublicSite();
    const root = container.querySelector("div.home3-root");
    expect(root).not.toBeNull();
    /* Exactly one root — two scopes would make the claim ambiguous. */
    expect(container.querySelectorAll("div.home3-root").length).toBe(1);
    const terms = termsAnchor(container);
    expect(root!.contains(terms)).toBe(true);
    expect(terms.getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);
    /* The className that scopes the marketing button reset is still there — its
     * own comment records that removing it silently restores a platform-wide
     * bug, and this wave added a ref to that element. */
    expect(root!.className).toContain("home3-root");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §W3 — IDEMPOTENT, AND IT SURVIVES A RE-RENDER.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 235 §W3 — the correction is idempotent and re-applies", () => {
  it("W3: after a forced re-render the href is still correct and still singular", () => {
    /* The effect has no dependency array, so it runs after every render. That is
     * deliberate: React writes the JSX href when it creates the element and does
     * not know about a mutation made behind it, so a remount would otherwise
     * restore the wrong value. Idempotence matters because the effect runs many
     * times: after the first pass the predicate no longer matches. */
    const { container, rerender } = (() => {
      const { hook } = memoryLocation({ path: "/", record: true });
      const utils = render(
        <QueryClientProvider client={queryClient}>
          <LegalDrawerProvider>
            <Router hook={hook}>
              <Home />
            </Router>
          </LegalDrawerProvider>
        </QueryClientProvider>,
      );
      const tree = (
        <QueryClientProvider client={queryClient}>
          <LegalDrawerProvider>
            <Router hook={hook}>
              <Home />
            </Router>
          </LegalDrawerProvider>
        </QueryClientProvider>
      );
      return { container: utils.container, rerender: () => act(() => utils.rerender(tree)) };
    })();

    expect(termsAnchor(container).getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);
    rerender();
    rerender();
    /* Still one anchor, still corrected, label still byte-identical, and no
     * anchor was added or removed by repeated application. */
    const terms = termsAnchor(container);
    expect(terms.getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);
    expect(terms.textContent).toBe(FROZEN_FOOTER_TERMS_LABEL);
    expect(footerAnchors(container).length).toBe(FROZEN_FOOTER_ANCHOR_RENDERED_COUNT);
    /* And exactly one anchor still carries the ORIGINAL href — the Privacy
     * Policy one — so repetition did not widen the match. */
    expect(
      footerAnchors(container).filter((a) => a.getAttribute("href") === FROZEN_FOOTER_MISLABELLED_TERMS_HREF).length,
    ).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §W4 — THE SACRED FILE WAS NOT EDITED, AND ITS DEFECT IS STILL ON DISK.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 235 §W4 — the frozen file is byte-identical and the residual is stated", () => {
  it("W4: Footer3.jsx hashes to its sacred baseline", () => {
    expect(createHash("sha256").update(readBytes(FOOTER3_REL)).digest("hex")).toBe(FOOTER3_SACRED_SHA);
  });

  it("W4b: the SOURCE still carries the wrong href — the one residual, asserted not assumed", () => {
    /* This is what remains unfixed and it is deliberately asserted rather than
     * hoped about: a render that never executes an effect still emits these
     * bytes. Closing it needs an owner-ratified change to a sacred file. */
    expect(readText(FOOTER3_REL)).toContain(`<a href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Terms</a>`);
  });

  it("W4c: the fix lives in the non-sacred layer, and adds no second mechanism", () => {
    const home = readText("client/src/pages/home/Home.tsx");
    /* Wave 210's strip and wave 218's handler are both still mounted. */
    expect(home).toContain("<PublicLegalStrip />");
    expect(home).toContain("onClickCapture={interceptFrozenFooterTermsLink}");
    /* Wave 235's correction is invoked on the same element's ref. */
    expect(home).toContain("useFrozenFooterTermsHrefCorrection(home3RootRef)");
    expect(home).toContain("ref={home3RootRef}");
    const mod = readText("client/src/components/FrozenFooterTermsInterception.tsx");
    /* One module, one predicate pair, no document-level reach. */
    expect(mod).not.toContain("document.addEventListener");
    expect(mod).not.toContain("document.querySelector");
    expect((mod.match(/export function useFrozenFooterTermsHrefCorrection/g) ?? []).length).toBe(1);
    /* The correction only ever SETS one attribute. It removes nothing (R195.5). */
    expect(mod).not.toContain("removeAttribute");
    expect(mod).not.toContain("remove()");
    expect((mod.match(/setAttribute\(/g) ?? []).length).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §W5 — THE COMPOSED BEHAVIOUR: CORRECT href AND a client-side route change.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 235 §W5 — both halves at once", () => {
  it("W5: the href is corrected AND a click still lands on the real Terms page", () => {
    /* Correcting the href alone would have broken wave 218's mechanism: its
     * predicate is keyed on the WRONG href, so the click would have stopped being
     * cancelled and the browser would have done a full document navigation. The
     * destination would still be right and the single-page app would still be torn
     * down. Both halves are therefore asserted together, in one mount. */
    const { container, currentPath } = mountRealPublicSite();
    expect(currentPath()).toBe("/");
    const terms = termsAnchor(container);

    /* HALF ONE — the markup. */
    expect(terms.getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);
    expect(terms.getAttribute("href")).not.toBe(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);

    /* HALF TWO — the click, still cancelled by the application and still routed. */
    expect(clickAndReportCancelled(terms).cancelled).toBe(true);
    expect(currentPath()).toBe(CORRECT_TERMS_ROUTE);
    /* And the visitor is reading the Terms of Service, not merely at its URL. */
    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading!.textContent ?? "").toContain("Terms");
    /* A real route change, not an overlay: the marketing tree is gone. */
    expect(container.querySelectorAll("div.home3-root").length).toBe(0);
  });

  it("W5b: the four non-click consumers now read the right target", () => {
    /* Each of these is what a real consumer actually reads, and none of them
     * reaches a React handler — which is precisely why wave 218 did not fix them.
     * They are asserted off the attribute rather than described in prose. */
    const { container } = mountRealPublicSite();
    const terms = termsAnchor(container);
    /* "copy link address" and open-in-new-tab both read the attribute. */
    expect(terms.getAttribute("href")).toBe(CORRECT_TERMS_ROUTE);
    /* A crawler reads the serialised markup of the anchor. */
    expect(terms.outerHTML).toContain(`href="${CORRECT_TERMS_ROUTE}"`);
    expect(terms.outerHTML).not.toContain(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
    /* A screen reader announces label + target; both must be right together. */
    expect(terms.textContent).toBe(FROZEN_FOOTER_TERMS_LABEL);
    /* And the route it now names is one the application really serves — proved by
     * §W5 mounting it, not by this string existing. */
    expect(CORRECT_TERMS_ROUTE).toBe("/terms-of-service");
  });
});
