#!/bin/zsh
set -e
cd "${0:A:h}/.."
if [[ -d 'src-tauri/target/release/bundle/macos/Gesture Camera.app' ]]; then
  open 'src-tauri/target/release/bundle/macos/Gesture Camera.app'
else
  print 'The app has not been built yet. Follow README to run npm install and npm run build.'
  read '?Press Return to close'
fi
