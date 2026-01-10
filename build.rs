fn main() {
    linker_be_nice();
    println!("cargo:rustc-link-arg=-Tdefmt.x");
    // make sure linkall.x is the last linker script (otherwise might cause problems with flip-link)
    println!("cargo:rustc-link-arg=-Tlinkall.x");

    // Re-run when Wi‑Fi config changes (Plan #0003).
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let env_path = std::path::Path::new(&manifest_dir).join(".env");
        println!("cargo:rerun-if-changed={}", env_path.display());
    }
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_SSID");
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_PSK");
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_HOSTNAME");
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_STATIC_IP");
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_NETMASK");
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_GATEWAY");
    println!("cargo:rerun-if-env-changed=USB_HUB_WIFI_DNS");

    // Inject Wi‑Fi configuration only when `net_http` feature is enabled, so
    // non-network builds don't require a local `.env`.
    if std::env::var_os("CARGO_FEATURE_NET_HTTP").is_some() {
        inject_wifi_cfg();
    }
}

fn linker_be_nice() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let kind = &args[1];
        let what = &args[2];

        match kind.as_str() {
            "undefined-symbol" => match what.as_str() {
                "_defmt_timestamp" => {
                    eprintln!();
                    eprintln!(
                        "Note: `defmt` not found - make sure `defmt.x` is added as a linker script and you have included `use defmt_rtt as _;`"
                    );
                    eprintln!();
                }
                "_stack_start" => {
                    eprintln!();
                    eprintln!("Note: Is the linker script `linkall.x` missing?");
                    eprintln!();
                }
                "esp_rtos_initialized" | "esp_rtos_yield_task" | "esp_rtos_task_create" => {
                    eprintln!();
                    eprintln!(
                        "Note: `esp-radio` has no scheduler enabled. Make sure you have initialized `esp-rtos` or provided an external scheduler."
                    );
                    eprintln!();
                }
                "embedded_test_linker_file_not_added_to_rustflags" => {
                    eprintln!();
                    eprintln!(
                        "Note: `embedded-test` not found - make sure `embedded-test.x` is added as a linker script for tests"
                    );
                    eprintln!();
                }
                _ => (),
            },
            // we don't have anything helpful for "missing-lib" yet
            _ => {
                std::process::exit(1);
            }
        }

        std::process::exit(0);
    }

    println!(
        "cargo:rustc-link-arg=-Wl,--error-handling-script={}",
        std::env::current_exe().unwrap().display()
    );
}

// -------------------------------------------------------------------------
// Wi‑Fi compile-time configuration (Plan #0003)
// -------------------------------------------------------------------------

fn inject_wifi_cfg() {
    use std::collections::HashMap;

    let mut cfg: HashMap<String, String> = HashMap::new();

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let env_path = std::path::Path::new(&manifest_dir).join(".env");
        if env_path.exists() {
            cfg.extend(load_env_file(&env_path));
        }
    }

    let ssid = get_wifi_cfg("USB_HUB_WIFI_SSID", &cfg);
    let psk = get_wifi_cfg("USB_HUB_WIFI_PSK", &cfg);

    if ssid.is_none() || psk.is_none() {
        eprintln!("error: Wi‑Fi config missing for net_http build.");
        eprintln!("Set USB_HUB_WIFI_SSID and USB_HUB_WIFI_PSK in `.env` or environment.");
        std::process::exit(1);
    }

    println!("cargo:rustc-env=USB_HUB_WIFI_SSID={}", ssid.unwrap());
    println!("cargo:rustc-env=USB_HUB_WIFI_PSK={}", psk.unwrap());

    if let Some(hostname) = get_wifi_cfg("USB_HUB_WIFI_HOSTNAME", &cfg) {
        println!("cargo:rustc-env=USB_HUB_WIFI_HOSTNAME={}", hostname);
    }
    if let Some(static_ip) = get_wifi_cfg("USB_HUB_WIFI_STATIC_IP", &cfg) {
        println!("cargo:rustc-env=USB_HUB_WIFI_STATIC_IP={}", static_ip);
    }
    if let Some(netmask) = get_wifi_cfg("USB_HUB_WIFI_NETMASK", &cfg) {
        println!("cargo:rustc-env=USB_HUB_WIFI_NETMASK={}", netmask);
    }
    if let Some(gateway) = get_wifi_cfg("USB_HUB_WIFI_GATEWAY", &cfg) {
        println!("cargo:rustc-env=USB_HUB_WIFI_GATEWAY={}", gateway);
    }
    if let Some(dns) = get_wifi_cfg("USB_HUB_WIFI_DNS", &cfg) {
        println!("cargo:rustc-env=USB_HUB_WIFI_DNS={}", dns);
    }
}

fn get_wifi_cfg(key: &str, cfg: &std::collections::HashMap<String, String>) -> Option<String> {
    if let Ok(v) = std::env::var(key) {
        if !v.trim().is_empty() {
            return Some(v);
        }
    }
    cfg.get(key).cloned().filter(|v| !v.trim().is_empty())
}

fn load_env_file(path: &std::path::Path) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();

    let Ok(contents) = std::fs::read_to_string(path) else {
        return out;
    };

    for raw_line in contents.lines() {
        let mut line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("export ") {
            line = rest.trim();
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }

        let mut value = value.trim();
        // Strip inline comments like `KEY=value # comment`.
        if let Some((before, _comment)) = value.split_once(" #") {
            value = before.trim();
        }
        if let Some((before, _comment)) = value.split_once("\t#") {
            value = before.trim();
        }

        // Strip surrounding quotes.
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = &value[1..value.len().saturating_sub(1)];
        }

        out.insert(key.to_string(), value.to_string());
    }

    out
}
