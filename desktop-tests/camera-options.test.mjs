import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraOptions } from '../desktop/camera-options.mjs';
const mac={kind:'videoinput',deviceId:'mac',label:'FaceTime HD Camera'};
const phone={kind:'videoinput',deviceId:'phone',label:'My iPhone Camera'};
test('Continuity Camera is selectable alongside other cameras',()=>{
  const list=cameraOptions([mac,phone,{kind:'audioinput',deviceId:'mic',label:'iPhone microphone'}],'phone');
  assert.deepEqual(list.map(p=>p.value),['','mac','phone']);assert.equal(list[2].disabled,false);assert.equal(list[2].label,phone.label);
});
test('disconnected iPhone stays selected as unavailable; reconnect restores it',()=>{
  const missing=cameraOptions([mac],'phone',phone.label);
  assert.equal(missing.at(-1).value,'phone');assert.equal(missing.at(-1).disabled,true);
  const restored=cameraOptions([mac,phone],'phone',phone.label);
  assert.equal(restored.at(-1).disabled,false);assert.equal(restored.at(-1).label,phone.label);
});
test('permission-limited devices never create duplicate default choices',()=>{
  assert.equal(cameraOptions([{kind:'videoinput',deviceId:'',label:''}]).length,1);
  assert.equal(cameraOptions([mac,mac]).length,2);
});
