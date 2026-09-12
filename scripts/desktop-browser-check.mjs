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
try{
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1320,height:1000},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const remoteRequests=[],remoteSockets=[];
  const localOrigin=`http://127.0.0.1:${server.address().port}`;
  page.context().on('request',request=>{
    const url=new URL(request.url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==localOrigin)remoteRequests.push(url.origin);
  });
  page.on('websocket',socket=>remoteSockets.push(new URL(socket.url()).origin));
  await page.context().route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==localOrigin)return route.abort();
    return route.continue();
  });

  page.on('console',m=>{if(m.type()==='error')console.error('Browser:',m.text().slice(0,300));});
  await page.addInitScript(()=>{
    window.saved=[];window.edits=[];window.deleted=[];window.reorders=[];window.photoRecords=[];window.photoData={};
    const dims=body=>{const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));const v=new DataView(bytes.buffer);return{width:v.getUint32(16),height:v.getUint32(20)};};
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='library')return {folder:'/Test photos/Gesture Camera',photos:window.photoRecords};
      if(command==='save_capture'){
        window.saved.push(args);
        const id='photo-'+window.saved.length;
        const photo={id,filename:id+'.png',...dims(args.corrected||args.original),created:Date.now(),thumbnail:args.thumbnail,edit:args.edit,revision:0};
        window.photoRecords.unshift(photo);window.photoData[id]={current:args.corrected||args.original,original:args.corrected?args.original:null};return photo;
      }
      if(command==='load_photo'){
        const photo=window.photoRecords.find(p=>p.id===args.id),data=window.photoData[args.id];
        if(!photo)throw new Error('missing photo');
        return{data:'data:image/png;base64,'+(args.source?(data.original||data.current):data.current),originalBackup:!!data.original,edit:args.source&&data.original?photo.edit:null,revision:photo.revision};
      }
      if(command==='replace_photo'){
        window.edits.push(args);const index=window.photoRecords.findIndex(p=>p.id===args.id),old=window.photoRecords[index];
        const photo={...old,...dims(args.image),edit:args.edit,thumbnail:args.thumbnail,revision:old.revision+1};
        window.photoRecords[index]=photo;window.photoData[args.id].current=args.image;return photo;
      }
      if(command==='reorder_photos'){window.reorders.push(args.ids);await new Promise(r=>setTimeout(r,400));window.photoRecords=args.ids.map(id=>window.photoRecords.find(p=>p.id===id));return null;}
      if(command==='delete_photo'){window.deleted.push(args.id);window.photoRecords=window.photoRecords.filter(p=>p.id!==args.id);return null;}
      return null;
    }}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#saveOriginal').isChecked(),false);
  assert.equal(await page.locator('#quality').count(),0);
  assert.equal(await page.locator('[data-mode]').count(),0);
  assert.equal(await page.locator('#settingsDialog').isVisible(),false);
  assert.equal(await page.locator('#photoSection').count(),1);
  for (const [width,height] of [[1320,1000],[940,650],[600,700]]) {
    await page.setViewportSize({width,height});
    const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollHeight, height:innerHeight, bottom:document.querySelector('#stop').getBoundingClientRect().bottom}));
    assert.ok(bounds.bottom<=height,JSON.stringify(bounds));
  }
  await page.setViewportSize({width:1320,height:1000});
  await page.screenshot({path:path.join(output,'idle.png'),fullPage:true});
  await page.click('#showSettings');
  await page.mouse.click(100,200);assert.equal(await page.locator('#settingsDialog').isVisible(),false);
  await page.click('#startEmpty');
  await page.waitForFunction(()=>document.querySelector('#video').videoWidth>0);
  await page.waitForFunction(()=>/Score/.test(document.querySelector('#gestureReadout').textContent),{timeout:45000});
  const dimensions=await page.evaluate(()=>({w:document.querySelector('#video').videoWidth,h:document.querySelector('#video').videoHeight}));
  console.log('Fake camera input:',dimensions);
  assert.equal(dimensions.w,3840);assert.equal(dimensions.h,2160);
  await page.click('#capture');await page.waitForFunction(()=>window.saved.length===1);
  const png=await page.evaluate(()=>window.saved[0].original);await writeFile(path.join(output,'captured.png'),Buffer.from(png,'base64'));
  const head=Buffer.from(png,'base64');assert.equal(head.readUInt32BE(16),dimensions.w);assert.equal(head.readUInt32BE(20),dimensions.h);
  await page.waitForFunction(()=>!document.querySelector('#rotate').disabled);
  await page.click('#showSettings');await page.click('#rotate');await page.click('#closeSettings');await page.click('#capture');await page.waitForFunction(()=>window.saved.length===2);
  const rot=Buffer.from(await page.evaluate(()=>window.saved[1].original),'base64');assert.equal(rot.readUInt32BE(16),dimensions.h);assert.equal(rot.readUInt32BE(20),dimensions.w);
  await page.waitForFunction(()=>!document.querySelector('#rotate').disabled);
  await page.click('#showSettings');
  await page.evaluate(()=>{
    const slider=document.querySelector('#distortion');slider.value='.1';slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.click('#closeSettings');await page.click('#capture');await page.waitForFunction(()=>window.saved.length===3);
  assert.equal(await page.evaluate(()=>window.saved[2].original),null);
  assert.ok(await page.evaluate(()=>!!window.saved[2].corrected));
  await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.ok(!(await page.locator('#notice').textContent()).includes('plus'));
  await page.click('#showSettings');await page.check('#saveOriginal');await page.click('#closeSettings');
  await page.click('#capture');await page.waitForFunction(()=>window.saved.length===4);
  assert.ok(await page.evaluate(()=>!!window.saved[3].original&&!!window.saved[3].corrected));
  await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.ok((await page.locator('#notice').textContent()).includes('original backup'));
  await page.click('#showSettings');await page.click('#calibrate');
  assert.equal(await page.locator('#correctedCanvas').isVisible(),false);
  await page.click('#cancelCalibration');
  assert.equal(await page.locator('#correctedCanvas').isVisible(),true);
  // Numeric image test checks orientation and one-pixel stripe retention independently of the camera.
  const quality=await page.evaluate(async()=>{
    const {originalCanvas,CorrectionRenderer}=await import('./correction.mjs');
    const source=document.createElement('canvas');source.width=96;source.height=64;
    const ctx=source.getContext('2d');const image=ctx.createImageData(96,64);
    for(let y=0;y<64;y++)for(let x=0;x<96;x++){
      const n=(y*96+x)*4;image.data[n]=x%2?255:0;image.data[n+1]=y<32?255:0;image.data[n+2]=x<48?255:0;image.data[n+3]=255;
    }
    ctx.putImageData(image,0,0);
    const raw=originalCanvas(source,0).getContext('2d').getImageData(0,0,96,64).data;
    const renderer=new CorrectionRenderer(document.createElement('canvas'));renderer.draw(source,0,null,0);
    const read=document.createElement('canvas');read.width=96;read.height=64;const out=read.getContext('2d');out.drawImage(renderer.canvas,0,0);
    const actual=out.getImageData(0,0,96,64).data;
    let rawError=0,gpuError=0;
    for(let i=0;i<raw.length;i++){rawError=Math.max(rawError,Math.abs(raw[i]-image.data[i]));gpuError=Math.max(gpuError,Math.abs(actual[i]-image.data[i]));}
    renderer.draw(source,90,null,0);const r=originalCanvas(source,90);
    read.width=64;read.height=96;out.drawImage(renderer.canvas,0,0);
    const expected=r.getContext('2d').getImageData(0,0,64,96).data,rotated=out.getImageData(0,0,64,96).data;
    let rotateError=0;for(let i=0;i<expected.length;i++)rotateError=Math.max(rotateError,Math.abs(expected[i]-rotated[i]));
    const {rotatePoint,rotatedSize}=await import('./core.mjs');
    const colors=[[240,40,40],[40,240,40],[40,40,240],[240,240,40]];
    const points=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}];
    source.width=320;source.height=180;ctx.fillStyle='white';ctx.fillRect(0,0,320,180);
    points.forEach((p,i)=>{ctx.fillStyle=`rgb(${colors[i].join(',')})`;ctx.fillRect(p.x*320-10,p.y*180-10,20,20);});
    let freeAngleError=0;
    for(const angle of [17.3,89.9,132.5,270.1]){
      const size=rotatedSize(320,180,angle),cpu=originalCanvas(source,angle);
      renderer.draw(source,angle,null,0);read.width=size.width;read.height=size.height;out.drawImage(renderer.canvas,0,0);
      for(let i=0;i<points.length;i++){
        const p=rotatePoint(points[i],angle,320,180),x=Math.floor(p.x*size.width),y=Math.floor(p.y*size.height);
        for(const context of [out,cpu.getContext('2d')]){
          const color=context.getImageData(x,y,1,1).data;
          for(let channel=0;channel<3;channel++)freeAngleError=Math.max(freeAngleError,Math.abs(color[channel]-colors[i][channel]));
        }
      }
    }
    return {rawError,gpuError,rotateError,freeAngleError};
  });
  assert.equal(quality.rawError,0);assert.ok(quality.gpuError<=1,JSON.stringify(quality));assert.ok(quality.rotateError<=1,JSON.stringify(quality));
  assert.ok(quality.freeAngleError<=1,JSON.stringify(quality));
  console.log('Pixel comparison:',quality);
  await page.click('#showSettings');assert.equal(await page.locator('#corrected').count(),0);assert.equal(await page.locator('#correctedCanvas').isVisible(),true);
  await page.screenshot({path:path.join(output,'settings.png'),fullPage:true});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settingsDialog').isVisible(),false);
  await page.waitForTimeout(300);
  await page.screenshot({path:path.join(output,'camera.png'),fullPage:true});
  await page.click('#showPhotos');assert.equal(await page.locator('.photo').count(),4);
  await page.waitForFunction(()=>document.querySelector('#selectedPhoto').naturalWidth===2160);
  assert.equal(await page.locator('.photo.selected').getAttribute('data-id'),'photo-4');
  await page.locator('.photo[data-id="photo-1"]').click();
  await page.waitForFunction(()=>document.querySelector('#selectedPhoto').naturalWidth===3840);
  await page.click('#capture');await page.waitForFunction(()=>window.saved.length===5);
  await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
  assert.equal(await page.locator('.photo.selected').getAttribute('data-id'),'photo-5');
  await page.waitForFunction(()=>document.querySelector('#selectedPhoto').naturalWidth===2160);
  await page.click('#showPhotos');
  await page.evaluate(()=>{
    window.thumbnailNodes=Object.fromEntries([...document.querySelectorAll('.photo')].map(b=>[b.dataset.id,b]));
    window.toolbarFaded=false;
    window.toolbarObserver=new MutationObserver(()=>{
      for(const id of ['editPhoto','deletePhoto','movePhotoDown'])if(document.getElementById(id).disabled)window.toolbarFaded=true;
    });
    for(const id of ['editPhoto','deletePhoto','movePhotoDown'])window.toolbarObserver.observe(document.getElementById(id),{attributes:true,attributeFilter:['disabled']});
  });
  await page.click('#movePhotoDown');
  await page.waitForFunction(()=>window.reorders.length===1);
  assert.equal(await page.locator('#editPhoto').evaluate(b=>getComputedStyle(b).opacity),'1');
  await page.evaluate(()=>document.getElementById('movePhotoDown').click());
  await page.waitForFunction(()=>document.querySelector('#movePhotoDown').getAttribute('aria-disabled')==='false');
  assert.equal(await page.evaluate(()=>window.reorders.length),1);
  assert.equal(await page.evaluate(()=>{window.toolbarObserver.disconnect();return window.toolbarFaded;}),false);
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.photo')].every(b=>window.thumbnailNodes[b.dataset.id]===b)));

  assert.deepEqual(await page.locator('.photo').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),['photo-4','photo-5','photo-3','photo-2','photo-1']);
  assert.ok(await page.locator('.photo').evaluateAll(nodes=>nodes.every(n=>!n.draggable&&!n.querySelector('img').draggable)));
  assert.equal(await page.getByText('Drag to reorder',{exact:false}).count(),0);
  await page.locator('.photo[data-id="photo-5"]').dragTo(page.locator('.photo[data-id="photo-4"]'));
  assert.equal(await page.evaluate(()=>window.reorders.length),1);
  assert.deepEqual(await page.locator('.photo').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),['photo-4','photo-5','photo-3','photo-2','photo-1']);
  await page.locator('.photo[data-id="photo-5"]').click();await page.click('#movePhotoUp');
  await page.waitForFunction(()=>window.reorders.length===2&&document.querySelector('.photo').dataset.id==='photo-5');
  assert.equal(await page.locator('.photo').first().getAttribute('data-id'),'photo-5');
  await page.locator('.photo[data-id="photo-5"]').click();
  const originalBefore=await page.evaluate(()=>window.photoData['photo-5'].original);
  await page.click('#editPhoto');await page.waitForFunction(()=>!document.querySelector('#saveEdit').disabled);
  assert.ok((await page.locator('#editSource').textContent()).includes('Editing from the original backup'));
  await page.click('#editCrop');
  let box=await page.locator('#editImageFrame').boundingBox();
  await page.mouse.move(box.x+box.width*.15,box.y+box.height*.15);await page.mouse.down();await page.mouse.move(box.x+box.width*.85,box.y+box.height*.85,{steps:6});await page.mouse.up();
  await page.check('#editPreview');
  await page.screenshot({path:path.join(output,'photo-editor.png'),fullPage:true});
  await page.click('#saveEdit');await page.waitForFunction(()=>window.edits.length===1&&!document.querySelector('#photoEditor').open);
  assert.equal(await page.evaluate(()=>window.photoData['photo-5'].original),originalBefore);
  const changed=await page.evaluate(()=>window.photoRecords.find(p=>p.id==='photo-5'));
  assert.ok(changed.width<2160&&changed.height<3840);
  await page.waitForFunction(w=>document.querySelector('#selectedPhoto').naturalWidth===w,changed.width);
  await page.click('#editPhoto');await page.waitForFunction(()=>!document.querySelector('#saveEdit').disabled);
  await page.click('#editRotate');await page.click('#cancelEdit');assert.equal(await page.evaluate(()=>window.edits.length),1);
  await page.locator('.photo[data-id="photo-3"]').click();await page.click('#editPhoto');
  await page.waitForFunction(()=>!document.querySelector('#saveEdit').disabled);
  assert.ok((await page.locator('#editSource').textContent()).includes('No separate original backup'));
  await page.click('#editRotate');await page.click('#saveEdit');await page.waitForFunction(()=>window.edits.length===2&&!document.querySelector('#photoEditor').open);
  assert.equal(await page.evaluate(()=>window.photoData['photo-3'].original),null);
  await page.click('#deletePhoto');await page.waitForFunction(()=>window.deleted.length===1);
  assert.equal(await page.locator('.photo').count(),4);assert.equal(await page.locator('.photo[data-id="photo-3"]').count(),0);
  await page.screenshot({path:path.join(output,'photo-gallery.png'),fullPage:true});
  for(let total=2;total<=5;total++){await page.click('#deletePhoto');await page.waitForFunction(n=>window.deleted.length===n,total);}
  await page.waitForFunction(()=>document.querySelector('#editPhoto').disabled);
  assert.equal(await page.locator('.photo').count(),0);assert.equal(await page.locator('#selectedPhoto').isVisible(),false);


  await page.click('#showSettings');await page.click('#calibrate');
  assert.equal(await page.locator('#settingsDialog').isVisible(),false);
  assert.equal(await page.locator('#calibration').isVisible(),true);
  await page.click('#cancelCalibration');
  assert.equal(await page.locator('h1').textContent(),'Gesture Camera');
  assert.equal(await page.evaluate(()=>/[\u4e00-\u9fff]/.test(document.body.textContent)),false);
  assert.deepEqual(errors,[]);
  await page.click('#stop');assert.equal(await page.locator('#empty').isVisible(),true);
  await page.reload();assert.equal(await page.locator('#saveOriginal').isChecked(),true);
  assert.deepEqual(remoteRequests,[],'App or worker attempted an external HTTP request');
  assert.deepEqual(remoteSockets,[],'App attempted a WebSocket connection');
  console.log('PASS: no external HTTP or WebSocket requests during tested camera, gesture and photo workflows.');
  console.log('PASS: backup off by default, corrected-only capture, optional backup, persisted setting.');
  console.log('PASS: local worker, full-size capture, single preview, English UI, stable toolbar during slow saves, thumbnail node reuse, backdrop dismissal, gallery selection/newest sync, dragging cannot reorder, Earlier/Later reorder, crop/edit/replace with and without backup, cancel, delete, WebGL pixels, stop lifecycle.');
}finally{await browser?.close();server.close();}
