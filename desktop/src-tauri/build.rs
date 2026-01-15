use std::path::{Path, PathBuf};

fn main() {
    ensure_desktop_dist();
    tauri_build::build()
}

fn ensure_desktop_dist() {
    let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") else {
        return;
    };
    let manifest_dir = PathBuf::from(manifest_dir);

    let desktop_dist = manifest_dir.join("../dist");
    if desktop_dist.join("index.html").exists() {
        return;
    }

    // Best-effort: if `web/dist` exists (built by `bun --cwd web run build`), copy it into `desktop/dist`
    // so `cargo check` / `cargo build` works without requiring `cargo tauri`.
    let web_dist = manifest_dir.join("../../web/dist");
    if !web_dist.join("index.html").exists() {
        return;
    }

    let _ = std::fs::remove_dir_all(&desktop_dist);
    let _ = std::fs::create_dir_all(&desktop_dist);
    let _ = copy_dir_all(&web_dist, &desktop_dist);
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(from, to)?;
        }
    }
    Ok(())
}
