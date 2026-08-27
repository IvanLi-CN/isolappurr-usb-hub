# ADR 0001: IP Scan Session Ownership and Retention

## Context

The Add device dialog combines desktop service discovery, browser IP scans, and manual device creation. A completed scan is useful when the dialog is reopened shortly afterwards, but an unbounded or shared history would present stale devices and blur ownership between live discovery and a scan in progress.

## Decision

- Store only the latest completed IP scan in the current browser profile. Keep live and demo modes in separate storage namespaces.
- Store the normalized CIDR, deduplicated discovered devices, completion time, and an expiry exactly ten minutes after completion. A completed scan with zero devices replaces the previous record.
- Evaluate expiry when Add device opens. Expired data is removed and is not rendered. Do not persist typed-but-unstarted input, partial results, cancellations, failures, or browser private-network blocks.
- Keep desktop service discovery devices separate from scan devices. Each desktop scan receives a monotonic `runId`; clients accept progress and completion only for the run they started.
- After a discovered device is added, keep the dialog open while another deduplicated result remains addable. Close and navigate only after the final addable result succeeds.
- Every dialog close path cancels the owned browser or desktop scan so partial work cannot be committed as a completed session.

## Consequences

The browser owns short-lived scan memory and the desktop agent owns only live process state. Reopening the dialog is deterministic, while a long-lived device database or cross-tab scan coordinator is unnecessary. The UI must merge live, current-run, and unexpired cached results before calculating addability.

## Rejected Alternatives

- Persisting every scan or retaining a history would increase stale-device risk and create cleanup policy without product value.
- Reusing the desktop service-discovery list for scan results would allow refresh and mDNS events to erase or resurrect a scan.
- Closing after every successful add would force repeated discovery and lose the operator's multi-device workflow.
