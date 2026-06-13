/**
 * Wave G Track 2 — G5: Micro-interactions library
 *
 * Reusable Tailwind class strings + small React hooks for premium feel.
 * All effects respect `prefers-reduced-motion: reduce`.
 *
 * USAGE:
 *   import { HOVER_LIFT, BUTTON_PRESS, CARD_HOVER, FOCUS_RING } from "@/lib/microInteractions";
 *   <div className={cn(HOVER_LIFT, "p-4")}>…</div>
 *
 * The reduced-motion gate uses Tailwind's `motion-reduce:` variant —
 * when the user prefers reduced motion, durations collapse to 0 (instant)
 * but the static visual styles (shadow, border, color) still apply.
 */

import { useEffect, useState, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// CLASS STRING EXPORTS
// ---------------------------------------------------------------------------

/** Card / tile gentle lift on hover. */
export const HOVER_LIFT =
  "transition-all duration-200 hover:translate-y-[-2px] hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** Button press feedback (scale down on :active). */
export const BUTTON_PRESS =
  "active:scale-[0.98] transition-transform duration-100 motion-reduce:transition-none motion-reduce:active:scale-100";

/** Card hover — soft shadow + subtle border tint. */
export const CARD_HOVER =
  "transition-all duration-200 hover:shadow-md hover:border-cap-primary/20 motion-reduce:transition-none";

/** Accessibility focus ring — branded. */
export const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-cap-primary focus-visible:ring-offset-2 focus-visible:outline-none";

/** Modal / dialog entry animation. */
export const MODAL_ENTRY =
  "animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none";

/** Modal / dialog exit animation. */
export const MODAL_EXIT =
  "animate-out fade-out zoom-out-95 duration-150 motion-reduce:animate-none";

/** Toast slide in from bottom. */
export const TOAST_SLIDE_IN =
  "animate-in slide-in-from-bottom-2 fade-in duration-300 motion-reduce:animate-none";

/** Toast slide out to bottom. */
export const TOAST_SLIDE_OUT =
  "animate-out slide-out-to-bottom-2 fade-out duration-200 motion-reduce:animate-none";

/** Form field success state — green tint. */
export const FIELD_SUCCESS =
  "border-cap-success bg-cap-success/5 transition-colors duration-200 motion-reduce:transition-none";

/** Form field error state — red tint. */
export const FIELD_ERROR =
  "border-cap-danger bg-cap-danger/5 transition-colors duration-200 motion-reduce:transition-none";

/** Subtle pulse (for "new" / "live" badges). */
export const PULSE_BADGE =
  "animate-pulse motion-reduce:animate-none";

/** Shimmer placeholder — matches Track 1's `animate-shimmer` keyframe. */
export const SHIMMER_PLACEHOLDER =
  "animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent bg-[length:200%_100%] motion-reduce:animate-none";

// ---------------------------------------------------------------------------
// HOOKS
// ---------------------------------------------------------------------------

/**
 * Detect `prefers-reduced-motion`. Returns true when the user wants
 * reduced motion. Hooks below use this for graceful degradation.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  return reduced;
}

/**
 * useShimmer — returns inline style object for a shimmer animation
 * suitable for loading placeholders. Honors reduced-motion.
 */
export function useShimmer(): React.CSSProperties {
  const reduced = useReducedMotion();
  if (reduced) return {};
  return {
    backgroundImage:
      "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.4s linear infinite",
  };
}

/**
 * usePulse — gentle pulse animation suitable for "new" notification
 * badges. Honors reduced-motion (returns empty style).
 */
export function usePulse(): React.CSSProperties {
  const reduced = useReducedMotion();
  if (reduced) return {};
  return {
    animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
  };
}

/**
 * useTilt — gentle 3D tilt on hover. Attach the returned `ref` to a
 * container, and the returned `style` to apply the transform. The tilt
 * is subtle by default (5deg max) — pass a larger `strength` for a more
 * dramatic effect. Honors reduced-motion (returns no-op handlers).
 */
export function useTilt(strength: number = 5) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const reduced = useReducedMotion();

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (reduced) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const tiltY = (x - 0.5) * 2 * strength;
      const tiltX = -(y - 0.5) * 2 * strength;
      setStyle({
        transform: `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
        transition: "transform 0.05s linear",
      });
    },
    [strength, reduced]
  );

  const onMouseLeave = useCallback(() => {
    setStyle({
      transform: "perspective(800px) rotateX(0deg) rotateY(0deg)",
      transition: "transform 0.3s ease",
    });
  }, []);

  return { ref, style, onMouseMove, onMouseLeave };
}

// ---------------------------------------------------------------------------
// Catalog (for tests + docs)
// ---------------------------------------------------------------------------
export const MICRO_INTERACTIONS_CATALOG = {
  classStrings: [
    "HOVER_LIFT",
    "BUTTON_PRESS",
    "CARD_HOVER",
    "FOCUS_RING",
    "MODAL_ENTRY",
    "MODAL_EXIT",
    "TOAST_SLIDE_IN",
    "TOAST_SLIDE_OUT",
    "FIELD_SUCCESS",
    "FIELD_ERROR",
    "PULSE_BADGE",
    "SHIMMER_PLACEHOLDER",
  ],
  hooks: ["useReducedMotion", "useShimmer", "usePulse", "useTilt"],
} as const;
