/**
 * Sprint 8 — Searchable country picker built on the shadcn Command palette.
 * Used everywhere a country code is captured. The value is the ISO-3166 α2
 * code (production: country_code text column).
 */
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES } from "@/lib/profile/data/countries";

export function CountryPicker({
  value,
  onChange,
  placeholder = "Select country…",
  testId,
  disabled,
}: {
  value: string; // ISO α2 code, "" means none
  onChange: (code: string) => void;
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = COUNTRIES.find(c => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]" align="start">
        <Command filter={(value, search) => {
          const v = value.toLowerCase();
          const s = search.toLowerCase().trim();
          return s === "" || v.includes(s) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search countries…" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.code}`}
                  onSelect={() => { onChange(c.code); setOpen(false); }}
                  data-testid={`option-country-${c.code}`}
                >
                  <Check className={cn("mr-2 h-4 w-4", c.code === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">{c.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function PhoneCountryPicker({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (code: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = COUNTRIES.find(c => c.code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-mono w-[6.5rem] text-xs"
          data-testid={testId}
        >
          <span className="truncate">{selected?.dialCode ?? "+—"}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command filter={(value, search) => {
          const v = value.toLowerCase();
          const s = search.toLowerCase().trim();
          return s === "" || v.includes(s) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search dial code…" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.filter(c => !!c.dialCode).map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.dialCode}`}
                  onSelect={() => { onChange(c.code); setOpen(false); }}
                  data-testid={`option-phone-${c.code}`}
                >
                  <Check className={cn("mr-2 h-4 w-4", c.code === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="ml-2 text-xs font-mono text-muted-foreground">{c.dialCode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
