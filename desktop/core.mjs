export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const normalizeRotation = angle => Number.isFinite(Number(angle)) ? ((Number(angle)%360)+360)%360 : 0;
// UI endpoints are distinct positions even though they render the same angle.
export function rotationControlAngle(angle) {
  const value=Number(angle);
  if(!Number.isFinite(value))return 0;
  const wrapped=value%360;
  return (wrapped>180?wrapped-360:wrapped< -180?wrapped+360:wrapped)||0;
}

export function rotationComponents(rotation){
  const radians=normalizeRotation(rotation)*Math.PI/180;
  const snap=value=>Math.abs(value)<1e-10?0:Math.abs(value-1)<1e-10?1:Math.abs(value+1)<1e-10?-1:value;
  return{cos:snap(Math.cos(radians)),sin:snap(Math.sin(radians))};
}
export function rotatedSize(width, height, rotation) {
  const {cos,sin}=rotationComponents(rotation);
  return{width:Math.ceil(Math.abs(width*cos)+Math.abs(height*sin)),height:Math.ceil(Math.abs(width*sin)+Math.abs(height*cos))};
}
export function rotatePoint({ x, y }, rotation, width=1, height=1) {
  rotation=normalizeRotation(rotation);
  if (rotation === 90) return { x: 1 - y, y: x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270) return { x: y, y: 1 - x };
  if(!rotation)return{x,y};
  const {cos,sin}=rotationComponents(rotation),size=rotatedSize(width,height,rotation);
  const dx=(x-.5)*width,dy=(y-.5)*height;
  return{x:.5+(cos*dx-sin*dy)/size.width,y:.5+(sin*dx+cos*dy)/size.height};
}
export function previewRect(width, height, vw, vh, dpr, native, pan = { x: 0, y: 0 }) {
  const scale = native ? 1 / dpr : Math.min(vw / width, vh / height);
  const w = width * scale, h = height * scale;
  let x = (vw - w) / 2 + (native ? clamp(pan.x, -Math.max(0, (w - vw) / 2), Math.max(0, (w - vw) / 2)) : 0);
  let y = (vh - h) / 2 + (native ? clamp(pan.y, -Math.max(0, (h - vh) / 2), Math.max(0, (h - vh) / 2)) : 0);
  if (native) { x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr; }
  return { x, y, width: w, height: h, scale };
}
export function fingerFeatures(lm) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return [4, 8, 12, 16, 20].map((tip, i) => {
    const base = i === 0 ? 2 : tip - 2;
    return clamp((distance(lm[tip], lm[0]) / Math.max(1e-6, distance(lm[base], lm[0])) - 1.05) / .55);
  });
}
export function gestureScore(landmarks, categories = [], learned = null) {
  const f = fingerFeatures(landmarks);
  const geometry = Math.min(f[1], 1 - f[2], 1 - f[3], 1 - f[4]);
  const builtin = Math.max(0, ...categories.filter(c => c.categoryName === 'Pointing_Up').map(c => c.score));
  // A learned pose replaces the built-in trigger; it is not model training.
  if (learned?.length === 5) return clamp(1 - f.reduce((s, v, i) => s + Math.abs(v - learned[i]), 0) / 1.2);
  return Math.max(geometry, builtin);
}

// Recording a pose is not a shutter request. Require a continuous hand-free
// interval before a newly recorded pose can enter the normal capture gate.
export class GestureReleaseGuard {
  constructor() { this.waiting=false; this.clearAt=null; this.lastSample=null; }
  requireRelease() { this.waiting=true; this.clearAt=null; this.lastSample=null; }
  allows({ now, hands }) {
    if(!this.waiting)return true;
    if(this.lastSample!==null && (now-this.lastSample>1200 || now<this.lastSample))this.clearAt=null;
    this.lastSample=now;
    if(hands!==0){this.clearAt=null;return false;}
    this.clearAt ??= now;
    if(now-this.clearAt<500)return false;
    this.waiting=false;
    return true;
  }
}

export class CaptureGate {
  constructor() { this.reset(); }
  reset() { this.phase = 'watch'; this.since = 0; this.lastTrue = null; this.clearAt = null; this.requested = 0; this.lastSample = null; this.progress = 0; }
  update({ now, score, hands }, { threshold = .65, hold = 600, waitForHand = true } = {}) {
    if (this.lastSample !== null && now - this.lastSample > 1200) this.reset();
    this.lastSample = now;
    const trigger = score >= threshold;
    if (this.phase === 'cooldown') {
      if (trigger) this.clearAt = null;
      else this.clearAt ??= now;
      if (now - this.since >= 2000 && this.clearAt !== null && now - this.clearAt >= 350) this.reset();
      return null;
    }
    if (this.phase === 'clear') {
      if (now - this.requested > 10000) { this.reset(); return 'timeout'; }
      if (hands !== 0) { this.clearAt = null; this.progress = 0; return null; }
      this.clearAt ??= now;
      this.progress = clamp((now - this.clearAt) / 500);
      if (this.progress >= 1) return this.capture(now);
      return null;
    }
    if (trigger) {
      if (this.phase !== 'hold') { this.since = now; this.phase = 'hold'; }
      this.lastTrue = now;
      this.progress = clamp((now - this.since) / hold);
      if (this.progress >= 1) {
        if (!waitForHand) return this.capture(now);
        this.phase = 'clear'; this.requested = now; this.clearAt = null; this.progress = 0;
        return 'armed';
      }
    } else if (this.lastTrue === null || now - this.lastTrue > 160) {
      this.phase = 'watch'; this.progress = 0;
    }
    return null;
  }
  capture(now) { this.phase = 'cooldown'; this.since = now; this.progress = 0; this.clearAt = null; return 'capture'; }
}

export function validQuad(points) {
  if (!points || points.length !== 4 || points.some(p => !Number.isFinite(p.x + p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], d = points[(i + 2) % 4];
    if ((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x) < .002) return false;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2 > .025;
}

export function correctionSize(width, height, points) {
  if (!points) return { width, height };
  const len = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  return {
    width: Math.max(1, Math.round(Math.max(len(points[0], points[1]), len(points[3], points[2])))),
    height: Math.max(1, Math.round(Math.max(len(points[0], points[3]), len(points[1], points[2])))),
  };
}

export function homography(points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]) {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = corners[i], { x: u, y: v } = points[i];
    matrix.push([x, y, 1, 0, 0, 0, -u*x, -u*y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v*x, -v*y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let j = col+1; j < 8; j++) if (Math.abs(matrix[j][col]) > Math.abs(matrix[pivot][col])) pivot = j;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const scale = matrix[col][col];
    if (Math.abs(scale) < 1e-10) throw new Error('Invalid corner positions. Select them again.');
    for (let k = col; k <= 8; k++) matrix[col][k] /= scale;
    for (let j = 0; j < 8; j++) if (j !== col) {
      const factor = matrix[j][col];
      for (let k = col; k <= 8; k++) matrix[j][k] -= factor * matrix[col][k];
    }
  }
  return [...matrix.map(row => row[8]), 1];
}

export function mapHomography(h, x, y) {
  const z = h[6]*x + h[7]*y + 1;
  return { x: (h[0]*x+h[1]*y+h[2])/z, y: (h[3]*x+h[4]*y+h[5])/z };
}
