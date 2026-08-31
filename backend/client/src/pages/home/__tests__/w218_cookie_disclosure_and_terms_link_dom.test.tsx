/**
 * WAVE 218 — WHAT A REAL VISITOR ACTUALLY GETS. REAL PAGES, REAL CLICKS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EVERY SECTION IS SHAPED THE WAY IT IS. READ BEFORE EDITING ANY ASSERTION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wave 218 has two subjects, and neither can be proved from a data structure:
 *
 *   1. The published Cookie Policy claimed a consent banner, a footer cookie
 *      settings link, a cookie-consent preference cookie, Google Analytics,
 *      advertising partners and a Settings opt-out. None of the six exists. The
 *      corrected statement of what is actually set has to be proved as SERVED
 *      TEXT on the real page, because a constant that is never rendered fixes
 *      nothing.
 *   2. The frozen marketing footer's "Terms" anchor points at the Privacy
 *      Policy. The fix is a click interception from the non-sacred parent, and a
 *      click interception can only be proved by clicking.
 *
 * NEVER PROVE A REPLICA (handbook §8). Every component mounted below is the
 * production module, imported from the path the application imports it from:
 *   - `Home` — the real marketing page, which mounts the real, FROZEN `Footer3`.
 *   - `LegalTermsPage` (`@/pages/Terms`) — the exact component `App.tsx:626`
 *     routes `/terms-of-service` to.
 *   - `AdoptedLegalDocumentPage` — the exact component `App.tsx:634` routes
 *     `/legal/:docId` to, rendering through the ONE markdown renderer
 *     (`MarkdownBlock`), not a second copy of it.
 *   - The real `queryClient` and the real `LegalDrawerProvider`, i.e. the same
 *     providers `client/src/main.tsx` wraps the application in.
 *
 * TWO BROWSER APIS ARE STUBBED, AND NEITHER IS APPLICATION CODE.
 *   - `IntersectionObserver`: jsdom does not implement it and
 *     `home3compo/useScrollReveal.js` constructs one on mount. The stub is inert.
 *   - `fetch`: stubbed to REJECT, not to return a convenient value. That is
 *     deliberate and copied from wave 210's reasoning: the fail-safe path is the
 *     one a real visitor hits when the config read is slow or broken, and the
 *     corrected cookie text must be served on that path too. A test that stubs a
 *     happy answer proves the happy answer, which is inert-proof mechanism (3) —
 *     a fixture no failure can move.
 *
 * THE SIX KNOWN INERT-PROOF MECHANISMS, AND WHERE EACH IS ANSWERED HERE.
 *   (1) a replica instead of the real thing → §A/§C mount the production
 *       modules; §A0 proves the FROZEN footer is in the tree before any claim
 *       about it is made.
 *   (2) a normalising call inside an equality assertion → §C2 compares stored
 *       bytes to rendered bytes with `===` and NO `.trim()`, NO `.toLowerCase()`,
 *       NO whitespace collapse on either side, and §C1 proves separately that the
 *       stored lines carry no trailing whitespace, so nothing is being hidden by
 *       the renderer's own `trimEnd`. R200.1 is the reason this rule exists: a
 *       `.trim()` in the comparison erased the exact difference the test existed
 *       to detect, and the disarm came back GREEN.
 *   (3) a fixture no mutation can move → §B drives real clicks on the real
 *       anchors and reads the resulting ROUTE, and the disarm harness moves the
 *       subject rather than trusting it.
 *   (4) a fence whose installation is never proved → §B0 proves the interception
 *       handler is attached to the mounted element before §B claims anything
 *       about what it does.
 *   (5) a filter keyed to a field the writer never writes → §E reads the real
 *       source files off disk by sha256 rather than trusting a constant.
 *   (6) an unscoped DOM query reading a different element → every query below is
 *       `container`-scoped or `within(...)`-scoped. `screen` is never used, and
 *       §B3 proves the interception does not reach outside the marketing tree.
 *
 * WHAT THIS FILE DOES NOT PROVE, SAID PLAINLY.
 *   - Nothing here is verified against a deployed site. There is no live access
 *     in this session and nothing is described as live-fixed.
 *   - It does not prove the mislabelled anchor's MARKUP is corrected, because it
 *     is not corrected: `Footer3.jsx` is sacred and untouched. A visitor who
 *     copies the link address, opens it in a new tab from the context menu, or
 *     runs with JavaScript disabled still reaches the Privacy Policy. §B5 asserts
 *     that this residual defect is still present, so that a later wave cannot
 *     quietly believe it was fixed.
 *   - It does not prove the six false sentences are REMOVED from the Cookie
 *     Policy, because they are not removed. §C4 asserts they are still present
 *     AND that each is explicitly withdrawn, which is what was actually built.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClientProvider } from "@tanstack/react-query";

/* THE REAL PRODUCTION MODULES. */
import Home from "@/pages/home/Home";
/* The FROZEN footer itself, mounted alone as the control in B2. */
import Footer3 from "@/components/home3compo/Footer3";
import LegalTermsPage from "@/pages/Terms";
import LegalPrivacyPage from "@/pages/Privacy";
import { AdoptedLegalDocumentPage } from "@/components/AdoptedLegalDocumentPage";
import { queryClient } from "@/lib/queryClient";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import { ADOPTED_LEGAL_DOCS, findAdoptedLegalDoc } from "@/lib/legalDocsV2";
import { LEGAL_DOCS } from "@/lib/legalDocs";
import {
  ADOPTED_LEGAL_CORPUS_VERSION,
  ADOPTED_LEGAL_CORPUS_DATE_LABEL,
} from "@shared/wave210LegalCorpusVersion";
import {
  FROZEN_FOOTER_MISLABELLED_TERMS_HREF,
  FROZEN_FOOTER_TERMS_LABEL,
  CORRECT_TERMS_ROUTE,
  isFrozenFooterMislabelledTermsLink,
} from "@/components/FrozenFooterTermsInterception";

const REPO = path.resolve(__dirname, "../../../../..");
const readBytes = (rel: string) => readFileSync(path.join(REPO, rel));
const readText = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

/** The sacred sha of the frozen public footer, from `sacred_baseline/SACRED_SHA256.txt`. */
const FOOTER3_SACRED_SHA = "64937e08cc4abaf8205909240c485aff779031f5afb8ee43f63b8458a70bb350";
/** Wave 210's pin on the superseded corpus source. Wave 218 must not move it. */
const LEGALDOCS_PINNED_SHA = "80ecf559c6192cef1310b4a8e4258ccf3cd73e8edcd62569fa365c4db58ef25e";

class InertIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/* ═══ WHY `scrollIntoView` IS STUBBED, AND HOW ITS ABSENCE NEARLY FALSIFIED THIS
 * WHOLE FILE ═══
 *
 * jsdom implements no layout, so `Element.prototype.scrollIntoView` does not
 * exist. `Footer3.jsx:20-26` calls it on every in-page `#` anchor click. Clicking
 * those anchors — which §B2 and §B3 do, deliberately, dozens of times — therefore
 * threw asynchronously, inside React's event dispatch, where no assertion could
 * see it. Vitest reported `26 passed` AND exited with code 1, and it took the
 * disarm harness to surface that: the harness reads the EXIT CODE, so its control
 * disarm D0, which must stay GREEN, came back RED. Had I trusted the printed test
 * summary instead of the exit code, every disarm verdict in the harness would have
 * been meaningless while looking perfect.
 *
 * The stub is a no-op because scrolling is not what this file measures. What it
 * measures is which anchor gets cancelled and where the visitor lands, and the
 * frozen footer's own `preventDefault` — the part that matters here — runs whether
 * or not the scroll that follows it succeeds. */
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", InertIntersectionObserver as unknown as typeof IntersectionObserver);
  /* REJECT, not resolve. See the header. */
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no server in jsdom"))));
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: function scrollIntoViewStub() { /* jsdom has no layout; nothing to do */ },
      writable: true,
      configurable: true,
    });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Mounts the REAL marketing page inside the REAL provider tree, on a real wouter
 * router carrying the same two route mappings `App.tsx` declares. Returns the
 * container and a reader for the router's current path, so a click can be judged
 * by where the visitor actually ended up rather than by a spy.
 */
function mountRealPublicSite(initialPath = "/") {
  const { hook, history } = memoryLocation({ path: initialPath, record: true });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LegalDrawerProvider>
        <Router hook={hook}>
          <Switch>
            {/* The same components App.tsx routes these paths to. */}
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
 * The frozen footer element inside a mounted marketing page. Throws rather than
 * returning null: a helper that silently returns nothing turns every downstream
 * assertion into a vacuous pass, which is how mechanism (6) gets in.
 */
function frozenFooter(container: HTMLElement): HTMLElement {
  const footers = Array.from(container.querySelectorAll("footer"));
  if (footers.length !== 1) {
    throw new Error(`expected exactly one <footer> in the mounted marketing page, found ${footers.length}`);
  }
  return footers[0] as HTMLElement;
}

/** Every anchor in the frozen footer, in document order. */
function footerAnchors(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(frozenFooter(container).querySelectorAll("a"));
}

/**
 * Dispatches a REAL click and reports whether the APPLICATION cancelled it.
 *
 * ═══ A MEASUREMENT ERROR I MADE HERE, AND THE CORRECTION ═══
 * The obvious form of this helper reads the return value of `dispatchEvent`,
 * which is `false` exactly when some listener called `preventDefault`. That is
 * wrong in this harness, and it reported that EVERY anchor on the page was being
 * intercepted — including `#main-content` and the Privacy Policy link — which
 * would have been a serious production defect if it had been true. It was not:
 * the helper's own suppression listener (below) was the thing calling
 * `preventDefault`, so `dispatchEvent` always returned `false` and the helper was
 * measuring itself. Left uncorrected in the other direction, the same shape is
 * how a test comes to pass for a reason that has nothing to do with the code.
 *
 * The verdict is therefore read at the document, in the bubble phase, BEFORE the
 * suppression: React 18 attaches its listeners to the render root, which sits
 * below `document`, so by the time this listener runs the application's
 * capture-phase handler on `div.home3-root` has already either cancelled the
 * click or declined to. `ev.defaultPrevented` at that instant is the
 * application's answer and nothing else's.
 *
 * The suppression exists only because jsdom cannot navigate: an uncancelled click
 * on an `<a href>` makes it print a "Not implemented: navigation" error. It runs
 * strictly after the verdict is recorded and cannot change it.
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
    /* `act` so that a route change the handler causes is FLUSHED before the
     * caller looks at the DOM. Without it the router's history had advanced but
     * React had not re-rendered, and the assertion about which page the visitor
     * is now reading was being made against the previous render. */
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  } finally {
    document.removeEventListener("click", observer, false);
  }
  /* If the event never reached the document the verdict was never taken, and a
   * silent `false` would be a vacuous pass. Fail loudly instead. */
  if (!observed) {
    throw new Error("the dispatched click never reached document — the verdict was never observed");
  }
  return { cancelled: cancelledByApp };
}

/* ════════════════════════════════════════════════════════════════════════════
 * §A — THE SUBJECT EXISTS. Proved before any claim is made about it.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 218 §A — the real marketing page and the real frozen footer are mounted", () => {
  it("A0: the page mounts, and the FROZEN footer with its mislabelled anchor is in the tree", () => {
    const { container } = mountRealPublicSite();
    /* The wrapper the interception is attached to. */
    expect(container.querySelectorAll("div.home3-root").length).toBe(1);
    const anchors = footerAnchors(container);
    /* The frozen footer is not empty and is the real one. */
    expect(anchors.length).toBeGreaterThan(10);
    const terms = anchors.filter((a) => (a.textContent ?? "").trim() === FROZEN_FOOTER_TERMS_LABEL);
    /* EXACTLY ONE. If a second appeared, the narrow predicate would be wrong and
     * every §B assertion would be about an anchor nobody chose. */
    expect(terms.length).toBe(1);
    /* And it still carries the WRONG href, because the frozen file was not edited. */
    expect(terms[0].getAttribute("href")).toBe(FROZEN_FOOTER_MISLABELLED_TERMS_HREF);
  });

  it("A1: Footer3.jsx is byte-identical to its sacred hash — the frozen file was NOT edited", () => {
    expect(createHash("sha256").update(readBytes("client/src/components/home3compo/Footer3.jsx")).digest("hex"))
      .toBe(FOOTER3_SACRED_SHA);
  });

  it("A2: the source of the fix is the non-sacred parent, and it is scoped to the marketing wrapper", () => {
    const home = readText("client/src/pages/home/Home.tsx");
    /* Wave 210's strip is still mounted — this wave did not replace it. */
    expect(home).toContain("<Footer3 />");
    expect(home).toContain("<PublicLegalStrip />");
    /* And the interception is on the wrapper, not on `document`. */
    expect(home).toContain('<div className="home3-root" onClickCapture={interceptFrozenFooterTermsLink}>');
    const mod = readText("client/src/components/FrozenFooterTermsInterception.tsx");
    expect(mod).not.toContain("document.addEventListener");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §B — THE CLICK. The fence is proved installed, then proved narrow.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 218 §B — clicking Terms in the frozen footer reaches the real Terms page", () => {
  it("B0: the interception is installed on the mounted wrapper BEFORE any negative claim", () => {
    const { container } = mountRealPublicSite();
    const root = container.querySelector("div.home3-root");
    expect(root).not.toBeNull();
    /* A React prop is not readable off the DOM node, so installation is proved
     * behaviourally: the one anchor the fence targets is cancelled. If the fence
     * were absent this is the assertion that fails, and every later "other
     * anchors are untouched" claim would otherwise be vacuously true. */
    const terms = footerAnchors(container).find(
      (a) => (a.textContent ?? "").trim() === FROZEN_FOOTER_TERMS_LABEL,
    )!;
    expect(clickAndReportCancelled(terms).cancelled).toBe(true);
  });

  it("B1: the click lands on the REAL /terms-of-service route and the REAL Terms page renders", () => {
    const { container, currentPath } = mountRealPublicSite();
    expect(currentPath()).toBe("/");
    const terms = footerAnchors(container).find(
      (a) => (a.textContent ?? "").trim() === FROZEN_FOOTER_TERMS_LABEL,
    )!;
    clickAndReportCancelled(terms);
    /* The route actually changed — read from the router, not from a spy. */
    expect(currentPath()).toBe(CORRECT_TERMS_ROUTE);
    /* And the Terms page is what rendered. This is the whole point: not that a
     * handler fired, but that a visitor now reads the Terms of Service. */
    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect((heading!.textContent ?? "")).toContain("Terms");
    /* The marketing page is gone, so this is a real route change, not an overlay. */
    expect(container.querySelectorAll("div.home3-root").length).toBe(0);
  });

  it("B2: the interception changes NOTHING except the one anchor \u2014 proved against a CONTROL mount", () => {
    /* \u2550\u2550\u2550 A FINDING THAT CHANGED THIS TEST, RECORDED BECAUSE IT MATTERS \u2550\u2550\u2550
     *
     * The first version of this test asserted that no anchor other than "Terms"
     * is ever cancelled. It FAILED on `#how-it-works`, and for a moment that
     * looked like the interception swallowing the footer's in-page navigation \u2014
     * exactly the lockout hazard the preflight named as this wave's only real
     * one. It was not. `Footer3.jsx:20-26` carries its OWN `handleSmoothScroll`
     * handler, which calls `e.preventDefault()` on every in-page `#` anchor so it
     * can scroll instead. That behaviour predates this wave and belongs to the
     * frozen file.
     *
     * So "nothing was cancelled" was the wrong property to assert: it was never
     * true. The right property is that the interception changes nothing, and the
     * only way to state that without hand-waving is to MEASURE THE SAME ANCHORS
     * TWICE \u2014 once in a CONTROL mount of the frozen footer with no interception
     * anywhere near it, and once inside the real marketing page \u2014 and require the
     * two measurements to be identical for every anchor except the one this wave
     * deliberately changes. That is a moved fixture: if the interception reached
     * one anchor further than intended, the two measurements would diverge and
     * this test would say which anchor.
     */
    const control = render(<Footer3 />);
    const controlVerdicts = new Map<string, boolean>();
    for (const a of Array.from(control.container.querySelectorAll("a"))) {
      const key = `${a.getAttribute("href")}\u0000${(a.textContent ?? "").trim()}`;
      controlVerdicts.set(key, clickAndReportCancelled(a).cancelled);
    }
    /* The control must actually contain the subject, or the comparison is empty. */
    expect(controlVerdicts.size).toBeGreaterThan(10);
    const termsKey = `${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}\u0000${FROZEN_FOOTER_TERMS_LABEL}`;
    expect(controlVerdicts.has(termsKey)).toBe(true);
    /* Without the interception, the mislabelled anchor is NOT cancelled \u2014 i.e.
     * the browser would have followed its wrong href. That is the defect. */
    expect(controlVerdicts.get(termsKey)).toBe(false);
    cleanup();

    const { container, currentPath } = mountRealPublicSite();
    const live = footerAnchors(container);
    let compared = 0;
    for (const a of live) {
      const key = `${a.getAttribute("href")}\u0000${(a.textContent ?? "").trim()}`;
      if (!controlVerdicts.has(key)) continue;
      const verdict = clickAndReportCancelled(a).cancelled;
      compared += 1;
      if (key === termsKey) {
        /* The one deliberate change. */
        expect(verdict).toBe(true);
        continue;
      }
      expect(
        verdict,
        `the interception changed the behaviour of an anchor it must not touch: ${key}`,
      ).toBe(controlVerdicts.get(key));
      /* And none of them moved the visitor off the marketing page. */
      if (key !== termsKey) expect(currentPath()).toBe("/");
    }
    /* A comparison over two anchors would pass for the wrong reason. */
    expect(compared).toBeGreaterThan(10);
  });

  it("B2b: the Privacy Policy anchor SHARES the same href and is still NOT intercepted", () => {
    const { container, currentPath } = mountRealPublicSite();
    const sameHref = footerAnchors(container).filter(
      (a) => a.getAttribute("href") === FROZEN_FOOTER_MISLABELLED_TERMS_HREF,
    );
    /* Two anchors carry the identical href; only one of them is mislabelled. A
     * predicate keyed on href alone would have swallowed the correct link too. */
    expect(sameHref.length).toBe(2);
    const privacy = sameHref.find((a) => (a.textContent ?? "").trim() !== FROZEN_FOOTER_TERMS_LABEL)!;
    expect((privacy.textContent ?? "").trim()).toBe("Privacy Policy");
    expect(clickAndReportCancelled(privacy).cancelled).toBe(false);
    expect(currentPath()).toBe("/");
  });

  it("B3: no anchor with a real destination anywhere on the page is intercepted", () => {
    /* In-page `#` anchors are excluded and handled in B2, because the frozen
     * footer and the marketing header cancel those themselves in order to scroll.
     * What must never be cancelled is an anchor that would take the visitor
     * somewhere \u2014 the partner, admin, investor and founder logins, the public
     * application form, the education site, and the wave-210 legal strip. */
    const { container, currentPath } = mountRealPublicSite();
    const real = Array.from(container.querySelectorAll("a")).filter((a) => {
      const href = a.getAttribute("href") ?? "";
      if (href === "" || href.startsWith("#")) return false;
      return (a.textContent ?? "").trim() !== FROZEN_FOOTER_TERMS_LABEL;
    });
    expect(real.length).toBeGreaterThan(10);
    for (const a of real) {
      expect(
        clickAndReportCancelled(a).cancelled,
        `an anchor with a real destination was intercepted: ${a.getAttribute("href")}`,
      ).toBe(false);
      expect(currentPath()).toBe("/");
    }
  });

  it("B4: the predicate itself refuses every near miss", () => {
    /* Attacking the predicate directly, because a click test can only cover the
     * anchors that happen to be on the page today. */
    const mk = (html: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      return d.firstElementChild;
    };
    expect(isFrozenFooterMislabelledTermsLink(null)).toBe(false);
    /* right href, wrong label */
    expect(isFrozenFooterMislabelledTermsLink(mk(`<a href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Privacy Policy</a>`))).toBe(false);
    /* right label, wrong href */
    expect(isFrozenFooterMislabelledTermsLink(mk(`<a href="/terms-of-service">Terms</a>`))).toBe(false);
    expect(isFrozenFooterMislabelledTermsLink(mk(`<a href="/privacy-policy">Terms</a>`))).toBe(false);
    /* ═══ A COVERAGE GAP THE DISARM HARNESS FOUND, AND THE CASE THAT CLOSES IT ═══
     * This block originally contained only the `<button>Terms</button>` line
     * below. Disarm D7 deletes the `tagName !== "A"` check from the predicate and
     * expected this test to go RED; it stayed GREEN. The reason is that a
     * `<button>` carries no `href`, so the href comparison rejected it whether or
     * not the tag was ever checked — the assertion looked like it was testing the
     * type check and was in fact testing the href check a second time. The case
     * that actually exercises the type check is a NON-ANCHOR ELEMENT CARRYING THE
     * RIGHT href ATTRIBUTE, which is legal HTML and which `closest("a")` would
     * never return but a hand-written or future caller could pass in. */
    expect(isFrozenFooterMislabelledTermsLink(mk(`<div href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Terms</div>`))).toBe(false);
    expect(isFrozenFooterMislabelledTermsLink(mk(`<span href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Terms</span>`))).toBe(false);
    expect(isFrozenFooterMislabelledTermsLink(mk(`<button href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Terms</button>`))).toBe(false);
    /* right label and href but not an anchor */
    expect(isFrozenFooterMislabelledTermsLink(mk(`<button>Terms</button>`))).toBe(false);
    /* label that merely contains the word */
    expect(isFrozenFooterMislabelledTermsLink(mk(`<a href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Terms of Use</a>`))).toBe(false);
    /* the one true case, including the JSX whitespace a real render produces */
    expect(isFrozenFooterMislabelledTermsLink(mk(`<a href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">\n  Terms\n</a>`))).toBe(true);
  });

  it("B5: the RESIDUAL defect is still present and is asserted, not assumed away", () => {
    /* The markup still carries the wrong href. A copied link address, a
     * middle-click, or a visitor with JavaScript disabled still reaches the
     * Privacy Policy, and no interception from outside a frozen file can change
     * that. This assertion exists so that a later wave reading a green suite does
     * not conclude the anchor was corrected. */
    const footer3 = readText("client/src/components/home3compo/Footer3.jsx");
    expect(footer3).toContain(`<a href="${FROZEN_FOOTER_MISLABELLED_TERMS_HREF}">Terms</a>`);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §C — THE CORRECTED COOKIE DISCLOSURE, AS SERVED.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The stored clause, taken from the corpus the platform actually serves. */
function storedCookieBody(): string {
  const doc = findAdoptedLegalDoc("cookies");
  if (!doc) throw new Error("the adopted corpus has no `cookies` document");
  return doc.body;
}

/** The paragraph lines of the appended clause, as stored. */
function appendedClauseLines(): string[] {
  const body = storedCookieBody();
  const marker = "What is actually set on your device";
  const at = body.indexOf(marker);
  if (at < 0) throw new Error("the appended wave-218 clause is not in the served cookie body");
  return body
    .slice(at)
    .split("\n")
    .filter((l) => l.trim() !== "");
}

describe("WAVE 218 §C — the corrected disclosure is SERVED, byte-identical to what is stored", () => {
  it("C0: the real /legal/cookies page renders, and it is the production component", () => {
    const { container } = render(<AdoptedLegalDocumentPage docId="cookies" />);
    expect(container.querySelector('[data-testid="page-legal-cookies"]')).not.toBeNull();
    const title = container.querySelector('[data-testid="legal-doc-title"]');
    expect(title?.textContent).toBe("Cookie Policy");
    /* The version identity did NOT move. Wave 210 pins it in twenty places and a
     * bump would re-prompt every user for consent they already gave. */
    const version = container.querySelector('[data-testid="legal-doc-version"]');
    expect(version?.textContent).toContain(ADOPTED_LEGAL_CORPUS_VERSION);
    expect(version?.textContent).toContain(ADOPTED_LEGAL_CORPUS_DATE_LABEL);
  });

  it("C1: the stored clause lines carry NO trailing whitespace — nothing is hidden by trimEnd", () => {
    /* `MarkdownBlock` applies `trimEnd()` to each source line before rendering.
     * If a stored line had trailing whitespace, the byte comparison in C2 would
     * be silently forgiving of it. This asserts there is nothing for the
     * renderer's own normalisation to absorb, so C2's `===` is a real equality
     * over the real bytes rather than an equality the renderer arranged. */
    for (const line of appendedClauseLines()) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });

  it("C2: every stored line of the clause is rendered BYTE-IDENTICALLY — no normalising call", () => {
    /* ═══ THE REASON THIS COMPARISON HAS NO `.trim()`, NO `.toLowerCase()` AND
     * NO WHITESPACE COLLAPSE ON EITHER SIDE ═══
     *
     * R200.1: wave 212 broke the link between the words shown on screen and the
     * bytes stored, and the test built for exactly that property PASSED, because
     * its helper called `.trim()` on each paragraph before comparing. It
     * normalised away the difference it existed to detect, and the disarm came
     * back GREEN. This is a legal document: what a user reads and what the
     * platform holds as the text it published must be the SAME BYTES, and any
     * normalising call in this assertion would make that claim unprovable. So the
     * comparison below is `===` between the stored line and the rendered
     * `textContent`, with nothing applied to either operand.
     */
    const { container } = render(<AdoptedLegalDocumentPage docId="cookies" />);
    const renderedTexts = Array.from(container.querySelectorAll("p, h3, h4, li")).map(
      (el) => el.textContent ?? "",
    );
    const lines = appendedClauseLines();
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      const matches = renderedTexts.filter((t) => t === line);
      expect(
        matches.length,
        `stored line was not rendered byte-identically:\n${JSON.stringify(line.slice(0, 120))}`,
      ).toBeGreaterThan(0);
    }
  });

  it("C3: the corrected facts are the ones the code actually shows", () => {
    const { container } = render(<AdoptedLegalDocumentPage docId="cookies" />);
    const served = container.textContent ?? "";
    /* Each of these is a fact established by enumerating the code in the
     * preflight, not a phrase chosen for a test to find. */
    expect(served).toContain("There is no analytics on this platform.");
    expect(served).toContain("There is no advertising or targeting on this platform.");
    expect(served).toContain("There is no cookie consent banner and no cookie settings link, and none is needed.");
    expect(served).toContain("Nothing at all is written to session storage.");
    expect(served).toContain("Airwallex");
    expect(served).toContain("Web fonts are loaded from Google on every page");
    expect(served).toContain("collapsed the navigation sidebar");
    /* And the limit of what the wave can verify is stated rather than guessed. */
    expect(served).toContain("neither confirmed nor withdrawn here");
  });

  it("C4: the six false statements are STILL PRESENT and EACH is explicitly withdrawn", () => {
    /* This is the honest shape of what was built. The false sentences could not
     * be deleted: `legalDocs.ts` is sha-pinned by wave 210's suite and its body
     * is prefix-proved, so the adopted corpus may only be appended to. The
     * correction therefore names each false statement and withdraws it, and this
     * test asserts BOTH halves — that the old wording is still on the page, and
     * that the withdrawal of it is too. Asserting only the second half would let
     * a future reader believe the document had been cleaned. */
    const { container } = render(<AdoptedLegalDocumentPage docId="cookies" />);
    const served = container.textContent ?? "";

    const stillPresent = [
      "you will be presented with a cookie consent banner",
      "the cookie settings link in the website footer",
      "Google Analytics",
      "These may be set by our advertising partners",
      "cookie consent preference cookies",
      "persist for up to 12 months",
    ];
    for (const s of stillPresent) {
      expect(served, `expected the superseded wording to still be present: ${s}`).toContain(s);
    }

    /* Each withdrawal, matched on the sentence that performs it. */
    expect(served).toContain("are withdrawn: there is nothing to opt out of");
    expect(served).toContain("describing cookies set by our advertising partners is withdrawn");
    expect(served).toContain("are all withdrawn. No such banner, link, control or cookie exists.");
    expect(served).toContain("this clause is correct and the earlier statement is withdrawn");
  });

  it("C5: the SUMMARY correction is served where the false summary is served", () => {
    /* The summary is rendered in the consent drawer and on the founder Settings
     * page — the very page its superseded wording pointed the reader to. */
    const doc = findAdoptedLegalDoc("cookies")!;
    expect(doc.summary).toContain("You can opt out of non-essential cookies in Settings.");
    expect(doc.summary).toContain("there is no cookie opt-out control in Settings because none is needed");
    /* Appended, not substituted: the superseded sentence is still the prefix. */
    const superseded = LEGAL_DOCS.find((d) => d.id === "cookies")!.summary;
    expect(doc.summary.startsWith(superseded)).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §D — NO BANNER, NO SECOND STORE, NO BUNDLED MARKETING. Read from the code.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 218 §D — the decision not to build a banner, verified behaviourally", () => {
  it("D0: mounting the real public site sets NO consent cookie and shows NO consent banner", () => {
    /* Read the environment, not a label. If a banner had been built, this is
     * where it would appear, and if a consent cookie were written on first visit,
     * this is where it would be written. */
    const before = document.cookie;
    const { container } = mountRealPublicSite();
    expect(document.cookie).toBe(before);
    expect(document.cookie).not.toMatch(/consent/i);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/accept all cookies/i);
    expect(text).not.toMatch(/reject all cookies/i);
    expect(text).not.toMatch(/cookie settings/i);
    expect(text).not.toMatch(/manage cookies/i);
    /* And nothing was written to storage by simply arriving. */
    expect(window.sessionStorage.length).toBe(0);
  });

  it("D1: wave 218 created NO second consent store and NO second corpus", () => {
    /* R171.1. The canonical ledger already exists and already admits `cookies`;
     * nothing was built beside it, because §4 of the preflight concluded consent
     * is not required for what the platform actually sets. */
    const store = readText("server/legalConsentStore.ts");
    expect(store).toContain('"cookies"');
    /* One consent table name, in the one store. */
    expect(readText("server/lib/auditChainVerifier.ts")).toContain('"legal_consents"');
    /* And the corpus is still DERIVED from the one source, by the one transform. */
    const v2 = readText("client/src/lib/legalDocsV2.ts");
    expect(v2).toContain("export const ADOPTED_LEGAL_DOCS: LegalDoc[] = LEGAL_DOCS.map(adoptDoc);");
    expect((v2.match(/function adoptText/g) ?? []).length).toBe(1);
  });

  it("D2: marketing consent is NOT bundled into anything, because no marketing tick exists", () => {
    /* The rule is that one tick may never cover both cookie and marketing
     * consent. The strongest available proof is that no caller of the consent
     * checkbox names a marketing document at all, and the closed vocabulary the
     * server accepts contains none. */
    for (const rel of [
      "client/src/pages/auth/Signup.tsx",
      "client/src/pages/founder/Subscribe.tsx",
      "client/src/pages/founder/Company.tsx",
    ]) {
      const src = readText(rel);
      expect(src).not.toMatch(/docs=\{\[[^\]]*marketing/i);
    }
    const store = readText("server/legalConsentStore.ts");
    expect(store).not.toMatch(/"marketing[-_a-z]*"/i);
    /* And the served clause says so in words a reader can rely on. */
    const { container } = render(<AdoptedLegalDocumentPage docId="cookies" />);
    expect(container.textContent ?? "").toContain(
      "no single tick box on this platform covers both",
    );
  });

  it("D3: no schema change was made, in EITHER schema path", () => {
    /* Migration 0223 was reserved and deliberately not used. Both migration
     * directories are checked, because a change mirrored into only one of them is
     * a known failure shape on this tree. */
    for (const dir of ["migrations", "server/db/migrations"]) {
      const entries = readdirSync(path.join(REPO, dir));
      expect(entries.filter((e) => e.startsWith("0223")).length, `${dir} gained a 0223 migration`).toBe(0);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §E — NOTHING ELSE MOVED. Read off disk, by hash.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 218 §E — the files that must not change, did not change", () => {
  it("E0: client/src/lib/legalDocs.ts still hashes to wave 210's pin", () => {
    expect(createHash("sha256").update(readBytes("client/src/lib/legalDocs.ts")).digest("hex"))
      .toBe(LEGALDOCS_PINNED_SHA);
  });

  it("E1: the superseded corpus is unchanged in content, and still contains the false sentences", () => {
    /* R195.5: nothing is deleted. The evidence of what users previously agreed to
     * must remain retrievable in full. */
    const old = LEGAL_DOCS.find((d) => d.id === "cookies")!;
    expect(old.body).toContain("you will be presented with a cookie consent banner");
    expect(old.body).toContain("Google Analytics");
    expect(old.lastUpdated).toBe("17 March 2026");
  });

  it("E2: the five documents, same ids, same order — nothing added or dropped by this wave", () => {
    expect(ADOPTED_LEGAL_DOCS.map((d) => d.id)).toEqual(LEGAL_DOCS.map((d) => d.id));
    expect(ADOPTED_LEGAL_DOCS.length).toBe(5);
  });

  it("E3: wave 210's prefix property still holds for EVERY document, including cookies", () => {
    /* The property this wave had to respect: the superseded body, with only the
     * party-name and date substitutions, is a PREFIX of the served body. An
     * appended clause keeps it; a substituted sentence would break it. Asserted
     * here as well as in wave 210's own suite, so that a reader of THIS wave can
     * see the constraint it was built under. */
    for (let i = 0; i < LEGAL_DOCS.length; i++) {
      const expectedPrefix = (LEGAL_DOCS[i].body ?? "")
        .split("Blueprint Catalyst Limited").join("BluePrint Catalyst Limited")
        .split("17 March 2026").join(ADOPTED_LEGAL_CORPUS_DATE_LABEL);
      expect(
        ADOPTED_LEGAL_DOCS[i].body.startsWith(expectedPrefix),
        `wave 210's prefix proof broken for ${LEGAL_DOCS[i].id}`,
      ).toBe(true);
    }
  });

  it("E4: PublicLegalStrip is untouched and still carries wave 210's working Terms link", () => {
    const strip = readText("client/src/components/PublicLegalStrip.tsx");
    expect(strip).toContain('"/terms-of-service"');
    /* Not duplicated: exactly one strip component exists. */
    expect((strip.match(/export function PublicLegalStrip/g) ?? []).length).toBe(1);
  });

  it("E5: NewFooter.jsx is dead code and was not touched", () => {
    const home = readText("client/src/pages/home/Home.tsx");
    expect(home).not.toContain("NewFooter");
    /* Its own defect is still there, and is deliberately not this wave's. */
    expect(readText("client/src/components/home3compo/NewFooter.jsx"))
      .toContain('<a href="/privacy-policy">LEGAL & Terms of Use</a>');
  });
});
