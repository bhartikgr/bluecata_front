/**
 * Wave C / FIX C7 — Polished admin 404.
 *
 * A-FINAL-023 (Avi, 24-May-2026): hitting `/admin/lifecycle` or
 * `/admin/chapters` rendered the generic dev-only "Did you forget to add
 * the page to the router?" message. For an admin tool that's unacceptably
 * unprofessional — the page is reachable to anyone with the bookmark.
 *
 * This component renders a branded admin 404 that:
 *   1. Identifies the surface ("Admin Console").
 *   2. Echoes the path the visitor tried.
 *   3. Provides a clear back-link to /admin/dashboard.
 *
 * The shell sidebar is still rendered around this component (it sits
 * inside <AppShell>), so the visitor's nav state is preserved.
 */
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default function AdminNotFound() {
  const [location] = useLocation();
  return (
    <div className="p-6 max-w-3xl mx-auto" data-testid="admin-not-found">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden />
            <CardTitle>Admin page not found</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t find{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {location}
            </code>{" "}
            in the Admin Console. The page may have been moved or renamed.
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li>
              Lifecycle policies live at{" "}
              <Link
                href="/admin/lifecycle-policies"
                className="text-primary underline"
              >
                /admin/lifecycle-policies
              </Link>
              .
            </li>
            <li>
              The full admin map starts at{" "}
              <Link href="/admin/dashboard" className="text-primary underline">
                Admin Dashboard
              </Link>
              .
            </li>
          </ul>
          <div className="flex gap-2 pt-2">
            <Button asChild variant="default">
              <Link href="/admin/dashboard" data-testid="admin-404-back-to-dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                Back to Admin Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
