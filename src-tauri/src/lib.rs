// Standupify desktop shell (Tauri 2).
//
// The window is a view onto the real app: on launch the shell runs the
// same local server as `npm start` (bridge + Station) with the Node and
// app source the installer ships (src-tauri/tauri.bundle.json), then
// points the window at it. While that boots, the window shows
// desktop/index.html. Closing the window stops the server; engines it
// started (ComfyUI, Nightshift) keep running, as with `npm start`.
//
// Debug builds (`npm run tauri:dev`) and installers built without the
// payload keep the old behaviour: the frontend alone, no server.

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Url};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct Server(Mutex<Option<Child>>);

fn status(app: &AppHandle, text: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.setStatus && window.setStatus({})", serde_json::to_string(text).unwrap_or_default()));
    }
}

fn fail(app: &AppHandle, text: &str, log: Option<&Path>) {
    let log = log.map(|p| p.display().to_string()).unwrap_or_default();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!(
            "window.setError && window.setError({}, {})",
            serde_json::to_string(text).unwrap_or_default(),
            serde_json::to_string(&log).unwrap_or_default()
        ));
    }
}

/// Copy the shipped app somewhere writable (its engines/ folder holds the
/// Station, logs and ComfyUI). Only when this build's stamp is new; files
/// the app wrote itself are never removed.
fn sync_app(src: &Path, dst: &Path) -> std::io::Result<bool> {
    let stamp = fs::read_to_string(src.join(".bundle-stamp")).unwrap_or_default();
    if !stamp.is_empty() && fs::read_to_string(dst.join(".bundle-stamp")).unwrap_or_default() == stamp {
        return Ok(false);
    }
    fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let to = dst.join(entry.file_name());
            if entry.file_type()?.is_dir() { copy_dir(&entry.path(), &to)?; } else { fs::copy(entry.path(), &to)?; }
        }
        Ok(())
    }
    // A stale Vite cache would mix old and new modules.
    let _ = fs::remove_dir_all(dst.join("node_modules").join(".vite"));
    copy_dir(src, dst)?;
    Ok(true)
}

/// Standupify's usual port when it is free (stable origin = stable browser storage), else any.
fn pick_port() -> u16 {
    for port in 3210..3230 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() { return port; }
    }
    TcpListener::bind(("127.0.0.1", 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(3210)
}

/// start.mjs prints `open  http://127.0.0.1:PORT/` (with colour codes) once it listens.
fn url_in(line: &str) -> Option<String> {
    let at = line.find("http://127.0.0.1:")?;
    let url: String = line[at..].chars().take_while(|c| !c.is_whitespace() && *c != '\u{1b}').collect();
    Some(url)
}

fn boot(app: &AppHandle) -> Result<(), (String, Option<PathBuf>)> {
    let res = app.path().resource_dir().map_err(|e| (e.to_string(), None))?;
    let node = res.join("runtime").join("node.exe");
    let shipped = res.join("app");
    let home = app.path().app_local_data_dir().map_err(|e| (e.to_string(), None))?;
    let app_dir = home.join("app");
    let log_path = home.join("standupify.log");

    status(app, "Unpacking Standupify…");
    match sync_app(&shipped, &app_dir) {
        Ok(true) => status(app, "Unpacked. Starting the studio…"),
        Ok(false) => status(app, "Starting the studio…"),
        Err(e) => return Err((format!("Could not unpack the app into {}: {e}", app_dir.display()), None)),
    }

    let mut log = fs::File::create(&log_path).map_err(|e| (e.to_string(), None))?;
    let port = pick_port();
    let mut cmd = Command::new(&node);
    cmd.arg("scripts/start.mjs").arg("--no-open")
        .current_dir(&app_dir)
        .env("PORT", port.to_string())
        .env("STANDUPIFY_DESKTOP", "1")
        .stdin(Stdio::piped()) // start.mjs exits when this closes, even if the shell crashes
        .stdout(Stdio::piped())
        .stderr(log.try_clone().map(Stdio::from).unwrap_or_else(|_| Stdio::null()));
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| (format!("Could not start the bundled Node ({}): {e}", node.display()), Some(log_path.clone())))?;
    let stdout = child.stdout.take();
    // Held for the life of the shell; the OS closes it when this process ends.
    std::mem::forget(child.stdin.take());
    *app.state::<Server>().0.lock().unwrap() = Some(child);

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    if let Some(out) = stdout {
        std::thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = writeln!(log, "{line}");
                if !sent { if let Some(u) = url_in(&line) { let _ = tx.send(u); sent = true; } }
            }
        });
    }

    let started = Instant::now();
    loop {
        if let Ok(url) = rx.recv_timeout(Duration::from_millis(500)) {
            let w = app.get_webview_window("main").ok_or_else(|| ("The window closed.".to_string(), None))?;
            let parsed: Url = url.parse().map_err(|_| (format!("Unexpected address {url}"), Some(log_path.clone())))?;
            return w.navigate(parsed).map_err(|e| (e.to_string(), Some(log_path.clone())));
        }
        let exited = app.state::<Server>().0.lock().unwrap().as_mut().map(|c| c.try_wait().ok().flatten().is_some()).unwrap_or(true);
        if exited { return Err(("The studio stopped while starting.".into(), Some(log_path.clone()))); }
        if started.elapsed() > Duration::from_secs(120) { return Err(("The studio took too long to start.".into(), Some(log_path.clone()))); }
        status(app, "Starting the studio and looking for Nightshift and ComfyUI…");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let shipped = app.path().resource_dir().map(|r| r.join("runtime").join("node.exe").exists()).unwrap_or(false);
            if cfg!(debug_assertions) || !shipped { return Ok(()); }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // Let the loading page finish loading so it can show progress.
                std::thread::sleep(Duration::from_millis(300));
                if let Err((msg, log)) = boot(&handle) { fail(&handle, &msg, log.as_deref()); }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Standupify");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Server>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
