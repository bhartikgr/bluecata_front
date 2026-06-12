/**
 * Capavate brand mark — real wordmark PNG.
 *
 * Sprint 7 (patched 2026-05-08): imports the asset via Vite's asset pipeline
 * so paths are rewritten correctly at build time and survive deployment proxies.
 * Previously used a `/capavate-logo.png` absolute path which broke under the
 * deploy proxy that serves the site at a non-root sub-path.
 */
import logoUrl from "@assets/capavate-logo.jpg";

/**
 * Brand mark only (image). Use `className` to control height — width is auto.
 * This keeps the wordmark crisp on retina and avoids rasterizing an inline SVG.
 */
export function CapavateLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="Capavate"
      // Brand asset is 362x128 ≈ 2.83:1
      className={className || "h-7 w-auto"}
      draggable={false}
    />
  );
}

/**
 * Convenience wrapper for legacy callsites — preserved for backwards compat.
 * Now identical to <CapavateLogo /> because the brand asset already includes
 * the wordmark.
 */
export function CapavateWordmark({ className = "" }: { className?: string }) {
  return <CapavateLogo className={className || "h-7 w-auto"} />;
}

/** Exported URL for places that need a raw `src` (e.g. PDF print headers). */
export const CAPAVATE_LOGO_URL = logoUrl;
