# Gesture Camera 0.2.0 Beta

A local macOS camera app that takes photos when you make a hand gesture.

## Download and install

- Download `Gesture-Camera-0.2.0-arm64.dmg` from this release.
- Requires macOS 13 or later on Apple Silicon (M-series). This download does not support Intel Macs.
- Open the DMG and drag Gesture Camera into Applications.
- This beta uses an ad-hoc signature and is not notarized by Apple. macOS may block the first launch. After verifying the download source, allow the app in System Settings → Privacy & Security if needed.
- Open the app and click **Start camera**. Launching the app or refreshing its device list does not open a camera.

## Features

- Gesture-triggered capture, plus a Capture button and Space shortcut.
- Custom gesture recording and optional waiting until your hands leave the frame.
- Automatic camera-resolution negotiation and full-resolution PNG saving.
- iPhone support through macOS Continuity Camera.
- Continuous rotation remembered separately for each camera.
- Perspective and lens-distortion correction with automatic corrected preview.
- Optional full-frame original backups.
- Photo browsing, reordering, cropping, correction and deletion.
- Capture sound with a mute control on the main screen.

Photos and gesture processing stay on your Mac. No account, LLM or cloud processing is required. Runtime model assets are bundled for offline use.

## Beta limitations

- Camera modes, image quality and available iPhone lens controls depend on the device and macOS/WebKit.
- The camera list can be incomplete until access is allowed through Start camera.
- Real-device coverage is limited; long-session reliability and recognition across different lighting conditions still need broader testing.
- Automated checks cover camera lifecycle with simulated devices, photo operations, image geometry and native WebKit behavior. They do not establish real-world recognition accuracy.
- Removing a photo moves its files and metadata into `.gesture-camera-deleted` inside the save folder; deletion is not permanent erasure.

When reporting an issue, include your Mac model, macOS version, camera model, steps to reproduce, and expected versus actual behavior. Share a screenshot only if it contains no private information.
