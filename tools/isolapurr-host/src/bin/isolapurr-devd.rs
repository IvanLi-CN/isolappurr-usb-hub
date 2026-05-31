use clap::{Parser, Subcommand};
use isolapurr_host::{
    DEFAULT_BIND, DevdConfig, IpcConfig, default_ipc_endpoint, serve_http_bridge, serve_ipc,
};
use std::{net::SocketAddr, path::PathBuf};

#[derive(Debug, Parser)]
#[command(
    name = "isolapurr-devd",
    version,
    about = "IsolaPurr local device daemon"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Serve {
        #[arg(long, default_value_t = default_ipc_endpoint())]
        endpoint: String,
    },
    BridgeHttp {
        #[arg(long, default_value = DEFAULT_BIND)]
        bind: SocketAddr,
        #[arg(long)]
        web_root: Option<PathBuf>,
        #[arg(long)]
        allow_dev_cors: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Serve { endpoint } => serve_ipc(IpcConfig::new(endpoint)).await?,
        Command::BridgeHttp {
            bind,
            web_root,
            allow_dev_cors,
        } => serve_http_bridge(DevdConfig::new(bind, web_root, allow_dev_cors)).await?,
    }
    Ok(())
}
