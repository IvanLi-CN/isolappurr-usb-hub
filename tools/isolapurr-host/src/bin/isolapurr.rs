use anyhow::{Context as _, anyhow};
use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use crossterm::terminal;
use dialoguer::{MultiSelect, Select};
use isolapurr_host::{
    DeviceIdentity, DeviceProfile, DeviceProfileTransports, DeviceRecord, FirmwareCatalog,
    SavedHardwareInput, api_url, default_ipc_endpoint, ipc_call, read_hardware_registry,
    redact_sensitive, registry_path, save_hardware,
};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use ratatui::{
    DefaultTerminal, Frame, TerminalOptions, Viewport,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Clear, List, ListItem, ListState, Paragraph, Wrap},
};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::{self, IsTerminal as _},
    path::PathBuf,
    process::{Command as ProcessCommand, Stdio},
    time::{Duration, Instant},
};

include!("isolapurr/cli.rs");
include!("isolapurr/app.rs");
include!("isolapurr/format.rs");
include!("isolapurr/power_support.rs");
include!("isolapurr/source_capability_tui.rs");
include!("isolapurr/power_runtime.rs");
include!("isolapurr/platform.rs");
include!("isolapurr/discover.rs");
include!("isolapurr/tests.rs");
