/**
 * WAVE 17 — ORP-042 proving suite for the Live Capital Pulse read surface.
 *
 * ANTI-VACUITY, stated up front. This component existed and typechecked through
 * Wave 16 while being mounted NOWHERE, so "it renders" proves nothing at all.
 * Four things are asserted, each at BOTH poles, plus the mount itself:
 *
 *  1. NAMED-EVENT SUBSCRIPTION. The writer emits `event: <type>` frames
 *     (server/pulseStream.ts:238), and `EventSource.onmessage` fires only for
 *     UNNAMED events. A fake transport records every addEventListener type: all
 *     three named types must be subscribed, and a frame delivered on the
 *     "message" channel must render NOTHING (the negative pole — this is what
 *     an `onmessage` implementation would have relied on).
 *  2. ID-DEDUPE ON REPLAY. Every flush re-derives from the DB and re-sends
 *     (`:232`), and a reconnect legitimately replays, so the same milestone
 *     arrives repeatedly and also arrives from the poll. Exactly one row.
 *  3. THE POLL-FALLBACK POLE. Heartbeats are SSE comments (`:hb`) invisible to
 *     EventSource, so liveness may never be inferred from silence. onopen ⇒
 *     "Streaming live"; onerror ⇒ the polling copy. Both asserted, and the
 *     quiet-but-open case is asserted to stay LIVE, which is exactly what a
 *     silence-based liveness check would get wrong.
 *  4. NO-PRICE COPY. `pulse_index_symbols` stores no quote and no quote route
 *     exists (server/pulseSymbolStore.ts:16). The watchlist must say so, and a
 *     structural assertion pins that no price-shaped text is rendered for a
 *     symbol.
 *  5. THE MOUNT. A source fence over client/src/pages/investor/Dashboard.tsx —
 *     the defect this item fixes was "mounted nowhere", which no render test
 *     can detect. The fence is proven to REJECT a fixture without the mount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import {
  LiveCapitalPulse,
  mergePulseEvents,
  PULSE_EVENT_TYPES,
  PULSE_POLL_INTERVAL_MS,
  type PulseEvent,
  type PulseSource,
} from "../LiveCapitalPulse";

const REPO = path.resolve(__dirname, "../../../../..");
const DASHBOARD = path.join(REPO, "client/src/pages/investor/Dashboard.tsx");
const COMPONENT = path.join(REPO, "client/src/components/pulse/LiveCapitalPulse.tsx");

/* ── fake transport ─────────────────────────────────────────────────────── */

class FakeSource implements PulseSource {
  readonly listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  close(): void {
    this.closed = true;
  }
  /** Deliver a frame on a NAMED channel, the way the writer really does. */
  emit(type: string, payload: unknown): void {
    const list = this.listeners.get(type) ?? [];
    for (const l of list) l({ data: JSON.stringify(payload) } as MessageEvent);
  }
  emitRaw(type: string, data: string): void {
    for (const l of this.listeners.get(type) ?? []) l({ data } as MessageEvent);
  }
  open(): void {
    this.onopen?.(new Event("open"));
  }
  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

let sources: FakeSource[] = [];
const factory = (url: string): PulseSource => {
  const s = new FakeSource(url);
  sources.push(s);
  return s;
};

/* ── server doubles ─────────────────────────────────────────────────────── */

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function ev(over: Partial<PulseEvent> = {}): PulseEvent {
  return {
    id: "round.opened:r_1",
    type: "round.opened",
    at: "2026-05-01T10:00:00.000Z",
    companyName: "NovaPay",
    roundName: "Seed",
    actorLabel: "NovaPay",
    ...over,
  };
}

let recentEvents: PulseEvent[] = [];
let symbolRows: Array<Record<string, unknown>> = [];
const calls: Array<{ method: string; url: string }> = [];

beforeEach(() => {
  sources = [];
  calls.length = 0;
  recentEvents = [];
  symbolRows = [];
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    calls.push({ method, url });
    if (url === "/api/pulse/recent") {
      return jsonResponse({ ok: true, events: recentEvents, serverTime: "2026-05-01T12:00:00.000Z" });
    }
    if (url === "/api/pulse/symbols") return jsonResponse({ ok: true, symbols: symbolRows });
    throw new Error(`unexpected url ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPulse() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <LiveCapitalPulse sourceFactory={factory} />
    </QueryClientProvider>,
  );
}

async function settled() {
  await waitFor(() => expect(calls.some((c) => c.url === "/api/pulse/recent")).toBe(true));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/pulse/symbols")).toBe(true));
}

/* ── 0. the harness is not lying ────────────────────────────────────────── */

describe("ORP-042 harness integrity", () => {
  it("both source files exist on disk (a fence over a missing file passes vacuously)", () => {
    expect(fs.existsSync(DASHBOARD)).toBe(true);
    expect(fs.existsSync(COMPONENT)).toBe(true);
  });

  it("the fake transport is really the transport in use — a real EventSource is never constructed", async () => {
    // jsdom ships no EventSource, so a stub is installed that EXPLODES if the
    // component reaches for the browser transport instead of the injected one.
    let realConstructed = 0;
    const g = globalThis as unknown as { EventSource?: unknown };
    const had = "EventSource" in g;
    const prev = g.EventSource;
    g.EventSource = class {
      constructor() {
        realConstructed += 1;
        throw new Error("the injected sourceFactory was bypassed");
      }
    };
    try {
      renderPulse();
      await settled();
      expect(sources).toHaveLength(1);
      expect(sources[0].url).toBe("/api/pulse/stream");
      expect(realConstructed).toBe(0);
    } finally {
      if (had) g.EventSource = prev;
      else delete g.EventSource;
    }
  });

  it("with NO factory and no EventSource in the environment the component polls instead of throwing", async () => {
    const g = globalThis as unknown as { EventSource?: unknown };
    expect("EventSource" in g).toBe(false); // jsdom baseline — the fallback pole is reachable
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <LiveCapitalPulse />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("pulse-transport").textContent).toContain("Live stream unavailable"),
    );
    expect(sources).toHaveLength(0);
  });
});

/* ── 1. named-event subscription, both poles ────────────────────────────── */

describe("ORP-042 named-event subscription", () => {
  it("subscribes every named type the writer emits", async () => {
    renderPulse();
    await settled();
    const subscribed = Array.from(sources[0].listeners.keys()).sort();
    expect(subscribed).toEqual([...PULSE_EVENT_TYPES].sort());
    expect(subscribed).toHaveLength(3);
  });

  it("POSITIVE POLE — a frame on a NAMED channel renders a row", async () => {
    renderPulse();
    await settled();
    await act(async () => {
      sources[0].emit("round.soft_circle_placed", ev({ id: "round.soft_circle_placed:s_9", type: "round.soft_circle_placed", companyName: "Arboreal" }));
    });
    expect(await screen.findByTestId("pulse-row-round.soft_circle_placed:s_9")).toBeTruthy();
    expect(screen.getByTestId("pulse-kind-round.soft_circle_placed:s_9").textContent).toContain("Soft circle");
  });

  it("NEGATIVE POLE — an unnamed `message` frame renders nothing, so an onmessage implementation would show an empty pulse", async () => {
    renderPulse();
    await settled();
    expect(sources[0].listeners.has("message")).toBe(false);
    await act(async () => {
      sources[0].emit("message", ev({ id: "round.opened:ghost" }));
    });
    expect(screen.queryByTestId("pulse-row-round.opened:ghost")).toBeNull();
    expect(screen.getByTestId("pulse-empty")).toBeTruthy();
  });

  it("a malformed frame does not tear down the stream — the next good frame still renders", async () => {
    renderPulse();
    await settled();
    await act(async () => {
      sources[0].emitRaw("round.opened", "{not json");
      sources[0].emit("round.opened", ev({ id: "round.opened:r_ok" }));
    });
    expect(await screen.findByTestId("pulse-row-round.opened:r_ok")).toBeTruthy();
  });
});

/* ── 2. id-dedupe on replay ─────────────────────────────────────────────── */

describe("ORP-042 replay de-duplication", () => {
  it("the same milestone re-sent on every flush renders exactly ONE row", async () => {
    renderPulse();
    await settled();
    const frame = ev({ id: "round.opened:r_dup" });
    await act(async () => {
      sources[0].emit("round.opened", frame);
      sources[0].emit("round.opened", frame);
      sources[0].emit("round.opened", frame);
    });
    await waitFor(() => expect(screen.getByTestId("pulse-list")).toBeTruthy());
    expect(screen.getAllByTestId("pulse-row-round.opened:r_dup")).toHaveLength(1);
  });

  it("a milestone present in BOTH the poll body and the stream renders once (the two paths overlap by design)", async () => {
    recentEvents = [ev({ id: "round.opened:r_both" })];
    renderPulse();
    await settled();
    await act(async () => {
      sources[0].emit("round.opened", ev({ id: "round.opened:r_both" }));
    });
    await waitFor(() => expect(screen.getAllByTestId("pulse-row-round.opened:r_both")).toHaveLength(1));
  });

  it("mergePulseEvents keys by id, prefers the incoming copy and orders newest-first", () => {
    const merged = mergePulseEvents(
      [ev({ id: "a", at: "2026-01-01T00:00:00.000Z", companyName: "STALE" })],
      [
        ev({ id: "a", at: "2026-01-01T00:00:00.000Z", companyName: "FRESH" }),
        ev({ id: "b", at: "2026-03-01T00:00:00.000Z" }),
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(["b", "a"]);
    expect(merged[1].companyName).toBe("FRESH");
  });

  it("mergePulseEvents does not spread a MapIterator — that is a TS2802 under this tsconfig", () => {
    const src = fs.readFileSync(COMPONENT, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("Array.from(byId.values())");
    expect(code).not.toMatch(/\[\s*\.\.\.[A-Za-z_$][\w$]*\.(values|keys|entries)\(\)/);
  });
});

/* ── 3. the poll-fallback pole ──────────────────────────────────────────── */

describe("ORP-042 liveness and poll fallback", () => {
  it("onopen ⇒ live copy; the fallback copy is ABSENT", async () => {
    renderPulse();
    await settled();
    await act(async () => sources[0].open());
    await waitFor(() => expect(screen.getByTestId("pulse-transport").textContent).toContain("Streaming live"));
    expect(screen.getByTestId("pulse-transport").textContent).not.toContain("unavailable");
  });

  it("onerror ⇒ the poll-fallback copy, naming the real interval", async () => {
    renderPulse();
    await settled();
    await act(async () => {
      sources[0].open();
      sources[0].fail();
    });
    await waitFor(() =>
      expect(screen.getByTestId("pulse-transport").textContent).toContain("Live stream unavailable"),
    );
    expect(screen.getByTestId("pulse-transport").textContent).toContain(
      String(PULSE_POLL_INTERVAL_MS / 1000),
    );
    expect(screen.getByTestId("pulse-transport").textContent).not.toContain("Streaming live");
  });

  it("SILENCE IS NOT FAILURE — an open stream with no frames at all stays live, because heartbeats are SSE comments EventSource cannot see", async () => {
    renderPulse();
    await settled();
    await act(async () => sources[0].open());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(screen.getByTestId("pulse-transport").textContent).toContain("Streaming live");
    expect(screen.getByTestId("pulse-empty")).toBeTruthy();
  });

  it("a factory that throws falls back to polling instead of rendering a broken surface", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <LiveCapitalPulse
          sourceFactory={() => {
            throw new Error("blocked");
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("pulse-transport").textContent).toContain("Live stream unavailable"),
    );
  });

  it("the stream is closed on unmount so a navigated-away dashboard leaves no open connection", async () => {
    const { unmount } = renderPulse();
    await settled();
    expect(sources[0].closed).toBe(false);
    unmount();
    expect(sources[0].closed).toBe(true);
  });
});

/* ── 4. no prices ───────────────────────────────────────────────────────── */

describe("ORP-042 watchlist renders no prices", () => {
  it("renders the DB-driven symbols with their labels and says quotes are not published", async () => {
    symbolRows = [
      { symbol: "BTC-USD", label: "Bitcoin", category: "crypto", refreshSeconds: 60, sortOrder: 1 },
      { symbol: "SPX", label: null, category: "index", refreshSeconds: 3600, sortOrder: 2 },
    ];
    renderPulse();
    await settled();
    expect(await screen.findByTestId("pulse-symbol-BTC-USD")).toBeTruthy();
    expect(screen.getByTestId("pulse-symbol-SPX")).toBeTruthy();
    expect(screen.getByTestId("pulse-watchlist-note").textContent).toMatch(/quotes are not published/i);
    // No price-shaped text anywhere in the watchlist: no currency symbol, no
    // decimal quantity, no percent. The registry stores none of those.
    const text = screen.getByTestId("pulse-watchlist").textContent ?? "";
    expect(text).not.toMatch(/[$€£]/);
    expect(text).not.toMatch(/\d[\d,]*\.\d/);
    expect(text).not.toMatch(/%/);
  });

  it("an empty registry says so rather than rendering an empty strip", async () => {
    renderPulse();
    await settled();
    expect(await screen.findByTestId("pulse-watchlist-empty")).toBeTruthy();
    expect(screen.queryByTestId("pulse-watchlist-items")).toBeNull();
  });

  it("the component source contains no quote route and no price field — there is neither in the tree", () => {
    const src = fs.readFileSync(COMPONENT, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\/api\/[a-z/-]*quote/i);
    expect(code).not.toMatch(/\b(price|lastPrice|changePct|quote)\b/);
  });

  it("a milestone row publishes no amount — the writer emits none (spec-locked)", async () => {
    recentEvents = [ev({ id: "round.opened:r_amt" })];
    renderPulse();
    await settled();
    const row = await screen.findByTestId("pulse-row-round.opened:r_amt");
    expect(row.textContent ?? "").not.toMatch(/[$€£]/);
  });

  it("a withheld company / actor renders the privacy copy, never a blank", async () => {
    recentEvents = [ev({ id: "round.opened:r_priv", companyName: null, actorLabel: null, roundName: null })];
    renderPulse();
    await settled();
    expect((await screen.findByTestId("pulse-company-round.opened:r_priv")).textContent).toBe(
      "Undisclosed company",
    );
    expect(screen.getByTestId("pulse-actor-round.opened:r_priv").textContent).toBe(
      "Participant withheld",
    );
  });
});

/* ── 5. the mount fence — the actual Wave-16 defect ─────────────────────── */

const IMPORT_RE = /import\s*\{[^}]*\bLiveCapitalPulse\b[^}]*\}\s*from\s*["']@\/components\/pulse\/LiveCapitalPulse["']/;
const MOUNT_RE = /<\s*LiveCapitalPulse\b/;

function mountFinding(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  if (!IMPORT_RE.test(code)) out.push("import_missing");
  if (!MOUNT_RE.test(code)) out.push("mount_missing");
  return out;
}

describe("ORP-042 mount fence", () => {
  it("the investor dashboard imports AND renders the component", () => {
    expect(mountFinding(fs.readFileSync(DASHBOARD, "utf8"))).toEqual([]);
  });

  it("VACUITY POLE — the fence reports both findings for a dashboard without the mount (the Wave 16 state)", () => {
    expect(mountFinding("export default function D() { return <div>nothing</div>; }")).toEqual([
      "import_missing",
      "mount_missing",
    ]);
  });

  it("a mount that is only MENTIONED in a comment does not satisfy the fence", () => {
    const commentOnly = `// import { LiveCapitalPulse } from "@/components/pulse/LiveCapitalPulse";\n/* <LiveCapitalPulse /> */\nexport default function D() { return null; }`;
    expect(mountFinding(commentOnly)).toEqual(["import_missing", "mount_missing"]);
  });

  it("the mount sits after the round-activity card and before the member-value block, and the card is still there", () => {
    const src = fs.readFileSync(DASHBOARD, "utf8");
    const activity = src.indexOf('data-testid="card-round-activity"');
    const mount = src.search(MOUNT_RE);
    const memberValue = src.indexOf("<MemberValueIntelligenceInvestor");
    expect(activity).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(activity);
    expect(memberValue).toBeGreaterThan(mount);
  });

  it("production mounts pass no sourceFactory, so the real EventSource is used in the browser", () => {
    const src = fs.readFileSync(DASHBOARD, "utf8");
    expect(src).toMatch(/<LiveCapitalPulse\s*\/>/);
  });
});
