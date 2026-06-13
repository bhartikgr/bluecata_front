/**
 * Sprint 8 — Chip-style multi-select for enum-bounded options. Used by every
 * multi-select on the profile wizards (strategic priorities, transaction
 * interests, partner types, deal breakers, geographies, customer segments,
 * industry expertise, cheque sizes, etc.).
 *
 * The value stored is the canonical enum `value` (production-shape).
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
}

export function ChipMultiSelect<V extends string>({
  options,
  value,
  onChange,
  max,
  columns = "auto",
  testIdPrefix,
  size = "md",
}: {
  options: readonly ChipOption<V>[];
  value: readonly V[];
  onChange: (next: V[]) => void;
  max?: number;
  columns?: "auto" | 1 | 2 | 3;
  testIdPrefix?: string;
  size?: "sm" | "md";
}) {
  const toggle = (v: V) => {
    if (value.includes(v)) {
      onChange(value.filter(x => x !== v));
    } else {
      if (max && value.length >= max) return; // soft cap; UI is also disabled below
      onChange([...value, v]);
    }
  };

  const colCls = columns === "auto" ? "" : columns === 1 ? "grid grid-cols-1" : columns === 2 ? "grid grid-cols-1 sm:grid-cols-2" : "grid grid-cols-1 sm:grid-cols-3";
  const sizeCls = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";

  return (
    <div className={cn("gap-2", columns === "auto" ? "flex flex-wrap" : colCls)}>
      {options.map((o) => {
        const on = value.includes(o.value);
        const atCap = !on && !!max && value.length >= max;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            disabled={atCap}
            className={cn(
              "rounded-md border transition-colors flex items-center gap-1.5",
              sizeCls,
              on
                ? "bg-primary text-primary-foreground border-primary"
                : atCap
                ? "bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed"
                : "bg-background text-foreground border-border hover-elevate",
            )}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            aria-pressed={on}
          >
            {on && <Check className="h-3 w-3" />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ChipSingleSelect<V extends string>({
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  options: readonly ChipOption<V>[];
  value: V | null;
  onChange: (v: V) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              on ? "bg-primary text-primary-foreground border-primary"
                 : "bg-background text-foreground border-border hover-elevate",
            )}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            aria-pressed={on}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function YesNoRadio({
  value,
  onChange,
  testId,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-xs" data-testid={testId}>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn("px-3 py-1.5 transition-colors", value ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}
        aria-pressed={value}
      >Yes</button>
      <div className="w-px bg-border" />
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn("px-3 py-1.5 transition-colors", !value ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}
        aria-pressed={!value}
      >No</button>
    </div>
  );
}
