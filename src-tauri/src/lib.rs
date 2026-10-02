//! Scriptorium desktop shell.
//!
//! The window shows the same web app that runs on GitHub Pages (web/dist), bundled so it works
//! offline. The Rust side adds only what a browser cannot do safely:
//!
//! * keep the API key in the operating system's keychain (three commands below);
//! * open external links in the system browser instead of navigating the app window away;
//! * save downloads (the project file) into the user's Downloads folder.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
                // "Download project" saves into the Downloads folder.
                .on_download(|_webview, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        if let Some(dir) = dirs::download_dir() {
                            let name = destination
                                .file_name()
                                .map(|n| n.to_owned())
                                .unwrap_or_else(|| "scriptorium-project.json".into());
                            *destination = dir.join(name);
                        }
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
    fn only_app_pages_stay_in_the_window() {
        assert!(is_app_url(&Url::parse("tauri://localhost/index.html").unwrap()));
        assert!(is_app_url(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(is_app_url(&Url::parse("http://localhost:5173/").unwrap()));
        assert!(!is_app_url(&Url::parse("https://doi.org/10.1109/TCT.1955.6500159").unwrap()));
        assert!(!is_app_url(&Url::parse("file:///etc/passwd").unwrap()));
    }
}
