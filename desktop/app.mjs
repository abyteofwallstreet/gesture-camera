import { CaptureGate, GestureReleaseGuard, clamp, previewRect, rotatedSize, rotatePoint, validQuad, correctionSize, gestureScore, fingerFeatures, rotationControlAngle } from './core.mjs';
import { cameraOptions } from './camera-options.mjs';
import { connectCamera, discoverCameras, findCamera } from './camera-connection.mjs';
import { CaptureSound } from './capture-sound.mjs';
import { PhotoLibrary } from './photo-library.mjs';
import { maximizeResolution } from './camera.mjs';
import { CorrectionRenderer, originalCanvas, pngBlob, base64Blob } from './correction.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), viewport = $('viewport'), layer = $('imageLayer');
const invoke = window.__TAURI__?.core.invoke;
const gate = new CaptureGate();
const recordingRelease = new GestureReleaseGuard();
let prefs;
try { prefs = JSON.parse(localStorage.getItem('gesture-camera-v2') || '{}'); } catch { prefs = {}; }
const defaults = { rotation: 0, camera: '', cameraLabel: '', threshold: .65, hold: .6, waitHand: true, auto: true, distortion: 0, points: null, learned: null, calibrationDevice: '', saveOriginal: false, soundOn: true };
prefs = { ...defaults, ...prefs };
const captureSound=new CaptureSound(prefs.soundOn!==false);
// Retire old quality caps and preview modes, including previously saved choices.
delete prefs.quality; delete prefs.native;
prefs.rotation=rotationControlAngle(prefs.rotation);
if(!prefs.rotationByCamera||typeof prefs.rotationByCamera!=='object'||Array.isArray(prefs.rotationByCamera))prefs.rotationByCamera={};
const rotationKey=()=>`camera:${prefs.camera}`;
const rememberRotation=()=>{prefs.rotationByCamera[rotationKey()]=prefs.rotation;};
rememberRotation();
if (!validQuad(prefs.points)) prefs.points=null;
let stream, worker, ready = false, inFlight = false, busy = false, opening = false, session = 0;
let lastAnalysis = 0, lastResult = 0, lastFrame = 0, nextFrameId = 0, previewCallback, callbackType;
let requestStarted = 0, fpsStart = 0, fpsFrames = 0, fpsCount = 0, latest = null;
let rect=null, calibrating=false, calibrationPoints=[];
let corrected = false, previewError = false, renderer, captureRenderer, learning = null, lastVideoSize='';
const gallery = new PhotoLibrary(invoke);
let noticeTimer;

function persist() { localStorage.setItem('gesture-camera-v2', JSON.stringify(prefs)); }
function notice(message, error=false) {
  clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').hidden=false;
  if(!error)noticeTimer=setTimeout(()=>$('notice').hidden=true,6500);
}
function phase(title, detail) { $('phase').textContent=title;$('phaseDetail').textContent=detail; }
function resetGate() { gate.reset();$('progress').style.width='0%'; }
function controls() {
  $('threshold').value=prefs.threshold;$('thresholdValue').textContent=Number(prefs.threshold).toFixed(2);
  $('hold').value=prefs.hold;$('holdValue').textContent=Number(prefs.hold).toFixed(1)+' s';
  $('waitHand').checked=prefs.waitHand;$('auto').checked=prefs.auto;
  $('saveOriginal').checked=prefs.saveOriginal;
  $('soundToggle').setAttribute('aria-pressed',String(prefs.soundOn!==false));
  $('soundToggle').title=prefs.soundOn!==false?'Mute capture sound':'Enable capture sound';
  $('soundLabel').textContent=prefs.soundOn!==false?'Sound on':'Muted';
  $('distortion').value=prefs.distortion;$('distortionValue').textContent=Number(prefs.distortion).toFixed(2);
  const angle=prefs.rotation;
  $('rotationLabel').textContent=Number(angle.toFixed(2))+'°';
  $('rotationAngle').value=Number(angle.toFixed(2));$('rotationRange').value=angle;
  $('gestureName').textContent=prefs.learned?'Custom gesture':'Hold up your index finger';
}
controls();

function size() { return rotatedSize(video.videoWidth || 1920, video.videoHeight || 1080, prefs.rotation); }
function layout() {
  corrected=!calibrating && Boolean(prefs.points || Number(prefs.distortion)!==0);
  if(!stream || !video.videoWidth) return;
  if(corrected)drawCorrection();else{previewError=false;$('capture').disabled=busy||!!stream.getVideoTracks()[0]?.muted;}
  let s=size();
  if(corrected) s=correctionSize(s.width,s.height,prefs.points);
  rect=previewRect(s.width,s.height,viewport.clientWidth,viewport.clientHeight,devicePixelRatio,false);
  Object.assign(layer.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
  const w=video.videoWidth*rect.scale,h=video.videoHeight*rect.scale;
  Object.assign(video.style,{width:w+'px',height:h+'px',left:(rect.width-w)/2+'px',top:(rect.height-h)/2+'px',transform:`rotate(${prefs.rotation}deg)`});
  // Keep the video element playing off-screen behind the corrected canvas.
  // Never display:none it: WebKit may otherwise suspend video frame callbacks.
  video.style.opacity=corrected?'0':'1';
  $('correctedCanvas').hidden=!corrected;
  $('viewBadge').textContent=calibrating?'Select page corners':'Photo framing';
  overlay();
}
new ResizeObserver(layout).observe(viewport);
window.addEventListener('resize',layout);

function overlay() {
  const svg=$('overlay');svg.replaceChildren();
  const shape=(name,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el;};
  if(!corrected && latest && !calibrating) for(const hand of latest.landmarks){
    const p=hand.map(l=>rotatePoint(l,prefs.rotation,video.videoWidth,video.videoHeight));
    const minX=clamp(Math.min(...p.map(l=>l.x))-.02),minY=clamp(Math.min(...p.map(l=>l.y))-.02);
    const maxX=clamp(Math.max(...p.map(l=>l.x))+.02),maxY=clamp(Math.max(...p.map(l=>l.y))+.02);
    shape('rect',{x:minX,y:minY,width:maxX-minX,height:maxY-minY,fill:'none',stroke:latest.score>=prefs.threshold?'#b9df81':'#e4b852','stroke-width':1.5,'vector-effect':'non-scaling-stroke'});
  }
  const points=calibrating?calibrationPoints:(!corrected?prefs.points:null);
  if(points?.length){
    shape(points.length===4?'polygon':'polyline',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#d0e8a4','stroke-width':1.5,'vector-effect':'non-scaling-stroke'});
    for(const p of points)shape('ellipse',{cx:p.x,cy:p.y,rx:5/(rect?.width||600),ry:5/(rect?.height||400),fill:'#d0e8a4'});
  }
}

let deviceRefresh=0;
async function enumerate(discovered) {
  if(!navigator.mediaDevices?.enumerateDevices)return;
  const request=++deviceRefresh;
  const devices=discovered||await navigator.mediaDevices.enumerateDevices();
  if(request!==deviceRefresh)return;
  const options=cameraOptions(devices,prefs.camera,prefs.cameraLabel),picker=$('camera');
  const signature=JSON.stringify(options);
  // Device polling must not rebuild an open picker or make its selection flicker.
  if(picker.dataset.options!==signature){
    const focused=document.activeElement;
    const focusedId=picker.contains(focused)?focused.value:null;
    $('cameraChoices').replaceChildren(...options.map(item=>{
      const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
      input.type='radio';input.name='camera';input.value=item.value;input.disabled=item.disabled;
      input.checked=item.value===prefs.camera;text.textContent=item.label;
      label.append(input,text);return label;
    }));
    picker.dataset.options=signature;
    if(focusedId!==null)Array.from(picker.querySelectorAll('input')).find(input=>input.value===focusedId)?.focus({preventScroll:true});
  }
  for(const input of picker.querySelectorAll('input'))input.checked=input.value===prefs.camera;
  const selected=options.find(item=>item.value===prefs.camera);
  if(!devices.some(d=>d.kind==='videoinput'&&d.label))$('cameraHelp').textContent='Camera names may be hidden until access is allowed. Click Start camera when you are ready.';
  else if(selected?.disabled)$('cameraHelp').textContent='Selected camera unavailable. Reconnect your iPhone or choose another camera.';
  else if(devices.some(d=>d.kind==='videoinput'&&/iphone|continuity/i.test(d.label)))$('cameraHelp').textContent='iPhone camera available. Select it from the Camera list.';
  else $('cameraHelp').textContent='To use an iPhone, connect it with Continuity Camera, then refresh this list.';
}
async function refreshCameras(){
  try{await enumerate();}catch(e){$('cameraHelp').textContent=`Could not refresh cameras: ${e.message||e}`;}
}

let discoveryPromise, pageClosed=false;
async function discoverOnOpen(){
  if(discoveryPromise)return discoveryPromise;
  discoveryPromise=(async()=>{
    try{
      if(invoke && await invoke('is_self_test')===true)return;
      if(!navigator.mediaDevices?.enumerateDevices)return;
      $('cameraHelp').textContent='Finding available cameras…';
      const devices=await discoverCameras(navigator.mediaDevices,()=>!pageClosed);
      if(pageClosed)return;
      // Rebind a saved selection only when its name identifies one device.
      const selected=findCamera(devices,{id:prefs.camera,label:prefs.cameraLabel});
      if(prefs.camera && selected){
        const old=prefs.camera;prefs.camera=selected.deviceId;prefs.cameraLabel=selected.label;
        if(prefs.calibrationDevice===old)prefs.calibrationDevice=prefs.camera;
        rememberRotation();persist();
      }
      await enumerate(devices);
    }catch(e){
      if(!pageClosed){await refreshCameras();$('cameraHelp').textContent=e.name==='NotAllowedError'
        ?'Camera access was not allowed. Enable it in System Settings → Privacy & Security → Camera, then refresh.'
        :`Could not load cameras: ${e.message||e}. Click Refresh cameras to retry.`;}
    }
  })();
  try{await discoveryPromise;}finally{discoveryPromise=null;}
}
function drawCorrection(){
  try{renderer ||= new CorrectionRenderer($('correctedCanvas'));renderer.draw(video,prefs.rotation,prefs.points,Number(prefs.distortion));previewError=false;}
  catch(e){if(!previewError)notice(`Camera preview could not be corrected: ${e.message}. Reset correction or reconnect the camera.`,true);previewError=true;}
  $('capture').disabled=previewError||busy||!stream||!!stream?.getVideoTracks()[0]?.muted;
}

function stopCamera(message='Camera stopped') {
  session++;
  if(previewCallback!==undefined){
    if(callbackType==='video')video.cancelVideoFrameCallback?.(previewCallback);else cancelAnimationFrame(previewCallback);
  }
  stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
  worker?.terminate();worker=null;ready=false;inFlight=false;latest=null;learning=null;
  lastFrame=0;resetGate();cancelCalibration();
  $('empty').hidden=false;$('viewBadge').hidden=true;$('overlay').replaceChildren();
  $('capture').disabled=true;$('stop').disabled=true;$('learn').disabled=true;$('restart').textContent='Start camera';
  $('cameraControls').disabled=true;
  $('statusDot').classList.remove('active');$('fps').textContent='— FPS';$('resolution').textContent='Camera is off';
  $('gestureReadout').textContent='Gesture detection is off';phase(message,'Start the camera to continue.');
}

async function startCamera() {
  if(opening||busy)return;
  void captureSound.unlock();
  stopCamera('Connecting to camera');opening=true;
  $('restart').disabled=true;$('startEmpty').disabled=true;$('camera').disabled=true;
  const token=session;
  try {
    if(discoveryPromise)await discoveryPromise;
    if(token!==session)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is unavailable here. Open the packaged Gesture Camera.app.');
    const selected=prefs.camera;
    const connection=await connectCamera(navigator.mediaDevices,{id:selected,label:prefs.cameraLabel},{active:()=>token===session,onDiscover:()=>phase('Finding your camera','Refreshing camera access and reconnecting to your selected camera.')});
    const media=connection.stream;
    if(token!==session){media.getTracks().forEach(t=>t.stop());return;}
    stream=media;
    if(selected){
      const track=media.getVideoTracks()[0];
      prefs.camera=connection.device?.deviceId||track.getSettings().deviceId||selected;
      prefs.cameraLabel=connection.device?.label||track.label||prefs.cameraLabel;
      // A refreshed WebKit ID still refers to the same selected camera.
      if(prefs.calibrationDevice===selected)prefs.calibrationDevice=prefs.camera;
      rememberRotation();persist();
    }
    await maximizeResolution(media.getVideoTracks()[0], navigator.mediaDevices.getSupportedConstraints?.() || {}, () => token===session);
    if(token!==session)return;
    video.srcObject=media;await video.play();
    if(token!==session)return;
    await refreshCameras();
    const track=media.getVideoTracks()[0],settings=track.getSettings();
    if(prefs.points && prefs.calibrationDevice!==settings.deviceId){prefs.points=null;persist();notice('The camera has changed. Select the page corners again.');}
    track.addEventListener('ended',()=>{if(token===session){stopCamera('Camera disconnected');void refreshCameras();notice('The camera disconnected. Reconnect your iPhone or choose a camera in Settings.');}});
    track.addEventListener('mute',()=>{if(token===session){resetGate();latest=null;$('capture').disabled=true;phase('Camera paused','For iPhone, lock and position it again, or tap Resume on the phone.');}});
    track.addEventListener('unmute',()=>{if(token===session){resetGate();$('capture').disabled=busy;phase('Camera resumed','Use your gesture or press Space to capture.');}});

    $('empty').hidden=true;$('viewBadge').hidden=false;$('capture').disabled=track.muted;$('stop').disabled=false;
    $('cameraControls').disabled=false;
    $('restart').textContent='Reconnect';$('statusDot').classList.add('active');
    if(track.muted)phase('Camera paused','For iPhone, lock and position it again, or tap Resume on the phone.');
    else phase('Loading gesture detection','You can already capture with the button or Space.');
    fpsStart=performance.now();fpsCount=0;fpsFrames=0;lastAnalysis=0;lastVideoSize='';
    layout();startWorker(token);scheduleFrame(token);
  } catch(e) {
    if(token===session){stopCamera('Could not start camera');notice(`${e.name==='NotAllowedError'?'Allow Gesture Camera in System Settings → Privacy & Security → Camera.':prefs.camera&&['OverconstrainedError','NotFoundError'].includes(e.name)?'The selected camera is unavailable. Reconnect your iPhone, refresh the camera list, or select another camera.':e.message||e}`,true);}
  } finally {opening=false;$('restart').disabled=false;$('startEmpty').disabled=false;$('camera').disabled=false;void refreshCameras();}
}

function startWorker(token) {
  worker=new Worker('./gesture-worker.js');requestStarted=performance.now();
  worker.onerror=e=>workerFailure(e.message||'Could not load gesture detection');
  worker.onmessage=({data})=>{
    if(token!==session)return;
    if(data.type==='ready'){ready=true;lastResult=performance.now();$('learn').disabled=false;if(!stream?.getVideoTracks()[0]?.muted)phase('Waiting for index finger','Hold up your index finger, then move your hand away.');return;}
    if(data.type==='error'){workerFailure(data.error);return;}
    if(data.type!=='result')return;
    inFlight=false;lastResult=performance.now();
    if(stream?.getVideoTracks()[0]?.muted){resetGate();return;}
    // Old results cannot arm or fire a shutter after a pause or slow inference.
    if(lastResult-data.timestamp>1000){resetGate();$('gestureReadout').textContent='Detection is slow. The old result was discarded.';return;}
    const scores=data.landmarks.map((lm,i)=>gestureScore(lm,data.gestures[i]||[],prefs.learned));
    data.score=Math.max(0,...scores);latest=data;
    $('gestureReadout').textContent=`Score ${data.score.toFixed(2)} / ${Number(prefs.threshold).toFixed(2)} · ${data.landmarks.length} hand(s)`;
    if(learning){
      if(data.landmarks.length===1)learning.samples.push(fingerFeatures(data.landmarks[0]));
      if(learning.samples.length>=16){
        prefs.learned=Array.from({length:5},(_,i)=>learning.samples.reduce((s,f)=>s+f[i],0)/learning.samples.length);
        learning=null;recordingRelease.requireRelease();persist();controls();notice('Gesture saved. No photo was taken. Move your hand away before using the gesture to capture.');resetGate();phase('Gesture saved','Move your hand away. Recording does not take a photo.');
      }else if(lastResult-learning.started>10000){learning=null;notice('Keep one complete hand in view and try again.',true);}
      else phase('Recording gesture',`Keep one complete hand in view: ${learning.samples.length} / 16`);
      overlay();return;
    }
    if(dialogOpen()||stream?.getVideoTracks()[0]?.muted){resetGate();overlay();return;}
    if(!recordingRelease.allows({now:data.timestamp,hands:data.landmarks.length})){
      resetGate();phase('Move your hand away','Show the gesture again when you want to take a photo.');overlay();return;
    }
    if(prefs.auto&&!busy&&!gallery.working&&!calibrating){
      const event=gate.update({now:data.timestamp,score:data.score,hands:data.landmarks.length},{threshold:Number(prefs.threshold),hold:Number(prefs.hold)*1000,waitForHand:prefs.waitHand});
      updatePhase();
      if(event==='capture')void capture();
      if(event==='timeout')notice('Timed out without taking a photo. Move your hand away, then try again.');
    }else if(!busy&&!calibrating){phase('Manual capture','Click Capture or press Space to save the full frame.');}
    overlay();
  };
  worker.postMessage({type:'init'});
}

function workerFailure(message) {
  worker?.terminate();worker=null;ready=false;inFlight=false;latest=null;learning=null;resetGate();
  $('learn').disabled=true;$('gestureReadout').textContent='Gesture detection unavailable';
  phase('Manual capture available','The camera continues at its original resolution.');
  notice(`Gesture detection unavailable: ${message}. Reconnect the camera to try again.`,true);
}

function updatePhase() {
  if(gate.phase==='watch')phase(prefs.learned?'Waiting for custom gesture':'Waiting for index finger',`Hold a score of ${Number(prefs.threshold).toFixed(2)} for ${Number(prefs.hold).toFixed(1)} s.`);
  if(gate.phase==='hold')phase('Gesture detected — hold',`Hold progress ${Math.round(gate.progress*100)}%`);
  if(gate.phase==='clear')phase('Gesture confirmed — move your hand away',latest?.landmarks.length?'Your hand is still in the frame. Waiting to capture.':'Hand removed. Preparing to capture.');
  if(gate.phase==='cooldown')phase('Waiting between captures','Release the gesture. Ready again in 2 seconds.');
  $('progress').style.width=gate.progress*100+'%';
}

function scheduleFrame(token) {
  if(token!==session||!stream)return;
  if(video.requestVideoFrameCallback){callbackType='video';previewCallback=video.requestVideoFrameCallback((now,meta)=>onFrame(now,meta,token));}
  else{callbackType='animation';previewCallback=requestAnimationFrame(now=>onFrame(now,null,token));}
}

function onFrame(now,meta,token) {
  if(token!==session||!stream)return;
  if(stream.getVideoTracks()[0]?.muted){scheduleFrame(token);return;}
  const changed=meta || video.currentTime!==lastFrame;
  if(changed && video.readyState>=2){
    lastFrame=video.currentTime;
    const dims=`${video.videoWidth}×${video.videoHeight}`;
    if(dims!==lastVideoSize){lastVideoSize=dims;layout();}
    $('resolution').textContent=`Capture ${dims}`;
    fpsCount++;
    if(now-fpsStart>=1000){
      const frames=meta && fpsFrames ? meta.presentedFrames-fpsFrames:fpsCount;
      $('fps').textContent=`${(frames*1000/(now-fpsStart)).toFixed(1)} FPS${meta?'':' (estimated)'}`;
      fpsStart=now;fpsFrames=meta?.presentedFrames||0;fpsCount=0;
    }
    if(corrected)drawCorrection();
    if(ready&&!inFlight&&now-lastAnalysis>=110 && !busy){
      inFlight=true;lastAnalysis=now;requestStarted=now;
      const target=worker,id=++nextFrameId;
      createImageBitmap(video).then(bitmap=>{
        if(token!==session||target!==worker){bitmap.close();return;}
        target.postMessage({type:'frame',bitmap,timestamp:now,frameId:id},[bitmap]);
      }).catch(e=>{if(token===session)workerFailure(e.message);});
    }
  }
  scheduleFrame(token);
}

setInterval(()=>{
  if(worker && ((!ready&&performance.now()-requestStarted>30000)||(inFlight&&performance.now()-requestStarted>8000)))workerFailure('Gesture detection timed out');
  if(ready&&latest&&performance.now()-lastResult>1500){latest=null;resetGate();overlay();if(!busy)phase('Waiting for fresh detection','Detection paused. Old gestures will not trigger a photo.');}
},1000);

async function capture() {
  if(previewError||busy||gallery.working||!stream||stream.getVideoTracks()[0]?.muted||video.readyState<2||dialogOpen()||calibrating)return;
  void captureSound.unlock();
  busy=true;gallery.captureBusy=true;gallery.buttons();$('capture').disabled=true;$('rotate').disabled=true;$('chooseFolder').disabled=true;
  $('rotationRange').disabled=true;$('rotationAngle').disabled=true;
  gate.capture(performance.now());phase('Saving photo','Saving a PNG at the full camera resolution.');
  try {
    // Snapshot first; original and correction must describe the very same frame.
    const snapshot=originalCanvas(video,0),raw=originalCanvas(snapshot,prefs.rotation);
    let processed=null;
    if(prefs.points||Number(prefs.distortion)!==0){
      captureRenderer ||= new CorrectionRenderer(document.createElement('canvas'));
      captureRenderer.draw(snapshot,prefs.rotation,prefs.points,Number(prefs.distortion));
      processed=captureRenderer.canvas;
    }
    const display=processed||raw;
    const thumb=document.createElement('canvas');thumb.width=320;thumb.height=Math.round(320*display.height/display.width);
    thumb.getContext('2d').drawImage(display,0,0,thumb.width,thumb.height);
    const thumbnail=thumb.toDataURL('image/jpeg',.8);
    const backupOriginal=Boolean(processed && prefs.saveOriginal);
    const original=(!processed || backupOriginal)?await base64Blob(await pngBlob(raw)):null;
    const correction=processed?await base64Blob(await pngBlob(processed)):null;
    if(invoke){
      const photo=await invoke('save_capture',{original,corrected:correction,thumbnail,edit:processed?{rotation:0,points:prefs.points,distortion:Number(prefs.distortion)}:null});gallery.add(photo);
    }else{
      // Browser development preview still permits manual image export.
      const filename=`note-${Date.now()}`;
      for(const [suffix,body] of [['original',original],['corrected',correction]]) if(body){
        const a=document.createElement('a');a.href='data:image/png;base64,'+body;a.download=`${filename}-${suffix}.png`;a.click();
      }
      gallery.add({id:filename,filename:filename+'.png',thumbnail,width:display.width,height:display.height,created:Date.now(),_data:'data:image/png;base64,'+(correction||original),_original:backupOriginal?'data:image/png;base64,'+original:null});
    }
    $('flash').classList.remove('go');void $('flash').offsetWidth;$('flash').classList.add('go');
    notice(`Saved ${display.width}×${display.height} ${processed?'corrected':'original'} PNG${backupOriginal?`, plus ${raw.width}×${raw.height} original backup`:''}.`);
    phase('Photo saved','Release the gesture before the next capture.');
    void captureSound.play();
  }catch(e){notice(`Save failed: ${e.message||e}`,true);phase('Photo not saved','Check the save folder and try again.');}
  finally{busy=false;gallery.captureBusy=false;gallery.buttons();$('capture').disabled=!stream||!!stream.getVideoTracks()[0]?.muted;$('rotate').disabled=false;$('rotationRange').disabled=false;$('rotationAngle').disabled=false;$('chooseFolder').disabled=false;gate.capture(performance.now());}
}

async function loadLibrary(){
  if(!invoke){$('folderPath').textContent='Browser preview: photos are saved to Downloads';return;}
  try{const data=await invoke('library');$('folderPath').textContent=data.folder;gallery.setPhotos(data.photos,true);}catch(e){notice(String(e),true);}
}

function cancelCalibration(){calibrating=false;calibrationPoints=[];$('calibration').hidden=true;viewport.classList.remove('selecting');layout();overlay();}
function beginCalibration(){
  if(!stream){notice('Start the camera first.');return;}
  if(busy)return;
  $('settingsDialog').close();
  controls();
  calibrating=true;calibrationPoints=[];resetGate();layout();$('calibration').hidden=false;viewport.classList.add('selecting');
  $('calibrationText').textContent='Click the top-left corner (1/4), then top right, bottom right, bottom left';
  phase('Select page corners','This area applies to photo correction only. Gestures work across the full frame.');
}

viewport.addEventListener('pointerdown',e=>{
  if(!stream||e.target.closest('button'))return;
  const bounds=viewport.getBoundingClientRect();
  if(calibrating){
    const p={x:(e.clientX-bounds.left-rect.x)/rect.width,y:(e.clientY-bounds.top-rect.y)/rect.height};
    if(p.x<0||p.x>1||p.y<0||p.y>1)return;
    calibrationPoints.push(p);overlay();
    const names=['top-left','top-right','bottom-right','bottom-left'];
    if(calibrationPoints.length<4){$('calibrationText').textContent=`Click the ${names[calibrationPoints.length]} corner (${calibrationPoints.length+1}/4)`;return;}
    if(!validQuad(calibrationPoints)){calibrationPoints=[];overlay();$('calibrationText').textContent='Corners cross or the area is too small. Select top left → top right → bottom right → bottom left again.';return;}
    prefs.points=calibrationPoints.map(p=>({...p}));prefs.calibrationDevice=stream.getVideoTracks()[0].getSettings().deviceId;
    persist();cancelCalibration();layout();notice(prefs.saveOriginal?'Correction saved. Captures will include the corrected photo and original backup.':'Correction saved. Captures will save only the corrected photo.');return;
  }
});

function setRotation(angle){
  if(busy||!Number.isFinite(Number(angle))){controls();return;}
  prefs.rotation=rotationControlAngle(angle);rememberRotation();prefs.points=null;prefs.distortion=0;
  cancelCalibration();resetGate();persist();controls();layout();
}
$('rotate').onclick=()=>setRotation(prefs.rotation+90);
$('rotationRange').oninput=e=>setRotation(e.target.value);
$('rotationAngle').onchange=e=>setRotation(e.target.value);
$('calibrate').onclick=beginCalibration;$('cancelCalibration').onclick=cancelCalibration;
$('resetCorrection').onclick=()=>{prefs.points=null;prefs.distortion=0;cancelCalibration();persist();controls();layout();};
for(const id of ['threshold','hold','distortion'])$(id).oninput=e=>{prefs[id]=Number(e.target.value);persist();controls();resetGate();if(id==='distortion')layout();};
for(const [id,key] of [['auto','auto'],['waitHand','waitHand']])$(id).onchange=e=>{prefs[key]=e.target.checked;persist();resetGate();};
$('saveOriginal').onchange=e=>{prefs.saveOriginal=e.target.checked;persist();};
$('camera').onchange=e=>{
  if(!e.target.matches('input[name="camera"]')||!e.target.checked)return;
  rememberRotation();
  prefs.camera=e.target.value;prefs.cameraLabel=e.target.nextElementSibling?.textContent||'';
  prefs.rotation=rotationControlAngle(prefs.rotationByCamera[rotationKey()]??0);prefs.points=null;prefs.distortion=0;prefs.calibrationDevice='';
  cancelCalibration();resetGate();
  persist();controls();if(stream)void startCamera();
};
$('learn').onclick=()=>{if(!ready)return;$('settingsDialog').close();learning={started:performance.now(),samples:[]};recordingRelease.requireRelease();resetGate();notice('Keep one complete hand in view and hold your chosen capture gesture.');};
$('resetLearn').onclick=()=>{prefs.learned=null;learning=null;persist();controls();resetGate();};
for(const id of ['restart','startEmpty'])$(id).onclick=startCamera;
$('capture').onclick=capture;$('stop').onclick=()=>stopCamera();
$('cameraControls').onclick=async()=>{
  if(!stream)return;resetGate();
  try{
    if(invoke)await invoke('camera_controls');
    else notice('Use the Video menu in the macOS menu bar to adjust the camera lens and framing.');
  }catch(e){notice(`Could not open camera controls: ${e.message||e}`,true);}
};
$('soundToggle').onclick=()=>{prefs.soundOn=prefs.soundOn===false;captureSound.setEnabled(prefs.soundOn);persist();controls();if(prefs.soundOn)void captureSound.unlock();};
$('chooseFolder').onclick=async()=>{if(!invoke){notice('Open the desktop app to choose a save folder.');return;}try{await invoke('choose_folder');await loadLibrary();}catch(e){notice(String(e),true);}};
$('folder').onclick=()=>invoke?invoke('reveal',{filename:null}).catch(e=>notice(String(e),true)):notice('Browser preview uses the default Downloads folder.');
function dialogOpen(){return $('settingsDialog').open || $('photoEditor').open;}
for(const [button,close,dialog] of [['showSettings','closeSettings','settingsDialog']]){
  $(button).onclick=()=>{resetGate();learning=null;$(dialog).showModal();void refreshCameras();};
  $(close).onclick=()=>$(dialog).close();
  $(dialog).addEventListener('close',()=>{resetGate();if(stream?.getVideoTracks()[0]?.muted)phase('Camera paused','For iPhone, lock and position it again, or tap Resume on the phone.');else if(stream)phase('Camera ready','Use your gesture or press Space to capture.');});
}
// A real element owns outside clicks; no native ::backdrop hit testing or
// camera popup dismissal has to happen before the settings panel can close.
$('settingsBackdrop').onclick=e=>{e.stopPropagation();$('settingsDialog').close();};
$('photoEditor').addEventListener('close',resetGate);
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!dialogOpen()&&!e.repeat&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)){e.preventDefault();void capture();}if(e.code==='Escape'&&!dialogOpen())cancelCalibration();});
window.addEventListener('pagehide',()=>{pageClosed=true;stopCamera();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)resetGate();});
$('refreshCameras').onclick=()=>void discoverOnOpen();
navigator.mediaDevices?.addEventListener('devicechange',refreshCameras);
window.addEventListener('focus',()=>{if($('settingsDialog').open)void refreshCameras();});
setInterval(()=>{if($('settingsDialog').open&&!document.hidden&&!opening)void refreshCameras();},3000);
void discoverOnOpen();
void loadLibrary();
