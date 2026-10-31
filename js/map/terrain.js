// 地形・海・海岸線・区の境界。色は自然な色で作り、どの時代も同じ色で見せる。
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Y_PER_M, townYearFn } from './geo.js';

// 地図の端で背景色へ溶かす。端の線がまっすぐにならないよう、ゆるい揺らぎを足す
export const EDGE_GLSL = /* glsl */`
  float edgeHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float edgeNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(edgeHash(i), edgeHash(i + vec2(1, 0)), f.x), mix(edgeHash(i + vec2(0, 1)), edgeHash(i + vec2(1, 1)), f.x), f.y);
  }
  // 角を丸めた四角（4乗の超楕円）の内側で溶かす。揺らぎは内側へだけ寄せる（データの外は海の面しかないので）
  float edgeFade(vec2 p) {
    vec2 q = abs(p) / uEdge.xy;
    q *= q; q *= q;
    float r = sqrt(sqrt(q.x + q.y));
    float e = (1.0 - r) * 0.5 * (uEdge.x + uEdge.y) - (edgeNoise(p * 0.004) + 0.5 * edgeNoise(p * 0.011)) / 1.5 * uEdge.z * 0.35;
    return smoothstep(0.0, uEdge.z * 0.75, e);
  }`;

const srgb = (hex) => new THREE.Color(hex); // Color は sRGB の16進から線形に直して持つ
const tmpC = new THREE.Color();

// 標高・傾き・海からの距離で地面の色を決める（sRGB で考えて線形にする）
const C = {
  sand: srgb('#d8c9a0'), field: srgb('#a7ad73'), low: srgb('#7f9a5a'), forest: srgb('#587747'),
  high: srgb('#4f6a43'), peak: srgb('#6d7357'), rock: srgb('#8c8676'),
};
function groundColor(geo, k, out) {
  const h = geo.hm[k];
  const ld = geo.landDist[k];
  if (h < 18) out.copy(C.field).lerp(C.low, h / 18);
  else if (h < 110) out.copy(C.low).lerp(C.forest, (h - 18) / 92);
  else if (h < 330) out.copy(C.forest).lerp(C.high, (h - 110) / 220);
  else out.copy(C.high).lerp(C.peak, Math.min(1, (h - 330) / 220));
  if (ld <= 1.01 && h < 5) out.lerp(C.sand, 0.75);
  return out;
}

// まわり（半径2マス）の平均との差 m。正なら谷、負なら尾根
function concavity(geo, i, j) {
  let s = 0, n = 0;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const ii = i + di, jj = j + dj;
    if ((di === 0 && dj === 0) || ii < 0 || jj < 0 || ii >= geo.nx || jj >= geo.ny) continue;
    s += geo.hm[jj * geo.nx + ii]; n++;
  }
  return s / n - geo.hm[j * geo.nx + i];
}

export function buildTerrain(geo, shared) {
  const { nx, ny } = geo;
  const n = nx * ny;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const aMask = new Float32Array(n), aTown = new Float32Array(n);
  const townYear = townYearFn(geo);
  const c = new THREE.Color();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const x = geo.xOf(i), z = geo.zOf(j);
    pos.set([x, geo.y[k], z], k * 3);
    if (geo.land[k]) {
      groundColor(geo, k, c);
      // 急な斜面は岩の色
      const s = geo.slopeAt(x, z);
      c.lerp(C.rock, Math.min(1, Math.max(0, (s - 0.45) / 0.5)) * 0.6);
      // 谷は暗く、尾根は少し明るく（光の回り込みを色に焼き込む）。区の外は弱める
      const conc = concavity(geo, i, j) * (geo.mask[k] ? 1 : 0.35);
      c.multiplyScalar(1 - Math.min(0.24, Math.max(0, conc / 55)) + Math.min(0.06, Math.max(0, -conc / 90)));
      if (!geo.mask[k]) {
        // 門司区の外は「地名と海岸線くらい」：色を抜いて暗くし、区から離れるほど背景へ沈める
        const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
        const far = Math.min(1, geo.wardDist[k] / 30);
        c.lerp(tmpC.setRGB(l, l, l), 0.75).multiplyScalar(0.5 - 0.18 * far);
      }
    } else {
      c.copy(C.sand).multiplyScalar(0.55);
    }
    col.set([c.r, c.g, c.b], k * 3);
    aMask[k] = geo.mask[k];
    const h = geo.hm[k];
    aTown[k] = geo.mask[k] && geo.land[k] && h < 60 && geo.slopeAt(x, z) < 0.22 ? townYear(x, z) : 1e5;
  }
  // 四隅とも海のマスは水の下に隠れるので作らない。区の外（四隅とも区の外）は別の面にする
  const idxIn = [], idxOut = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    if (!(geo.land[a] || geo.land[b] || geo.land[d] || geo.land[e])) continue;
    const idx = geo.mask[a] || geo.mask[b] || geo.mask[d] || geo.mask[e] ? idxIn : idxOut;
    // 折れ目が尾根・谷に沿うよう、高さの差が小さい対角線で割る
    if (Math.abs(geo.y[a] - geo.y[e]) < Math.abs(geo.y[b] - geo.y[d])) idx.push(a, d, e, a, e, b);
    else idx.push(a, d, b, b, d, e);
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3), color: new THREE.BufferAttribute(col, 3),
    aMask: new THREE.BufferAttribute(aMask, 1), aTown: new THREE.BufferAttribute(aTown, 1),
  };
  // 法線は区の内外をまとめて求める（境目に継ぎ目が出ないように）
  const all = new THREE.BufferGeometry();
  all.setAttribute('position', attrs.position);
  all.setIndex([...idxIn, ...idxOut]);
  all.computeVertexNormals();
  attrs.normal = all.getAttribute('normal');
  // 区の外は面の向きを上へ寄せて、山の陰影を弱める（形は残すが目立たせない）
  const nrm = attrs.normal.array;
  for (let k = 0; k < n; k++) {
    if (geo.mask[k]) continue;
    const x = nrm[k * 3] * 0.3, y = nrm[k * 3 + 1] * 0.3 + 0.7, z = nrm[k * 3 + 2] * 0.3;
    const l = Math.hypot(x, y, z);
    nrm[k * 3] = x / l; nrm[k * 3 + 1] = y / l; nrm[k * 3 + 2] = z / l;
  }
  const part = (index) => {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, a);
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  };

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uYear: shared.uYear, uBg: shared.uBg, uEdge: shared.uEdge,
      uTownCol: { value: srgb('#b9b1a1') },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMask; attribute float aTown;
        varying float vMask; varying float vTown; varying vec3 vWP;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vMask = aMask; vTown = aTown; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uYear; uniform vec3 uBg, uTownCol; uniform vec4 uEdge;
        varying float vMask; varying float vTown; varying vec3 vWP;
        ${EDGE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float inMoji = smoothstep(0.35, 0.65, vMask);
        // 町になった所は地面を灰色に（年とともに広がる）
        float town = smoothstep(vTown, vTown + 18.0, uYear) * inMoji;
        diffuseColor.rgb = mix(diffuseColor.rgb, uTownCol, town * 0.55);
        // 等高線 100 m ごと（門司区の中だけ）
        float hm = vWP.y / ${Y_PER_M.toFixed(5)};
        float u = hm / 100.0;
        float fw = fwidth(u);
        float dl = abs(fract(u + 0.5) - 0.5);
        float cl = (1.0 - smoothstep(0.6 * fw, 1.6 * fw, dl)) * (1.0 - smoothstep(0.12, 0.35, fw));
        cl *= inMoji * smoothstep(40.0, 70.0, hm);
        diffuseColor.rgb *= 1.0 - 0.32 * cl;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = mix(uBg, gl_FragColor.rgb, edgeFade(vWP.xz));`);
  };
  mat.customProgramCacheKey = () => 'terrain';
  // 区の中は影を落とす・受ける。区の外は受けるだけ（外の山の影で目立たせない）
  const inner = new THREE.Mesh(part(idxIn), mat);
  inner.castShadow = inner.receiveShadow = true;
  inner.name = 'terrain-moji';
  const outer = new THREE.Mesh(part(idxOut), mat);
  outer.receiveShadow = true;
  outer.name = 'terrain-outer';
  const group = new THREE.Group();
  group.name = 'terrain';
  group.add(inner, outer);
  return group;
}

// 海：陸からの距離で浅瀬の色・岸の泡を出す。波は面の向きだけ（細かい波は遠くでは消す）
export function buildWater(geo, shared) {
  const { nx, ny } = geo;
  const tex = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) tex[k] = geo.land[k] ? 0 : Math.min(255, Math.round(geo.seaDist[k] * 16));
  const dist = new THREE.DataTexture(tex, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
  dist.magFilter = dist.minFilter = THREE.LinearFilter;
  dist.wrapS = dist.wrapT = THREE.ClampToEdgeWrapping;
  dist.needsUpdate = true;

  const size = 1.6;
  const g = new THREE.PlaneGeometry(geo.W * size, geo.D * size, 200, 200);
  g.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: shared.uTime, uBg: shared.uBg, uEdge: shared.uEdge, uNight: shared.uNight,
    uSunDir: shared.uSunDir,
    uDist: { value: dist },
    uGrid: { value: new THREE.Vector4(geo.W / 2, geo.D / 2, geo.dx, geo.dz) },
    uTexSize: { value: new THREE.Vector2(nx, ny) },
    uDeep: { value: srgb('#1c4660') }, uShallow: { value: srgb('#4a9298') },
    uSky: { value: srgb('#b8cdd6') }, uFoam: { value: srgb('#f3f0e6') }, uSunCol: { value: srgb('#fff4dc') },
    uFlow: shared.uFlow,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // ゆるいうねり：岸で水がわずかに寄せては返す
        wp.y += 0.05 * sin(wp.x * 0.07 + uTime * 0.9) * cos(wp.z * 0.05 - uTime * 0.7);
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uNight;
      uniform sampler2D uDist;
      uniform vec4 uGrid, uEdge, uFlow;
      uniform vec2 uTexSize;
      uniform vec3 uBg, uDeep, uShallow, uSky, uFoam, uSunCol, uSunDir;
      varying vec3 vWP;
      ${EDGE_GLSL}
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      // 陸までの距離（マス）。格子の点とテクセルの中心を合わせる
      float seaDist(vec2 p) {
        vec2 g = (p + uGrid.xy) / uGrid.zw;
        vec2 uv = (g + 0.5) / uTexSize;
        return texture2D(uDist, uv).r * 255.0 / 16.0;
      }
      // 向きの違う波を重ねる。画面で 2px より細かい波は消す（遠くでちらつかないように）
      vec2 wave(vec2 p, vec2 dir, float k, float slope, float w, float fw) {
        float fade = 1.0 - smoothstep(0.25, 0.6, k * fw);
        return dir * slope * cos(dot(dir, p) * k + uTime * w) * fade;
      }
      void main() {
        vec2 p = vWP.xz;
        // 潮の流れ（壇ノ浦の場面で使う）
        p -= uFlow.xy;
        float fw = length(fwidth(p));
        vec2 g = wave(p, vec2(0.8, 0.6), 0.35, 0.10, 0.9, fw)
               + wave(p, vec2(-0.5, 0.866), 0.8, 0.08, 1.4, fw)
               + wave(p, vec2(0.95, -0.31), 1.9, 0.06, 2.1, fw)
               + wave(p, vec2(-0.2, -0.98), 4.3, 0.05, 3.0, fw);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWP);
        float d = seaDist(vWP.xz);
        float shallow = exp(-d * 0.55);
        vec3 col = mix(uDeep, uShallow, shallow);
        float ndl = max(dot(N, uSunDir), 0.0);
        col *= 0.7 + 0.3 * ndl;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col = mix(col, uSky * (1.0 - 0.85 * uNight), fres * 0.5);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 240.0);
        col += uSunCol * spec * 1.6 * (1.0 - uNight);
        // 岸の泡：波打ち際の白い線と、岸へ寄せる帯
        float nz = vnoise(vWP.xz * 0.35 + vec2(uTime * 0.12, -uTime * 0.08));
        float fd = fwidth(d);
        float rim = 1.0 - smoothstep(0.0, 0.16 + 0.1 * nz + fd * 1.5, d);
        float ph = d * 9.0 - uTime * 1.7 + nz * 2.4;
        float band = smoothstep(0.86, 0.99, sin(ph)) * (1.0 - smoothstep(0.15, 1.3, d)) * (0.45 + 0.55 * nz);
        band *= 1.0 - smoothstep(0.2, 0.6, fd * 9.0);
        float foam = clamp(rim * 0.85 + band * 0.7, 0.0, 1.0);
        col = mix(col, uFoam * (1.0 - 0.7 * uNight), foam);
        col *= 1.0 - 0.72 * uNight;
        gl_FragColor = vec4(mix(uBg, col, edgeFade(vWP.xz)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'water';
  mesh.renderOrder = -1;
  return mesh;
}

// 線の材質に「地図の端で消える」を足す
export function fadeLineMaterial(params, shared, key) {
  const m = new LineMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEdge = shared.uEdge;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', `uniform vec4 uEdge; varying float vEdge;
        ${EDGE_GLSL}
        void main() {`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec3 wpE = (modelMatrix * vec4(position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;
        vEdge = edgeFade(wpE.xz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vEdge;\nvoid main() {')
      .replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );', 'gl_FragColor = vec4( diffuseColor.rgb, alpha * vEdge );');
  };
  m.customProgramCacheKey = () => 'fadeline-' + key;
  return m;
}

// 海岸線：頂点の高さ 0 の等値線（マーチングスクエア）
export function buildCoast(geo, shared) {
  const { nx, ny } = geo;
  const Y = geo.y, out = [];
  const lift = 0.25;
  const lerpPt = (ka, kb, ia, ja, ib, jb) => {
    const t = Y[ka] / (Y[ka] - Y[kb]);
    return [geo.xOf(ia + (ib - ia) * t), lift, geo.zOf(ja + (jb - ja) * t)];
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    const s = (Y[a] > 0 ? 1 : 0) | (Y[b] > 0 ? 2 : 0) | (Y[e] > 0 ? 4 : 0) | (Y[d] > 0 ? 8 : 0);
    if (s === 0 || s === 15) continue;
    // 辺：上(a-b) 右(b-e) 下(d-e) 左(a-d)
    const T = () => lerpPt(a, b, i, j, i + 1, j);
    const R = () => lerpPt(b, e, i + 1, j, i + 1, j + 1);
    const B = () => lerpPt(d, e, i, j + 1, i + 1, j + 1);
    const L = () => lerpPt(a, d, i, j, i, j + 1);
    const seg = (p, q) => out.push(...p, ...q);
    const center = (Y[a] + Y[b] + Y[d] + Y[e]) / 4 > 0;
    switch (s) {
      case 1: case 14: seg(L(), T()); break;
      case 2: case 13: seg(T(), R()); break;
      case 3: case 12: seg(L(), R()); break;
      case 4: case 11: seg(R(), B()); break;
      case 6: case 9: seg(T(), B()); break;
      case 7: case 8: seg(L(), B()); break;
      case 5: if (center) { seg(L(), B()); seg(T(), R()); } else { seg(L(), T()); seg(R(), B()); } break;
      case 10: if (center) { seg(L(), T()); seg(R(), B()); } else { seg(T(), R()); seg(L(), B()); } break;
    }
  }
  const g = new LineSegmentsGeometry().setPositions(out);
  const mat = fadeLineMaterial({ color: 0x241f1a, linewidth: 1.3, transparent: true, opacity: 0.3, depthWrite: false }, shared, 'coast');
  const line = new LineSegments2(g, mat);
  line.name = 'coast';
  line.renderOrder = 2;
  return line;
}

// 門司区の境界（陸の上だけ、地面に沿わせる）
export function buildBorder(geo, shared) {
  const out = [];
  const step = 2.5;
  for (const ring of geo.mojiRings) {
    const pts = [];
    for (let r = 0; r < ring.length; r++) {
      const [x0, z0] = ring[r], [x1, z1] = ring[(r + 1) % ring.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s < m; s++) {
        const x = x0 + (x1 - x0) * s / m, z = z0 + (z1 - z0) * s / m;
        const h = geo.heightAt(x, z);
        pts.push(h > 0.05 ? [x, h + 0.5, z] : null);
      }
    }
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      if (p && q) out.push(...p, ...q);
    }
  }
  const g = new LineSegmentsGeometry().setPositions(out);
  const mat = fadeLineMaterial({ color: 0xf4ead6, linewidth: 1.6, transparent: true, opacity: 0.5, depthWrite: false }, shared, 'border');
  const line = new LineSegments2(g, mat);
  line.name = 'border';
  line.renderOrder = 3;
  return line;
}
