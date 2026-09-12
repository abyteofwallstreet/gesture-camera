#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[tauri::command]
pub fn camera_controls(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(|| unsafe {
            // AVCaptureSystemUserInterfaceVideoEffects = 1 (macOS 12+).
            // The system owns lens/framing controls for Continuity Camera;
            // opening this UI does not start capture or change a lens itself.
            let _: () = objc2::msg_send![objc2::class!(AVCaptureDevice), showSystemUserInterface: 1isize];
        }).map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("System lens controls are available on macOS.".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn system_camera_controls_api_is_available() {
        let available: bool = unsafe { objc2::msg_send![objc2::class!(AVCaptureDevice), respondsToSelector: objc2::sel!(showSystemUserInterface:)] };
        assert!(available);
    }
}
