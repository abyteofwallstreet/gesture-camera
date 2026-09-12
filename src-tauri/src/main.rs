#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

mod photo_library;
mod camera_controls;

struct Storage {
    folder: Mutex<PathBuf>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Photo {
    id: String,
    filename: String,
    original: Option<String>,
    width: u32,
    height: u32,
    created: u64,
    thumbnail: String,
    #[serde(default)]
    edit: Option<photo_library::Edit>,
    #[serde(default)]
    revision: u64,
}

#[derive(Serialize)]
struct Library {
    folder: String,
    photos: Vec<Photo>,
}

fn folder(state: &State<Storage>) -> Result<PathBuf, String> {
    Ok(state.folder.lock().map_err(|e| e.to_string())?.clone())
}

fn read_history(dir: &Path) -> Result<Vec<Photo>, String> {
    let p = dir.join(".gesture-camera-history.json");
    if !p.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Could not read photo history. Your photos are still in the folder: {e}"))
}

#[tauri::command]
fn library(state: State<Storage>) -> Result<Library, String> {
    let dir = folder(&state)?;
    let mut photos = read_history(&dir)?;
    photos.reverse();
    Ok(Library {
        folder: dir.to_string_lossy().into(),
        photos,
    })
}

#[tauri::command]
async fn choose_folder(
    app: tauri::AppHandle,
    state: State<'_, Storage>,
) -> Result<Option<String>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Choose a photo folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    fs::write(
        config.join("folder.json"),
        serde_json::to_vec(&path).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    *state.folder.lock().map_err(|e| e.to_string())? = path.clone();
    Ok(Some(path.to_string_lossy().into()))
}

fn decode_png(input: &str) -> Result<(Vec<u8>, u32, u32), String> {
    if input.len() > 128 * 1024 * 1024 {
        return Err("The photo is too large to save".into());
    }
    let bytes = STANDARD
        .decode(input)
        .map_err(|_| "Invalid photo encoding".to_string())?;
    if bytes.len() < 33 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("Only PNG photos are supported".into());
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 80_000_000 {
        return Err("Invalid photo dimensions".into());
    }
    Ok((bytes, w, h))
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(path);
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
async fn save_capture(
    state: State<'_, Storage>,
    original: Option<String>,
    corrected: Option<String>,
    thumbnail: String,
    edit: Option<photo_library::Edit>,
) -> Result<Photo, String> {
    if let Some(value) = &edit { value.validate()?; }
    let raw = original.as_deref().map(decode_png).transpose()?;
    let processed = corrected.as_deref().map(decode_png).transpose()?;
    let (primary, width, height) = processed
        .as_ref()
        .or(raw.as_ref())
        .ok_or("No photo to save")?;
    if !thumbnail.starts_with("data:image/jpeg;base64,") || thumbnail.len() > 300_000 {
        return Err("Invalid thumbnail".into());
    }
    // Serialize writes and folder changes; a capture belongs to exactly one directory.
    let dir = state.folder.lock().map_err(|e| e.to_string())?;
    let mut history = read_history(&dir)?;
    fs::create_dir_all(&*dir).map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let id = format!("note-{}", now.as_micros());
    let suffix = if processed.is_some() {
        "corrected"
    } else {
        "original"
    };
    let filename = format!("{id}-{suffix}.png");
    let primary_path = dir.join(&filename);
    write_new(&primary_path, primary)?;
    let original_name = if processed.is_some() {
        if let Some((bytes, _, _)) = raw.as_ref() {
            let name = format!("{id}-original.png");
            if let Err(e) = write_new(&dir.join(&name), bytes) {
                let _ = fs::remove_file(&primary_path);
                return Err(e);
            }
            Some(name)
        } else {
            None
        }
    } else {
        Some(filename.clone())
    };
    let photo = Photo {
        id,
        filename,
        original: original_name,
        width: *width,
        height: *height,
        created: now.as_millis() as u64,
        thumbnail,
        edit,
        revision: 0,
    };
    history.push(photo.clone());
    let result = (|| {
        let pending = dir.join(".gesture-camera-history.tmp");
        fs::write(
            &pending,
            serde_json::to_vec(&history).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(pending, dir.join(".gesture-camera-history.json")).map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        // A reported failure must not leave an untracked duplicate capture.
        let _ = fs::remove_file(&primary_path);
        if let Some(name) = &photo.original {
            if name != &photo.filename {
                let _ = fs::remove_file(dir.join(name));
            }
        }
        return Err(e);
    }
    Ok(photo)
}

#[tauri::command]
fn reveal(state: State<Storage>, filename: Option<String>) -> Result<(), String> {
    let dir = folder(&state)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = if let Some(name) = filename {
        if !read_history(&dir)?
            .iter()
            .any(|p| p.filename == name || p.original.as_deref() == Some(name.as_str()))
            || Path::new(&name).components().count() != 1
        {
            return Err("This photo is not in the current library".into());
        }
        dir.join(name)
    } else {
        dir
    };
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("/usr/bin/open");
        if target.is_file() {
            cmd.arg("-R");
        }
        let status = cmd.arg(target).status().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not open Finder".into());
        }
    }
    #[cfg(not(target_os = "macos"))]
    return Err("Opening the photo folder is supported only on macOS in this build".into());
    Ok(())
}

#[tauri::command]
fn self_test_result(app: tauri::AppHandle, result: serde_json::Value) -> Result<(), String> {
    if !std::env::args().any(|a| a == "--self-test") {
        return Err("Self-test mode is not active".into());
    }
    println!("SELF_TEST {}", result);
    app.exit(if result["ok"].as_bool() == Some(true) {
        0
    } else {
        1
    });
    Ok(())
}

#[tauri::command]
fn is_self_test() -> bool {
    std::env::args().any(|a| a == "--self-test")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let testing = std::env::args().any(|a| a == "--self-test");
            let fallback = if testing {
                std::env::temp_dir().join(format!("gesture-camera-self-test-{}", std::process::id()))
            } else { app.path().picture_dir()?.join("Gesture Camera") };
            let config = app.path().app_config_dir()?.join("folder.json");
            let saved = if testing { None } else { fs::read(config)
                .ok()
                .and_then(|v| serde_json::from_slice::<PathBuf>(&v).ok()) };
            app.manage(Storage {
                folder: Mutex::new(saved.unwrap_or(fallback)),
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if std::env::args().any(|a| a == "--self-test") && payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = webview.eval("import('./self-test.mjs').then(m => m.run()).catch(e => window.__TAURI__.core.invoke('self_test_result', {result:{ok:false,error:String(e)}}))");
            }
        })
        .invoke_handler(tauri::generate_handler![
            library,
            is_self_test,
            camera_controls::camera_controls,
            choose_folder,
            save_capture,
            reveal,
            photo_library::load_photo,
            photo_library::replace_photo,
            photo_library::delete_photo,
            photo_library::reorder_photos,
            self_test_result
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Gesture Camera");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_png_and_absurd_dimensions() {
        assert!(decode_png(&STANDARD.encode(b"not an image")).is_err());
        let mut data = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        data.extend_from_slice(&100_000_u32.to_be_bytes());
        data.extend_from_slice(&100_000_u32.to_be_bytes());
        data.resize(33, 0);
        assert!(decode_png(&STANDARD.encode(data)).is_err());
    }
    #[test]
    fn never_overwrites_existing_photo() {
        let p = std::env::temp_dir().join(format!("gesture-test-{}", std::process::id()));
        let _ = fs::remove_file(&p);
        write_new(&p, b"original").unwrap();
        assert!(write_new(&p, b"replacement").is_err());
        assert_eq!(fs::read(&p).unwrap(), b"original");
        fs::remove_file(p).unwrap();
    }
}
