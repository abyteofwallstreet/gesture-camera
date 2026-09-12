# Gesture Camera 0.2.0 Beta

A local macOS camera app that takes photos when you make a hand gesture.

## Download and install

- Download `Gesture-Camera-0.2.0-arm64.dmg` from this release.
- Requires macOS 13 or later on Apple Silicon (M-series). This download does not support Intel Macs.
- Open the DMG and drag Gesture Camera into Applications.
- macOS may block the first launch of this unnotarized beta; follow the steps below.
- Open the app and click **Start camera**. Launching the app or refreshing its device list does not open a camera.

### First launch: “Apple could not verify”

Gesture Camera's current beta uses an ad-hoc signature, not an Apple Developer ID certificate, and has not been notarized by Apple. macOS may therefore show **“Gesture Camera.app” Not Opened** and say it cannot verify that the app is free of malware. This message does not mean malware was detected; it also does not certify the app as safe.

If you trust this project and downloaded the DMG from [this repository's release page](https://github.com/abyteofwallstreet/gesture-camera/releases/tag/v0.2.0-beta.1):

1. Copy **Gesture Camera.app** into **Applications** and try opening it.
2. In the warning, click **Done** to dismiss it.
3. Open **System Settings → Privacy & Security** and scroll to the **Security** section.
4. Find the message about Gesture Camera being blocked and click **Open Anyway**.
5. Confirm **Open**, and authenticate if macOS asks. Then click **Start camera** in the app and allow camera access.

If **Open Anyway** is missing, try opening the app once more, then check Privacy & Security again. A managed Mac may require your administrator's approval.

This creates an exception for this app; you do not need to disable Gatekeeper globally or run Terminal commands. See [Apple's official instructions](https://support.apple.com/en-us/102445).

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
