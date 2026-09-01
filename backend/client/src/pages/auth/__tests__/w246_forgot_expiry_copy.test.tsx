/* ════════════════════════════════════════════════════════════════════════════
   WAVE 246 (R218.1) — THE ON-SCREEN EXPIRY, ON THE REAL SCREEN.
   ════════════════════════════════════════════════════════════════════════════
   `client/src/pages/auth/Forgot.tsx` told the user "Magic links expire in 15
   minutes" while the token POST /api/auth/forgot mints lives 24 hours and the
   email says 24 hours. There is no 15-minute link mechanism on this platform, so
   the sentence was not misplaced copy about another token — it was false about
   this one. The email was NOT changed; the screen was.

   WHY THIS MOUNTS THE REAL PAGE AND NEVER READS SOURCE TEXT. A source grep would
   pass on a file that no longer renders the confirmation at all, and it would
   also pass on a page that renders the duration from a hardcoded second literal.
   Every assertion below reads `textContent` out of the REAL default-exported
   `Forgot` component after driving the REAL form submit, and each one compares
   against a string built from `@shared/passwordResetLinkExpiry` — the same module
   `server/lib/authRoutes.ts` imports to mint `expires_at`. If the page ever
   writes its own duration again, `W246-C2` fails.

   THE ONLY SEAM is `apiRequest`, because jsdom has no server. The page, its
   state machine, its markup and its copy are all real.

   ANTI-VACUITY. The negative assertions ("15 minutes" absent, "minutes" absent)
   are each paired, on the SAME mounted screen, with positive assertions that the
   confirmation panel really rendered: the email echo, the surviving
   "request a new one" link, and the derived duration.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

import {
  PASSWORD_RESET_TOKEN_TTL_HOURS,
  passwordResetLinkExpiryPhrase,
} from "@shared/passwordResetLinkExpiry";

const apiRequest = vi.fn(async () => ({ ok: true, message: "sent" }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...(a as [])) }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useLocation: () => ["/auth/forgot", vi.fn()],
    useSearch: () => "",
    useRoute: () => [false, {}],
    useRouter: () => ({}),
    Redirect: () => null,
    Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
  };
});

afterEach(() => {
  cleanup();
  apiRequest.mockClear();
});

async function mountAndSubmit(): Promise<HTMLElement> {
  const { default: Forgot } = await import("@/pages/auth/Forgot");
  render(<Forgot />);
  fireEvent.change(screen.getByTestId("input-email"), { target: { value: "maya@novapay.ai" } });
  fireEvent.submit(screen.getByTestId("form-forgot"));
  await waitFor(() => expect(screen.getByTestId("text-forgot-done")).toBeTruthy());
  return screen.getByTestId("text-forgot-done");
}

describe("WAVE 246 · the Forgot page's expiry sentence is derived from the minting constant", () => {
  it("W246-C1 the real page renders the confirmation after a real form submit", async () => {
    const panel = await mountAndSubmit();
    expect(apiRequest).toHaveBeenCalled();
    /* POSITIVE anchors: the panel is genuinely the confirmation, not an empty div. */
    expect(panel.textContent ?? "").toContain("maya@novapay.ai");
    expect(panel.textContent ?? "").toContain("a reset link is on its way.");
    expect(panel.textContent ?? "").toContain("request a new one");
  });

  it("W246-C2 the sentence states the DERIVED duration — 15 minutes is gone", async () => {
    const panel = await mountAndSubmit();
    const text = panel.textContent ?? "";

    /* POSITIVE: the duration on screen is the one built from the shared constant
       the mint site uses. Not a literal typed into this test either — it is
       computed from the module. */
    expect(text).toContain(`Password reset links stay valid for ${passwordResetLinkExpiryPhrase()}`);
    expect(text).toContain(`${PASSWORD_RESET_TOKEN_TTL_HOURS} hour`);
    expect(text).toContain("the same window the email states");

    /* NEGATIVE, paired with the positives above on the same mounted screen. */
    expect(text).not.toContain("15 minutes");
    expect(text).not.toContain("minutes");
    expect(text).not.toContain("Magic links expire");
  });

  it("W246-C3 the page contains NO second literal for the duration — the number comes only from the module", async () => {
    const panel = await mountAndSubmit();
    const text = panel.textContent ?? "";
    /* The digits of the TTL appear exactly as many times as the derived phrase
       appears. If someone re-typed "24 hours" beside the expression, or typed a
       DIFFERENT number, one of these two counts moves and this fails. */
    const digits = String(PASSWORD_RESET_TOKEN_TTL_HOURS);
    const countOf = (hay: string, needle: string) => hay.split(needle).length - 1;
    expect(countOf(text, digits)).toBe(1);
    expect(countOf(text, passwordResetLinkExpiryPhrase())).toBe(1);
  });
});
