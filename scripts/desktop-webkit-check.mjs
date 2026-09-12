import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const script=String.raw`
(async()=>{
  try {
    const worker=new Worker('./gesture-worker.js');
    const messages=[];
    await new Promise((resolve,reject)=>{
      worker.onerror=e=>reject(new Error(e.message));
      worker.onmessage=({data})=>{messages.push(data.type);if(data.type==='ready')resolve();if(data.type==='error')reject(new Error(data.error));};
      worker.postMessage({type:'init'});
    });
    const source=document.createElement('canvas');source.width=960;source.height=540;
    const ctx=source.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,960,540);
    for(let x=0;x<960;x+=2){ctx.fillStyle='#000';ctx.fillRect(x,0,1,540);}
    const bitmap=await createImageBitmap(source);
    const result=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data.type==='result'?resolve(data):reject(new Error(data.error));
      worker.postMessage({type:'frame',bitmap,timestamp:performance.now(),frameId:1},[bitmap]);
    });
    worker.terminate();
    const {originalCanvas,CorrectionRenderer}=await import('./correction.mjs');
    const raw=originalCanvas(source,0);const renderer=new CorrectionRenderer(document.createElement('canvas'));
    renderer.draw(source,0,null,0);
    const dest=document.createElement('canvas');dest.width=960;dest.height=540;
    dest.getContext('2d').drawImage(renderer.canvas,0,0);
    const a=ctx.getImageData(0,0,960,540).data,b=dest.getContext('2d').getImageData(0,0,960,540).data;
    let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));
    if(error>1)throw new Error('Pixel error: '+error);
    window.webkit.messageHandlers.report.postMessage({ok:!!navigator.mediaDevices?.getUserMedia,worker:messages,pixelError:error,hands:result.landmarks.length,mediaAPI:!!navigator.mediaDevices?.getUserMedia,secure:isSecureContext,userAgent:navigator.userAgent});
  } catch(e){window.webkit.messageHandlers.report.postMessage({ok:false,error:String(e),stack:e.stack});}
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
