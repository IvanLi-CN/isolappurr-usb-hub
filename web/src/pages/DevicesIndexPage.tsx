export function DevicesIndexPage() {
  return (
    <div className="flex flex-col gap-4" data-testid="devices-index">
      <div className="prose max-w-none">
        <h1>Ports Dashboard (Mock)</h1>
        <p>
          Select a device on the left, or add a new one. This plan delivers a UI
          skeleton only — real device telemetry/control will be added later.
        </p>
      </div>
    </div>
  );
}
