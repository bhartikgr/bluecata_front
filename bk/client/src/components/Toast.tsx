/**
 * Sprint 14 D1 — Standardized Toast helper.
 *
 * Wraps shadcn's `useToast` with named variants the rest of the app should
 * consume so call-sites don't drift on tone / duration.
 */
import { useToast } from "@/hooks/use-toast";

export type ToastTone = "info" | "success" | "warning" | "destructive";

export interface ToastSpec {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Default 4500ms; bump for important confirmations. */
  durationMs?: number;
}

export interface CapavateToast {
  (spec: ToastSpec): void;
  info: (spec: Omit<ToastSpec, "tone">) => void;
  success: (spec: Omit<ToastSpec, "tone">) => void;
  warn: (spec: Omit<ToastSpec, "tone">) => void;
  error: (spec: Omit<ToastSpec, "tone">) => void;
}

export function useCapavateToast(): CapavateToast {
  const { toast } = useToast();
  const fire = (spec: ToastSpec) => {
    const variant: "default" | "destructive" = spec.tone === "destructive" ? "destructive" : "default";
    toast({
      title: spec.title,
      description: spec.description,
      variant,
      duration: spec.durationMs ?? 4500,
    });
  };
  const out = fire as CapavateToast;
  out.info = (s) => fire({ ...s, tone: "info" });
  out.success = (s) => fire({ ...s, tone: "success" });
  out.warn = (s) => fire({ ...s, tone: "warning" });
  out.error = (s) => fire({ ...s, tone: "destructive" });
  return out;
}
