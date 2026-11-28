pub mod error;
pub mod models;
pub mod search;
pub mod server;
pub mod storage;
pub mod tutor;

use std::env;
use std::fs;
use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, SubmenuBuilder};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

struct ServerShutdown(Mutex<Option<oneshot::Sender<()>>>);

fn is_local_server_url(url: &tauri::Url, port: u16) -> bool {
    url.scheme() == "http"
        && url.port_or_known_default() == Some(port)
        && matches!(
            url.host_str(),
            Some("127.0.0.1") | Some("localhost") | Some("[::1]")
        )
}

fn check_legacy_data_hint(data_root: &std::path::Path) {
    let custom_dir = env::var_os("MINILEARN_DATA_DIR")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    if custom_dir {
        return;
    }
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let legacy = home.join(".minilearn");
    let legacy_exists =
        legacy.join("settings.json").exists() || legacy.join("projects").exists();
    if !legacy_exists {
        return;
    }
    let new_has_settings = data_root.join("settings.json").exists();
    let new_projects_empty = fs::read_dir(data_root.join("projects"))
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(true);
    if !new_has_settings && new_projects_empty {
        eprintln!(
            "Previous minilearn data remains at {}. See the README to migrate it safely into this installation.",
            legacy.display()
        );
    }
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("minilearn".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        ..Default::default()
    };
    let app_submenu = SubmenuBuilder::new(app, "minilearn")
        .about(Some(about))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .close_window()
        .build()?;

    Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_support_dir = app.path().data_dir().ok().map(|d| d.join("minilearn"));
            let data_root = storage::resolve_data_root(app_support_dir.as_deref());
            check_legacy_data_hint(&data_root);

            let store = storage::Storage::new(&data_root)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            let (addr, shutdown_tx) = tauri::async_runtime::block_on(server::start_server(store))
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(ServerShutdown(Mutex::new(Some(shutdown_tx))));

            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;

            let port = addr.port();
            let local_url: tauri::Url = format!("http://127.0.0.1:{port}/").parse()?;
            let nav_handle = app.handle().clone();
            let new_win_handle = app.handle().clone();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(local_url))
                .title("minilearn")
                .inner_size(1280.0, 840.0)
                .min_inner_size(820.0, 600.0)
                .background_color(tauri::window::Color(0x14, 0x14, 0x14, 0xff))
                .initialization_script("window.__MINILEARN_DESKTOP__ = true;")
                .on_navigation(move |url| {
                    if is_local_server_url(url, port) || url.as_str() == "about:blank" {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = nav_handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .on_new_window(move |url, _features| {
                    if matches!(url.scheme(), "http" | "https") && !is_local_server_url(&url, port)
                    {
                        let _ = new_win_handle
                            .opener()
                            .open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .on_download(move |_webview, event| match event {
                    DownloadEvent::Requested { url, destination } => {
                        if !is_local_server_url(&url, port) {
                            return false;
                        }
                        let filename = destination
                            .file_name()
                            .and_then(|n| n.to_str())
                            .filter(|s| !s.is_empty())
                            .unwrap_or("download")
                            .to_string();
                        let mut dialog = rfd::FileDialog::new().set_file_name(&filename);
                        if let Some(dir) = dirs::download_dir()
                            .or_else(|| destination.parent().map(|p| p.to_path_buf()))
                        {
                            dialog = dialog.set_directory(dir);
                        }
                        if let Some(chosen) = dialog.save_file() {
                            if fs::symlink_metadata(&chosen).is_ok()
                                && fs::remove_file(&chosen).is_err()
                            {
                                return false;
                            }
                            *destination = chosen;
                            true
                        } else {
                            false
                        }
                    }
                    DownloadEvent::Finished { .. } => true,
                    _ => true,
                })
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building minilearn");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<ServerShutdown>() {
                if let Some(tx) = state.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = tx.send(());
                }
            }
        }
    });
}
