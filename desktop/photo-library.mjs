import { CorrectionRenderer, originalCanvas, pngBlob, base64Blob } from './correction.mjs';
import { validQuad, clamp, normalizeRotation, rotationControlAngle } from './core.mjs';
const $=id=>document.getElementById(id);
const fullQuad=()=>[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
const imageFrom=data=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not decode the photo'));image.src=data;});

export class PhotoLibrary {
  constructor(invoke) {
    this.invoke=invoke;this.photos=[];this.selected=null;this.loading=0;this.working=false;this.edit=null;
    $('showPhotos').onclick=()=>$('photoSection').scrollIntoView({behavior:'smooth',block:'start'});
    $('movePhotoUp').onclick=()=>this.move(-1);$('movePhotoDown').onclick=()=>this.move(1);
    $('deletePhoto').onclick=()=>this.remove();$('editPhoto').onclick=()=>this.openEditor();
    $('cancelEdit').onclick=()=>{if(!this.working)$('photoEditor').close();};
    $('photoEditor').addEventListener('cancel',e=>{if(this.working)e.preventDefault();});
    $('photoEditor').addEventListener('close',()=>{this.edit=null;this.editToken=(this.editToken||0)+1;});
    $('saveEdit').onclick=()=>this.saveEdit();
    $('editCrop').onclick=()=>this.mode('crop');$('editQuad').onclick=()=>this.mode('quad');
    $('editRotate').onclick=()=>this.setRotation((this.edit?.rotation||0)+90);
    $('editRotationRange').oninput=e=>this.setRotation(e.target.value);
    $('editRotationAngle').onchange=e=>this.setRotation(e.target.value);
    $('editReset').onclick=()=>{if(!this.edit||this.working)return;Object.assign(this.edit,{rotation:0,distortion:0,points:null,mode:null});$('editDistortion').value=0;this.drawEditor();};
    $('editPreview').onchange=()=>this.drawEditor();
    $('editDistortion').oninput=e=>{if(!this.edit||this.working)return;this.edit.distortion=Number(e.target.value);this.drawEditor();};
    $('editStage').addEventListener('pointerdown',e=>this.pointerDown(e));
    $('editStage').addEventListener('pointermove',e=>this.pointerMove(e));
    const release=()=>{if(this.edit?.drag){this.edit.drag=null;if(!validQuad(this.edit.points)){$('editMessage').textContent='The corners must not cross or overlap. Adjust them and try again.';}else{$('editMessage').textContent='';}this.editorOverlay();}};
    $('editStage').addEventListener('pointerup',release);$('editStage').addEventListener('pointercancel',release);
    new ResizeObserver(()=>this.fitEditor()).observe($('editStage'));
    this.render();
  }
  setPhotos(photos, selectLatest=false) {
    this.photos=[...photos];
    const id=selectLatest?photos[0]?.id:(photos.find(p=>p.id===this.selected)?.id||photos[0]?.id);
    this.select(id);
  }
  add(photo) {this.photos.unshift(photo);this.select(photo.id,true);}
  current(){return this.photos.find(p=>p.id===this.selected);}
  message(text=''){$('galleryMessage').textContent=text;}
  render() {
    $('photoCount').textContent=this.photos.length;
    const list=$('photos'),nodes=new Map([...list.querySelectorAll('.photo')].map(b=>[b.dataset.id,b]));
    list.querySelectorAll('.helper').forEach(n=>n.remove());
    let position=0;
    for(const photo of this.photos){
      let button=nodes.get(photo.id);
      if(!button){
      button=document.createElement('button');button.className='photo';button.dataset.id=photo.id;button.draggable=false;button.setAttribute('role','option');button.setAttribute('aria-selected',String(photo.id===this.selected));button.classList.toggle('selected',photo.id===this.selected);
      const im=document.createElement('img');im.src=photo.thumbnail;im.draggable=false;im.alt='Note thumbnail';im.loading='lazy';
      const info=document.createElement('div'),name=document.createElement('strong'),size=document.createElement('small');
      name.textContent=new Date(photo.created).toLocaleString('en-US',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});size.textContent=`${photo.width} × ${photo.height}`;info.append(name,size);button.append(im,info);
      button.onclick=()=>this.select(photo.id);
      }
      nodes.delete(photo.id);
      button.classList.toggle('selected',photo.id===this.selected);button.setAttribute('aria-selected',String(photo.id===this.selected));
      const image=button.querySelector('img');if(image.getAttribute('src')!==photo.thumbnail)image.src=photo.thumbnail;
      button.querySelector('small').textContent=`${photo.width} × ${photo.height}`;
      if(list.children[position]!==button)list.insertBefore(button,list.children[position]||null);
      position++;
    }
    for(const node of nodes.values())node.remove();
    if(!this.photos.length){const p=document.createElement('p');p.className='helper';p.textContent='No photos yet';list.append(p);}
    this.buttons();
  }
  buttons() {
    const index=this.photos.findIndex(p=>p.id===this.selected),off=index<0;
    $('editPhoto').disabled=off;$('deletePhoto').disabled=off;
    $('movePhotoUp').disabled=off||index===0;$('movePhotoDown').disabled=off||index===this.photos.length-1;
    // Busy operations are guarded in handlers. Keep their appearance and focus
    // stable instead of flashing the entire toolbar through disabled opacity.
    for(const id of ['editPhoto','deletePhoto','movePhotoUp','movePhotoDown']){
      $(id).setAttribute('aria-disabled',String($(id).disabled||!!this.working||!!this.captureBusy));
    }

  }
  async data(photo,source) {
    if(this.invoke)return this.invoke('load_photo',{id:photo.id,source});
    return {data:source?(photo._original||photo._data):photo._data,originalBackup:!!photo._original,edit:source&&photo._original?photo.edit:null,revision:photo.revision||0};
  }
  async select(id,latest=false) {
    this.selected=id;const token=++this.loading;this.render();this.message();
    const photo=this.current();$('selectedPhoto').hidden=true;$('selectedPhoto').removeAttribute('src');$('photoPlaceholder').hidden=false;
    $('selectedPhotoInfo').textContent=photo?`${photo.width} × ${photo.height} · PNG`: 'No photo selected';
    if(latest){$('photos').scrollTop=0;}else{const active=$('photos').querySelector('.selected');if(active){const top=active.offsetTop-$('photos').offsetTop;if(top<$('photos').scrollTop||top+active.offsetHeight>$('photos').scrollTop+$('photos').clientHeight)$('photos').scrollTop=top;}}
    $('photoPlaceholder').textContent=photo?'Loading photo…':'Your latest photo will appear here automatically.';
    if(!photo)return;
    try{const value=await this.data(photo,false);const image=await imageFrom(value.data);if(token!==this.loading)return;$('selectedPhoto').src=image.src;$('selectedPhoto').hidden=false;$('photoPlaceholder').hidden=true;}
    catch(e){if(token===this.loading){$('photoPlaceholder').textContent='Could not load this photo';this.message(String(e.message||e));}}
  }
  async reorder(id,beforeId) {
    if(this.working||this.captureBusy)return;
    const ordered=this.photos.filter(p=>p.id!==id),photo=this.photos.find(p=>p.id===id);
    if(!photo)return;const index=beforeId?ordered.findIndex(p=>p.id===beforeId):ordered.length;if(index<0)return;ordered.splice(index,0,photo);
    this.working=true;this.buttons();
    try{if(this.invoke)await this.invoke('reorder_photos',{ids:ordered.map(p=>p.id)});this.photos=ordered;this.render();this.message('Photo order saved.');}
    catch(e){this.message(String(e.message||e));}finally{this.working=false;this.buttons();}
  }
  move(delta){const index=this.photos.findIndex(p=>p.id===this.selected);if(index<0||index+delta<0||index+delta>=this.photos.length)return;const before=delta<0?this.photos[index-1]?.id:this.photos[index+2]?.id;void this.reorder(this.selected,before);}
  async remove() {
    const photo=this.current();if(!photo||this.working||this.captureBusy)return;this.working=true;this.buttons();
    try{if(this.invoke)await this.invoke('delete_photo',{id:photo.id});const index=this.photos.findIndex(p=>p.id===photo.id);this.photos=this.photos.filter(p=>p.id!==photo.id);await this.select(this.selected===photo.id?this.photos[Math.min(index,this.photos.length-1)]?.id:this.selected);this.message('Photo deleted.');}
    catch(e){this.message(String(e.message||e));}finally{this.working=false;this.buttons();}
  }
  async openEditor() {
    const photo=this.current();if(!photo||this.working||this.captureBusy)return;
    const token=this.editToken=(this.editToken||0)+1;this.edit=null;$('saveEdit').disabled=true;$('editMessage').textContent='Loading the source image…';$('editSource').textContent='';$('editCanvas').hidden=true;$('editOverlay').replaceChildren();$('photoEditor').showModal();
    try {
      const value=await this.data(photo,true),image=await imageFrom(value.data);if(token!==this.editToken||!$('photoEditor').open)return;
      const saved=value.edit;
      this.edit={id:photo.id,revision:value.revision||0,image,backup:value.originalBackup,rotation:rotationControlAngle(saved?.rotation||0),distortion:saved?.distortion||0,points:validQuad(saved?.points)?saved.points.map(p=>({...p})):null,mode:null,drag:null};
      $('editSource').textContent=value.originalBackup?'Editing from the original backup. Saving replaces the processed photo and keeps the original.':'No separate original backup. Saving replaces the current photo.';
      $('editDistortion').value=this.edit.distortion;$('editPreview').checked=false;$('editMessage').textContent='';$('editCanvas').hidden=false;this.drawEditor();
    }catch(e){if(token===this.editToken)$('editMessage').textContent=String(e.message||e);}
  }
  mode(mode) {
    if(!this.edit||this.working)return;this.edit.mode=mode;this.edit.points=null;this.edit.drag=null;$('editPreview').checked=false;$('editMessage').textContent='';this.drawEditor();
  }
  setRotation(angle){
    if(!this.edit||this.working||!Number.isFinite(Number(angle)))return;
    Object.assign(this.edit,{rotation:rotationControlAngle(angle),points:null,mode:null,drag:null,distortion:0});
    $('editDistortion').value=0;this.drawEditor();
  }
  drawEditor() {
    const e=this.edit;if(!e)return;
    try {
      const canvas=$('editCanvas');let image;
      if($('editPreview').checked){
        if(e.points&&!validQuad(e.points)){$('editPreview').checked=false;throw new Error('Select all four corners first.');}
        this.renderer ||= new CorrectionRenderer(document.createElement('canvas'));this.renderer.draw(e.image,e.rotation,e.points,e.distortion);image=this.renderer.canvas;
      }else{image=originalCanvas(e.image,e.rotation);}
      canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
      const angle=e.rotation;
      $('editRotationRange').value=angle;$('editRotationAngle').value=Number(angle.toFixed(2));
      $('editDistortionValue').textContent=e.distortion.toFixed(2);$('editCrop').classList.toggle('active',e.mode==='crop');$('editQuad').classList.toggle('active',e.mode==='quad');
      $('editHint').textContent=e.mode==='crop'?'Drag a rectangle around the area you want to keep.':e.mode==='quad'?'Click the page corners: top left, top right, bottom right, bottom left.':'Drag the corners to adjust the area. Select Preview result to see the correction.';
      this.fitEditor();this.editorOverlay();
    }catch(error){$('editMessage').textContent=error.message;}
  }
  fitEditor(){if(!this.edit)return;const canvas=$('editCanvas'),stage=$('editStage');const scale=Math.min(stage.clientWidth/canvas.width,stage.clientHeight/canvas.height);Object.assign($('editImageFrame').style,{width:canvas.width*scale+'px',height:canvas.height*scale+'px',left:(stage.clientWidth-canvas.width*scale)/2+'px',top:(stage.clientHeight-canvas.height*scale)/2+'px'});this.editorOverlay();}
  editorOverlay() {
    const e=this.edit,svg=$('editOverlay');svg.replaceChildren();if(!e)return;
    $('saveEdit').disabled=this.working||!!(e.points&&!validQuad(e.points));
    if($('editPreview').checked)return;
    const points=e.points||fullQuad();
    const shape=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);svg.append(n);};
    shape(points.length===4?'polygon':'polyline',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:points.length===4?'#d4e5af20':'none',stroke:'#e0ec93','stroke-width':2,'vector-effect':'non-scaling-stroke'});
    const box=$('editImageFrame').getBoundingClientRect();for(const p of points)shape('ellipse',{cx:p.x,cy:p.y,rx:7/(box.width||1),ry:7/(box.height||1),fill:'#e0ec93',stroke:'#34472b','stroke-width':1,'vector-effect':'non-scaling-stroke'});
  }
  point(event){const r=$('editImageFrame').getBoundingClientRect();return{x:clamp((event.clientX-r.left)/r.width),y:clamp((event.clientY-r.top)/r.height)};}
  pointerDown(event) {
    const e=this.edit;if(!e||this.working||$('editPreview').checked)return;
    const r=$('editImageFrame').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)return;
    const p=this.point(event);
    if(e.mode==='quad'){
      e.points ||= [];e.points.push(p);if(e.points.length===4){e.mode=null;$('editHint').textContent='Drag the corners to fine-tune, or preview the result.';}this.editorOverlay();return;
    }
    if(e.mode==='crop'){e.drag={start:p};e.points=[p,p,p,p];}
    else{const points=e.points||fullQuad();const index=points.findIndex(v=>Math.hypot((v.x-p.x)*r.width,(v.y-p.y)*r.height)<24);if(index<0)return;e.points=points.map(v=>({...v}));e.drag={index};}
    $('editStage').setPointerCapture(event.pointerId);this.editorOverlay();
  }
  pointerMove(event){const e=this.edit;if(!e?.drag||this.working)return;const p=this.point(event);if(e.drag.start){const a=e.drag.start,x=Math.min(a.x,p.x),y=Math.min(a.y,p.y),right=Math.max(a.x,p.x),bottom=Math.max(a.y,p.y);e.points=[{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}];}else{e.points[e.drag.index]=p;}this.editorOverlay();}
  async saveEdit() {
    const e=this.edit;if(!e||this.working||(e.points&&!validQuad(e.points)))return;this.working=true;this.buttons();$('saveEdit').disabled=true;$('cancelEdit').disabled=true;$('editMessage').textContent='Saving…';
    try{
      this.renderer ||= new CorrectionRenderer(document.createElement('canvas'));this.renderer.draw(e.image,e.rotation,e.points,e.distortion);
      const canvas=this.renderer.canvas,encoded=await base64Blob(await pngBlob(canvas));const thumb=document.createElement('canvas');thumb.width=240;thumb.height=Math.round(240*canvas.height/canvas.width);thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);const thumbnail=thumb.toDataURL('image/jpeg',.8),edit={rotation:normalizeRotation(e.rotation),points:e.points,distortion:e.distortion};
      let updated;if(this.invoke)updated=await this.invoke('replace_photo',{id:e.id,revision:e.revision,image:encoded,thumbnail,edit});else{updated={...this.photos.find(p=>p.id===e.id),width:canvas.width,height:canvas.height,thumbnail,edit,revision:e.revision+1,_data:'data:image/png;base64,'+encoded};}
      this.photos=this.photos.map(p=>p.id===e.id?updated:p);$('photoEditor').close();await this.select(this.selected);this.message('Photo replaced. The thumbnail and full view are updated.');
    }catch(error){$('editMessage').textContent=String(error.message||error);}
    finally{this.working=false;$('cancelEdit').disabled=false;this.buttons();this.editorOverlay();}
  }
}
