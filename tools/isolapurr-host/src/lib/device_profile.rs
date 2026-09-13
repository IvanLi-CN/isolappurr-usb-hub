#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HardwareRegistry {
    pub schema_version: u8,
    #[serde(default)]
    pub devices: Vec<DeviceProfile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProfile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_name_cache: Option<DeviceNameCache>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transports: Option<DeviceProfileTransports>,
    #[serde(
        default,
        rename = "transport",
        skip_serializing,
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) legacy_transport: Option<LegacyHardwareTransport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<DeviceIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "state", content = "value", rename_all = "lowercase")]
pub enum DeviceNameCache {
    Unknown,
    Unset,
    Value(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum LegacyHardwareTransport {
    Usb {
        #[serde(alias = "deviceId")]
        device_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        devd_url: Option<String>,
    },
    Http {
        base_url: String,
    },
    WebSerial {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProfileTransports {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_usb_port_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_serial_label: Option<String>,
}

impl DeviceProfile {
    pub fn http_base_url(&self) -> Option<&str> {
        self.transports
            .as_ref()
            .and_then(|transports| transports.http_base_url.as_deref())
    }

    pub fn local_usb_port_path(&self) -> Option<&str> {
        self.transports
            .as_ref()
            .and_then(|transports| transports.local_usb_port_path.as_deref())
    }

    pub fn web_serial_label(&self) -> Option<&str> {
        self.transports
            .as_ref()
            .and_then(|transports| transports.web_serial_label.as_deref())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SavedHardwareInput {
    pub device_id: String,
    pub name: String,
    pub hostname: Option<String>,
    pub transports: DeviceProfileTransports,
    pub identity: Option<DeviceIdentity>,
    pub device_name_cache: Option<DeviceNameCache>,
}
