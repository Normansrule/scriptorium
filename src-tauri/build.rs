// The app manifest lists the only commands the webview may call; capabilities/default.json
// grants exactly these three (least privilege: no file system, shell or HTTP plugins).
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["key_get", "key_set", "key_delete"])),
    )
    .expect("failed to run tauri-build");
}
