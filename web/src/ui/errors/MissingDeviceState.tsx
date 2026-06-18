import { ErrorState } from "./ErrorState";

export function MissingDeviceState() {
  return (
    <ErrorState
      code="404"
      title="Device entry not found"
      description="The selected device is no longer in local storage. Return to Dashboard to pick another saved hub or add a new one."
      eyebrow="Saved device state"
      testId="device-not-found"
      actions={[
        { label: "Back to Dashboard", to: "/", variant: "primary" },
        { label: "About", to: "/about", variant: "secondary" },
      ]}
    />
  );
}
