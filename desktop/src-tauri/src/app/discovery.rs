impl DiscoveryController {
    fn new(mdns: Option<ServiceDaemon>, mdns_error: Option<String>, http: reqwest::Client) -> Self {
        let mdns_unavailable = mdns.is_none();
        let error = if mdns_unavailable {
            Some(
                mdns_error
                    .clone()
                    .unwrap_or_else(|| mdns_unavailable_message("mdns unavailable")),
            )
        } else {
            mdns_error.clone()
        };

        Self {
            snapshot: RwLock::new(DiscoverySnapshot {
                mode: DiscoveryMode::Service,
                status: if mdns.is_some() {
                    DiscoveryStatus::Scanning
                } else {
                    DiscoveryStatus::Unavailable
                },
                devices: Vec::new(),
                error,
                scan: None,
                ip_scan: IpScanSnapshot::default(),
            }),
            ip_scan_cancel: RwLock::new(CancellationToken::new()),
            mdns,
            mdns_error,
            mdns_unavailable: AtomicBool::new(mdns_unavailable),
            http,
        }
    }

    async fn start_mdns_background(self: &Arc<Self>) {
        let Some(mdns) = self.mdns.as_ref() else {
            return;
        };

        let receiver = match mdns.browse("_http._tcp.local.") {
            Ok(receiver) => receiver,
            Err(err) => {
                let message = mdns_unavailable_message(&format!("browse failed: {err}"));
                let mut snapshot = self.snapshot.write().await;
                snapshot.mode = DiscoveryMode::Service;
                snapshot.status = DiscoveryStatus::Unavailable;
                snapshot.error = Some(message);
                self.mdns_unavailable.store(true, Ordering::Relaxed);
                return;
            }
        };

        let this = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let event = receiver.recv_async().await;
                let Ok(event) = event else {
                    break;
                };
                if let Err(err) = this.handle_mdns_event(event).await {
                    tracing::debug!("mdns event: {err:#}");
                }
            }
        });
    }

    async fn handle_mdns_event(&self, event: ServiceEvent) -> anyhow::Result<()> {
        let resolved = match event {
            ServiceEvent::ServiceResolved(service) => {
                if !service.is_valid() {
                    return Ok(());
                }
                let host = service.get_hostname().trim_end_matches('.').to_string();
                let port = service.get_port();
                let ipv4 = service.get_addresses_v4().into_iter().next();
                ResolvedService {
                    hostname: host,
                    port,
                    ipv4,
                }
            }
            _ => return Ok(()),
        };

        self.handle_resolved(resolved).await
    }

    async fn handle_resolved(&self, resolved: ResolvedService) -> anyhow::Result<()> {
        let now = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
        let ip = resolved.ipv4.map(|v| v.to_string());
        // Prefer verifying via IPv4 (works even when the OS resolver can't resolve `.local`).
        let candidate_base = if let Some(ip) = ip.as_deref() {
            if resolved.port == 80 {
                format!("http://{ip}")
            } else {
                format!("http://{ip}:{}", resolved.port)
            }
        } else if resolved.port == 80 {
            format!("http://{}", resolved.hostname.as_str())
        } else {
            format!("http://{}:{}", resolved.hostname.as_str(), resolved.port)
        };

        tracing::debug!(
            hostname = resolved.hostname.as_str(),
            port = resolved.port,
            ipv4 = ?resolved.ipv4,
            base_url = candidate_base.as_str(),
            "discovery candidate resolved"
        );

        if let Some(device) = self
            .validate_device(&candidate_base, ip.as_deref(), &now)
            .await?
        {
            self.merge_device(device).await;
        }

        Ok(())
    }

    async fn validate_device(
        &self,
        base_url: &str,
        scanned_ipv4: Option<&str>,
        now_rfc3339: &str,
    ) -> anyhow::Result<Option<DiscoveredDevice>> {
        let url = format!("{base_url}/api/v1/info");
        let res = match self.http.get(&url).send().await {
            Ok(res) => res,
            Err(err) => {
                tracing::debug!(
                    base_url,
                    error = %err,
                    "discovery candidate request failed"
                );
                return Ok(None);
            }
        };
        if !res.status().is_success() {
            tracing::debug!(
                base_url,
                status = %res.status(),
                "discovery candidate rejected (non-2xx)"
            );
            return Ok(None);
        }
        let value: serde_json::Value = match res.json().await {
            Ok(value) => value,
            Err(err) => {
                tracing::debug!(
                    base_url,
                    error = %err,
                    "discovery candidate rejected (invalid json)"
                );
                return Ok(None);
            }
        };
        let Some(device) = parse_device_from_api_info(base_url, value, scanned_ipv4, now_rfc3339)
        else {
            tracing::debug!(
                base_url,
                "discovery candidate rejected (schema/firmware mismatch)"
            );
            return Ok(None);
        };
        tracing::debug!(
            base_url,
            device_id = ?device.device_id,
            "discovery candidate accepted"
        );
        Ok(Some(device))
    }

    async fn merge_device(&self, device: DiscoveredDevice) {
        let mut snapshot = self.snapshot.write().await;
        snapshot.error = None;

        let key = device_dedup_key(&device);
        let mut map: HashMap<String, DiscoveredDevice> = snapshot
            .devices
            .drain(..)
            .map(|d| (device_dedup_key(&d), d))
            .collect();
        let merged = if let Some(existing) = map.remove(&key) {
            DiscoveredDevice {
                base_url: device.base_url,
                device_id: device.device_id.or(existing.device_id),
                hostname: device.hostname.or(existing.hostname),
                fqdn: device.fqdn.or(existing.fqdn),
                ipv4: device.ipv4.or(existing.ipv4),
                variant: device.variant.or(existing.variant),
                firmware: device.firmware.or(existing.firmware),
                last_seen_at: device.last_seen_at.or(existing.last_seen_at),
            }
        } else {
            device
        };
        map.insert(key, merged);
        snapshot.devices = map.into_values().collect();
        snapshot.status = DiscoveryStatus::Ready;
    }

    async fn snapshot(&self) -> DiscoverySnapshot {
        let mut snapshot = self.snapshot.read().await.clone();
        snapshot.ip_scan = build_ip_scan_snapshot();
        snapshot
    }

    async fn refresh_services(&self) -> anyhow::Result<()> {
        if self.mdns.is_none() || self.mdns_unavailable.load(Ordering::Relaxed) {
            let message = self
                .mdns_error
                .clone()
                .unwrap_or_else(|| mdns_unavailable_message("mdns unavailable"));
            let mut snapshot = self.snapshot.write().await;
            snapshot.mode = DiscoveryMode::Service;
            snapshot.status = DiscoveryStatus::Unavailable;
            snapshot.error = Some(message);
            snapshot.scan = None;
            return Err(anyhow!("mdns unavailable"));
        }

        let mut snapshot = self.snapshot.write().await;
        snapshot.mode = DiscoveryMode::Service;
        snapshot.status = DiscoveryStatus::Scanning;
        snapshot.error = None;
        snapshot.scan = None;
        Ok(())
    }

    async fn start_ip_scan(self: &Arc<Self>, cidr: String) -> anyhow::Result<()> {
        let net: ipnet::Ipv4Net = cidr.parse().context("invalid cidr")?;
        let hosts: Vec<Ipv4Addr> = net.hosts().collect();
        if hosts.is_empty() {
            return Err(anyhow!("empty cidr"));
        }

        self.cancel_ip_scan().await;
        let cancel = CancellationToken::new();
        *self.ip_scan_cancel.write().await = cancel.clone();

        {
            let mut snapshot = self.snapshot.write().await;
            snapshot.mode = DiscoveryMode::Scan;
            snapshot.status = DiscoveryStatus::Scanning;
            snapshot.devices.clear();
            snapshot.error = None;
            snapshot.scan = Some(ScanState {
                cidr: cidr.clone(),
                done: 0,
                total: hosts.len().try_into().unwrap_or(u32::MAX),
            });
        }

        let http = self.http.clone();
        let this = Arc::clone(self);
        let now_base = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

        let max_concurrency = 24usize;
        tokio::spawn(async move {
            let mut done: u32 = 0;
            let stream = stream::iter(hosts.into_iter().map(|ip| ip.to_string()))
                .map(|ip| {
                    let http = http.clone();
                    let cancel = cancel.clone();
                    let now_base = now_base.clone();
                    async move {
                        if cancel.is_cancelled() {
                            return None;
                        }
                        let base = format!("http://{ip}");
                        let url = format!("{base}/api/v1/info");
                        let res = http.get(url).send().await.ok()?;
                        if !res.status().is_success() {
                            return None;
                        }
                        let value: serde_json::Value = res.json().await.ok()?;
                        parse_device_from_api_info(&base, value, Some(&ip), &now_base)
                    }
                })
                .buffer_unordered(max_concurrency);

            tokio::pin!(stream);
            while let Some(item) = stream.next().await {
                if cancel.is_cancelled() {
                    break;
                }
                done += 1;
                {
                    let mut snapshot = this.snapshot.write().await;
                    if let Some(scan) = snapshot.scan.as_mut() {
                        scan.done = done;
                    }
                }
                if let Some(device) = item {
                    this.merge_device(device).await;
                }
            }

            let mut snapshot = this.snapshot.write().await;
            snapshot.status = if cancel.is_cancelled() {
                DiscoveryStatus::Idle
            } else {
                DiscoveryStatus::Ready
            };
        });

        Ok(())
    }

    async fn cancel_ip_scan(&self) {
        self.ip_scan_cancel.read().await.cancel();
        let mut snapshot = self.snapshot.write().await;
        snapshot.status = DiscoveryStatus::Idle;
        snapshot.scan = None;
    }
}

#[tauri::command]
async fn discovery_snapshot(
    state: tauri::State<'_, AppState>,
) -> Result<DiscoverySnapshot, String> {
    Ok(state.discovery.snapshot().await)
}

#[derive(Clone, Debug)]
struct LanIface {
    name: String,
    friendly_name: Option<String>,
    if_type: InterfaceType,
    is_up: bool,
    is_loopback: bool,
    is_tun: bool,
    ipv4: Vec<LanIpv4Net>,
}

#[derive(Clone, Debug)]
struct LanIpv4Net {
    addr: Ipv4Addr,
    prefix_len: u8,
    network: Ipv4Addr,
}

fn build_ip_scan_snapshot() -> IpScanSnapshot {
    let interfaces = default_net::get_interfaces();
    let default_iface_name = default_net::get_default_interface().ok().map(|i| i.name);
    let ifaces: Vec<LanIface> = interfaces
        .iter()
        .map(|iface| LanIface {
            name: iface.name.clone(),
            friendly_name: iface.friendly_name.clone(),
            if_type: iface.if_type,
            is_up: iface.is_up(),
            is_loopback: iface.is_loopback(),
            is_tun: iface.is_tun(),
            ipv4: iface
                .ipv4
                .iter()
                .map(|net| LanIpv4Net {
                    addr: net.addr,
                    prefix_len: net.prefix_len,
                    network: net.network(),
                })
                .collect(),
        })
        .collect();
    let (default_cidr, candidates) = compute_lan_candidates(&ifaces, default_iface_name.as_deref());
    IpScanSnapshot {
        expanded: false,
        expanded_by: None,
        auto_expand_after_ms: None,
        default_cidr,
        candidates: Some(candidates),
    }
}

fn compute_lan_candidates(
    interfaces: &[LanIface],
    default_iface_name: Option<&str>,
) -> (Option<String>, Vec<LanCandidate>) {
    let mut out: Vec<LanCandidate> = Vec::new();

    for iface in interfaces {
        if !iface.is_up || iface.is_loopback || iface.is_tun {
            continue;
        }
        if matches!(
            iface.if_type,
            InterfaceType::Loopback | InterfaceType::Tunnel | InterfaceType::Ppp
        ) {
            continue;
        }

        let kind = iface
            .friendly_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| Some(short_iface_kind(&iface.if_type)));

        let label = kind.and_then(|kind| {
            let name = iface.name.trim();
            let kind = kind.trim();
            if kind.is_empty() {
                return None;
            }
            if name.is_empty() || kind.eq_ignore_ascii_case(name) {
                return Some(kind.to_string());
            }
            Some(format!("{kind} ({name})"))
        });

        for net in &iface.ipv4 {
            let ipv4 = net.addr;
            if !ipv4.is_private() || ipv4.is_loopback() || ipv4.is_link_local() {
                continue;
            }
            let cidr = format!("{}/{}", net.network, net.prefix_len);
            let primary = default_iface_name
                .map(|name| name == iface.name)
                .unwrap_or(false);

            out.push(LanCandidate {
                cidr,
                label: label.clone(),
                r#interface: Some(iface.name.clone()),
                ipv4: Some(ipv4.to_string()),
                primary: Some(primary),
            });
        }
    }

    out.sort_by(|a, b| {
        let ap = a.primary.unwrap_or(false);
        let bp = b.primary.unwrap_or(false);
        bp.cmp(&ap)
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.cidr.cmp(&b.cidr))
    });

    let primary_default = out
        .iter()
        .find(|c| c.primary.unwrap_or(false))
        .map(|c| c.cidr.clone());
    let default_cidr = if primary_default.is_some() {
        primary_default
    } else if out.len() == 1 {
        out.first().map(|c| c.cidr.clone())
    } else {
        None
    };

    (default_cidr, out)
}

fn short_iface_kind(ty: &InterfaceType) -> String {
    match ty {
        InterfaceType::Wireless80211 => "Wi-Fi".to_string(),
        InterfaceType::Ethernet => "Ethernet".to_string(),
        _ => ty.name(),
    }
}

fn device_dedup_key(device: &DiscoveredDevice) -> String {
    if let Some(id) = device.device_id.as_deref() {
        let id = id.trim();
        if !id.is_empty() {
            return format!("id:{id}");
        }
    }
    format!("url:{}", device.base_url.trim())
}

#[derive(Debug, Deserialize)]
struct ApiInfoEnvelope {
    device: ApiDeviceInfo,
}

#[derive(Debug, Deserialize)]
struct ApiDeviceInfo {
    device_id: Option<String>,
    hostname: Option<String>,
    fqdn: Option<String>,
    variant: Option<String>,
    firmware: Option<ApiFirmware>,
    wifi: Option<ApiWifi>,
}

#[derive(Debug, Deserialize)]
struct ApiFirmware {
    name: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiWifi {
    ipv4: Option<String>,
}

fn parse_device_from_api_info(
    base_url_by_ip_or_host: &str,
    value: serde_json::Value,
    scanned_ipv4: Option<&str>,
    now_rfc3339: &str,
) -> Option<DiscoveredDevice> {
    let env: ApiInfoEnvelope = serde_json::from_value(value).ok()?;

    let fw_name = env
        .device
        .firmware
        .as_ref()?
        .name
        .as_ref()?
        .trim()
        .to_string();
    if fw_name != "isolapurr-usb-hub" {
        return None;
    }
    let fw_version = env
        .device
        .firmware
        .as_ref()?
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let fqdn = env.device.fqdn.as_ref().and_then(|s| {
        let s = s.trim();
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    });

    // Always prefer the base URL we actually used to validate the device (IP or resolvable hostname).
    // `.local` name resolution can be broken on some systems; using IPv4 keeps the UX reliable.
    let preferred_base_url = base_url_by_ip_or_host.to_string();

    Some(DiscoveredDevice {
        base_url: preferred_base_url,
        device_id: env.device.device_id,
        hostname: env.device.hostname,
        fqdn,
        ipv4: env
            .device
            .wifi
            .and_then(|w| w.ipv4)
            .or_else(|| scanned_ipv4.map(|s| s.to_string())),
        variant: env.device.variant,
        firmware: Some(FirmwareInfo {
            name: fw_name,
            version: fw_version,
        }),
        last_seen_at: Some(now_rfc3339.to_string()),
    })
}
