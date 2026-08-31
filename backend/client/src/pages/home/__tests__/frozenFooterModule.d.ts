/**
 * WAVE 218 — a type declaration for ONE frozen JavaScript module, and nothing else.
 *
 * `client/src/components/home3compo/Footer3.jsx` is a SACRED file. It is plain
 * JavaScript with no type declarations, so any TypeScript file that imports it
 * raises `TS7016: implicitly has an 'any' type`. `Home.tsx` already carries that
 * error, along with twelve more of the same shape for its sibling marketing
 * components — they are pre-existing and are not this wave's to fix.
 *
 * Wave 218's DOM test needs to mount the frozen footer ALONE, as the control
 * against which the interception's blast radius is measured. Importing it added a
 * fourteenth TS7016 to the tree, and the standing rule for this wave is that the
 * `tsc` count must not increase. Rather than suppress the error with a
 * `@ts-expect-error` comment — which hides the same problem behind a directive and
 * teaches the next reader nothing — the module is declared here, once, honestly
 * typed as untyped.
 *
 * SCOPE, DELIBERATELY NARROW. An ambient module declaration matches on the
 * SPECIFIER STRING, not on the file it resolves to. This declares only the
 * `@/`-aliased specifier. `Home.tsx` imports the same component by relative path
 * (`../../components/home3compo/Footer3`), which is a different string and is NOT
 * matched, so its pre-existing error is left exactly where it was rather than
 * being silently cleaned up by a side effect of a test's convenience. The
 * remaining twelve marketing components are not declared at all.
 *
 * The frozen file itself is untouched, and `npm run sacred` reports 48/48
 * byte-identical after this change.
 */
declare module "@/components/home3compo/Footer3" {
  const Footer3: React.ComponentType<Record<string, never>>;
  export default Footer3;
}
