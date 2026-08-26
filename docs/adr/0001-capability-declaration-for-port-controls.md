# Capability Declaration For Port Controls

Port control availability is decided from the versioned capability declaration carried by the device `ports` response over both HTTP and USB JSONL, rather than from firmware version mapping or a state-changing probe. The aggregate response declares `capability_schema: 1`; `GET /api/v1/ports/:portId` declares the same field at its response root. Each port `capabilities` object must explicitly carry every version-1 port action capability. A declared `true` enables the action, a declared `false` is explicitly unsupported, and a missing or unrecognized declaration is unknown and remains safely unavailable without being described as unsupported.

## Considered Options

- Maintain a Web firmware-version table. This would drift as releases and transport paths evolve.
- Probe `POST /data`. This would use a state-changing operation to discover compatibility.

## Consequences

- HTTP `GET /api/v1/ports`, HTTP `GET /api/v1/ports/:portId`, and USB JSONL `ports.get` carry equivalent schema and capability values.
- A missing required capability in a known schema is malformed for that capability and is treated as unknown, not as `false`.
- Older devices remain safe: their missing schema leaves controls disabled, with an evidence-based unknown-capability explanation.
