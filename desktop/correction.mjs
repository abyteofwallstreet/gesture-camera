import { rotatedSize, correctionSize, homography, rotationComponents, normalizeRotation } from './core.mjs';

// The texture and render target both retain source resolution. CSS controls
// display size only; the inference buffer never enters this renderer.
export class CorrectionRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    const gl = this.gl;
    if (!gl) throw new Error('Correction preview is unavailable on this device. The original view is still available.');
    const compile = (kind, source) => {
      const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }');
    const fs = compile(gl.FRAGMENT_SHADER, `precision highp float;
      uniform sampler2D frame; uniform mat3 transform; uniform vec2 outputSize;
      uniform vec2 rotationCS; uniform vec2 sourceSize; uniform vec2 rotatedSize;
      uniform float distortion; uniform float aspect;
      void main(){
        vec2 uv=vec2(gl_FragCoord.x/outputSize.x,1.-gl_FragCoord.y/outputSize.y);
        vec3 v=transform*vec3(uv,1.); uv=v.xy/v.z;
        vec2 q=(uv-.5)*vec2(aspect,1.)*2.;
        uv=.5+q*(1.+distortion*dot(q,q))/vec2(aspect,1.)/2.;
        vec2 p=(uv-.5)*rotatedSize;
        uv=.5+vec2(rotationCS.x*p.x+rotationCS.y*p.y,-rotationCS.y*p.x+rotationCS.x*p.y)/sourceSize;
        if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) gl_FragColor=vec4(0.,0.,0.,1.);
        else gl_FragColor=texture2D(frame,uv);
      }`);
    this.program = gl.createProgram(); gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Could not initialize the correction preview');
    gl.useProgram(this.program);
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(this.program,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.uniforms=Object.fromEntries(['frame','transform','outputSize','rotationCS','sourceSize','rotatedSize','distortion','aspect'].map(n=>[n,gl.getUniformLocation(this.program,n)]));
  }
  draw(source, rotation, points, distortion) {
    const gl=this.gl;
    if (gl.isContextLost()) throw new Error('Correction preview was interrupted. Turn it off and on again.');
    const sw=source.videoWidth || source.width, sh=source.videoHeight || source.height;
    const rotated=rotatedSize(sw,sh,rotation), size=correctionSize(rotated.width,rotated.height,points);
    const max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (Math.max(sw,sh,size.width,size.height)>max) throw new Error('This image exceeds the GPU correction size limit. Use the original image instead.');
    if(this.canvas.width!==size.width||this.canvas.height!==size.height){this.canvas.width=size.width;this.canvas.height=size.height;}
    gl.viewport(0,0,size.width,size.height);gl.useProgram(this.program);
    const h=homography(points || undefined);
    gl.uniformMatrix3fv(this.uniforms.transform,false,new Float32Array([h[0],h[3],h[6],h[1],h[4],h[7],h[2],h[5],h[8]]));
    gl.uniform2f(this.uniforms.outputSize,size.width,size.height);
    const {cos,sin}=rotationComponents(rotation);
    gl.uniform2f(this.uniforms.rotationCS,cos,sin);gl.uniform2f(this.uniforms.sourceSize,sw,sh);gl.uniform2f(this.uniforms.rotatedSize,rotated.width,rotated.height);
    gl.uniform1f(this.uniforms.distortion,distortion);gl.uniform1f(this.uniforms.aspect,rotated.width/rotated.height);
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    return size;
  }
}

export function originalCanvas(source, rotation) {
  const sw=source.videoWidth || source.width, sh=source.videoHeight || source.height;
  const {width,height}=rotatedSize(sw,sh,rotation);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.translate(width/2,height/2);ctx.rotate(rotation*Math.PI/180);
  ctx.imageSmoothingEnabled=normalizeRotation(rotation)%90!==0;ctx.imageSmoothingQuality='high';ctx.drawImage(source,-sw/2,-sh/2,sw,sh);
  return canvas;
}

export const pngBlob = canvas => new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not encode the photo')),'image/png'));
export const base64Blob = blob => new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
});
