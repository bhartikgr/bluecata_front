import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LegalDrawerProvider } from "./lib/legalDrawer";
import { ConnectedLegalDrawer } from "./components/LegalDrawer";

// Sprint 16 hotfix — fix deep-link blank-screen bug.
// If a user pastes /founder/dashboard etc. (no hash), rewrite into the
// hash router instead of dumping them on the Landing page.
if (!window.location.hash) {
  const p = window.location.pathname;
  const s = window.location.search || "";
  const APP_PATH = /^\/(auth|founder|investor|admin|select-company|notifications|collective)(\/|$)/;
  if (p !== "/" && APP_PATH.test(p)) {
    window.location.replace("/#" + p + s);
  } else {
    window.location.hash = "#/";
  }
}

// Sprint 11 — light-only lock: enforce before React mounts so first paint
// never flashes a dark theme even if a stale class is on <html>.
const root = document.documentElement;
root.classList.add("light");
root.classList.remove("dark");
root.style.colorScheme = "light";

createRoot(document.getElementById("root")!).render(
  <LegalDrawerProvider>
    <App />
    <ConnectedLegalDrawer />
  </LegalDrawerProvider>
);
