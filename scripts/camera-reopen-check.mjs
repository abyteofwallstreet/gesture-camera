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
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1320,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const visit=Number(sessionStorage.getItem('cameraVisit')||0)+1;sessionStorage.setItem('cameraVisit',String(visit));
    if(!localStorage.getItem('gesture-camera-v2'))localStorage.setItem('gesture-camera-v2',JSON.stringify({camera:'expired-id',cameraLabel:'My iPhone',rotation:90,soundOn:false}));
    window.currentPhone='iphone-'+visit;window.authorized=false;window.requests=[];window.temporary=[];window.saved=[];window.edits=[];
    const media=navigator.mediaDevices,get=media.getUserMedia.bind(media);
    media.enumerateDevices=async()=>window.authorized?[{kind:'videoinput',deviceId:'mac',label:'Mac camera'},{kind:'videoinput',deviceId:window.currentPhone,label:'My iPhone'}]:[{kind:'videoinput',deviceId:'',label:''}];
    media.getUserMedia=async args=>{
      const id=args.video.deviceId?.exact;window.requests.push(id||'default');
      if(id!==undefined&&(!window.authorized||id!==window.currentPhone))throw new DOMException('Stale ID','OverconstrainedError');
      const stream=await get({audio:false,video:true}),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);
      track.getSettings=()=>({...settings(),deviceId:id||'mac'});
      if(!id){window.authorized=true;window.temporary.push(track);}
      return stream;
    };
    window.Worker=class{postMessage(){}terminate(){}};
    let photo,data;const dimensions=body=>{const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);return{width:view.getUint32(16),height:view.getUint32(20)};};
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='library')return{folder:'/Test photos',photos:[]};
      if(command==='save_capture'){window.saved.push(args);data=args.corrected||args.original;photo={id:'test',filename:'test.png',thumbnail:args.thumbnail,...dimensions(data),created:Date.now(),revision:0};return photo;}
      if(command==='load_photo')return{data:'data:image/png;base64,'+data,originalBackup:false,revision:photo.revision};
      if(command==='replace_photo'){window.edits.push(args);data=args.image;photo={...photo,...dimensions(data),revision:1,edit:args.edit,thumbnail:args.thumbnail};return photo;}
    }}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.querySelector('#camera').dataset.options);
  await page.click('#showSettings');await page.click('#refreshCameras');
  await page.evaluate(()=>{navigator.mediaDevices.dispatchEvent(new Event('devicechange'));window.dispatchEvent(new Event('focus'));});
  await page.waitForTimeout(3200);
  await page.mouse.click(100,200);
  assert.equal(await page.evaluate(()=>document.querySelector('#video').srcObject),null);
  assert.deepEqual(await page.evaluate(()=>window.requests),[]);
  assert.equal(await page.evaluate(()=>window.temporary.every(t=>t.readyState==='ended')),true);
  await page.click('#startEmpty');await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.deepEqual(await page.evaluate(()=>window.requests),['expired-id','default','iphone-1']);
  assert.equal(await page.evaluate(()=>window.temporary.every(t=>t.readyState==='ended')),true);
  assert.equal(await page.evaluate(()=>document.querySelector('#video').srcObject.getVideoTracks()[0].getSettings().deviceId),'iphone-1');
  await page.click('#showSettings');await page.fill('#rotationAngle','17.3');await page.press('#rotationAngle','Tab');
  assert.equal(await page.locator('#rotationLabel').textContent(),'17.3°');
  await page.mouse.click(100,200);await page.click('#capture');await page.waitForFunction(()=>window.saved.length===1);
  const size=await page.evaluate(async()=>{const {rotatedSize}=await import('./core.mjs');const v=document.querySelector('#video');return rotatedSize(v.videoWidth,v.videoHeight,17.3);});
  assert.deepEqual(await page.evaluate(()=>{const body=window.saved[0].corrected||window.saved[0].original,b=Uint8Array.from(atob(body),c=>c.charCodeAt(0)),v=new DataView(b.buffer);return{width:v.getUint32(16),height:v.getUint32(20)};}),size);
  await page.waitForFunction(()=>!document.querySelector('#editPhoto').disabled);await page.click('#editPhoto');
  await page.waitForFunction(()=>!document.querySelector('#saveEdit').disabled);
  // Both ends must stay put during native range keyboard interaction.
  for(const [key,value] of [['Home','-180'],['ArrowRight','-179.9'],['End','180'],['ArrowLeft','179.9']]){
    await page.locator('#editRotationRange').focus();await page.keyboard.press(key);
    assert.equal(await page.locator('#editRotationRange').inputValue(),value);
    assert.equal(await page.locator('#editRotationAngle').inputValue(),value);
  }
  await page.fill('#editRotationAngle','-12.4');await page.press('#editRotationAngle','Tab');
  await page.click('#saveEdit');await page.waitForFunction(()=>window.edits.length===1&&!document.querySelector('#photoEditor').open);
  assert.ok(Math.abs(await page.evaluate(()=>window.edits[0].edit.rotation)-347.6)<.0001);
  assert.ok(Math.abs(await page.evaluate(()=>JSON.parse(localStorage.getItem('gesture-camera-v2')).rotation)-17.3)<1e-8);
  await page.click('#showSettings');await page.locator('#distortion').evaluate(e=>{e.value='.1';e.dispatchEvent(new Event('input'));});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#camera').dataset.options);assert.deepEqual(await page.evaluate(()=>window.requests),[]);await page.click('#startEmpty');await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.deepEqual(await page.evaluate(()=>window.requests),['iphone-1','default','iphone-2']);
  assert.equal(await page.locator('#rotationLabel').textContent(),'17.3°');
  assert.equal(await page.locator('#correctedCanvas').isVisible(),true);
  assert.equal(await page.locator('#corrected').count(),0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gesture-camera-v2')).camera),'iphone-2');
  assert.equal(await page.evaluate(()=>window.temporary.every(t=>t.readyState==='ended')),true);
  await page.click('#showSettings');
  for(const [key,value] of [['Home','-180'],['ArrowRight','-179.9'],['End','180'],['ArrowLeft','179.9'],['Home','-180']]){
    await page.locator('#rotationRange').focus();await page.keyboard.press(key);
    assert.equal(await page.locator('#rotationRange').inputValue(),value);
    assert.equal(await page.locator('#rotationAngle').inputValue(),value);
  }
  // Another controls refresh, camera change, and app reload preserve -180.
  await page.locator('#threshold').evaluate(e=>e.dispatchEvent(new Event('input')));
  assert.equal(await page.locator('#rotationRange').inputValue(),'-180');
  await page.mouse.click(100,200);await page.click('#stop');await page.click('#showSettings');
  await page.click('#camera input[value="mac"]');
  assert.equal(await page.locator('#rotationRange').inputValue(),'0');
  await page.click('#camera input[value="iphone-2"]');
  assert.equal(await page.locator('#rotationRange').inputValue(),'-180');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#camera').dataset.options);assert.deepEqual(await page.evaluate(()=>window.requests),[]);
  assert.equal(await page.locator('#rotationRange').inputValue(),'-180');
  assert.equal(await page.locator('#rotationLabel').textContent(),'-180°');
  assert.deepEqual(errors,[]);

  console.log('PASS: startup/Settings/refresh/focus/device-change never request camera access; explicit Start performs cold permission discovery, refreshed ID after reload, selected iPhone only in preview, temporary tracks stopped, fractional camera/photo rotation, remembered angle survives refreshed IDs. Synthetic devices.');
}finally{await browser?.close();server.close();}
