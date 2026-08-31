/**
 * WAVE 212 — TEST HELPER: GIVE THE AUTHORISED SIGN-OFF ON STEP 5.
 *
 * The create control on the round wizard's last step is inert until the founder has
 * typed a full legal name AND ticked the attestation (R186.2). Every existing client
 * test that clicks "Create round" therefore has to do what a founder does first.
 *
 * ONE HELPER, not a copy in each test, so the interaction cannot drift from the real
 * one and so `grep _w212SignOff` names every test that depends on the sign-off.
 *
 * IT DRIVES THE REAL CONTROLS by their test ids on the really-mounted wizard — it
 * does not set component state, stub the gate, or fake completion.
 */
import { fireEvent, screen } from "@testing-library/react";

/** The name the client suite signs with when the test does not care which name. */
export const W212_TEST_SIGNED_NAME = "Test Founder";

export function w212SignOff(name: string = W212_TEST_SIGNED_NAME): void {
  fireEvent.change(screen.getByTestId("input-round-attestation-legalname"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByTestId("checkbox-round-attestation-accept"));
}
