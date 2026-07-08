import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

/* W2-C — friendly production 404. The prior copy ("Did you forget to add the
 * page to the router?") was a framework debug message leaking to end users.
 * This resolves the most relevant "home" destination from the current URL
 * prefix so the visitor is offered a link back to a surface they can actually
 * reach, and styles with the shared --cv-* design tokens. */
function resolveHome(path: string): { href: string; label: string } {
  if (path.startsWith("/collective/partner")) {
    return { href: "/collective/partner/dashboard", label: "Go to your partner dashboard" };
  }
  if (path.startsWith("/collective")) {
    return { href: "/collective/dashboard", label: "Go to the Collective dashboard" };
  }
  if (path.startsWith("/admin")) {
    return { href: "/admin/dashboard", label: "Go to the admin dashboard" };
  }
  if (path.startsWith("/investor")) {
    return { href: "/investor/dashboard", label: "Go to your dashboard" };
  }
  if (path.startsWith("/founder")) {
    return { href: "/founder/dashboard", label: "Go to your dashboard" };
  }
  return { href: "/", label: "Go to the homepage" };
}

export default function NotFound() {
  const [location] = useLocation();
  const home = resolveHome(location);
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ backgroundColor: "var(--cv-color-surface-muted, #FAFAF8)" }}
    >
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <Compass
              className="h-8 w-8"
              style={{ color: "var(--cv-color-primary, #cc0001)" }}
            />
            <h1
              className="text-2xl font-bold"
              style={{ color: "var(--cv-color-text, #1A1A2E)" }}
              data-testid="text-404-title"
            >
              Page not found
            </h1>
          </div>

          <p
            className="mt-2 text-sm"
            style={{ color: "var(--cv-color-text-muted, #555)" }}
            data-testid="text-404-body"
          >
            We couldn't find the page you were looking for. It may have moved, or
            the link may be out of date.
          </p>

          <div className="mt-6">
            <Link href={home.href}>
              <Button data-testid="button-404-home" className="gap-2">
                <Compass className="h-4 w-4" />
                {home.label}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
