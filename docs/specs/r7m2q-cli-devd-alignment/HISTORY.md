# History

- Created to align IsolaPurr host operation with the `isolapurr-devd` plus `isolapurr` model while preserving Web Serial as a first-class product path.
- Added initial implementation slice: host-tools package, skills, firmware catalog generator, Web Local USB API migration, and CI packaging workflow.
- Replaced CLI-to-devd localhost HTTP with local IPC as the default daemon transport; localhost HTTP is now an explicit bridge surface.
- Added IPC daemon idle shutdown semantics for on-demand clients.
- Added Local USB firmware guard requirements for project identity, compatibility, non-project firmware, and download-mode confirmation.
- Added official user-machine host-tools installers so `isolapurr-user-operations` can install released CLI/devd tools without requiring a source checkout.
- Tightened the user skill install gate so missing released host tools or unavailable installer assets cannot be answered with raw system USB/serial enumeration.
- Clarified and implemented `isolapurr discover` so LAN results come from live
  mDNS discovery, USB results come from the current local scan, and saved
  hardware only annotates matching live results instead of standing in for
  discovery.
- Tightened discover annotation rendering so one live result surfaces only one
  canonical saved hardware record instead of echoing duplicate saved entries
  from alternate transports of the same device.
