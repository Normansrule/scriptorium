//! Scriptorium desktop shell.
//!
//! The window shows the same web app that runs on GitHub Pages (web/dist), bundled so it works
//! offline. The Rust side adds only what a browser cannot do safely:
//!
//! * keep the API key in the operating system's keychain (three commands below);
//! * open external links in the system browser instead of navigating the app window away;
//! * save downloads (the project file) into the user's Downloads folder;
//! * on Linux, switch off WebKitGTK graphics paths that fail on some drivers and under WSL.
//!
//! Nothing else is exposed to the webview: no file-system, shell or HTTP plugins.

use keyring::Entry;
use tauri::webview::DownloadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use url::Url;

const SERVICE: &str = "io.github.normansrule.scriptorium";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("the system keychain is not available ({e})"))
}

/// A plausible key: printable ASCII without spaces, 20–300 characters. Never echoed back.
fn valid_key(key: &str) -> bool {
    (20..=300).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

/// Read the saved key; `None` when nothing is saved.
#[tauri::command]
fn key_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("could not read from the system keychain ({e})")),
    }
}

/// Save the key in the keychain. Error messages never contain the key.
#[tauri::command]
fn key_set(key: String) -> Result<(), String> {
    let key = key.trim();
    if !valid_key(key) {
        return Err("that does not look like an API key (expected 20–300 characters, no spaces)".into());
    }
    entry()?
        .set_password(key)
        .map_err(|e| format!("could not save to the system keychain ({e})"))
}

/// Remove the saved key; succeeds when nothing was saved.
#[tauri::command]
fn key_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not remove the key from the system keychain ({e})")),
    }
}

/// True for the app's own pages (bundled assets, or the Vite dev server in `tauri dev`).
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "about" | "blob" | "data" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")),
        _ => false,
    }
}

/** The user's Downloads folder (XDG / Known Folder / ~/Downloads), created if missing. */
fn downloads_dir() -> std::path::PathBuf {
    let dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(std::env::temp_dir);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/** `dir/name`, or `dir/name (1).ext`, `(2)`… if that file already exists. Only the file name of `name` is used. */
fn unique_path(dir: &std::path::Path, name: &std::path::Path) -> std::path::PathBuf {
    let file = name.file_name().map(std::path::Path::new).unwrap_or(std::path::Path::new("scriptorium-download"));
    let first = dir.join(file);
    if !first.exists() {
        return first;
    }
    let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("scriptorium-download");
    let ext = file.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (1..1000)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// WebKitGTK settings that keep the window from staying blank or failing to open.
///
/// * Every Linux system: turn off the DMA-BUF renderer, which fails with some GPU drivers
///   (the workaround Tauri documents for blank windows).
/// * Windows Subsystem for Linux (WSL): also turn off accelerated compositing and use
///   software OpenGL, because WSLg's GPU path makes WebKitGTK fail with "ZINK: failed to choose
///   pdev" / "failed to create dri2 screen".
///
/// A variable the user has already set is never overridden, and `SCRIPTORIUM_GPU=1` skips all
/// of this for people whose GPU path works.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn graphics_env(is_wsl: bool, is_set: impl Fn(&str) -> bool) -> Vec<(&'static str, &'static str)> {
    if is_set("SCRIPTORIUM_GPU") {
        return Vec::new();
    }
    let mut vars = vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")];
    if is_wsl {
        vars.push(("WEBKIT_DISABLE_COMPOSITING_MODE", "1"));
        vars.push(("LIBGL_ALWAYS_SOFTWARE", "1"));
    }
    vars.into_iter().filter(|(k, _)| !is_set(k)).collect()
}

/// True inside WSL 1 or 2 (both set these variables; the kernel name says "microsoft").
#[cfg(target_os = "linux")]
fn running_in_wsl() -> bool {
    std::env::var_os("WSL_DISTRO_NAME").is_some()
        || std::env::var_os("WSL_INTEROP").is_some()
        || std::fs::read_to_string("/proc/sys/kernel/osrelease").is_ok_and(|r| r.to_ascii_lowercase().contains("microsoft"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must happen before GTK or WebKit start (no other threads exist yet).
    #[cfg(target_os = "linux")]
    for (k, v) in graphics_env(running_in_wsl(), |k| std::env::var_os(k).is_some()) {
        std::env::set_var(k, v);
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![key_get, key_set, key_delete])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Scriptorium")
                .inner_size(1280.0, 860.0)
                .min_inner_size(800.0, 600.0)
                // External links (sources, DOIs, the web edition) open in the system browser.
                .on_navigation(|url| {
                    if is_app_url(url) {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                // Saved files (projects, KDP packages) go to the Downloads folder, never overwriting.
                .on_download(|_webview, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        let name = destination
                            .file_name()
                            .map(|n| n.to_owned())
                            .unwrap_or_else(|| "scriptorium-download".into());
                        *destination = unique_path(&downloads_dir(), std::path::Path::new(&name));
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Scriptorium");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphics_env_respects_the_user() {
        let none = |_: &str| false;
        assert_eq!(graphics_env(false, none), vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
        assert_eq!(graphics_env(true, none).len(), 3);
        // a variable the user set is left alone
        let set = |k: &str| k == "LIBGL_ALWAYS_SOFTWARE";
        assert!(!graphics_env(true, set).iter().any(|(k, _)| *k == "LIBGL_ALWAYS_SOFTWARE"));
        // SCRIPTORIUM_GPU=1 turns every workaround off
        assert!(graphics_env(true, |k| k == "SCRIPTORIUM_GPU").is_empty());
    }

    #[test]
    fn keys_are_checked_without_echoing() {
        assert!(valid_key("sk-ant-api03-abcdefghijklmnop"));
        assert!(!valid_key("short"));
        assert!(!valid_key("has a space in it but long enough"));
        assert!(!valid_key(&"x".repeat(301)));
    }

    /// Needs a real keychain (run with `cargo test -- --ignored` on a desktop session).
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        key_delete().unwrap();
        assert_eq!(key_get().unwrap(), None);
        key_set("  sk-ant-test-0123456789abcdef  ".into()).unwrap();
        assert_eq!(key_get().unwrap().as_deref(), Some("sk-ant-test-0123456789abcdef"));
        assert!(key_set("bad key".into()).unwrap_err().contains("does not look like"));
        key_delete().unwrap();
        assert_eq!(key_get().unwrap(), None);
    }

    #[test]
    fn downloads_never_overwrite_or_escape_the_folder() {
        let dir = std::env::temp_dir().join(format!("scriptorium-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p1 = unique_path(&dir, std::path::Path::new("book-kdp.zip"));
        assert_eq!(p1, dir.join("book-kdp.zip"));
        std::fs::write(&p1, b"x").unwrap();
        assert_eq!(unique_path(&dir, std::path::Path::new("book-kdp.zip")), dir.join("book-kdp (1).zip"));
        assert_eq!(unique_path(&dir, std::path::Path::new("../../etc/evil.zip")), dir.join("evil.zip"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_app_pages_stay_in_the_window() {
        assert!(is_app_url(&Url::parse("tauri://localhost/index.html").unwrap()));
        assert!(is_app_url(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(is_app_url(&Url::parse("http://localhost:5173/").unwrap()));
        assert!(!is_app_url(&Url::parse("https://doi.org/10.1109/TCT.1955.6500159").unwrap()));
        assert!(!is_app_url(&Url::parse("file:///etc/passwd").unwrap()));
    }
}
