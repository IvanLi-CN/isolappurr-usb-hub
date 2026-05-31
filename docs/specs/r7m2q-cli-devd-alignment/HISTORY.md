# History

- Created to align IsolaPurr host operation with the `isolapurr-devd` plus `isolapurr` model while preserving Web Serial as a first-class product path.
- Added initial implementation slice: host-tools package, skills, firmware catalog generator, Web Local USB API migration, and CI packaging workflow.
- Replaced CLI-to-devd localhost HTTP with local IPC as the default daemon transport; localhost HTTP is now an explicit bridge surface.
- Added IPC daemon idle shutdown semantics for on-demand clients.
