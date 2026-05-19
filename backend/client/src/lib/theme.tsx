/**
 * Sprint 11 — Light-only lock.
 *
 * Per the Sprint 11 product mandate the platform is light-mode only across
 * every surface (founder, investor, admin, auth/landing). Dark mode is
 * removed. This module preserves the `useTheme()` API so existing call
 * sites compile, but `theme` is permanently `"light"` and `toggle()` is
 * a no-op. The runtime also strips the `dark` class from the root element
 * if anything else (browser extension, leftover localStorage, etc.) tried
 * to apply it.
 */
import { createContext, useContext, useEffect, ReactNode } from "react";

type Theme = "light";
type Ctx = { theme: Theme; toggle: () => void };
const ThemeCtx = createContext<Ctx>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("light");
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }, []);

  return <ThemeCtx.Provider value={{ theme: "light", toggle: () => {} }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
