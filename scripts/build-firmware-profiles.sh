#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
output_dir="$repo_root/dist/firmware"
version="dev"
git_sha="unknown"
build_id="local"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --output-dir) output_dir="$2"; shift 2 ;;
        --version) version="$2"; shift 2 ;;
        --git-sha) git_sha="$2"; shift 2 ;;
        --build-id) build_id="$2"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

# The recovery probe is topology-only and is intentionally built as a
# separate ELF. It uses the profile feature only to satisfy the package build
# gate; it does not instantiate either profile runtime.
probe_target_dir="$repo_root/target/board_topology_probe"
mkdir -p "$output_dir"
cargo build --release \
    --target-dir "$probe_target_dir" \
    --bin board-topology-probe \
    --no-default-features \
    --features "net_http,board_tps_fusb"
cp "$probe_target_dir/xtensa-esp32s3-none-elf/release/board-topology-probe" \
    "$output_dir/board-topology-probe.elf"

for profile in tps-sw tps-fusb; do
    feature="board_${profile//-/_}"
    target_dir="$repo_root/target/$feature"
    if [ "$profile" = "tps-sw" ]; then
        profile_dir="$output_dir"
        image_stem="isolapurr-usb-hub"
        catalog_name="isolapurr-firmware-catalog.json"
    else
        profile_dir="$output_dir/$profile"
        mkdir -p "$profile_dir"
        image_stem="isolapurr-usb-hub-$profile"
        catalog_name="isolapurr-firmware-catalog-$profile.json"
    fi

    cargo build --release \
        --target-dir "$target_dir" \
        --no-default-features \
        --features "net_http,$feature"

    elf_source="$target_dir/xtensa-esp32s3-none-elf/release/isolapurr-usb-hub"
    elf="$profile_dir/$image_stem.elf"
    app="$profile_dir/$image_stem.app.bin"
    full="$profile_dir/$image_stem.full.bin"
    catalog="$profile_dir/$catalog_name"
    artifact_id="isolapurr-${git_sha:0:12}-${profile}"

    cp "$elf_source" "$elf"
    espflash save-image --chip esp32s3 "$elf" "$app"
    espflash save-image --chip esp32s3 --merge --skip-padding "$elf" "$full"
    python3 "$repo_root/tools/firmware-catalog/build-catalog.py" \
        --out "$catalog" \
        --artifact-id "$artifact_id" \
        --recovery-artifact-id "${artifact_id}-recovery" \
        --version "$version" \
        --git-sha "$git_sha" \
        --build-id "$build_id" \
        --compiled-profile "$profile" \
        --app-bin "$app" \
        --full-image "$full" \
        --elf "$elf"
done
