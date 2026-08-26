/**
 * REVIEW H (adversarial, read-only review artifact) — capture the EXACT payload
 * the shipped client constructs for both partner create paths and write it to
 * reviewH_scratch/captured_payloads.json, so a real supertest run against the
 * real express route can replay it byte-for-byte.
 *
 * This file asserts nothing about correctness; it only records what the client
 * sends. The verdict is made by the server-side replay test.
 */
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvs from "../PartnerSpvs";
import PartnerFunds from "../PartnerFunds";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const OUT = path.join(REPO_ROOT, "reviewH_scratch/captured_payloads.json");

let subRole = "managing_partner";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({ Link: ({ children }: { children?: ReactNode }) => <span>{children}</span> }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_rh",
      tier: "builder",
      subRole,
      identity: { userId: "u_rh", email: "rh@example.com", name: "Review H Partner" },
    },
  }),
}));

const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (method !== "GET") sent.push({ method, url, body: (body ?? {}) as Record<string, unknown> });
      const payload =
        method === "GET"
          ? url.includes("/funds")
            ? { funds: [] }
            : { spvs: [] }
          : { spv: { id: "spv_rh" }, fund: { id: "fund_rh" } };
      return {
        ok: true,
        status: method === "GET" ? 200 : 201,
        statusText: "ok",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      } as unknown as Response;
    },
  };
});

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
function setValue(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
}

beforeEach(() => {
  subRole = "managing_partner";
  sent.length = 0;
});
afterEach(() => cleanup());

describe("REVIEW H — capture real client payloads", () => {
  it("captures the SPV payload the shipped form builds", async () => {
    mount(<PartnerSpvs />);
    fireEvent.click(screen.getByTestId("partner-spvs-new-toggle"));
    setValue("partner-spv-name", "Review H Capture SPV");
    // a real money figure typed in whole currency units by a human
    setValue("partner-spv-target", "5,000,000");
    setValue("partner-spv-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-spv-signoff-accept"));
    fireEvent.click(screen.getByTestId("partner-spvs-create"));
    await waitFor(() => expect(sent.length).toBe(1));
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
    prev.spv = sent[0];
    fs.writeFileSync(OUT, JSON.stringify(prev, null, 2));
  });

  it("captures the fund payload the shipped form builds", async () => {
    mount(<PartnerFunds />);
    fireEvent.click(screen.getByTestId("partner-funds-new-toggle"));
    setValue("partner-fund-name", "Review H Capture Fund I");
    setValue("partner-fund-type", "closed_end");
    setValue("partner-fund-target", "5,000,000");
    /* WAVE 150 · R111 Q11 — the shipped fund form now carries the same recorded
       sign-off as the SPV form, so the captured payload must include it or the
       server replay would be exercising a body the client can no longer send. */
    setValue("partner-fund-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    await waitFor(() => expect(sent.length).toBe(1));
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
    prev.fund = sent[0];
    fs.writeFileSync(OUT, JSON.stringify(prev, null, 2));
  });
});
