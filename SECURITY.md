# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead: on this repository, go to **Security → Advisories → Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it.

You should get an acknowledgement within 7 days. Fixes for confirmed issues are released as soon as they are ready, and reporters are credited unless they ask not to be.

## Supported versions

Only the latest release and the `main` branch receive security fixes while the project is below version 1.0.

## Scope

In scope: the web app, the command line, the exporters, the release builds, and anything that could leak an API key, run untrusted content, or put untrusted content into a published book without it being flagged. The threat model is in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

Out of scope: vulnerabilities in the model provider or the scholarly databases themselves (report those to them), and the content of books you generate (you are responsible for reviewing the proof and the verification report before publishing).

## Known advisories in dependencies

Every high-severity alert is fixed or listed here; lower-severity ones are listed when they cannot be fixed yet.

| Advisory | Package | Severity | Why it is not fixed | Exposure |
|---|---|---|---|---|
| RUSTSEC-2024-0429 (GitHub: Dependabot alert) | `glib` 0.18 (Rust, desktop app on Linux) | Moderate (unsoundness) | `glib` 0.18 is pinned by Tauri 2's GTK and WebKitGTK bindings; moving to `glib` ≥ 0.20 needs a Tauri release that upgrades the whole GTK stack. | The flaw is in `VariantStrIter`, which neither Scriptorium nor its webview code uses. Re-check when Tauri updates its GTK bindings. |
| RUSTSEC-2024-0370 (warning, not a vulnerability) | `proc-macro-error` (build-time only) | Unmaintained | Pulled in by GTK build macros. | Runs only at compile time on the build machine. |
| RUSTSEC-2026-0370, -0371, -0372 (warnings, not vulnerabilities) | `zvariant`, `zvariant_derive`, `zbus_names` (Rust, desktop app on Linux) | Unmaintained | Pulled in by `tauri-plugin-opener` (through `zbus`, its D-Bus client on Linux) and Tauri's Linux stack; the plugin has not moved to a maintained replacement yet. | The app uses the opener only to hand web links to the system browser; no data from a book reaches D-Bus. Re-check when the plugin updates. |
