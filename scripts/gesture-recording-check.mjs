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
  for(const waitForHand of [true,false]){
    const page=await browser.newPage({viewport:{width:1320,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({waitForHand})=>{
      localStorage.setItem('gesture-camera-v2',JSON.stringify({waitHand:waitForHand,hold:.2,threshold:.65}));
      window.pose='held';window.saved=[];
      window.Worker=class {
        terminated=false;
        postMessage(data){
          if(data.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);
          if(data.type==='frame'){
            data.bitmap.close();
            const hand=Array.from({length:21},(_,i)=>({x:.3+i*.01,y:.4+i*.005,z:0}));
            setTimeout(()=>{if(!this.terminated)this.onmessage?.({data:{type:'result',timestamp:data.timestamp,landmarks:window.pose==='held'?[hand]:[],gestures:[[]]}});},0);
          }
        }
        terminate(){this.terminated=true;}
      };
      window.__TAURI__={core:{invoke:async(command,args)=>{
        if(command==='library')return{folder:'/Test photos',photos:[]};
        if(command==='save_capture'){
          window.saved.push(args);const body=args.original||args.corrected,bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0)),v=new DataView(bytes.buffer);
          return{id:'test',filename:'test.png',width:v.getUint32(16),height:v.getUint32(20),created:Date.now(),thumbnail:args.thumbnail};
        }
        if(command==='load_photo')return{data:'data:image/png;base64,'+(window.saved[0].original||window.saved[0].corrected)};
      }}};
    },{waitForHand});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('#startEmpty');await page.waitForFunction(()=>!document.querySelector('#learn').disabled);
    await page.click('#showSettings');await page.getByText('Learn a custom gesture',{exact:true}).click();await page.click('#learn');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gesture-camera-v2')).learned?.length===5);
    // Continue holding the recorded pose well beyond the capture hold duration.
    await page.waitForTimeout(1600);assert.equal(await page.evaluate(()=>window.saved.length),0);
    assert.equal(await page.locator('#phase').textContent(),'Move your hand away');
    await page.evaluate(()=>window.pose='clear');await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(()=>window.saved.length),0);
    // A separate gesture still works normally after recording has ended.
    await page.evaluate(()=>window.pose='held');await page.waitForTimeout(850);
    if(waitForHand){assert.equal(await page.evaluate(()=>window.saved.length),0);await page.evaluate(()=>window.pose='clear');}
    await page.waitForFunction(()=>window.saved.length===1);await page.waitForTimeout(600);
    assert.equal(await page.evaluate(()=>window.saved.length),1);
    assert.deepEqual(errors,[]);await page.click('#stop');await page.close();
    console.log(`PASS: recording does not capture; a new gesture captures once (waitForHand=${waitForHand})`);
  }
}finally{await browser?.close();server.close();}
