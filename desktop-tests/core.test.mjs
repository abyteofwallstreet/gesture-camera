import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureGate, previewRect, rotatePoint, rotatedSize, validQuad, homography, mapHomography, correctionSize, gestureScore } from '../desktop/core.mjs';

test('1:1 uses physical screen pixels on Retina without a thumbnail stage', () => {
  const r=previewRect(3840,2160,900,600,2,true);
  assert.equal(r.width*2,3840);assert.equal(r.height*2,2160);
  const fit=previewRect(3840,2160,900,600,2,false);
  assert.equal(fit.width,900);assert.equal(fit.height,506.25);
  const dragged=previewRect(3840,2160,900,600,2,true,{x:99999,y:-99999});
  assert.equal(dragged.x,0);assert.equal(dragged.y,600-1080);
  const odd=previewRect(1921,1081,900,600,2,true,{x:.123,y:.456});
  assert.ok(Number.isInteger(odd.x*2));assert.ok(Number.isInteger(odd.y*2));
});

test('90-degree rotation preserves native pixel dimensions and coordinates',()=>{
  assert.deepEqual(rotatedSize(3840,2160,90),{width:2160,height:3840});
  assert.deepEqual(rotatePoint({x:.2,y:.3},90),{x:.7,y:.2});
  let p={x:.2,y:.3};for(let i=0;i<4;i++)p=rotatePoint(p,90);
  assert.ok(Math.abs(p.x-.2)<1e-8&&Math.abs(p.y-.3)<1e-8);
});

test('arbitrary rotation retains all four corners of a nonsquare input',()=>{
  const w=1920,h=1080,angle=32.5,s=rotatedSize(w,h,angle),r=angle*Math.PI/180;
  assert.deepEqual(s,{width:Math.ceil(w*Math.cos(r)+h*Math.sin(r)),height:Math.ceil(w*Math.sin(r)+h*Math.cos(r))});
  for(const p of [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]){
    const q=rotatePoint(p,angle,w,h);assert.ok(q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1);
    const x=(q.x-.5)*s.width,y=(q.y-.5)*s.height;
    assert.ok(Math.abs(.5+(x*Math.cos(r)+y*Math.sin(r))/w-p.x)<1e-10);
    assert.ok(Math.abs(.5+(-x*Math.sin(r)+y*Math.cos(r))/h-p.y)<1e-10);
  }
  assert.deepEqual(rotatedSize(w,h,-90),{width:h,height:w});
});

test('score .4 above threshold .3 arms, waits for clear frame, then captures only once',()=>{
  const gate=new CaptureGate(),opts={threshold:.3,hold:600,waitForHand:true};
  for(let now=0;now<600;now+=100)assert.equal(gate.update({now,score:.4,hands:1,motion:0},opts),null);
  assert.equal(gate.update({now:600,score:.4,hands:1,motion:0},opts),'armed');
  for(let now=700;now<=900;now+=100)assert.equal(gate.update({now,score:0,hands:1,motion:0},opts),null);
  for(let now=1000;now<1500;now+=100)assert.equal(gate.update({now,score:0,hands:0,motion:0},opts),null);
  assert.equal(gate.update({now:1500,score:0,hands:0,motion:0},opts),'capture');
  for(let now=1600;now<=3400;now+=100)assert.equal(gate.update({now,score:.4,hands:1,motion:0},opts),null);
  assert.equal(gate.phase,'cooldown');
});

test('continuous pose does not repeatedly trigger when waiting for hands is off',()=>{
  const gate=new CaptureGate(),opts={threshold:.3,hold:200,waitForHand:false};
  gate.update({now:0,score:.4,hands:1,motion:100},opts);
  assert.equal(gate.update({now:200,score:.4,hands:1,motion:100},opts),'capture');
  for(let now=300;now<5000;now+=100)assert.equal(gate.update({now,score:.4,hands:1,motion:0},opts),null);
});

test('interrupted recognition cannot use elapsed pause as gesture hold time',()=>{
  const gate=new CaptureGate();gate.update({now:0,score:.9,hands:1,motion:0});
  assert.equal(gate.update({now:5000,score:.9,hands:1,motion:0}),null);
  assert.equal(gate.phase,'hold');assert.equal(gate.progress,0);
});

test('motion never delays capture once the hand has left',()=>{
  const gate=new CaptureGate(),o={threshold:.3,hold:200,waitForHand:true};
  gate.update({now:0,score:.4,hands:1},o);
  gate.update({now:200,score:.4,hands:1},o);
  for(let now=300;now<800;now+=100)assert.equal(gate.update({now,score:0,hands:0,motion:100},o),null);
  assert.equal(gate.update({now:800,score:0,hands:0,motion:100},o),'capture');
});

test('a hand remaining in the frame still times out',()=>{
  const gate=new CaptureGate(),o={threshold:.3,hold:200,waitForHand:true};
  gate.update({now:0,score:.4,hands:1,motion:0},o);
  gate.update({now:200,score:.4,hands:1,motion:0},o);
  for(let now=300;now<=10000;now+=100){assert.equal(gate.update({now,score:0,hands:1,motion:0},o),null);}
  assert.equal(gate.update({now:10300,score:0,hands:1,motion:0},o),'timeout');
});

test('perspective maps each output corner to the selected source corner',()=>{
  const p=[{x:.14,y:.1},{x:.8,y:.25},{x:.95,y:.93},{x:.03,y:.88}];
  assert.ok(validQuad(p));
  const h=homography(p);
  [[0,0],[1,0],[1,1],[0,1]].forEach(([x,y],i)=>{
    const mapped=mapHomography(h,x,y);assert.ok(Math.abs(mapped.x-p[i].x)<1e-10);assert.ok(Math.abs(mapped.y-p[i].y)<1e-10);
  });
  assert.equal(validQuad([p[0],p[2],p[1],p[3]]),false);
  assert.deepEqual(correctionSize(3840,2160,null),{width:3840,height:2160});
  assert.ok(correctionSize(3840,2160,p).width>3000);
});

test('gesture scoring never uses an unrelated built-in gesture category',()=>{
  const hand=Array.from({length:21},()=>({x:.5,y:.5}));
  assert.equal(gestureScore(hand,[{categoryName:'Victory',score:.99}]),0);
  assert.equal(gestureScore(hand,[{categoryName:'Pointing_Up',score:.4}]),.4);
});
