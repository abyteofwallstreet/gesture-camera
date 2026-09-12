import test from 'node:test';
import assert from 'node:assert/strict';
import {connectCamera,discoverCameras} from '../desktop/camera-connection.mjs';
const device=(deviceId,label='My iPhone')=>({kind:'videoinput',deviceId,label});
const stream=id=>{const track={stopped:false,stop(){this.stopped=true;},getSettings:()=>({deviceId:id})};return{getTracks:()=>[track],getVideoTracks:()=>[track]};};
const missing=()=>new DOMException('Missing','OverconstrainedError');

test('opens a current selected camera directly without a default-camera detour',async()=>{
  const calls=[],phone=stream('current');
  const media={enumerateDevices:async()=>[device('current')],getUserMedia:async c=>{calls.push(c.video.deviceId?.exact);return phone;}};
  assert.equal((await connectCamera(media,{id:'current',label:'My iPhone'})).stream,phone);
  assert.deepEqual(calls,['current']);
});
test('rebinds an old ID to the same uniquely named camera before opening it',async()=>{
  const calls=[],media={enumerateDevices:async()=>[device('new')],getUserMedia:async c=>{calls.push(c.video.deviceId.exact);return stream('new');}};
  assert.equal((await connectCamera(media,{id:'old',label:'My iPhone'})).device.deviceId,'new');
  assert.deepEqual(calls,['new']);
});
test('cold permission discovery stops its temporary stream and retries the refreshed iPhone ID',async()=>{
  let authorized=false;const calls=[],temporary=stream('mac'),phone=stream('new');
  const media={enumerateDevices:async()=>authorized?[device('mac','Mac'),device('new')]:[device('','')],getUserMedia:async c=>{
    const id=c.video.deviceId?.exact;calls.push(id||'default');
    if(id==='old')throw missing();
    if(!id){authorized=true;return temporary;}
    assert.equal(temporary.getTracks()[0].stopped,true);return phone;
  }};
  assert.equal((await connectCamera(media,{id:'old',label:'My iPhone'},{wait:async()=>{}})).stream,phone);
  assert.deepEqual(calls,['old','default','new']);
});
test('missing iPhone never leaves the default camera running or returns it as a fallback',async()=>{
  const temporary=stream('mac');
  const media={enumerateDevices:async()=>[device('mac','Mac')],getUserMedia:async c=>{if(c.video.deviceId)throw missing();return temporary;}};
  await assert.rejects(connectCamera(media,{id:'old',label:'My iPhone'},{wait:async()=>{}}),{name:'NotFoundError'});
  assert.equal(temporary.getTracks()[0].stopped,true);
});
test('ambiguous camera names are not silently matched',async()=>{
  const temporary=stream('mac'),calls=[];
  const media={enumerateDevices:async()=>[device('one'),device('two')],getUserMedia:async c=>{calls.push(c.video.deviceId?.exact||'default');if(c.video.deviceId)throw missing();return temporary;}};
  await assert.rejects(connectCamera(media,{id:'old',label:'My iPhone'},{wait:async()=>{}}),{name:'NotFoundError'});
  assert.deepEqual(calls,['old','default']);
});
test('denied camera permission is not retried',async()=>{
  let calls=0;const media={enumerateDevices:async()=>[],getUserMedia:async()=>{calls++;throw new DOMException('Denied','NotAllowedError');}};
  await assert.rejects(connectCamera(media,{id:'old',label:'My iPhone'}),{name:'NotAllowedError'});assert.equal(calls,1);
});
test('cancellation during permission discovery releases the temporary stream',async()=>{
  let active=true;const temporary=stream('mac');
  const media={enumerateDevices:async()=>[],getUserMedia:async c=>{if(c.video.deviceId)throw missing();active=false;return temporary;}};
  await assert.rejects(connectCamera(media,{id:'old',label:'My iPhone'},{active:()=>active}),{name:'AbortError'});
  assert.equal(temporary.getTracks()[0].stopped,true);
});

test('startup discovers named cameras without opening a stream unnecessarily',async()=>{
  const devices=[device('phone')];assert.equal(await discoverCameras({enumerateDevices:async()=>devices,getUserMedia:()=>assert.fail('Already authorized')}),devices);
});
test('startup never opens a camera when permission hides device names',async()=>{
  const hidden=[device('','')];
  assert.equal(await discoverCameras({enumerateDevices:async()=>hidden,getUserMedia:()=>assert.fail('Startup must not open hardware')}),hidden);
});
test('failed or cancelled startup enumeration never requests camera access',async()=>{
  const getUserMedia=()=>assert.fail('Discovery must not open hardware');
  await assert.rejects(discoverCameras({enumerateDevices:async()=>{throw new Error('Enumeration failed');},getUserMedia}));
  await assert.rejects(discoverCameras({enumerateDevices:async()=>[],getUserMedia},()=>false),{name:'AbortError'});
});
