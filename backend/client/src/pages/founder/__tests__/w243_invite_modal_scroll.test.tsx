/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 243 — THE INVITE MODAL SCROLLS, AND EVERY FIELD AND BOTH BUTTONS ARE
 * REACHABLE AT 1280×800, 1024×700 AND 800×350.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS. The defect is pure CSS layout: the
 * dialog had no height bound, so on a short viewport it grew past the window and
 * the Expires-in select, Cancel and Send invitation fell off the bottom with
 * nothing to scroll. **jsdom cannot prove that.** jsdom implements no layout
 * engine: every `getBoundingClientRect()` is zero and no Tailwind utility is
 * ever resolved, so a jsdom test could only assert that a className string is
 * present — which is the "checks the element exists" non-proof the wave brief
 * explicitly rejects.
 *
 * So this file does three things in order, and each stage feeds the next:
 *
 *   STAGE 1 (jsdom) — mount the REAL `RoundDetail` page, click the REAL invite
 *     trigger, and take the dialog's own serialised markup. The markup is
 *     therefore produced by the production component: real Radix `DialogContent`
 *     base classes, real fields, real buttons. Nothing is hand-written.
 *   STAGE 2 (real Tailwind) — compile the project's OWN stylesheet with the
 *     project's OWN `tailwind.config.ts`, so the CSS under test is the CSS the
 *     app ships. If Tailwind did not emit `max-h-[85vh]` or
 *     `grid-rows-[auto_minmax(0,1fr)_auto]`, this stage fails rather than
 *     silently measuring a class that does nothing.
 *   STAGE 3 (real Chromium, via Playwright) — load stage 1's markup with stage
 *     2's stylesheet and MEASURE, at all three viewport sizes: computed
 *     `overflow-y`, real element rectangles, real `scrollHeight` vs
 *     `clientHeight`.
 *
 * HONEST LIMIT, STATED IN THE TEST ITSELF: stage 3's document is synthetic — a
 * bare page hosting the component's real output and the app's real CSS. No HTTP
 * route is involved, because the defect and the fix are entirely CSS. What is
 * NOT synthetic is the markup (the component emitted it) or the stylesheet (the
 * build emitted it). This is written up as a limitation in W243_TESTS.md rather
 * than glossed over.
 *
 * WHAT THIS WAVE MUST NOT HAVE CHANGED — asserted here: every field, every
 * label, the helper texts, and the Expires-in default of 7 days. The fix is
 * className-only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import RoundDetail from "../RoundDetail";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";

const COMPANY_ID = "co_w243";
const ROUND_ID = "rnd_w243";
const REPO = resolve(__dirname, "../../../../..");

/** The three viewport sizes the wave brief names. */
const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x700", width: 1024, height: 700 },
  { name: "800x350", width: 800, height: 350 },
];

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "W243 Co", billing: { plan: "founder_pro" } } },
  }),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useParams: () => ({ id: ROUND_ID }),
    useLocation: () => ["/founder/rounds/" + ROUND_ID, () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

const ROUND = {
  id: ROUND_ID,
  companyId: COMPANY_ID,
  name: "W243 Invite Round",
  type: "seed",
  instrument: "preferred",
  state: "active",
  currency: "USD",
  region: "HK",
  targetAmount: 600000,
  raisedAmount: 0,
  preMoney: 2000000,
  postMoney: 2600000,
  pricePerShare: 0.25,
  fdPreMoneyShares: 8000000,
  sharesAuthorized: 2000000,
  minTicket: 10000,
  openDate: "2026-08-01",
  closeDate: "2026-12-31",
  termsSummary: "Seed priced round, Hong Kong.",
  softCommits: [],
  invitations: [],
  tranches: [],
};

/** Several CRM contacts, so the picker is populated exactly as it would be for a
 *  founder with a real book — a taller dialog is the realistic case. */
const CRM = [
  { id: "c1", name: "Aisha Patel", email: "aisha@northstar.vc", firmName: "Northstar" },
  { id: "c2", name: "Hassan Malik", email: "hassan@meridian.fund", firmName: "Meridian" },
  { id: "c3", name: "Dana Chu", email: "dana@keiretsu.example", firmName: "Keiretsu" },
];

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes(`/api/rounds/${ROUND_ID}/invitations`)) return res(200, []);
    if (u.includes(`/api/rounds/${ROUND_ID}/soft-circles`)) return res(200, []);
    if (u.includes(`/api/rounds/${ROUND_ID}`)) return res(200, { ...ROUND, pipeline: [] });
    if (u.startsWith("/api/rounds?") || u === "/api/rounds") return res(200, [ROUND]);
    if (u.includes("/securities")) return res(200, []);
    if (u.includes("investor-crm")) return res(200, { contacts: CRM });
    if (u.includes("/crm/contacts")) return res(200, CRM);
    if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
    return res(200, {});
  }));
}

function wrap(node: unknown) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          {node as never}
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** STAGE 1 — mount the real page, open the real dialog, hand back the dialog's
 *  own serialised markup. */
async function openRealInviteDialog(): Promise<HTMLElement> {
  wrap(<RoundDetail />);
  const trigger = await waitFor(() => screen.getByTestId("button-invite"), { timeout: 5000 });
  fireEvent.click(trigger);
  await waitFor(() => screen.getByTestId("button-send-invite"), { timeout: 5000 });
  /* Choose "Add new investor" so the three mandatory fields and the three
     optional CRM fields are all rendered — the tallest real state of this
     dialog, and the state the founder was actually in when the defect bit. */
  fireEvent.change(screen.getByTestId("select-invite-source"), { target: { value: "__new__" } });
  await waitFor(() => screen.getByTestId("input-invite-first-name"), { timeout: 5000 });
  const dialog = screen.getByTestId("button-send-invite").closest('[role="dialog"]');
  if (!dialog) throw new Error("no [role=dialog] ancestor — the real dialog did not mount");
  return dialog as HTMLElement;
}

/** Derive the scroll container STRUCTURALLY rather than by a test id: the
 *  deepest ancestor of the fields that does NOT contain the submit button. No
 *  data-testid was added to the page for this — adding one would replace the
 *  element's structural identity key and the silent-drop guard reads that as a
 *  drop. */
function deriveScroller(dialog: HTMLElement): HTMLElement {
  const field = dialog.querySelector('[data-testid="input-invite-note"]');
  const submit = dialog.querySelector('[data-testid="button-send-invite"]');
  if (!field || !submit) throw new Error("dialog is missing the note field or the submit button");
  let node: HTMLElement | null = field.parentElement as HTMLElement | null;
  let last: HTMLElement | null = null;
  while (node && node !== dialog) {
    if (node.contains(submit)) break;
    last = node;
    node = node.parentElement as HTMLElement | null;
  }
  if (!last) throw new Error("could not derive a fields container that excludes the submit button");
  return last;
}

/** STAGE 2 — compile the project's own stylesheet with the project's own config. */
let CSS = "";
let DIALOG_HTML = "";
let SCROLLER_MARK = "";

function buildRealTailwindCss(): string {
  const dir = mkdtempSync(join(tmpdir(), "w243css-"));
  const input = join(dir, "in.css");
  const output = join(dir, "out.css");
  writeFileSync(input, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
  execFileSync("npx", ["tailwindcss", "-c", "tailwind.config.ts", "-i", input, "-o", output], {
    cwd: REPO,
    stdio: "pipe",
    timeout: 240_000,
  });
  if (!existsSync(output)) throw new Error("tailwind produced no stylesheet");
  return readFileSync(output, "utf8");
}

beforeEach(() => { installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("W243 · the invite modal is bounded and scrolls", () => {
  it("W243-1 · the REAL dialog mounts with every field, both buttons, and the Expires-in default of 7 days intact", async () => {
    const dialog = await openRealInviteDialog();

    /* Every field the wave must not have changed. */
    for (const id of [
      "select-invite-source",
      "input-invite-first-name",
      "input-invite-last-name",
      "input-invite-email",
      "input-invite-company",
      "input-invite-stage-focus",
      "input-invite-market-size",
      "input-invite-note",
      "button-preview-invite",
      "select-invite-expiry",
    ]) {
      expect(dialog.querySelector(`[data-testid="${id}"]`), `missing ${id}`).not.toBeNull();
    }
    /* Both controls in the footer. */
    expect(dialog.querySelector('[data-testid="button-send-invite"]')).not.toBeNull();
    expect(Array.from(dialog.querySelectorAll("button")).some(b => (b.textContent ?? "").trim() === "Cancel")).toBe(true);

    /* Labels and helper text — verbatim, so a className-only wave stays
       className-only. */
    const t = (dialog.textContent ?? "").replace(/\s+/g, " ");
    expect(t).toContain("Invite an investor");
    expect(t).toContain("Investor");
    expect(t).toContain("First name");
    expect(t).toContain("Last name");
    expect(t).toContain("Email");
    expect(t).toContain("Company name (optional)");
    expect(t).toContain("Stage focus (optional)");
    expect(t).toContain("Typical market size (optional)");
    expect(t).toContain("Personal note (optional)");
    expect(t).toContain("Your note is added to the standard invitation email. The round terms and name are not changed — only your message.");
    expect(t).toContain("Expires in");
    expect(t).toContain("Preview email");
    expect(t).toContain("Send invitation");

    /* THE EXPIRES-IN DEFAULT IS UNCHANGED: 7 days, and it is the first option. */
    const expiry = dialog.querySelector('[data-testid="select-invite-expiry"]') as HTMLSelectElement;
    expect(expiry.value).toBe("7");
    expect(Array.from(expiry.options).map(o => o.value)).toEqual(["7", "14", "30", "60", "90", "never"]);
    expect(expiry.options[0].textContent).toBe("7 days");
  }, 90000);

  it("W243-2 · the footer is OUTSIDE the scroll container — Cancel and Send can never be scrolled away", async () => {
    const dialog = await openRealInviteDialog();
    const scroller = deriveScroller(dialog);
    const submit = dialog.querySelector('[data-testid="button-send-invite"]')!;

    /* The structural heart of the fix. */
    expect(scroller.contains(submit)).toBe(false);
    /* …and the scroller really does hold the fields, so it is not some empty
       wrapper that trivially excludes the button. */
    for (const id of ["select-invite-source", "input-invite-first-name", "input-invite-note", "select-invite-expiry"]) {
      expect(scroller.querySelector(`[data-testid="${id}"]`), `${id} is not inside the scroll container`).not.toBeNull();
    }
    /* Both the scroller and the footer are children of the same grid. */
    expect(submit.closest("div")!.parentElement === scroller.parentElement || scroller.parentElement!.contains(submit)).toBe(true);
  }, 90000);

  it("W243-3 · REAL BROWSER, REAL CSS — bounded height, computed overflow, and every field plus both buttons reachable at 1280×800, 1024×700 and 800×350", async () => {
    const dialog = await openRealInviteDialog();
    const scroller = deriveScroller(dialog);
    /* Mark the derived scroller so Chromium can find the same element. The mark
       is added to the SERIALISED COPY only — the page's own source is untouched. */
    SCROLLER_MARK = "w243-scroller";
    scroller.setAttribute("data-w243-scroller", "1");
    DIALOG_HTML = dialog.outerHTML;
    scroller.removeAttribute("data-w243-scroller");

    if (!CSS) CSS = buildRealTailwindCss();
    /* Stage 2 is itself an assertion: if the build did not emit these utilities
       the measurements below would be meaningless. */
    expect(CSS, "tailwind emitted no max-h-[85vh] rule").toContain("max-height: 85vh");
    expect(CSS, "tailwind emitted no overflow-y-auto rule").toContain("overflow-y: auto");
    expect(CSS, "tailwind emitted no min-h-0 rule").toContain("min-height: 0px");
    expect(CSS, "tailwind emitted no grid-rows-[auto_minmax(0,1fr)_auto] rule")
      .toContain("grid-template-rows: auto minmax(0,1fr) auto");

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      for (const vp of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style>` +
          `<style>html,body{margin:0;padding:0;height:100%}</style></head>` +
          `<body>${DIALOG_HTML}</body></html>`,
          { waitUntil: "load" },
        );

        const m = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
          const sc = document.querySelector("[data-w243-scroller]") as HTMLElement;
          const send = document.querySelector('[data-testid="button-send-invite"]') as HTMLElement;
          const cancel = Array.from(document.querySelectorAll("button"))
            .find(b => (b.textContent ?? "").trim() === "Cancel") as HTMLElement;
          const expiry = document.querySelector('[data-testid="select-invite-expiry"]') as HTMLElement;
          const first = document.querySelector('[data-testid="input-invite-first-name"]') as HTMLElement;
          const inView = (el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
              && r.width > 0 && r.height > 0;
          };
          // Scroll the container to the very bottom, then re-measure the last field.
          sc.scrollTop = sc.scrollHeight;
          const expiryInViewAfterScroll = inView(expiry);
          sc.scrollTop = 0;
          const firstInViewAtTop = inView(first);
          return {
            overflowY: getComputedStyle(sc).overflowY,
            dialogHeight: dlg.getBoundingClientRect().height,
            dialogBottom: dlg.getBoundingClientRect().bottom,
            dialogTop: dlg.getBoundingClientRect().top,
            viewportHeight: window.innerHeight,
            scrollHeight: sc.scrollHeight,
            clientHeight: sc.clientHeight,
            maxScroll: sc.scrollHeight - sc.clientHeight,
            sendInView: inView(send),
            cancelInView: inView(cancel),
            expiryInViewAfterScroll,
            firstInViewAtTop,
          };
        });

        /* (a) COMPUTED OVERFLOW — not a className string, the browser's own
           resolved value. */
        expect(m.overflowY, `${vp.name}: computed overflow-y`).toBe("auto");

        /* (b) The dialog is BOUNDED: never taller than 85% of the viewport, and
           it fits inside the window. */
        expect(m.dialogHeight, `${vp.name}: dialog height vs 85vh`)
          .toBeLessThanOrEqual(m.viewportHeight * 0.85 + 1);
        expect(m.dialogTop, `${vp.name}: dialog top`).toBeGreaterThanOrEqual(-1);
        expect(m.dialogBottom, `${vp.name}: dialog bottom`).toBeLessThanOrEqual(m.viewportHeight + 1);

        /* (c) BOTH BUTTONS are inside the viewport WITHOUT scrolling — they are
           outside the scroll area, which is the point. */
        expect(m.sendInView, `${vp.name}: Send invitation is not fully in the viewport`).toBe(true);
        expect(m.cancelInView, `${vp.name}: Cancel is not fully in the viewport`).toBe(true);

        /* (d) EVERY FIELD IS REACHABLE: the first field is visible at scroll top,
           and the last field (Expires in) is visible after scrolling to bottom. */
        expect(m.firstInViewAtTop, `${vp.name}: first field not visible at scroll top`).toBe(true);
        expect(m.expiryInViewAfterScroll, `${vp.name}: Expires-in not reachable by scrolling`).toBe(true);

        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 300000);

  it("W243-4 · at 800×350 the container genuinely SCROLLS — the scroll position actually moves, not merely overflows", async () => {
    const dialog = await openRealInviteDialog();
    const scroller = deriveScroller(dialog);
    scroller.setAttribute("data-w243-scroller", "1");
    const html = dialog.outerHTML;
    scroller.removeAttribute("data-w243-scroller");
    if (!CSS) CSS = buildRealTailwindCss();

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 350 } });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style>` +
        `<style>html,body{margin:0;padding:0;height:100%}</style></head><body>${html}</body></html>`,
        { waitUntil: "load" },
      );
      const m = await page.evaluate(() => {
        const sc = document.querySelector("[data-w243-scroller]") as HTMLElement;
        /* ASKING FOR OVERFLOW IS NOT ENOUGH. An element with `overflow: visible`
           still reports scrollHeight > clientHeight — the content simply spills
           instead of scrolling — so an overflow-only assertion stays green when
           the scroll container is deleted. That exact weakness was found by the
           D1 disarm (see W243_DISARM_OUTPUT.txt) and this is the repair: MOVE THE
           SCROLL POSITION and confirm it actually moved. Only a real scroll
           container can hold a non-zero scrollTop. */
        sc.scrollTop = 10_000;
        const scrollTopAfterMax = sc.scrollTop;
        sc.scrollTop = 0;
        return {
          scrollHeight: sc.scrollHeight,
          clientHeight: sc.clientHeight,
          scrollTopAfterMax,
          overflowY: getComputedStyle(sc).overflowY,
        };
      });
      /* If content did not exceed the box there would be nothing to prove and a
         removed overflow rule would not be detectable. It must really overflow… */
      expect(m.scrollHeight).toBeGreaterThan(m.clientHeight + 20);
      /* …AND the box must really scroll. */
      expect(m.overflowY, "800x350: computed overflow-y on the field container").toBe("auto");
      expect(m.scrollTopAfterMax, "800x350: the container did not scroll at all").toBeGreaterThan(20);
      expect(m.scrollTopAfterMax, "800x350: scrollTop exceeded the maximum scroll")
        .toBeLessThanOrEqual(m.scrollHeight - m.clientHeight);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 300000);
});
