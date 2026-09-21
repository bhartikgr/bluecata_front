import { useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";

/**
 * Landing-page presentation only. Extend the frozen hero from its owning Home
 * component, without rewriting the heading, tagline, copy or registration links.
 */
export function useHeroPartnerValue(rootRef: { current: HTMLElement | null }) {
  // Allocate an unattached target once; attaching it does not trigger a Home
  // render or reset the existing correction layer's per-pass diagnostics.
  const host = useMemo(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.setAttribute("data-home-partner-value-host", "");
    return element;
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const ctas = root?.querySelector<HTMLElement>(".hero .hero__content .hero__ctas");
    if (!root || !ctas?.parentElement || !host) return;
    const existing = root.querySelector<HTMLElement>("[data-home-partner-value-host]");
    if (existing && existing !== host) return;
    ctas.parentElement.insertBefore(host, ctas);
    return () => host.remove();
  }, [rootRef, host]);

  return host ? createPortal(
    <p className="home-hero-partner-value" data-testid="home-hero-partner-value">
      <strong>Consortium Partners</strong>{" "}
      can qualify their sales pipelines, manage clients’ funding rounds, and launch their own SPVs on Capavate.
    </p>,
    host,
  ) : null;
}
