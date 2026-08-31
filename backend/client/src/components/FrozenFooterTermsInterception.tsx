/**
 * WAVE 218 — CLICK INTERCEPTION FOR THE FROZEN MARKETING FOOTER'S "Terms" LINK.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE ASSUMING THE FOOTER WAS FIXED IN PLACE. IT WAS NOT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `client/src/components/home3compo/Footer3.jsx:209` reads
 *
 *     <a href="https://capavate.com/privacy-policy">Terms</a>
 *
 * so a visitor who clicks "Terms" in the public footer is served the Privacy
 * Policy. `/terms-of-service` exists and is public (`client/src/App.tsx:626` →
 * `LegalTermsPage`), so the destination was never missing — only the link was
 * wrong. The anchor immediately above it, at `:204`, points at the same URL and
 * is labelled "Privacy Policy"; that one is CORRECT and must keep working.
 *
 * WHY IT IS NOT FIXED AT SOURCE. `Footer3.jsx` is a BASE entry in the enforced
 * 48-entry sacred list (sha
 * `64937e08cc4abaf8205909240c485aff779031f5afb8ee43f63b8458a70bb350`). Editing it
 * fails `npm run sacred`, and a tenth waiver is not available to be sought. The
 * correction is therefore made from the non-sacred layer that mounts it —
 * handbook §2.4, and exactly the mechanism wave 210 used for the entity name in
 * this same file.
 *
 * WHAT WAVE 210 ALREADY DID, AND WHY THIS IS NOT A SECOND MECHANISM (R171.1).
 * Wave 210 built `client/src/components/PublicLegalStrip.tsx`, appended beneath
 * the frozen footer from `client/src/pages/home/Home.tsx`. It added the first
 * working public anchor to `/terms-of-service` and the corrected party name, and
 * its own header records that the frozen footer's mislabelled anchor "is still on
 * the page" and is "reported as unfixed". That strip is not duplicated here and
 * is not modified. This module completes the one thing the strip could not do:
 * make the CLICK on the frozen anchor resolve correctly. Same interception layer,
 * same parent, one remaining gap closed.
 *
 * WHY CAPTURE-PHASE ON THE PARENT AND NOT A DOCUMENT LISTENER. The handler is
 * attached to the element `Home.tsx` already renders (`div.home3-root`) via
 * `onClickCapture`. That scopes it to the marketing tree: nothing on any
 * authenticated page, any login page or any other route can reach it. A
 * `document`-level listener would have been global, and an unscoped handler that
 * reads or intercepts a different element than intended is one of the six known
 * inert-proof mechanisms — mechanism (6). Scoping it to the mounting parent is
 * both narrower and the thing the tests can actually pin.
 *
 * WHY THE MATCH IS THIS NARROW, AND WHAT IT MUST NOT CATCH. `Footer3.jsx`
 * contains NINETEEN anchors, including `/partner/login`, `/admin/login`,
 * `/apply/consortium`, the investor and founder login links, the education link
 * and six in-page `#` anchors. Swallowing any of them would be far worse than the
 * defect being fixed: it would break navigation on the public front door. So the
 * predicate requires BOTH
 *   (a) the anchor's `href` attribute is exactly the mislabelled target, and
 *   (b) the anchor's visible label is exactly "Terms",
 * which is true of exactly one anchor in the file and false of the Privacy Policy
 * anchor that shares its href. Anything else is left completely alone — the
 * handler returns without calling `preventDefault`, so the browser's own
 * behaviour proceeds untouched.
 *
 * WHY THE LABEL IS COMPARED AFTER TRIMMING. JSX emits the anchor's text with the
 * surrounding source indentation, so the raw `textContent` of a multi-line anchor
 * is not the label. Trimming here is a DOM label match, not an evidence
 * comparison: nothing about what a user agreed to is being decided by it. Where
 * this wave compares stored bytes to rendered bytes it does so with no
 * normalising call at all, for the reason R200.1 records — a `.trim()` inside an
 * equality assertion erases the difference the assertion exists to detect. This
 * is not that comparison.
 *
 * WHAT IS NOT FIXED, STATED PLAINLY. The frozen anchor still carries the wrong
 * `href` in its markup. A visitor who copies the link address, opens it in a new
 * tab from the context menu, or has JavaScript disabled still reaches the Privacy
 * Policy. Those paths never reach a React handler and cannot be corrected from
 * outside the frozen file. They are reported as unfixed rather than counted as
 * done, and closing them needs an owner-ratified change to a sacred file.
 *
 * NOTHING IS DELETED (R195.5) AND NO LITERAL IS REPLACED (R143.1). The frozen
 * anchor keeps its text and its href. No JSX literal is added to or removed from
 * any file by this interception, no element is inserted mid-parent, and no
 * existing copy is hoisted out of JSX into a constant.
 */
import { useCallback } from "react";
import { useLocation } from "wouter";

/**
 * The exact `href` the frozen footer's mislabelled anchor carries, byte-for-byte
 * as it appears at `Footer3.jsx:209`. A literal, not a pattern: if the frozen
 * file is ever re-baselined and this string stops matching, the interception
 * stops firing and the wave-218 test goes RED, which is the correct failure —
 * silently intercepting some other anchor would be worse.
 */
export const FROZEN_FOOTER_MISLABELLED_TERMS_HREF = "https://capavate.com/privacy-policy";

/** The visible label of that anchor, exactly as rendered. */
export const FROZEN_FOOTER_TERMS_LABEL = "Terms";

/** Where a click on it must actually go. Public, and already mounted. */
export const CORRECT_TERMS_ROUTE = "/terms-of-service";

/**
 * True only for the one mislabelled anchor. Exported so a test can attack the
 * predicate directly with every other anchor in the frozen footer.
 */
export function isFrozenFooterMislabelledTermsLink(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName !== "A") return false;
  if (el.getAttribute("href") !== FROZEN_FOOTER_MISLABELLED_TERMS_HREF) return false;
  return (el.textContent ?? "").trim() === FROZEN_FOOTER_TERMS_LABEL;
}

/**
 * Returns the `onClickCapture` handler for the element that mounts the frozen
 * footer. Requires a wouter `Router` ancestor, which the real application
 * provides at `client/src/App.tsx`.
 */
export function useFrozenFooterTermsInterception(): (event: React.MouseEvent<HTMLElement>) => void {
  const [, navigate] = useLocation();
  return useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as Element | null;
      /* `closest` because the click may land on a text node inside the anchor. */
      const anchor = target && typeof target.closest === "function" ? target.closest("a") : null;
      if (!isFrozenFooterMislabelledTermsLink(anchor)) return;
      event.preventDefault();
      navigate(CORRECT_TERMS_ROUTE);
    },
    [navigate],
  );
}
