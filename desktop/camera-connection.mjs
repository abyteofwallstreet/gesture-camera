const stop=stream=>stream?.getTracks().forEach(track=>track.stop());
const unavailable=()=>new DOMException('The selected camera is unavailable.','NotFoundError');

export function findCamera(devices, {id,label}) {
  const cameras=devices.filter(d=>d.kind==='videoinput'&&d.deviceId);
  const exact=cameras.find(d=>d.deviceId===id);
  if(exact)return exact;
  const matches=label?cameras.filter(d=>d.label===label):[];
  return matches.length===1?matches[0]:null;
}

// Saved WebKit device IDs can become stale or remain hidden until permission
// is granted. Discover again after a temporary permission stream, then open
// only the requested camera. The permission stream never reaches the preview.
export async function connectCamera(media, selection, {active=()=>true,onDiscover=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const check=()=>{if(!active())throw new DOMException('Camera connection cancelled.','AbortError');};
  const list=async()=>{const devices=await media.enumerateDevices();check();return devices;};
  const open=async id=>{
    check();const stream=await media.getUserMedia({audio:false,video:id?{deviceId:{exact:id}}:{}});
    if(!active()){stop(stream);check();}
    const actual=stream.getVideoTracks()[0]?.getSettings().deviceId;
    if(id&&actual&&actual!==id){stop(stream);throw unavailable();}
    return stream;
  };
  if(!selection.id)return{stream:await open(''),device:null};
  let device=findCamera(await list(),selection);
  try{return{stream:await open(device?.deviceId||selection.id),device};}
  catch(error){if(!['NotFoundError','OverconstrainedError'].includes(error.name))throw error;}
  check();onDiscover();
  let permissionStream;
  try{
    permissionStream=await open('');
    for(let attempt=0;attempt<9;attempt++){
      device=findCamera(await list(),selection);
      if(device)break;
      if(attempt<8)await wait(250);
    }
  }finally{stop(permissionStream);}
  check();if(!device)throw unavailable();
  return{stream:await open(device.deviceId),device};
}

// Listing cameras must never open a stream, even when permission hides labels.
// Permission and stale-ID recovery belong to an explicit Start camera action.
export async function discoverCameras(media, active=()=>true){
  const devices=await media.enumerateDevices();
  if(!active())throw new DOMException('Camera discovery cancelled.','AbortError');
  return devices;
}
