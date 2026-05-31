use clap::{Parser, Subcommand};
use isolapurr_host::{DEFAULT_BIND, DevdConfig, serve};
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
        Command::Serve {
            bind,
            web_root,
            allow_dev_cors,
        } => serve(DevdConfig::new(bind, web_root, allow_dev_cors)).await?,
    }
    Ok(())
}
