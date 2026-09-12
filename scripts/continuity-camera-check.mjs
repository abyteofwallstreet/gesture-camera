import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const runtime=process.env.NOTE_PLAYWRIGHT || 'playwright';
const {chromium}=await import(runtime);
const root=fileURLToPath(new URL('../desktop/',import.meta.url));
const output=fileURLToPath(new URL('../tmp/desktop-check/',import.meta.url));await mkdir(output,{recursive:true});
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.task':'application/octet-stream'};
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.join(root,pathname==='/'?'index.html':pathname);
    if(!file.startsWith(root))throw new Error('outside root');
    const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const page=await browser.newPage({viewport:{width:1320,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.phone=true;window.requests=[];window.saved=[];window.cameraControlRequests=0;
    const media=navigator.mediaDevices, get=media.getUserMedia.bind(media);
    media.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'mac',label:'Mac camera'},...(window.phone?[{kind:'videoinput',deviceId:'phone',label:'Test iPhone Camera'}]:[])];
    media.getUserMedia=async args=>{
      window.requests.push(args);
      if(args.video.deviceId?.exact==='phone'&&!window.phone)throw new DOMException('Disconnected','NotFoundError');
      const stream=await get({audio:false,video:true});window.testTrack=stream.getVideoTracks()[0];const settings=window.testTrack.getSettings.bind(window.testTrack);window.testTrack.getSettings=()=>({...settings(),deviceId:args.video.deviceId?.exact||'mac'});return stream;
    };
    window.Worker=class {postMessage(data){if(data.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);if(data.type==='frame'){data.bitmap.close();setTimeout(()=>this.onmessage?.({data:{type:'result',timestamp:data.timestamp,landmarks:[],gestures:[],motion:0}}),0);}}terminate(){this.onmessage=null;}};
    window.__TAURI__={core:{invoke:async(command,args)=>{if(command==='camera_controls'){window.cameraControlRequests++;return;}if(command==='library')return{folder:'/Test photos',photos:[]};if(command==='save_capture')window.saved.push(args);}}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#cameraControls').isDisabled(),true);
  await page.click('#showSettings');await page.waitForFunction(()=>document.querySelector('#camera input[value="phone"]'));
  await page.click('#camera input[value="phone"]');await page.click('#restart');
  await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  await page.click('#cameraControls');
  assert.equal(await page.evaluate(()=>window.cameraControlRequests),1);
  assert.equal(await page.locator('#settingsDialog').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.saved.length),0);
  assert.equal(await page.evaluate(()=>window.requests.filter(c=>c.video.deviceId).at(-1).video.deviceId.exact),'phone');
  await page.evaluate(()=>window.originalOption=document.querySelector('#camera input[value="phone"]'));
  await page.click('#refreshCameras');
  assert.equal(await page.evaluate(()=>window.originalOption===document.querySelector('#camera input[value="phone"]')),true);
  // Exercise the visible camera controls with real pointer clicks, then close
  // Settings with exactly one click on the left.
  for(const camera of ['mac','phone']){
    await page.click('#rotate');
    assert.equal(await page.locator('#rotationLabel').textContent(),'90°');
    await page.locator('#distortion').evaluate(e=>{e.value='.1';e.dispatchEvent(new Event('input'));});
    await page.click(`#camera input[value="${camera}"]`);
    await page.waitForFunction(id=>window.requests.at(-1).video.deviceId.exact===id&&!document.querySelector('#camera').disabled,camera);
    const restored=camera==='phone'?90:0;
    assert.equal(await page.locator('#rotationLabel').textContent(),restored+'°');
    assert.equal(await page.locator('#correctedCanvas').isVisible(),false);
    assert.equal(await page.locator('#video').evaluate(video=>video.style.transform),`rotate(${restored}deg)`);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gesture-camera-v2')).rotation),restored);
    await page.mouse.click(100,200);
    assert.equal(await page.locator('#settingsDialog').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.saved.length),0);
    if(camera==='mac')await page.click('#showSettings');
  }
  await page.evaluate(()=>{Object.defineProperty(window.testTrack,'muted',{configurable:true,value:true});window.testTrack.dispatchEvent(new Event('mute'));});
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Space');await page.waitForTimeout(400);
  assert.equal(await page.locator('#phase').textContent(),'Camera paused');
  assert.equal(await page.locator('#capture').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.saved.length),0);
  await page.evaluate(()=>{Object.defineProperty(window.testTrack,'muted',{configurable:true,value:false});window.testTrack.dispatchEvent(new Event('unmute'));});
  assert.equal(await page.locator('#capture').isEnabled(),true);
  await page.evaluate(()=>{window.phone=false;window.testTrack.dispatchEvent(new Event('ended'));navigator.mediaDevices.dispatchEvent(new Event('devicechange'));});
  await page.waitForFunction(()=>document.querySelector('#camera input[value="phone"]').disabled);
  assert.equal(await page.locator('#camera input:checked').inputValue(),'phone');
  assert.equal(await page.locator('#capture').isDisabled(),true);
  await page.click('#showSettings');await page.click('#restart');
  await page.waitForFunction(()=>document.querySelector('#phase').textContent==='Could not start camera');
  assert.equal(await page.evaluate(()=>window.requests.filter(c=>c.video.deviceId).at(-1).video.deviceId.exact),'phone');
  await page.evaluate(()=>{window.phone=true;navigator.mediaDevices.dispatchEvent(new Event('devicechange'));});
  await page.waitForFunction(()=>!document.querySelector('#camera input[value="phone"]').disabled);
  await page.click('#restart');await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.equal(await page.locator('#camera input:checked').inputValue(),'phone');
  assert.deepEqual(errors,[]);
  console.log('PASS: iPhone selection, single-press dismissal after camera switches, stable refresh, pause blocks capture, disconnect has no silent fallback, reconnect restores selection (simulated devices)');
}finally{await browser?.close();server.close();}
