// Keep the selected device explicit when a wireless camera disappears.
// Never silently switch the preview or capture to a different camera.
export function cameraOptions(devices, selectedId='', selectedLabel='') {
  const videos=devices.filter(d=>d.kind==='videoinput'&&d.deviceId);
  const options=[{value:'',label:'System default camera',disabled:false}];
  const seen=new Set();
  for(const device of videos){
    if(seen.has(device.deviceId))continue;seen.add(device.deviceId);
    options.push({value:device.deviceId,label:device.label||`Camera ${seen.size}`,disabled:false});
  }
  if(selectedId&&!seen.has(selectedId))options.push({value:selectedId,label:`${selectedLabel||'Selected camera'} (unavailable)`,disabled:true});
  return options;
}
