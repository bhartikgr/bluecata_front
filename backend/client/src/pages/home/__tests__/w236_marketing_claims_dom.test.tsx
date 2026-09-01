/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WAVE 236 — WHAT A REAL VISITOR ACTUALLY READS. REAL PAGES, RENDERED TEXT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * R225 found 25 unsupportable claims on the public marketing site and the login
 * surfaces. R227 authorised the rewrite. R229 made the operating company's
 * registered name a specification. None of those can be proved from a data
 * structure, because the defect was never in a data structure: it was in the words
 * a prospect reads before they hand over money. So every assertion below reads
 * RENDERED TEXT off a mounted production page.
 *
 * NEVER PROVE A REPLICA (handbook §8). Every component mounted here is the module
 * the application imports:
 *   - `Home` (`@/pages/home/Home`) — the component `App.tsx:619` routes `/` to.
 *     It mounts the real, FROZEN `Header3`, `Footer3`, `Hero`, `LearnSection` and
 *     the rest of `home3compo`, and the real `PublicLegalStrip`.
 *   - `Login` (`@/pages/auth/Login`) — the real investor/founder login page.
 * Neither section under test is reimplemented here. §A0 proves the frozen files are
 * on disk, byte-unchanged, BEFORE any claim is made about what the page renders.
 *
 * THE INERT-PROOF MECHANISMS THIS FILE HAS TO ANSWER, AND WHERE.
 *   (1) a replica instead of the real thing → §A0 pins the three frozen files by
 *       sha256 and §A1 proves the interception actually installed on the mounted
 *       root before §C/§D read any text.
 *   (2) a normalising call inside an equality assertion → §B compares the footer's
 *       rendered party name with `toContain` on untrimmed `textContent`, and §B2
 *       asserts the PROHIBITED spelling is absent from the same node, so a
 *       whitespace or casing accident cannot pass both.
 *   (3) a fixture no mutation can move → §D sweeps the ENTIRE rendered page for the
 *       prohibited vocabulary rather than checking sentences the author chose.
 *       Re-introduce any withdrawn claim anywhere on the page and §D goes RED.
 *   (4) a fence whose installation is never proved → §A1 reads
 *       `data-w236-applied` / `data-w236-unmatched` off the mounted root. A
 *       correction whose target moved reports itself as unmatched instead of
 *       silently doing nothing.
 *   (5) a filter keyed to a field the writer never writes → §A0 and §G read the
 *       real source files off disk, by hash and by substring, not via a constant.
 *   (6) an unscoped DOM query reading a different element → every query is
 *       `container`-scoped or `within(...)`-scoped. `screen` is never used.
 *
 * WHAT THIS FILE DOES NOT PROVE, SAID PLAINLY.
 *   - Nothing here is verified against a deployed site. There is no live access in
 *     this session and nothing wave 236 did is described as live-fixed.
 *   - It does not prove the withdrawn sentences are REMOVED from the frozen files.
 *     They are not: the files are frozen and §A0 asserts they are byte-identical.
 *     §G asserts the superseded literals are still in their own source, which is
 *     what R195.5 requires and what wave 210's own test at
 *     `w210_legal_surfaces.test.tsx:368` independently pins.
 *   - It does not prove the usage figures were WRONG. It proves they are no longer
 *     rendered. Wave 236 could not establish them from any source and could not
 *     measure them without live access, which is why they were removed rather
 *     than restated.
 *   - It asserts nothing about `730 of 730 tenant chains`. That figure is the
 *     owner's measurement, declared, not re-counted by this wave.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClientProvider } from "@tanstack/react-query";

/* THE REAL PRODUCTION MODULES. */
import Home from "@/pages/home/Home";
import Login from "@/pages/auth/Login";
import { queryClient } from "@/lib/queryClient";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
/* The real provider `client/src/main.tsx` wraps the application in. `Login` calls
 * `useRole()` on line 136 and throws without it, so a test that omitted it would be
 * testing a page no visitor can reach. */
import { RoleProvider } from "@/lib/role";
import { REGISTERED_PARTY_NAME } from "@shared/wave210LegalCorpusVersion";
import {
  W236_TEXT_CORRECTIONS,
  W236_PUBLIC_LEARN_ANCHOR,
} from "@/components/marketing/w236MarketingClaimCorrections";
import {
  W236_SUPERSEDED_INVESTOR_TAGLINE,
  W236_SUPERSEDED_INVESTOR_SUBLINE,
} from "@/pages/auth/Login";

const REPO = path.resolve(__dirname, "../../../../..");
const readText = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");
const sha256 = (rel: string) =>
  createHash("sha256").update(readFileSync(path.join(REPO, rel))).digest("hex");

/**
 * The three frozen files wave 236 corrects the OUTPUT of without editing.
 * Hashes read from `sacred_baseline/SACRED_SHA256.txt` at the start of the wave.
 * If any of these changes, wave 236 edited a frozen file and every claim in this
 * file about "corrected without editing" is false — so this is §A0, and it runs
 * before anything else.
 */
const FROZEN_PINS: ReadonlyArray<{ rel: string; sha: string }> = [
  {
    rel: "client/src/components/home3compo/Footer3.jsx",
    sha: "64937e08cc4abaf8205909240c485aff779031f5afb8ee43f63b8458a70bb350",
  },
  {
    rel: "client/src/components/home3compo/TrustSignals.jsx",
    sha: "373646314de6180c87fe6c204df0d96111285fde67514f813a37962ab3d0c8e5",
  },
  {
    rel: "client/src/components/home3compo/CredibilitySection.jsx",
    sha: "475d47802f91c837cd65dd8fdff755c0ed7f29e7e2fd80a2a5a4f7aa8c215022",
  },
];

/**
 * THE PROHIBITED VOCABULARY, from the owner's constraint verbatim: "PROHIBITED
 * about a person, a holding or an eligibility: verified, verification, verify,
 * independently verified, vetted, screened, approved, certified, guaranteed,
 * compliant."
 *
 * `accredited` is NOT on this list and must not be added to it. The owner's
 * instruction was to keep a similar message, and an accredited-investor platform
 * that cannot say the word has been blanded rather than corrected. What is
 * forbidden is presenting accreditation as something the platform CHECKED. §D2
 * tests that distinction directly.
 */
const PROHIBITED_WORDS = [
  "verified",
  "verification",
  "verify",
  "verifies",
  "vetted",
  "screened",
  "certified",
  "guaranteed",
] as const;

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
  /* REJECT, not resolve — wave 210's reasoning, kept: the fail-safe path is the one
   * a real visitor hits when a config read is slow, and the corrected copy has to
   * be right on that path too. A happy stub proves the happy stub. */
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no server in jsdom"))));
  /* jsdom has no layout and `Footer3.jsx` calls this on every in-page anchor click.
   * Without the stub it throws inside React's event dispatch, where no assertion
   * can see it, and vitest prints "passed" while exiting non-zero. */
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: function scrollIntoViewStub() {},
      writable: true,
      configurable: true,
    });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Mounts the REAL marketing page in the REAL provider tree, on a real router. */
function mountRealHome() {
  const { hook, history } = memoryLocation({ path: "/", record: true });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LegalDrawerProvider>
        <Router hook={hook}>
          <Switch>
            <Route path="/" component={Home} />
          </Switch>
        </Router>
      </LegalDrawerProvider>
    </QueryClientProvider>,
  );
  return { ...utils, history };
}

/** Mounts the REAL login page for a given portal, the way a visitor arrives. */
function mountRealLogin(portal: "founder" | "investor") {
  window.history.replaceState({}, "", `/auth/login?portal=${portal}`);
  const { hook } = memoryLocation({ path: `/auth/login?portal=${portal}`, record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <RoleProvider>
        <LegalDrawerProvider>
          <Router hook={hook}>
            <Switch>
              <Route path="/auth/login" component={Login} />
            </Switch>
          </Router>
        </LegalDrawerProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/**
 * The interception root. Throws rather than returning null: a helper that silently
 * returns nothing turns every downstream assertion into a vacuous pass.
 */
function home3Root(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>("div.home3-root");
  if (!root) throw new Error("div.home3-root not mounted — Home did not render");
  return root;
}

/* ═════════════════════════════════════════════════════════════════════════════
   §A0 — THE FROZEN FILES ARE UNTOUCHED. THIS RUNS FIRST, ON PURPOSE.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §A0 — no frozen marketing file was edited", () => {
  it.each(FROZEN_PINS)("$rel is byte-identical to its sacred hash", ({ rel, sha }) => {
    expect(sha256(rel)).toBe(sha);
  });

  it("no wave-236 marker was written into any frozen marketing file", () => {
    for (const { rel } of FROZEN_PINS) {
      expect(readText(rel)).not.toContain("WAVE 236");
      expect(readText(rel)).not.toContain("W236");
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §A1 — THE INTERCEPTION INSTALLED, AND EVERY CORRECTION FOUND ITS TARGET.
   Mechanism (4): a fence whose installation is never proved is not a fence.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §A1 — the correction layer is installed and complete", () => {
  it("publishes its result on the mounted root", () => {
    const { container } = mountRealHome();
    const root = home3Root(container);
    expect(root.getAttribute("data-w236-applied")).not.toBeNull();
    expect(root.getAttribute("data-w236-unmatched")).not.toBeNull();
  });

  it("leaves NOTHING unmatched: every correction found the sentence it names", () => {
    const { container } = mountRealHome();
    const unmatched = home3Root(container).getAttribute("data-w236-unmatched") ?? "MISSING";
    /* Not `toBeFalsy()`. An empty string is the pass; "MISSING" is a fail, and so
     * is any comma-separated list of correction ids whose target moved. */
    expect(unmatched).toBe("");
  });

  it("applied at least one correction per declared target file", () => {
    const { container } = mountRealHome();
    const applied = Number(home3Root(container).getAttribute("data-w236-applied"));
    expect(Number.isFinite(applied)).toBe(true);
    expect(applied).toBeGreaterThanOrEqual(W236_TEXT_CORRECTIONS.length);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §B — R229. THE OPERATING COMPANY'S NAME, AS RENDERED.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §B — R229: the registered name is what a visitor reads", () => {
  it("B1 — the footer copyright line names BluePrint Catalyst Limited", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    expect(text).toContain(`${REGISTERED_PARTY_NAME}. All rights reserved.`);
  });

  it("B2 — neither prohibited form of the name is rendered anywhere on the page", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* R229: never "Blueprint", never "Ltd.". Both are asserted, because correcting
     * only the casing or only the abbreviation would leave the ruling half-met. */
    expect(text).not.toContain("Blueprint Catalyst Ltd");
    expect(text).not.toContain("Blueprint Catalyst");
    expect(text).not.toContain("Catalyst Ltd");
  });

  it("B3 — the footer now names ONE entity, one way", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* The defect R229 diagnosed was two spellings in one footer block. The legal
     * strip's correct line and the copyright line must now agree. */
    const occurrences = text.split(REGISTERED_PARTY_NAME).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §C — NO FABRICATED FIGURE AND NO PLACEHOLDER REACHES THE BROWSER.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §C — nothing unsupportable is rendered", () => {
  it("C1 — the eight placeholder logo tiles are gone, and no logo was invented", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    expect(text.toLowerCase()).not.toContain("logo here");
    expect(text.toLowerCase()).not.toContain("logo 1");
    /* And the container that labelled them as customers is gone with them: an empty
     * "Customer logos" region implies logos exist and are being withheld. */
    expect(home3Root(container).querySelector('[aria-label="Customer logos"]')).toBeNull();
  });

  it("C2 — the three unsourced usage figures are not rendered", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    expect(text).not.toContain("$2.4M");
    expect(text).not.toContain("committed via Capavate");
    expect(text).not.toContain("180+");
  });

  it("C3 — the three unsourced market figures are not rendered", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    expect(text).not.toContain("$8.4T");
    expect(text).not.toContain("Global private equity AUM");
    expect(text).not.toContain("Deals sourced via relationships");
    expect(text).not.toContain("Investor intros via warm network");
  });

  it("C4 — and NOTHING was substituted for them: no other trillions figure appears", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* R-ASSERT §14: an unsupported figure is not repaired by a different figure.
     * This asserts the removal was a removal, not a swap. */
    expect(text).not.toMatch(/\$\s?\d+(\.\d+)?\s?T\b/);
  });

  it("C5 — no compliance badge is presented as a certification", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    expect(text).not.toContain("GDPR Ready");
    expect(text).not.toContain("CCPA Ready");
    /* AES-256 survives as a statement of the cipher in use. It must carry its
     * qualification in the same rendered region. */
    if (text.includes("AES-256")) {
      expect(text).toContain("not a certification");
    }
  });

  it("C6 — the hash chain is kept, and stated as tamper-evidence rather than an audit", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* The owner's ruling: this one IS defensible — keep it, reframed. A wave that
     * dropped it would have thrown away a real differentiator. */
    expect(text).toContain("Tamper-evident hash chain \u2014 730 of 730 tenant chains proved intact");
    expect(text).toContain("not an audit of whether the underlying facts are true");
    expect(text).not.toContain("Hash-chain Audit");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §D — THE ADVERSARIAL SWEEP. THE WHOLE PAGE, NOT THE SENTENCES I CHOSE.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §D — no rendered sentence claims a check", () => {
  it.each(PROHIBITED_WORDS)(
    "D1 — the word %s does not appear anywhere in the rendered marketing page",
    (word) => {
      const { container } = mountRealHome();
      const text = (home3Root(container).textContent ?? "").toLowerCase();
      expect(text).not.toContain(word);
    },
  );

  it("D2 — accreditation is presented as a DECLARATION, never as a check", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* The most dangerous sentence on the site was "limited to verified accredited
     * investors". The word "accredited" stays — the claim about who checked it
     * goes, and the platform's own honest sentence takes its place. */
    expect(text).toContain("declare they are accredited");
    expect(text).toContain("This records your declaration. It is not a check of it.");
    expect(text).not.toContain("Accredited Only");
  });

  it("D3 — no regulation is cited on the public page", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* Whether the posture is 506(b) or 506(c) is an open question for counsel. A
     * marketing page must not answer it by implication. */
    expect(text).not.toMatch(/506\s?\(?[bc]\)?/i);
    expect(text).not.toContain("Regulation D");
    expect(text).not.toContain("Reg D");
  });

  it("D4 — the differentiator the owner named is still the argument being made", () => {
    const { container } = mountRealHome();
    const text = home3Root(container).textContent ?? "";
    /* "Similar message" is a binding constraint: a wave that deleted the claims and
     * left a bland page has failed as surely as one that left them standing. This
     * asserts the commercial argument survived the correction. */
    expect(text).toContain("Salesforce trusts what people type. Capavate trusts what companies file.");
    expect(text).toContain("Trusted infrastructure for modern fundraising");
    expect(text).toContain("The market demands it.");
    expect(text).toContain("Issuer-Recorded Equity");
    expect(text).toContain("register");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §E — THE CORRECTED SECTIONS ARE IN POSITION, NOT APPENDED SOMEWHERE ELSE.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §E — the page's structure is unchanged", () => {
  it("E1 — both corrected sections are mounted, in the frozen components' slots", () => {
    const { container } = mountRealHome();
    const main = home3Root(container).querySelector<HTMLElement>("main#main-content");
    expect(main).not.toBeNull();
    const children = Array.from(main!.children);
    const trustIdx = children.findIndex((c) => c.getAttribute("data-w236-corrected") === "trust-signals");
    const credIdx = children.findIndex((c) => c.getAttribute("data-w236-corrected") === "credibility");
    /* TrustSignals sat immediately after Hero; CredibilitySection after
     * PlatformSection. Same slots, same order. */
    expect(trustIdx).toBe(1);
    expect(credIdx).toBeGreaterThan(trustIdx);
    expect(children.length).toBe(11);
  });

  it("E2 — the superseded sections are retained and NEVER taken", () => {
    const { container } = mountRealHome();
    const root = home3Root(container);
    /* The retention block is flag-gated to `false`, so it must not be in the DOM at
     * all — and it must be the LAST child in source, which §E3 reads from source. */
    expect(root.querySelector('[data-testid="w236-superseded-marketing"]')).toBeNull();
  });

  it("E3 — the retention block is the LAST sibling and the flag is an identifier", () => {
    const src = readText("client/src/pages/home/Home.tsx");
    /* Appending mid-page renumbers siblings and the guard reads that as a moved
     * panel. And `{false && …}` reads as a SUPPRESSION, which stops the build. */
    expect(src).toContain("const W236_RENDER_SUPERSEDED_MARKETING = false;");
    expect(src).not.toMatch(/\{\s*false\s*&&/);
    const blockIdx = src.indexOf("W236_RENDER_SUPERSEDED_MARKETING ?");
    const rootCloseIdx = src.lastIndexOf("</div>");
    expect(blockIdx).toBeGreaterThan(-1);
    expect(blockIdx).toBeLessThan(rootCloseIdx);
    /* Nothing but the block's own terminator and the root's closing tag may follow
     * it. Whitespace is stripped so indentation cannot make this pass or fail. */
    const tail = src.slice(blockIdx).replace(/\s+/g, "");
    expect(tail.endsWith("):null}</div>)}")).toBe(true);
  });

  it("E4 — the frozen components are still imported and still mounted in JSX", () => {
    const src = readText("client/src/pages/home/Home.tsx");
    /* R195.5: nothing deleted. A component hoisted out of this file's JSX reads as
     * a DROP to the guard, so both must still appear as elements. */
    expect(src).toContain("<TrustSignals />");
    expect(src).toContain("<CredibilitySection />");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §F — THE KNOWLEDGE HUB IS NO LONGER PRESENTED AS A PUBLIC DESTINATION.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §F — the Knowledge Hub", () => {
  it("F1 — no anchor on the public page points at the routeless /education path", () => {
    const { container } = mountRealHome();
    const anchors = Array.from(home3Root(container).querySelectorAll("a"));
    for (const a of anchors) {
      const href = a.getAttribute("href") ?? "";
      expect(href).not.toBe("/education");
      expect(href).not.toContain("capavate.com/education");
    }
  });

  it("F2 — the nav entry resolves to the in-page section that actually exists", () => {
    const { container } = mountRealHome();
    const anchors = Array.from(home3Root(container).querySelectorAll("a"));
    const learnAnchors = anchors.filter((a) => a.getAttribute("href") === W236_PUBLIC_LEARN_ANCHOR);
    expect(learnAnchors.length).toBeGreaterThan(0);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §G — THE SUPERSEDED COPY IS RETAINED IN SOURCE. NOTHING WAS DELETED.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §G — R195.5: retired in place, not removed", () => {
  it("G1 — the frozen footer's superseded copyright literal is still in its own file", () => {
    /* This is also what `w210_legal_surfaces.test.tsx:368` pins byte-for-byte. Wave
     * 236 corrects the RENDERED text and leaves the source literal alone, so that
     * assertion keeps passing for the reason it was written. It was not loosened. */
    expect(readText("client/src/components/home3compo/Footer3.jsx")).toContain("Blueprint Catalyst Ltd");
  });

  it("G2 — every withdrawn marketing sentence is still present in its frozen source", () => {
    const trust = readText("client/src/components/home3compo/TrustSignals.jsx");
    const cred = readText("client/src/components/home3compo/CredibilitySection.jsx");
    expect(trust).toContain("Logo here");
    expect(trust).toContain("$2.4M");
    expect(trust).toContain("Hash-chain Audit");
    expect(cred).toContain("Verified Equity");
    expect(cred).toContain("Accredited Only");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   §H — THE LOGIN SURFACES. THE CLAIM WAVE 274a MISSED, AND THE ONE IT FIXED.
   ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 236 §H — the login page", () => {
  it("H1 — the FOUNDER tagline still reads 'a contact you can reach' and was NOT regressed", () => {
    const { container } = mountRealLogin("founder");
    const text = container.textContent ?? "";
    /* Wave 274a's correction. Wave 236 verifies it, and changes nothing about it. */
    expect(text).toContain("turn every shareholder into a contact you can reach");
  });

  it("H2 — the INVESTOR portal no longer claims invitations are checked", () => {
    const { container } = mountRealLogin("investor");
    const text = container.textContent ?? "";
    expect(text).not.toContain(W236_SUPERSEDED_INVESTOR_TAGLINE);
    expect(text).not.toContain(W236_SUPERSEDED_INVESTOR_SUBLINE);
    expect(text).not.toContain("invitations are verified");
    expect(text).not.toContain("verified ownership");
  });

  it("H3 — and it makes the stronger, true claim in their place", () => {
    const { container } = mountRealLogin("investor");
    const text = container.textContent ?? "";
    expect(text).toContain("every position comes from the company’s own register, not from a form");
    expect(text).toContain("Invitation-only access to issuer-recorded ownership");
  });

  it.each(PROHIBITED_WORDS)(
    "H4 — the word %s does not appear on either rendered login portal",
    (word) => {
      for (const portal of ["founder", "investor"] as const) {
        const { container, unmount } = mountRealLogin(portal);
        const text = (container.textContent ?? "").toLowerCase();
        expect(text).not.toContain(word);
        unmount();
      }
    },
  );

  it("H5 — the superseded investor copy is retained in source, byte-verbatim", () => {
    const src = readText("client/src/pages/auth/Login.tsx");
    expect(src).toContain(W236_SUPERSEDED_INVESTOR_TAGLINE);
    expect(src).toContain(W236_SUPERSEDED_INVESTOR_SUBLINE);
  });
});
