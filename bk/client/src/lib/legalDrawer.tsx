/**
 * LegalDrawer context provider.
 *
 * Wrap <App /> (or a subtree) with <LegalDrawerProvider> to allow any component
 * to open the legal drawer via useLegalDrawer().openDrawer(docId?).
 *
 * Light-mode only. No web storage. Consent is server-backed via POST /api/legal/consent.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { LegalDocId } from "./legalDocs";

// Re-export LegalDocId for consumers
export type { LegalDocId };

interface LegalDrawerContextValue {
  open: boolean;
  activeFocusId: LegalDocId | undefined;
  openDrawer: (focusDocId?: LegalDocId) => void;
  closeDrawer: () => void;
}

const LegalDrawerContext = createContext<LegalDrawerContextValue | null>(null);

export function LegalDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeFocusId, setActiveFocusId] = useState<LegalDocId | undefined>(undefined);

  function openDrawer(focusDocId?: LegalDocId) {
    setActiveFocusId(focusDocId);
    setOpen(true);
  }

  function closeDrawer() {
    setOpen(false);
    setActiveFocusId(undefined);
  }

  return (
    <LegalDrawerContext.Provider value={{ open, activeFocusId, openDrawer, closeDrawer }}>
      {children}
    </LegalDrawerContext.Provider>
  );
}

export function useLegalDrawer(): { openDrawer: (focusDocId?: LegalDocId) => void } {
  const ctx = useContext(LegalDrawerContext);
  if (!ctx) {
    // Graceful fallback outside provider — opens a simple console warning
    return {
      openDrawer: () => {
        console.warn("[LegalDrawer] useLegalDrawer() called outside <LegalDrawerProvider>");
      },
    };
  }
  return { openDrawer: ctx.openDrawer };
}

/** Internal hook used by LegalDrawer.tsx for full context. */
export function _useLegalDrawerContext(): LegalDrawerContextValue {
  const ctx = useContext(LegalDrawerContext);
  if (!ctx) throw new Error("LegalDrawer context not found — wrap with <LegalDrawerProvider>");
  return ctx;
}
