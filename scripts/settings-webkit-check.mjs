import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const script=String.raw`
(async()=>{
  const wait=async test=>{for(let i=0;i<150;i++){if(test())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timed out: '+test);};
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const click=async selector=>{
    let x=100,y=200;
    if(selector){const el=document.querySelector(selector);el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();x=r.left+r.width/2;y=r.top+r.height/2;}
    await new Promise(resolve=>{window.nativeClickDone=resolve;window.webkit.messageHandlers.nativeClick.postMessage({x,y});});
  };
  window.clickTrace=[];document.addEventListener('click',e=>window.clickTrace.push({id:e.target.id,tag:e.target.tagName,value:e.target.value,x:e.clientX,y:e.clientY}),true);
  try {
    // Native input events, synthetic streams only. The Swift harness denies
    // real camera permission as a second guard.
    const video=document.querySelector('#video');let fakeStream;
    Object.defineProperty(video,'srcObject',{configurable:true,get:()=>fakeStream,set:value=>{fakeStream=value;}});
    Object.defineProperty(video,'videoWidth',{get:()=>640});Object.defineProperty(video,'videoHeight',{get:()=>360});
    Object.defineProperty(video,'readyState',{get:()=>4});video.play=async()=>{};
    video.requestVideoFrameCallback=()=>1;video.cancelVideoFrameCallback=()=>{};
    window.Worker=class{postMessage(){}terminate(){}};
    const media=navigator.mediaDevices;window.requests=[];
    media.enumerateDevices=async()=>['mac','phone'].map(id=>({kind:'videoinput',deviceId:id,label:id==='mac'?'Mac Camera':'iPhone Camera'}));
    media.getSupportedConstraints=()=>({});
    media.getUserMedia=async args=>{
      window.requests.push(args.video.deviceId?.exact||'default');
      await new Promise(r=>setTimeout(r,700));
      const track=new EventTarget();track.getSettings=()=>({width:640,height:360,deviceId:args.video.deviceId?.exact||'mac'});track.getCapabilities=()=>({width:{max:640},height:{max:360}});track.applyConstraints=async()=>{};track.stop=()=>{};
      return{getTracks:()=>[track],getVideoTracks:()=>[track]};
    };
    let underlyingClicks=0;document.querySelector('main').addEventListener('click',()=>underlyingClicks++);
    await click('#showSettings');assert(document.querySelector('#settingsDialog').open,'Settings did not open');await click('#refreshCameras');
    await wait(()=>document.querySelectorAll('#camera input').length===3);
    await click('#camera input[value="mac"]');await click('#restart');
    await wait(()=>window.requests.length===1&&!document.querySelector('#camera').disabled);
    for(const id of ['phone','mac','phone']){
      await click('#camera input[value="'+id+'"]');
      assert(window.requests.at(-1)===id,'Radio did not switch camera through native mouse input');
      await click();
      assert(!document.querySelector('#settingsDialog').open,'First outside click did not close Settings during switch');
      await wait(()=>!document.querySelector('#camera').disabled);
      assert(!document.querySelector('#settingsDialog').open,'Switch completion reopened Settings');
      await click('#showSettings');
    }
    const panel=document.querySelector('#settingsPanel');panel.scrollTop=panel.scrollHeight;
    await click();assert(!document.querySelector('#settingsDialog').open,'Scrolled Settings did not close with one click');
    assert(underlyingClicks===0,'Dismissal clicked the underlying camera area');
    await click('#stop');
    window.webkit.messageHandlers.report.postMessage({ok:true,nativeMouseClicks:true,cameraSwitches:window.requests,closesWhileConnecting:true,closesWhenScrolled:true,noClickThrough:true});
  }catch(e){window.webkit.messageHandlers.report.postMessage({ok:false,error:String(e),stack:e.stack,clickTrace:window.clickTrace,requests:window.requests,phase:document.querySelector('#phase').textContent});}
})(); void 0;
`;
await mkdir(path.join(root,'tmp/desktop-check'),{recursive:true});
const scriptPath=path.join(root,'tmp/desktop-check/webkit-script.js');await writeFile(scriptPath,script);
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'};
const conf=JSON.parse(await readFile(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.join(root,'desktop',pathname==='/'?'index.html':pathname);
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Security-Policy':conf.app.security.csp});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});
const child=spawn(path.join(root,'tmp/desktop-check/WebKitCheck.app/Contents/MacOS/wkcheck'),[`http://127.0.0.1:${server.address().port}`,scriptPath],{stdio:'inherit'});
child.on('error',e=>{console.error(e);server.close();process.exitCode=1;});
child.on('exit',code=>{server.close();process.exitCode=code||0;});
