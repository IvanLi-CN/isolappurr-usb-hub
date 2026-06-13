# History

## 2026-06-13

- Defined root firmware `cargo test` as an unsupported invocation because the
  repository default target is `xtensa-esp32s3-none-elf`.
- Added a shared `no_std` firmware core crate for host-runnable pure logic.
- Kept runtime, driver, transport, and HIL behavior in the root firmware crate.
- Added local and CI validation entrypoints for shared core host tests without
  changing the existing firmware workflow check name.
