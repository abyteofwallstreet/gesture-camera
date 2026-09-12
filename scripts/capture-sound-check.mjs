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
    window.audioStarts=[];window.saved=[];window.saveFails=false;window.savePending=false;
    window.AudioContext=class{
      state='suspended';currentTime=0;destination={};async resume(){this.state='running';}
      createOscillator(){return{frequency:{},connect(){},disconnect(){},start(){window.audioStarts.push({saved:window.saved.length,pending:window.savePending});},stop(){this.onended?.();}};}
      createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    };
    window.Worker=class{postMessage(){}terminate(){}};
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='library')return{folder:'/Test photos',photos:[]};
      if(command==='save_capture'){
        window.savePending=true;await new Promise(r=>setTimeout(r,500));window.savePending=false;
        if(window.saveFails)throw new Error('Test save failure');
        window.saved.push(args);return{id:'test-'+window.saved.length,filename:'test.png',width:640,height:480,created:Date.now(),thumbnail:args.thumbnail};
      }
      if(command==='load_photo')return{data:'data:image/png;base64,'+(window.saved.at(-1).original||window.saved.at(-1).corrected)};
    }}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#soundToggle').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#settingsDialog #soundToggle').count(),0);
  await page.click('#startEmpty');await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.equal(await page.evaluate(()=>window.audioStarts.length),0);
  await page.evaluate(()=>window.saveFails=true);await page.click('#capture');
  await page.waitForFunction(()=>document.querySelector('#phase').textContent==='Photo not saved');
  assert.equal(await page.evaluate(()=>window.audioStarts.length),0);
  await page.evaluate(()=>window.saveFails=false);await page.click('#capture');
  await page.waitForFunction(()=>window.savePending);
  assert.equal(await page.evaluate(()=>window.audioStarts.length),0);
  await page.waitForFunction(()=>window.audioStarts.length===2);
  assert.deepEqual(await page.evaluate(()=>window.audioStarts),[{saved:1,pending:false},{saved:1,pending:false}]);
  await page.click('#soundToggle');assert.equal(await page.locator('#soundLabel').textContent(),'Muted');
  await page.click('#capture');await page.waitForFunction(()=>window.saved.length===2&&!document.querySelector('#capture').disabled);
  assert.equal(await page.evaluate(()=>window.audioStarts.length),2);
  await page.reload();assert.equal(await page.locator('#soundToggle').getAttribute('aria-pressed'),'false');
  await page.click('#startEmpty');await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  await page.click('#capture');await page.waitForFunction(()=>window.saved.length===1&&!document.querySelector('#capture').disabled);
  assert.equal(await page.evaluate(()=>window.audioStarts.length),0);
  await page.click('#soundToggle');assert.equal(await page.locator('#soundLabel').textContent(),'Sound on');
  assert.equal(await page.evaluate(()=>window.audioStarts.length),0);
  await page.click('#capture');await page.waitForFunction(()=>window.audioStarts.length===2);
  // The visible main-window control remains reachable at supported window sizes.
  for(const width of [1320,940,600]){
    await page.setViewportSize({width,height:700});
    const r=await page.locator('#soundToggle').boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width&&r.y+r.height<=700);
  }
  assert.deepEqual(errors,[]);await page.click('#stop');
  console.log('PASS: sound only after save success, no sound while saving or on failure, mute works, mute persists across reload, unmute restores sound, toggle outside Settings and visible. Audio output mocked.');
}finally{await browser?.close();server.close();}
