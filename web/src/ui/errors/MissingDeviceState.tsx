import { ErrorState } from "./ErrorState";

export function MissingDeviceState() {
  return (
    <ErrorState
      code="404"
      title="Device entry not found"
      description="This saved device is no longer available in local storage. Return to a known screen to pick another hub or add it again."
      pathTestId="device-not-found-path"
      testId="device-not-found"
      actions={[
        { label: "Dashboard", to: "/", variant: "primary" },
        { label: "About", to: "/about", variant: "secondary" },
      ]}
    />
  );
}
