/**
 * Wave C-3 — CollectivePreview redirect.
 *
 * The old /collective/preview route is superseded by the full Collective shell.
 * Any deep link to /collective/preview will redirect to the real dashboard.
 * File is kept (not deleted) so existing test imports continue to resolve.
 */
import { Redirect } from "wouter";

export default function CollectivePreview() {
  return <Redirect to="/collective/dashboard" />;
}
