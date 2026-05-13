import { ReactNode } from "react";
import { Link } from "wouter";
import { CapavateLogo } from "@/components/CapavateLogo";

export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Brand panel */}
      <div className="hidden lg:flex bg-gradient-to-br from-[hsl(219_45%_20%)] via-[hsl(219_45%_16%)] to-[hsl(184_98%_22%)] text-white p-10 flex-col">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-flex items-center bg-white rounded-md px-2.5 py-1.5 shadow-sm">
            <CapavateLogo className="h-7 w-auto" />
          </span>
        </Link>
        <div className="mt-auto max-w-md">
          <blockquote className="text-2xl font-semibold tracking-tight leading-snug">
            "We closed a soft-circled $4M seed in nine days because every investor saw the same numbers, the same dataroom, the same terms — at the same time."
          </blockquote>
          <div className="mt-4 text-sm text-white/70">— Maya Chen, CEO of NovaPay AI</div>
        </div>
      </div>
      {/* Right: Form */}
      <div className="flex items-center justify-center p-6 lg:p-10 bg-background">
        <div className="w-full max-w-md">
          <Link href="/" className="lg:hidden flex items-center gap-2 text-foreground mb-8">
            <CapavateLogo className="h-7 w-auto" />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted-foreground text-center">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
