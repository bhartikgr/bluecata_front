/**
 * WAVE 18 / XT-7 — client half: the partner-scoped subscription, and the two
 * partner pages that now use it.
 *
 * The wiring IS the URL and the reaction to a frame, so that is what is
 * asserted: which URL is opened, which listeners are registered, and which
 * query keys are invalidated when a frame arrives. Every claim has a negative
 * pole, including the mount fences.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { useCollectiveStream } from "../sseClient";

/* ── A fake EventSource that records everything ───────────────────────────── */
interface FakeInstance {
  url: string;
  listeners: Map<string, EventListener[]>;
  closed: boolean;
  emit: (topic: string, data: unknown) => void;
  fire: (kind: "open" | "error") => void;
}
let instances: FakeInstance[] = [];

class FakeEventSource {
  onopen: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private inst: FakeInstance;
  constructor(url: string) {
    const self = this;
    this.inst = {
      url,
      listeners: new Map(),
      closed: false,
      emit(topic, data) {
        for (const fn of self.inst.listeners.get(topic) ?? []) {
          fn({ data: JSON.stringify(data) } as unknown as Event);
        }
      },
      fire(kind) {
        if (kind === "open") self.onopen?.({});
        else self.onerror?.({});
      },
    };
    instances.push(this.inst);
  }
  addEventListener(type: string, fn: EventListener): void {
    const arr = this.inst.listeners.get(type) ?? [];
    arr.push(fn);
    this.inst.listeners.set(type, arr);
  }
  close(): void {
    this.inst.closed = true;
  }
}

beforeEach(() => {
  instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("XT-7 — partner scope omits chapter_id", () => {
  it("opens /api/stream?topics=spv with NO chapter_id param", () => {
    renderHook(() =>
      useCollectiveStream({
        chapterId: "",
        scope: "partner",
        path: "/api/stream",
        topics: ["spv"],
        onMessage: () => {},
      }),
    );
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe("/api/stream?topics=spv");
    /* Absent, not blank: an empty-but-present param would put the server into
     * its chapter-scoped branch. */
    expect(instances[0].url).not.toContain("chapter_id");
  });

  it("connects even though chapterId is empty — the bail is scope-conditional", () => {
    renderHook(() =>
      useCollectiveStream({
        chapterId: "",
        scope: "partner",
        path: "/api/stream",
        topics: ["crm", "partner-workspace"],
        onMessage: () => {},
      }),
    );
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe("/api/stream?topics=crm%2Cpartner-workspace");
  });

  /* NEGATIVE POLE — the pre-existing chapter behaviour must be untouched.
   * Without this, a mutation deleting the empty-chapter bail entirely would
   * still pass the two tests above. */
  it("a CHAPTER-scoped call with no chapterId still does NOT connect", () => {
    renderHook(() =>
      useCollectiveStream({ chapterId: "", topics: ["comms"], onMessage: () => {} }),
    );
    expect(instances).toHaveLength(0);
  });

  it("a chapter-scoped call still sends chapter_id and defaults to the Collective path", () => {
    renderHook(() =>
      useCollectiveStream({ chapterId: "chap_x", topics: ["comms"], onMessage: () => {} }),
    );
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe("/api/collective/stream?chapter_id=chap_x&topics=comms");
  });

  it("registers a NAMED listener per topic (the server emits `event: <topic>`)", () => {
    renderHook(() =>
      useCollectiveStream({
        chapterId: "",
        scope: "partner",
        path: "/api/stream",
        topics: ["spv"],
        onMessage: () => {},
      }),
    );
    for (const t of ["spv", "crm", "partner-workspace", "lag"]) {
      expect(instances[0].listeners.get(t)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("dispatches the parsed frame under its topic name", () => {
    const seen: Array<[string, unknown]> = [];
    renderHook(() =>
      useCollectiveStream({
        chapterId: "",
        scope: "partner",
        path: "/api/stream",
        topics: ["spv"],
        onMessage: (topic, data) => seen.push([topic, data]),
      }),
    );
    instances[0].emit("spv", { type: "spv.capital_call.recorded", spvId: "spv_1" });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe("spv");
    expect(seen[0][1]).toEqual({ type: "spv.capital_call.recorded", spvId: "spv_1" });
  });

  it("closes the stream on unmount (no leaked socket per navigation)", () => {
    const { unmount } = renderHook(() =>
      useCollectiveStream({
        chapterId: "",
        scope: "partner",
        path: "/api/stream",
        topics: ["spv"],
        onMessage: () => {},
      }),
    );
    expect(instances[0].closed).toBe(false);
    unmount();
    expect(instances[0].closed).toBe(true);
  });

  it("enabled:false still suppresses the connection in partner scope", () => {
    renderHook(() =>
      useCollectiveStream({
        chapterId: "",
        scope: "partner",
        path: "/api/stream",
        topics: ["spv"],
        enabled: false,
        onMessage: () => {},
      }),
    );
    expect(instances).toHaveLength(0);
  });
});

/* ── Source fences on the two mounts ──────────────────────────────────────────
 * A component that subscribes to nothing is the defect this item fixes, so the
 * subscription's PRESENCE on each page is asserted, and each fence is proved
 * capable of failing on a commented-out or deleted mount. */
const ROOT = path.resolve(__dirname, "../../../..");
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** True iff `needle` appears on a line that is not commented out. */
function liveMention(src: string, needle: string): boolean {
  return src
    .split("\n")
    .some(
      (line) =>
        line.includes(needle) &&
        !line.trimStart().startsWith("//") &&
        !line.trimStart().startsWith("*") &&
        !line.trimStart().startsWith("/*") &&
        !line.trimStart().startsWith("{/*"),
    );
}

/**
 * Extract the `useCollectiveStream({ … })` call block by BRACE MATCHING.
 *
 * The naive `indexOf("});")` I used first stops at the first inner
 * `qc.invalidateQueries({ … });`, so a fence built on it inspects only the head
 * of the call and reports success while checking almost nothing — the exact trap
 * this wave is under orders about. Matching braces reads the whole block.
 */
function streamBlock(src: string): string {
  const start = src.indexOf("useCollectiveStream({");
  if (start < 0) return "";
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

describe("XT-7 — the mounts exist", () => {
  /* The query key each page must refetch when a frame lands — i.e. the sink the
   * frame is supposed to move. */
  const KEYS: Record<string, string> = {
    "client/src/pages/partner/PartnerSpvEngine.tsx": '["/api/partner/me/spv"]',
    "client/src/pages/partner/PartnerContacts.tsx": '["/api/partner/me/crm/contacts"]',
  };

  const PAGES: Array<[string, string]> = [
    ["client/src/pages/partner/PartnerSpvEngine.tsx", '"spv"'],
    ["client/src/pages/partner/PartnerContacts.tsx", '"crm"'],
  ];

  for (const [rel, topic] of PAGES) {
    it(`${rel} subscribes with scope:"partner" on ${topic}`, () => {
      const src = read(rel);
      expect(liveMention(src, "useCollectiveStream({")).toBe(true);
      expect(liveMention(src, 'scope: "partner"')).toBe(true);
      expect(liveMention(src, 'path: "/api/stream"')).toBe(true);
      expect(liveMention(src, `topics: [${topic}]`)).toBe(true);
    });

    /* The invalidation must be INSIDE the subscription's own handler. Asserting
     * that the file merely CONTAINS `qc.invalidateQueries` is worthless here —
     * every mutation handler on these pages already invalidates, so that check
     * passes on a page whose stream handler does nothing at all. Measured: the
     * falsification harness proved exactly that, so the fence now reads the
     * brace-matched block. */
    it(`${rel} invalidates the right query key INSIDE the stream handler`, () => {
      const block = streamBlock(read(rel));
      expect(block.length, rel).toBeGreaterThan(80);
      expect(block).toContain("qc.invalidateQueries");
      expect(block).toContain(KEYS[rel]);
      /* And it refetches the SELECTED-ROW key too, not only the list: a detail
       * pane left on a stale row is the same defect one level down. */
      expect(block.match(/qc\.invalidateQueries/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
  }

  it("the stream-handler fence FAILS on a handler that invalidates nothing", () => {
    const handlerless = [
      "  useCollectiveStream({",
      '    chapterId: "",',
      '    scope: "partner",',
      "    onMessage: () => { setLive((n) => n + 1); },",
      "  });",
      "  const m = useMutation({ onSuccess: () => qc.invalidateQueries({ queryKey: [\"/api/partner/me/spv\"] }) });",
    ].join("\n");
    /* The file-wide check would pass on this — the string is present, in the
     * MUTATION handler. The block-scoped one must not. */
    expect(handlerless.includes("qc.invalidateQueries")).toBe(true);
    expect(streamBlock(handlerless)).not.toContain("qc.invalidateQueries");
  });

  /* POSITIVE POLE for the fence itself. */
  it("liveMention returns false for a commented-out mount", () => {
    const bare = 'useCollectiveStream({ scope: "partner" });';
    expect(liveMention(bare, "useCollectiveStream({")).toBe(true);
    expect(liveMention(`// ${bare}`, "useCollectiveStream({")).toBe(false);
    expect(liveMention(`/* ${bare} */`, "useCollectiveStream({")).toBe(false);
    expect(liveMention(`{/* ${bare} */}`, "useCollectiveStream({")).toBe(false);
  });
});

/* ── The frames are hints, never a source of numbers ──────────────────────── */
describe("XT-7 — no money and no state comes off the wire", () => {
  const PAGES = [
    "client/src/pages/partner/PartnerSpvEngine.tsx",
    "client/src/pages/partner/PartnerContacts.tsx",
  ];

  it("neither onMessage handler reads an amount off the frame", () => {
    for (const rel of PAGES) {
      const src = read(rel);
      /* Isolate the subscription block and check the payload cast lists only
       * identifiers, never money fields. A frame that fed a figure to the screen
       * would bypass the server's projection — and `formatMinor` with it. */
      const block = streamBlock(src);
      expect(block.length, rel).toBeGreaterThan(80);
      for (const banned of [
        "amount",
        "Minor",
        "currency",
        "/ 100",
        "/100",
        "* 100",
        "toFixed(",
      ]) {
        expect(block.includes(banned), `${rel} :: ${banned}`).toBe(false);
      }
    }
  });

  it("...and the ban is a real check — it fails on a handler that did read an amount", () => {
    const bad = `useCollectiveStream({ onMessage: (t, p) => setTotal((p as { amountMinor: number }).amountMinor / 100) });`;
    const block = streamBlock(bad);
    const hits = ["amount", "Minor", "/ 100", "/100"].filter((b) => block.includes(b));
    expect(hits.length).toBeGreaterThan(0);
  });
});
