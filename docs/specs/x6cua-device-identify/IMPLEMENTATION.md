# Implementation

- Firmware holds an identify request generation in shared API state and consumes it in the main runtime.
- The reusable firmware-core `IdentifyState` owns the fixed deadline and border phase calculations.
- The prompt-tone manager owns the looping identify audio, so safety and error events can preempt it immediately.
- Web runtime dispatch uses the existing HTTP, Web Serial, and Local USB transport arbitration.
