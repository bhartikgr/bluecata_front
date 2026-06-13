/**
 * Sprint 21 Wave G — Capavate Collective page merged into Apply-to-Collective.
 *
 * This route (/investor/collective) now redirects to /investor/apply-to-collective
 * which contains the full hero + eligibility + wizard experience.
 *
 * This file is kept to avoid a dead import in App.tsx (the route still renders
 * this component which immediately redirects).
 */
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Collective() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/investor/apply-to-collective", { replace: true });
  }, [navigate]);
  // Render nothing — redirect happens on mount.
  return null;
}
