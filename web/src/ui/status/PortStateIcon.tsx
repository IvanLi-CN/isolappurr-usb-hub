export type PortStateIconKind =
  | "power-on"
  | "power-off"
  | "data-linked"
  | "data-unlinked";

export type PortStateChannel = "power" | "data";

export function portStateIconKind(
  channel: PortStateChannel,
  enabled: boolean,
): PortStateIconKind {
  if (channel === "data") {
    return enabled ? "data-linked" : "data-unlinked";
  }
  return enabled ? "power-on" : "power-off";
}

export function portStateLabel(
  channel: PortStateChannel,
  enabled: boolean,
): string {
  if (channel === "data") {
    return enabled ? "Data link connected" : "Data link disconnected";
  }
  return enabled ? "Power on" : "Power off";
}

export function PortStateIcon({
  kind,
  className = "h-4 w-4",
}: {
  kind: PortStateIconKind;
  className?: string;
}) {
  if (kind === "power-on" || kind === "power-off") {
    return (
      <svg
        aria-hidden="true"
        className={`shrink-0 ${className}`}
        data-status-icon={kind}
        fill="none"
        role="presentation"
        viewBox="0 0 16 16"
      >
        <path
          d="M8 2.3v5.1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <path
          d="M4.8 4.5a5 5 0 1 0 6.4 0"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        {kind === "power-off" ? (
          <path
            d="m3 3 10 10"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
        ) : null}
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      data-status-icon={kind}
      fill="none"
      role="presentation"
      viewBox="0 0 16 16"
    >
      <path
        d="m6.3 9.7-1.1 1.1a2.45 2.45 0 0 1-3.5-3.5l2.2-2.2a2.45 2.45 0 0 1 3.5 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m9.7 6.3 1.1-1.1a2.45 2.45 0 0 1 3.5 3.5l-2.2 2.2a2.45 2.45 0 0 1-3.5 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      {kind === "data-linked" ? (
        <path
          d="m5.8 10.2 4.4-4.4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      ) : (
        <path
          d="m3 3 10 10"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      )}
    </svg>
  );
}
