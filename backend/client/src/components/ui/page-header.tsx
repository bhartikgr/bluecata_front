/**
 * v25.46 Track 6 — PageHeader: canonical left-aligned breadcrumb / title /
 * subtitle / action-row header. Replaces the centered marketing H1 + long
 * intro on the Consortium application page with canonical workspace chrome.
 * Sacred Tier 9 rule 73.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Optional breadcrumb row rendered above the title. */
  breadcrumb?: React.ReactNode;
  /** Optional right-aligned action row (buttons). */
  actions?: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, subtitle, breadcrumb, actions, ...props }, ref) => (
    <div
      ref={ref}
      data-testid="page-header"
      className={cn("cv-page-header", className)}
      {...props}
    >
      {breadcrumb ? (
        <div className="cv-page-header__breadcrumb text-xs text-[var(--cv-color-text-muted)]">
          {breadcrumb}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="cv-page-header__title">{title}</h1>
          {subtitle ? <p className="cv-page-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  ),
);
PageHeader.displayName = "PageHeader";

export default PageHeader;
