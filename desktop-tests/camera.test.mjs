import test from 'node:test';
import assert from 'node:assert/strict';
import { maximizeResolution } from '../desktop/camera.mjs';

function device(modes, { capabilities = true, reject = false } = {}) {
  let settings = modes[0];
  const calls = [];
  return {
    calls,
    getSettings: () => ({ ...settings }),
    getCapabilities: capabilities ? () => ({
      width: { max: Math.max(...modes.map(m => m.width)) },
      height: { max: Math.max(...modes.map(m => m.height)) },
      resizeMode: ['none', 'crop-and-scale'],
    }) : undefined,
    applyConstraints: async c => {
      calls.push(c);
      const valid = modes.filter(m => ['width', 'height'].every(k => !c[k]?.exact || c[k].exact === m[k]));
      if (reject || !valid.length) throw Object.assign(new Error('unsupported mode'), { name: 'OverconstrainedError' });
      const distance = m => ['width','height','frameRate'].reduce((s,k) => {
        const ideal = c[k]?.ideal;
        return s + (ideal ? Math.abs(m[k] - ideal) / Math.max(m[k], ideal) : 0);
      }, 0);
      settings = valid.toSorted((a,b) => distance(a) - distance(b))[0];
    },
  };
}

for (const [width,height] of [[1280,720],[1920,1080],[3840,2160],[7680,4320]]) {
  test(`adapts to a ${width}×${height} device without a fixed preset`, async () => {
    const track = device([{ width:640, height:480, frameRate:30 }, { width,height,frameRate:15 }]);
    const result = await maximizeResolution(track);
    assert.equal(result.width, width); assert.equal(result.height, height);
    assert.equal(result.frameRate, 15, '30 FPS must not reduce resolution');
  });
}

test('incompatible width/height maxima select a valid mode, not an invented resolution', async () => {
  const track = device([{ width:640,height:480,frameRate:30 }, { width:3840,height:2160,frameRate:30 }, { width:2560,height:2560,frameRate:30 }]);
  const result = await maximizeResolution(track);
  assert.deepEqual(result, {width:3840,height:2160,frameRate:30});
});

test('older capability API falls back to ideal negotiation and reads actual dimensions', async () => {
  const track = device([{width:640,height:480,frameRate:30},{width:2560,height:1440,frameRate:30}],{capabilities:false});
  assert.equal((await maximizeResolution(track)).width,2560);
});

test('a device rejecting mode changes keeps its working stream', async () => {
  const track = device([{width:1280,height:720,frameRate:30}], {reject:true});
  assert.equal((await maximizeResolution(track)).width,1280);
});

test('stopping during negotiation does not reconfigure a stale track', async () => {
  const track=device([{width:1280,height:720,frameRate:30}]);
  let active=true;const apply=track.applyConstraints;
  track.applyConstraints=async c=>{await apply(c);active=false;};
  await maximizeResolution(track,{},()=>active);
  assert.equal(track.calls.length,1);
});
