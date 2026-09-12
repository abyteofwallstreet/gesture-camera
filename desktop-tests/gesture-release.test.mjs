import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureGate, GestureReleaseGuard } from '../desktop/core.mjs';

for(const waitForHand of [true,false])test(`recording pose cannot trigger a photo (waitForHand=${waitForHand})`,()=>{
  const guard=new GestureReleaseGuard(),gate=new CaptureGate(),events=[];
  guard.requireRelease();
  const frame=(now,hands,score)=>{
    if(!guard.allows({now,hands})){gate.reset();return;}
    const event=gate.update({now,hands,score,motion:0},{threshold:.6,hold:200,waitForHand});
    if(event)events.push(event);
  };
  for(let now=0;now<4000;now+=100)frame(now,1,1);
  for(let now=4000;now<=4700;now+=100)frame(now,0,0);
  assert.deepEqual(events,[], 'neither holding the recording pose nor removing it captures');
  for(let now=4800;now<=5200;now+=100)frame(now,1,1);
  if(waitForHand){assert.deepEqual(events,['armed']);for(let now=5300;now<=5800;now+=100)frame(now,0,0);}
  assert.equal(events.filter(e=>e==='capture').length,1);
});

test('brief missed hand detection or a long recognition gap cannot release recording guard',()=>{
  const guard=new GestureReleaseGuard();guard.requireRelease();
  assert.equal(guard.allows({now:0,hands:0}),false);
  assert.equal(guard.allows({now:100,hands:1}),false);
  assert.equal(guard.allows({now:200,hands:0}),false);
  assert.equal(guard.allows({now:5000,hands:0}),false);
  assert.equal(guard.allows({now:5300,hands:0}),false);
  assert.equal(guard.allows({now:5500,hands:0}),true);
});
