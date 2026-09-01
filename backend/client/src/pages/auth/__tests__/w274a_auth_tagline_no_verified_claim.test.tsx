/* ════════════════════════════════════════════════════════════════════════════
   WAVE 274a · R221.1 — THE CLASS A CLAIM ON THE HIGHEST-TRAFFIC PAGE.
   ════════════════════════════════════════════════════════════════════════════
   The finding: the partner login page's brand panel read

       "Run your cap table, structure your rounds, and turn every shareholder
        into a VERIFIED contact — in one place."

   while the platform's own attestation panels state, in terms, that it performs
   no such check ("Capavate does not describe any investor as accredited,
   professional, sophisticated, qualified, verified or screened";  "Capavate does
   not verify this investor's identity, wealth, status, eligibility or source of
   funds"). A claim of a check the platform does not perform is a Class A claim.

   ── WHY THIS TEST MOUNTS SCREENS AND NEVER READS SOURCE ─────────────────────
   The three literals it fences live in MODULE CONSTANTS and in a `tagline=`
   attribute. `scripts/silent-drop-guard/extract-inventory.ts` inventories copy
   only from JSX text nodes and from `COPY_ATTRS`
   ({title,label,placeholder,aria-label,alt,description,emptyMessage,tooltip}) —
   `tagline` is not in that set and module constants are not JSX. So NO gate can
   see a regression here. A source-text assertion would be no better: it would
   pass on a file that no longer renders the panel at all. Every assertion below
   therefore reads `textContent` out of a rendered brand panel.

   ── ANTI-VACUITY ────────────────────────────────────────────────────────────
   "the word is absent" is passed by a screen that renders nothing and by one
   that threw. Each negative assertion is paired, on the SAME mounted screen,
   with a positive assertion that the surviving value proposition renders — the
   full corrected sentence, byte for byte, and the untouched subline.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ── seams a jsdom page cannot have ───────────────────────────────────────── */
/* jsdom has no ResizeObserver; a Radix control on the signup form measures itself
   on mount. A no-op observer stubs a browser API, not anything under test. */
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useLocation: () => ["/partner/login", vi.fn()],
    useSearch: () => "",
    useRoute: () => [false, {}],
    useRouter: () => ({}),
    Redirect: () => null,
    Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
  };
});

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  queryClient: { clear: vi.fn(), invalidateQueries: vi.fn(), setQueryData: vi.fn() },
}));

vi.mock("@/lib/role", () => ({ useRole: () => ({ role: null, setRole: vi.fn() }) }));

/* The corrected sentence, written out once. Any drift in the product now fails
   here rather than reaching a partner's first screen. */
const CORRECTED =
  "Run your cap table, structure your rounds, and turn every shareholder into a contact you can reach — in one place.";
const SUBLINE = "Activate the network already inside your ownership structure.";

/* `Login` and `Signup` open with a real `useQuery` “am I already signed in?”
   probe, so they need a provider. Retries off and a throwing default queryFn are
   deliberate: this test must not depend on a network, and a silent fetch would
   make it slow and flaky rather than wrong. */
function mount(el: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => ({ isAuthed: false }) } },
  });
  return render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
}

/** The rendered brand-panel tagline, as a partner's browser would read it. */
function renderedTagline(): string {
  return screen.getByTestId("auth-shell-tagline").textContent ?? "";
}

afterEach(() => cleanup());

describe("W274a · /partner/login — the page the ruling names", () => {
  it("renders the corrected tagline and never the word 'verified'", async () => {
    const { default: PartnerLogin } = await import("@/pages/partner/PartnerLogin");
    mount(<PartnerLogin />);

    /* Positive first, so the negative below cannot pass vacuously. */
    expect(renderedTagline()).toBe(CORRECTED);
    expect(screen.getByTestId("auth-shell-subtagline").textContent).toBe(SUBLINE);
    /* The page really is the partner one, not some fallback that happens to
       render a shell. */
    expect(screen.getByTestId("auth-shell-product-label").textContent).toBe("Consortium Partner");

    /* THE CLAIM: gone from the tagline, and gone from the whole brand panel. */
    expect(renderedTagline()).not.toMatch(/verified/i);
    expect(screen.getByTestId("auth-shell-brand-panel").textContent ?? "").not.toMatch(/verified/i);
  });
});

describe("W274a · the other two copies of the same sentence", () => {
  it("the founder portal's own brand copy no longer claims a check", async () => {
    const { default: Login } = await import("@/pages/auth/Login");
    mount(<Login />);
    expect(renderedTagline()).toBe(CORRECTED);
    expect(renderedTagline()).not.toMatch(/verified/i);
  });

  it("founder signup no longer claims a check", async () => {
    const { default: Signup } = await import("@/pages/auth/Signup");
    mount(<Signup />);
    expect(renderedTagline()).toBe(CORRECTED);
    expect(renderedTagline()).not.toMatch(/verified/i);
  });
});

describe("W274a · the value proposition was not weakened away", () => {
  it("every clause of the original sentence still renders — only the check claim left", async () => {
    const { default: PartnerLogin } = await import("@/pages/partner/PartnerLogin");
    mount(<PartnerLogin />);
    const t = renderedTagline();
    for (const clause of [
      "Run your cap table",
      "structure your rounds",
      "turn every shareholder into a contact",
      "in one place",
    ]) {
      expect(t).toContain(clause);
    }
    /* The em dash and the closing phrase are unchanged, so the sentence reads as
       the same sentence and not as a rewrite. */
    expect(t.endsWith("— in one place.")).toBe(true);
  });
});
