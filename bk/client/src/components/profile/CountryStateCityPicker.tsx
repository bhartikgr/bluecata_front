/**
 * Sprint 21 Wave E — Cascading Country → State → City picker.
 *
 * Three dropdowns rendered side-by-side.
 * When the country has structured state/city data (US, CA, GB, AU, SG, HK, IN, JP)
 * the dependent pickers are Select dropdowns. For all other countries, state and
 * city fall back to free-text Input elements so the user can still enter them.
 *
 * Emits an `onDialCodeChange` callback when the country selection changes so the
 * parent can auto-update the phone dial code (E4).
 */
import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CountryPicker } from "@/components/profile/CountryPicker";
import { REGIONS, getDialCodeForCountry } from "@/lib/profile/data/regionsData";
import { COUNTRIES } from "@/lib/profile/data/countries";

export interface CountryStateCityValue {
  countryCode: string;
  stateProvince: string;
  city: string;
}

interface Props {
  value: CountryStateCityValue;
  onChange: (next: CountryStateCityValue) => void;
  /** Called with the new dial code whenever the country changes */
  onDialCodeChange?: (dialCode: string) => void;
  /** data-testid prefix */
  testIdPrefix?: string;
}

export function CountryStateCityPicker({
  value,
  onChange,
  onDialCodeChange,
  testIdPrefix = "csc",
}: Props) {
  const regionEntry = REGIONS[value.countryCode];
  const states = regionEntry?.states ?? [];
  const selectedState = states.find((s) => s.code === value.stateProvince);
  const cities = selectedState?.cities ?? [];

  // When country changes: notify dial-code listeners
  useEffect(() => {
    if (!value.countryCode) return;
    const dialCode = getDialCodeForCountry(value.countryCode);
    if (dialCode && onDialCodeChange) {
      onDialCodeChange(dialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.countryCode]);

  const handleCountryChange = (code: string) => {
    onChange({ countryCode: code, stateProvince: "", city: "" });
  };

  const handleStateChange = (stateCode: string) => {
    onChange({ ...value, stateProvince: stateCode, city: "" });
  };

  const handleCityChange = (city: string) => {
    onChange({ ...value, city });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Country */}
      <div className="space-y-1.5">
        <Label>Country</Label>
        <CountryPicker
          value={value.countryCode}
          onChange={handleCountryChange}
          testId={`${testIdPrefix}-country`}
        />
      </div>

      {/* State / Province */}
      <div className="space-y-1.5">
        <Label>State / Province</Label>
        {states.length > 0 ? (
          <Select
            value={value.stateProvince}
            onValueChange={handleStateChange}
          >
            <SelectTrigger data-testid={`${testIdPrefix}-state`}>
              <SelectValue placeholder="Select state…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {states.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={value.stateProvince}
            onChange={(e) =>
              onChange({ ...value, stateProvince: e.target.value })
            }
            placeholder="e.g. Ontario"
            data-testid={`${testIdPrefix}-state`}
          />
        )}
      </div>

      {/* City */}
      <div className="space-y-1.5">
        <Label>City</Label>
        {cities.length > 0 ? (
          <Select value={value.city} onValueChange={handleCityChange}>
            <SelectTrigger data-testid={`${testIdPrefix}-city`}>
              <SelectValue placeholder="Select city…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })}
            placeholder="e.g. Toronto"
            data-testid={`${testIdPrefix}-city`}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Utility: look up the dial code for a given country code using both REGIONS
 * and the base COUNTRIES list as a fallback.
 */
export function resolveDialCode(countryCode: string): string | undefined {
  const fromRegions = getDialCodeForCountry(countryCode);
  if (fromRegions) return fromRegions;
  const fromCountries = COUNTRIES.find((c) => c.code === countryCode);
  return fromCountries?.dialCode;
}
