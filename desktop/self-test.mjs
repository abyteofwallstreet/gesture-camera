// Explicit --self-test mode uses generated pixels and a temporary save directory.
// It never calls getUserMedia or asks for camera access.
export async function run() {
  const invoke=window.__TAURI__.core.invoke;
  let worker;
  const timer=setTimeout(()=>invoke('self_test_result',{result:{ok:false,error:'Self-test timeout'}}),30000);
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error(`Camera API unavailable at ${location.href}; secure=${isSecureContext}`);
    const {originalCanvas,CorrectionRenderer,pngBlob,base64Blob}=await import('./correction.mjs');
    const source=document.createElement('canvas');source.width=1920;source.height=1080;
    const ctx=source.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1920,1080);
    for(let x=0;x<1920;x+=2){ctx.fillStyle='#000';ctx.fillRect(x,0,1,1080);}
    worker=new Worker('./gesture-worker.js');
    await new Promise((resolve,reject)=>{
      worker.onerror=e=>reject(new Error(e.message));
      worker.onmessage=({data})=>data.type==='ready'?resolve():reject(new Error(data.error));
      worker.postMessage({type:'init'});
    });
    const bitmap=await createImageBitmap(source);
    const handResult=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data.type==='result'?resolve(data):reject(new Error(data.error));
      worker.postMessage({type:'frame',bitmap,timestamp:performance.now(),frameId:1},[bitmap]);
    });
    worker.terminate();worker=null;
    const renderer=new CorrectionRenderer(document.createElement('canvas'));renderer.draw(source,0,null,0);
    const read=originalCanvas(renderer.canvas,0);
    const a=ctx.getImageData(0,0,1920,1080).data,b=read.getContext('2d').getImageData(0,0,1920,1080).data;
    let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));
    if(error>1)throw new Error(`Pixel error ${error}`);
    const original=await base64Blob(await pngBlob(source));
    const corrected=await base64Blob(await pngBlob(originalCanvas(source,90)));
    const thumb=document.createElement('canvas');thumb.width=160;thumb.height=90;thumb.getContext('2d').drawImage(source,0,0,160,90);
    const thumbnail=thumb.toDataURL('image/jpeg',.7);
    const saved=await invoke('save_capture',{original:null,corrected,thumbnail});
    const backedUp=await invoke('save_capture',{original,corrected,thumbnail});
    const rawOnly=await invoke('save_capture',{original,corrected:null,thumbnail});
    const library=await invoke('library');
    if(saved.width!==1080||saved.height!==1920||library.photos.length!==3)throw new Error('Saved image dimensions/history mismatch');
    if(saved.original!==null||!backedUp.original||backedUp.original===backedUp.filename||rawOnly.original!==rawOnly.filename||rawOnly.width!==1920)throw new Error('Original backup setting mismatch');
    const before=await invoke('load_photo',{id:backedUp.id,source:true});
    const replacement=await invoke('replace_photo',{id:backedUp.id,revision:0,image:original,thumbnail,edit:{rotation:0,distortion:0,points:null}});
    const after=await invoke('load_photo',{id:backedUp.id,source:true});
    if(before.data!==after.data||replacement.width!==1920||replacement.revision!==1)throw new Error('Edit did not preserve backup');
    await invoke('replace_photo',{id:rawOnly.id,revision:0,image:corrected,thumbnail,edit:{rotation:90,distortion:0,points:null}});
    const rawSource=await invoke('load_photo',{id:rawOnly.id,source:true});
    if(rawSource.originalBackup||rawSource.data!=='data:image/png;base64,'+corrected)throw new Error('Edit without backup did not replace current image');
    await invoke('reorder_photos',{ids:[saved.id,rawOnly.id,backedUp.id]});
    if((await invoke('library')).photos[0].id!==saved.id)throw new Error('Order was not persisted');
    await invoke('delete_photo',{id:backedUp.id});
    if((await invoke('library')).photos.length!==2)throw new Error('Delete failed');
    await invoke('self_test_result',{result:{ok:true,photoEditing:true,photoOrdering:true,photoDeletion:true,mediaAPI:true,source:location.href,worker:true,hands:handResult.landmarks.length,pixelError:error,saveSize:[saved.width,saved.height],folder:library.folder}});
  }catch(e){await invoke('self_test_result',{result:{ok:false,error:String(e),stack:e.stack}});}
  finally{clearTimeout(timer);worker?.terminate();}
}
