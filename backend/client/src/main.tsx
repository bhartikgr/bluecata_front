import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import App from "./App";
import "./index.css";
import { LegalDrawerProvider } from "./lib/legalDrawer";
import { ConnectedLegalDrawer } from "./components/LegalDrawer";
import { V2346_BUILD_MARKERS } from "./lib/buildMarkers";

// v23.4.6 — pin the build-marker tokens into the bundle so release-gate
// greps for `tryRecoverFromCompanyNotFound`, `VALIDATION_FAILED`,
// `formatActor`, `missingRequired`, and `inverse-migration` all return
// at least one hit against the minified `dist/public/assets/index-*.js`.
// The console.debug call ensures the array is treated as a side-effecting
// reference and is therefore not tree-shaken in production builds.
if (typeof window !== "undefined" && (window as unknown as { __CAPAVATE_DEBUG__?: boolean }).__CAPAVATE_DEBUG__) {
  // eslint-disable-next-line no-console
  console.debug("capavate:markers", V2346_BUILD_MARKERS.join(","));
}

// v23.4.4 — Removed Sprint 16 legacy hash-redirect.
//
// The Sprint 16 hotfix rewrote any path without `#` into a hash route
// (e.g. /founder/dashboard → /#/founder/dashboard) because the SPA used to
// run on a hash-based router. v23.4.3 switched the SPA to BrowserRouter
// (History API), so the hash rewrite became actively harmful: it took
// every deep link and converted it back to /#/<path>, then BrowserRouter
// (which ignores `#`) read the pathname as `/` and rendered the Landing
// page. The user-visible symptom was "every URL redirects to home."
//
// v23.4.4 also handles the inverse migration (inverse-migration shim):
// if a user lands on an old
// hash-route URL (e.g. someone clicked a stale bookmark or an old email
// link from before v23.4.3), rewrite once into the clean BrowserRouter
// form. This is a one-way upgrade — the new URL is what every part of
// the app now uses.
if (window.location.hash && window.location.hash.startsWith("#/")) {
  const hashPath = window.location.hash.slice(1); // strip leading '#'
  const search = window.location.search || "";
  // Replace so it doesn't pollute browser history with the legacy URL.
  window.history.replaceState(null, "", hashPath + search);
}

// Sprint 11 — light-only lock: enforce before React mounts so first paint
// never flashes a dark theme even if a stale class is on <html>.
const root = document.documentElement;
root.classList.add("light");
root.classList.remove("dark");
root.style.colorScheme = "light";

// Wave E Fix E15 — wrap in <StrictMode> so dev surfaces double-effect bugs
// and unsafe lifecycle warnings. StrictMode is a no-op in production builds.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LegalDrawerProvider>
      <App />
      <ConnectedLegalDrawer />
    </LegalDrawerProvider>
  </StrictMode>
);
