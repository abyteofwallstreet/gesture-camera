/* Classic worker supports importScripts used by MediaPipe's WASM loader. */
self.exports = {};
importScripts('./assets/vision_bundle.js');
let recognizer, lastTimestamp = 0;
let input, ctx;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await self.exports.FilesetResolver.forVisionTasks(new URL('./assets/wasm', self.location.href).href);
      recognizer = await self.exports.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('./assets/gesture_recognizer.task', self.location.href).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .35, minHandPresenceConfidence: .35, minTrackingConfidence: .35,
      });
      input = new OffscreenCanvas(720, 405);ctx = input.getContext('2d');
      self.postMessage({ type: 'ready' });
    } catch (e) { self.postMessage({ type: 'error', error: String(e) }); }
    return;
  }
  if (data.type !== 'frame') return;
  const {bitmap, timestamp, frameId} = data;
  try {
    if (!recognizer) throw new Error('Gesture detection is not ready');
    const ratio = Math.min(1, 720 / Math.max(bitmap.width,bitmap.height));
    const w = Math.round(bitmap.width*ratio), h = Math.round(bitmap.height*ratio);
    if(input.width!==w||input.height!==h){input.width=w;input.height=h;}
    ctx.drawImage(bitmap,0,0,w,h);
    lastTimestamp=Math.max(lastTimestamp+1,timestamp);
    const start=performance.now();
    const result=recognizer.recognizeForVideo(input,lastTimestamp);
    self.postMessage({ type:'result', timestamp, frameId, landmarks:result.landmarks, gestures:result.gestures, inferenceMs:performance.now()-start });
  } catch(e){self.postMessage({type:'error',error:String(e)});}
  finally { bitmap.close(); }
};
