/* WAVE 40 — REAL-BROWSER REPRO of the SPV tabs defect.
 *
 * Two variants of the SAME tab widget are mounted:
 *   #variant-nested  — reproduces the SHIPPED shape: a Card that is
 *                      role="button" tabIndex={0} with onClick + onKeyDown that
 *                      toggle expansion, wrapping the Radix tablist. The detail
 *                      wrapper stops onClick propagation, exactly as shipped.
 *   #variant-flat    — the proposed fix shape: a real <button> header control,
 *                      the body a plain container (no interactive role), tabs
 *                      nested in nothing.
 *
 * Driven by probe.mjs in a real Chromium. jsdom is deliberately NOT used.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Tabs from "@radix-ui/react-tabs";

const TAB_KEYS = ["overview", "mandate", "fees", "lps", "deployments", "nav", "k1"] as const;

function TabWidget({ id }: { id: string }) {
  return (
    <Tabs.Root defaultValue="overview" data-testid={`tabs-${id}`}>
      <Tabs.List style={{ display: "flex", flexWrap: "wrap" }}>
        {TAB_KEYS.map((k) => (
          <Tabs.Trigger key={k} value={k} data-testid={`${id}-tab-${k}`}>
            {k}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {TAB_KEYS.map((k) => (
        <Tabs.Content key={k} value={k} data-testid={`${id}-panel-${k}`}>
          PANEL-CONTENT-{k.toUpperCase()}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/* ---- variant A: shipped shape (interactive role wrapping a tablist) ------- */
function NestedVariant() {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      id="variant-nested"
      data-testid="nested-card"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      style={{ border: "1px solid #ccc", padding: 12, cursor: "pointer" }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      onClick={() => setOpen((v) => !v)}
    >
      <div>NESTED CARD HEADER</div>
      {open && (
        <div data-testid="nested-detail" onClick={(e) => e.stopPropagation()}>
          <TabWidget id="nested" />
        </div>
      )}
    </div>
  );
}

/* ---- variant B: proposed fix shape --------------------------------------- */
function FlatVariant() {
  const [open, setOpen] = React.useState(false);
  return (
    <div id="variant-flat" data-testid="flat-card" style={{ border: "1px solid #ccc", padding: 12 }}>
      <button
        type="button"
        data-testid="flat-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        FLAT CARD HEADER
      </button>
      {open && (
        <div data-testid="flat-detail">
          <TabWidget id="flat" />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <NestedVariant />
    <hr />
    <FlatVariant />
  </>,
);
