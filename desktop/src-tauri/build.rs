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
    let desktop_index = desktop_dist.join("index.html");

    // Best-effort: if `web/dist` exists (built by `bun run --cwd web build`),
    // sync it into `desktop/dist` so the app can embed and serve the UI.
    let web_dist = manifest_dir.join("../../web/dist");
    let web_index = web_dist.join("index.html");
    if !web_index.exists() {
        return;
    }

    let should_sync = if !desktop_index.exists() {
        true
    } else {
        let web_mtime = std::fs::metadata(&web_index).and_then(|m| m.modified());
        let desktop_mtime = std::fs::metadata(&desktop_index).and_then(|m| m.modified());
        match (web_mtime, desktop_mtime) {
            (Ok(web_mtime), Ok(desktop_mtime)) => web_mtime > desktop_mtime,
            _ => true,
        }
    };

    if !should_sync {
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
