// 特別な場面の部品：煙・炎・火の粉の粒、矢や弾の筋、船や建物の模型の形。
// 大きさは地図の縮尺（1 = 10m、高さは 1.7 倍）が基本。船や汽車は、引いた視点でも形がわかるよう少し大きめに作る
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { painted } from '../map/props.js';

export { painted };
export const merge = (list) => mergeGeometries(list);

// ---------- 形 ----------
// 底が y0 の箱・円柱（中心 x, z）
export const box = (w, h, d, color, x = 0, y0 = 0, z = 0) => painted(new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z), color);
export const cyl = (r0, r1, h, color, x = 0, y0 = 0, z = 0, seg = 8) => painted(new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y0 + h / 2, z), color);
// 上をすぼめた箱（k = 上の幅の割合）。マンサード屋根の下の段や、船の上の建物に使う
export function frustum(w, h, d, k, color, x = 0, y0 = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  return painted(g.translate(x, y0 + h / 2, z), color);
}
// 屋根：棟は x 向き。hip = 0 で切妻、大きいほど寄棟（両端も斜めになる）
export function roof(w, d, h, color, { hip = 0, x = 0, y0 = 0, z = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setZ(i, 0); p.setX(i, p.getX(i) * (1 - hip)); }
  return painted(g.translate(x, y0 + h / 2, z), color);
}
// 光る面（ガラス窓・灯り）。色は線形の値で、1 より大きいと光がにじむ
export function lit(geom, rgb) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// 船の胴：x が船首の向き、y = 0 が水面。長さ L・幅 B・深さ D。船首は細く、両端は反り上がる。甲板は deck の色
export function hull(L, B, D, color, deck, { bow = 0.62, stern = 0.3, sheer = 0.45, draft = 0.4 } = {}) {
  const g = new THREE.BoxGeometry(L, D, B, 10, 1, 1);
  const p = g.attributes.position, nrm = g.attributes.normal;
  const top = [];
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (L / 2); // -1 船尾 … 1 船首
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 1;
    const b0 = 1 - bow;
    if (u > b0) k = 1 - ((u - b0) / bow) ** 1.5 * 0.96;
    if (u < -1 + stern) k = 1 - ((-u - (1 - stern)) / stern) * 0.45;
    z *= k;
    if (y < 0) { z *= 0.42; y += D * 0.55 * Math.max(0, Math.abs(u) - 0.45) ** 2 / 0.3; }
    y += sheer * D * u * u;
    if (u > 0.85 && y > 0) x += (u - 0.85) * L * 0.08; // 船首を少し前へ突き出す
    p.setXYZ(i, x, y + D / 2 - draft * D, z);
    top.push(nrm.getY(i) > 0.5);
  }
  const out = g.toNonIndexed();
  const n = out.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c0 = new THREE.Color(color), c1 = new THREE.Color(deck);
  // 甲板の面（もとの箱の上の面）だけ色を変える
  const idx = g.index.array;
  for (let i = 0; i < n; i++) { const c = top[idx[i]] ? c1 : c0; col.set([c.r, c.g, c.b], i * 3); }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.deleteAttribute('uv');
  return out;
}

// ---------- 材質 ----------
export function solidMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, ...opts });
}
export function glowMaterial(opts = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...opts });
}

// 同じ形をたくさん並べて、毎コマ動かす（船団・汽車・飛行機）。向きは yaw（上から見て、x 軸から北回り）・前後の傾き・横揺れ
export function fleet(geom, mat, n) {
  const mesh = new THREE.InstancedMesh(geom, mat, n);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3(), s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
  return {
    mesh,
    set(i, x, y, z, yaw = 0, pitch = 0, roll = 0, k = 1) {
      e.set(roll, yaw, pitch);
      q.setFromEuler(e);
      m4.compose(v.set(x, y, z), q, s.setScalar(k));
      mesh.setMatrixAt(i, m4);
    },
    hide(i) { mesh.setMatrixAt(i, zero); },
    done() { mesh.instanceMatrix.needsUpdate = true; },
  };
}
// x 軸の向きを、進む向き (dx, dz) にそろえる yaw
export const yawOf = (dx, dz) => Math.atan2(-dz, dx);

// ---------- 粒 ----------
// 粒の絵（白、透けぐあいだけ使う）：soft はぼんやりした丸、puff はもくもくした煙のかたまり
const sprites = {};
function sprite(kind) {
  if (sprites[kind]) return sprites[kind];
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const blob = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'soft') blob(32, 32, 31, 1);
  else for (const [x, y, r, a] of [[32, 35, 22, 0.8], [21, 29, 14, 0.7], [43, 27, 15, 0.7], [31, 20, 13, 0.65], [42, 41, 12, 0.6], [20, 41, 12, 0.6]]) blob(x, y, r, a);
  const t = new THREE.CanvasTexture(c);
  sprites[kind] = t;
  return t;
}

const PV = /* glsl */`
  attribute float aSize; attribute vec4 aCol; attribute float aSpin;
  uniform float uScale, uMax;
  varying vec4 vCol; varying float vSpin;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uMax, aSize * uScale / max(-mv.z, 0.1));
    vCol = aCol; vSpin = aSpin;
  }`;
const PF = /* glsl */`
  uniform sampler2D uMap; uniform float uNight, uLitK;
  varying vec4 vCol; varying float vSpin;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vSpin), s = sin(vSpin);
    p = mat2(c, -s, s, c) * p + 0.5;
    float a = texture2D(uMap, p).a * vCol.a;
    if (a < 0.004) discard;
    // 煙は夜になるほど暗く（日の光で見えているので）。炎は暗くしない
    gl_FragColor = vec4(vCol.rgb * mix(1.0, 1.0 - 0.78 * uNight, uLitK), a);
  }`;

// 粒の種類：life 秒 [最短, 最長]・size 大きさ [生まれたとき, 消えるとき]・col 色 [はじめ, おわり]（線形）・a 濃さ
// drag 速さの減り・rise 上へ（負なら下へ）の加速・fin / fout 濃くなり終わる・薄くなり始める割合・wind 風に流される割合・spin 回る速さ
export function preset(o) {
  return { life: [1, 2], size: [1, 2], col: [[1, 1, 1], [1, 1, 1]], a: 1, drag: 0.5, rise: 0, fin: 0.1, fout: 0.5, wind: 1, spin: 0.4, floor: -Infinity, ...o };
}

export function particles(ctx, { max = 400, kind = 'puff', additive = false, lit = !additive } = {}) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max), spin = new Float32Array(max);
  const vel = new Float32Array(max * 3), age = new Float32Array(max), life = new Float32Array(max), rot = new Float32Array(max);
  const kindOf = new Array(max).fill(null);
  const g = new THREE.BufferGeometry();
  const attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', attr(pos, 3));
  g.setAttribute('aCol', attr(col, 4));
  g.setAttribute('aSize', attr(size, 1));
  g.setAttribute('aSpin', attr(spin, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: sprite(kind) }, uScale: ctx.pointScale, uMax: ctx.pointMax, uNight: ctx.shared.uNight, uLitK: { value: lit ? 1 : 0 } },
    vertexShader: PV, fragmentShader: PF,
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 3 : 2;
  let next = 0, live = 0;
  const rand = ctx.rand;

  function emit(p, x, y, z, vx = 0, vy = 0, vz = 0) {
    const i = next;
    next = (next + 1) % max;
    if (life[i] <= 0) live++;
    kindOf[i] = p;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    age[i] = 0;
    life[i] = p.life[0] + (p.life[1] - p.life[0]) * rand();
    spin[i] = rand() * 6.283;
    rot[i] = (rand() - 0.5) * 2 * p.spin;
    size[i] = p.size[0];
    col[i * 4 + 3] = 0;
  }
  function update(dt) {
    if (!live) return;
    const w = ctx.wind;
    live = 0;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      const p = kindOf[i];
      age[i] += dt;
      const u = age[i] / life[i];
      if (u >= 1) { life[i] = 0; col[i * 4 + 3] = 0; size[i] = 0; continue; }
      live++;
      const j = i * 3, damp = Math.exp(-p.drag * dt);
      vel[j] *= damp; vel[j + 1] = vel[j + 1] * damp + p.rise * dt; vel[j + 2] *= damp;
      pos[j] += (vel[j] + w.x * p.wind) * dt;
      pos[j + 1] += (vel[j + 1] + w.y * p.wind) * dt;
      pos[j + 2] += (vel[j + 2] + w.z * p.wind) * dt;
      if (pos[j + 1] < p.floor) { life[i] = 0; col[i * 4 + 3] = 0; size[i] = 0; live--; continue; }
      const e = 1 - (1 - u) * (1 - u);
      size[i] = p.size[0] + (p.size[1] - p.size[0]) * e;
      const a = p.a * Math.min(1, u / p.fin) * (u > p.fout ? 1 - (u - p.fout) / (1 - p.fout) : 1);
      const c0 = p.col[0], c1 = p.col[1], k = i * 4;
      col[k] = c0[0] + (c1[0] - c0[0]) * u; col[k + 1] = c0[1] + (c1[1] - c0[1]) * u; col[k + 2] = c0[2] + (c1[2] - c0[2]) * u;
      col[k + 3] = a;
      spin[i] += rot[i] * dt;
    }
    for (const n of ['position', 'aCol', 'aSize', 'aSpin']) g.attributes[n].needsUpdate = true;
  }
  return { points, emit, update, get live() { return live; }, dispose() { g.dispose(); mat.dispose(); } };
}

// ---------- 筋（矢・曳光弾・落ちていく爆弾） ----------
// 先が濃く、尾は消える線。重さ g で落ち、floor(x, z) より下に着いたら hit(x, y, z) を呼んで消える
export function streaks(ctx, { max = 200, additive = false } = {}) {
  const pos = new Float32Array(max * 6), col = new Float32Array(max * 8);
  const S = Array.from({ length: max }, () => ({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), len: 1, g: 0, age: 0, life: 9, c: [1, 1, 1, 1], tail: null, hit: null, floor: null }));
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const lines = new THREE.LineSegments(geom, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  let next = 0, live = 0;
  const _d = new THREE.Vector3();
  function fire(o) {
    const s = S[next];
    next = (next + 1) % max;
    if (!s.on) live++;
    s.on = true;
    s.p.copy(o.p); s.v.copy(o.v);
    s.len = o.len ?? 1; s.g = o.g ?? 0; s.age = 0; s.life = o.life ?? 9;
    s.c = o.c ?? [1, 1, 1, 1]; s.tail = o.tail ?? null;
    s.hit = o.hit ?? null; s.floor = o.floor ?? null;
    s.trail = o.trail ?? null;
    return s;
  }
  function update(dt) {
    if (!live) return;
    live = 0;
    for (let i = 0; i < max; i++) {
      const s = S[i], j = i * 6, k = i * 8;
      if (!s.on) continue;
      s.age += dt;
      s.v.y -= s.g * dt;
      s.p.addScaledVector(s.v, dt);
      const fl = s.floor ? s.floor(s.p.x, s.p.z) : -Infinity;
      if (s.p.y <= fl || s.age >= s.life) {
        s.on = false;
        if (s.p.y <= fl) s.hit?.(s.p.x, fl, s.p.z, s);
        col[k + 3] = 0; col[k + 7] = 0;
        continue;
      }
      live++;
      s.trail?.(s, dt);
      _d.copy(s.v).normalize().multiplyScalar(s.len);
      pos[j] = s.p.x - _d.x; pos[j + 1] = s.p.y - _d.y; pos[j + 2] = s.p.z - _d.z;
      pos[j + 3] = s.p.x; pos[j + 4] = s.p.y; pos[j + 5] = s.p.z;
      const t = s.tail ?? s.c, fade = Math.min(1, (s.life - s.age) / 0.3);
      col[k] = t[0]; col[k + 1] = t[1]; col[k + 2] = t[2]; col[k + 3] = (s.tail ? t[3] : 0) * fade;
      col[k + 4] = s.c[0]; col[k + 5] = s.c[1]; col[k + 6] = s.c[2]; col[k + 7] = s.c[3] * fade;
    }
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  }
  return { lines, fire, update, get live() { return live; }, dispose() { geom.dispose(); mat.dispose(); } };
}

// ---------- 光の帯（探照灯） ----------
// 根元から先へ薄くなる、ふちのぼけた円すい。足し算で重ねる
export function beamMaterial(rgb) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Vector3(...rgb) }, uA: { value: 1 } },
    vertexShader: /* glsl */`
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        vT = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; uniform float uA;
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = edge * (1.0 - vT) * (1.0 - vT) * uA;
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
}
