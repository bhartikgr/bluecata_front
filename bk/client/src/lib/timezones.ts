/**
 * Sprint 18 T11.1 — IANA timezone list for Settings selector.
 *
 * Curated set covering Capavate's 9 supported regions plus common UTC offsets.
 * Browser-detected timezone is selected by default at first render.
 */
export const TIMEZONES_IANA: Array<{ value: string; label: string; region: string }> = [
  // Americas
  { value: "America/Toronto",      label: "Toronto (EST/EDT)",       region: "Americas" },
  { value: "America/New_York",     label: "New York (EST/EDT)",      region: "Americas" },
  { value: "America/Chicago",      label: "Chicago (CST/CDT)",       region: "Americas" },
  { value: "America/Denver",       label: "Denver (MST/MDT)",        region: "Americas" },
  { value: "America/Los_Angeles",  label: "Los Angeles (PST/PDT)",   region: "Americas" },
  { value: "America/Vancouver",    label: "Vancouver (PST/PDT)",     region: "Americas" },
  { value: "America/Sao_Paulo",    label: "São Paulo (BRT)",         region: "Americas" },
  { value: "America/Mexico_City",  label: "Mexico City (CST)",       region: "Americas" },
  // Europe
  { value: "Europe/London",        label: "London (GMT/BST)",        region: "Europe" },
  { value: "Europe/Dublin",        label: "Dublin (GMT/IST)",        region: "Europe" },
  { value: "Europe/Paris",         label: "Paris (CET/CEST)",        region: "Europe" },
  { value: "Europe/Berlin",        label: "Berlin (CET/CEST)",       region: "Europe" },
  { value: "Europe/Amsterdam",     label: "Amsterdam (CET/CEST)",    region: "Europe" },
  { value: "Europe/Zurich",        label: "Zürich (CET/CEST)",       region: "Europe" },
  { value: "Europe/Stockholm",     label: "Stockholm (CET/CEST)",    region: "Europe" },
  { value: "Europe/Madrid",        label: "Madrid (CET/CEST)",       region: "Europe" },
  // Asia Pacific
  { value: "Asia/Singapore",       label: "Singapore (SGT)",         region: "APAC" },
  { value: "Asia/Hong_Kong",       label: "Hong Kong (HKT)",         region: "APAC" },
  { value: "Asia/Shanghai",        label: "Shanghai (CST)",          region: "APAC" },
  { value: "Asia/Tokyo",           label: "Tokyo (JST)",             region: "APAC" },
  { value: "Asia/Seoul",           label: "Seoul (KST)",             region: "APAC" },
  { value: "Asia/Kolkata",         label: "Mumbai / Delhi (IST)",    region: "APAC" },
  { value: "Asia/Dubai",           label: "Dubai (GST)",             region: "APAC" },
  { value: "Asia/Bangkok",         label: "Bangkok (ICT)",           region: "APAC" },
  { value: "Asia/Jakarta",         label: "Jakarta (WIB)",           region: "APAC" },
  { value: "Asia/Manila",          label: "Manila (PHT)",            region: "APAC" },
  { value: "Asia/Taipei",          label: "Taipei (CST)",            region: "APAC" },
  { value: "Asia/Ho_Chi_Minh",     label: "Ho Chi Minh (ICT)",       region: "APAC" },
  { value: "Asia/Tel_Aviv",        label: "Tel Aviv (IST)",          region: "APAC" },
  // Australia / NZ
  { value: "Australia/Sydney",     label: "Sydney (AEST/AEDT)",      region: "Oceania" },
  { value: "Australia/Melbourne",  label: "Melbourne (AEST/AEDT)",   region: "Oceania" },
  { value: "Australia/Perth",      label: "Perth (AWST)",            region: "Oceania" },
  { value: "Pacific/Auckland",     label: "Auckland (NZST/NZDT)",    region: "Oceania" },
  // Africa
  { value: "Africa/Johannesburg",  label: "Johannesburg (SAST)",     region: "Africa" },
  // UTC
  { value: "UTC",                  label: "UTC (Coordinated Universal Time)", region: "UTC" },
];

export function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TIMEZONES_IANA.some(t => t.value === tz)) return tz;
    return tz ?? "UTC";
  } catch {
    return "UTC";
  }
}
