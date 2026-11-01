// 木・町並み・鉄道・関門橋。年（uYear）に合わせて建ったり消えたりする。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { rng, townYearFn, TOWN_SEEDS, VILLAGES, UNIT, Y_PER_M } from './geo.js';
import { fadeLineMaterial } from './terrain.js';
import { NOW_YEAR } from '../eras.js';

const srgb = (h) => new THREE.Color(h);

// 頂点ごとに色をつけたジオメトリ
export function painted(geom, color) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = srgb(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// 特別な場面で模型を置くところ：線分 uHole（a.xz → b.xz）から uHoleR より近い木・建物を消す（uHoleR = 0 なら何も消さない）
const HOLE_GLSL = `uniform vec4 uHole; uniform float uHoleR;
  float outsideHole(vec2 p) {
    vec2 a = p - uHole.xy, d = uHole.zw - uHole.xy;
    return step(uHoleR, length(a - d * clamp(dot(a, d) / max(dot(d, d), 1e-4), 0.0, 1.0)));
  }`;

// 年で現れたり消えたりするための差し込み。材質と影の材質の両方に同じものを入れる
function yearPatch(shared, vertexCommon, beginVertex, extra = {}) {
  return (sh) => {
    sh.uniforms.uYear = shared.uYear;
    Object.assign(sh.uniforms, extra);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uYear;\n${vertexCommon}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${beginVertex}`);
  };
}
function depthMaterialWith(patch, key) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = patch;
  m.customProgramCacheKey = () => 'depth-' + key;
  return m;
}

// ---------- 木 ----------
// clear(x, z) が true の所（現代の道の上）には植えない。rand() の並びを変えないよう、選んだあとで外す
export function buildTrees(geo, shared, { clear = null, count = 9000 } = {}) {
  const rand = rng(11);
  const noise = new SimplexNoise({ random: rand });
  const townYear = townYearFn(geo);
  const trunk = painted(new THREE.CylinderGeometry(0.16, 0.22, 1.3, 5).translate(0, 0.65, 0), '#5b4633');
  const coneG = painted(new THREE.ConeGeometry(1.15, 3.7, 6).translate(0, 1.0 + 3.7 / 2, 0), '#ffffff');
  const ballG = painted(new THREE.IcosahedronGeometry(1.35, 0).scale(1, 1.05, 1).translate(0, 2.55, 0), '#ffffff');
  const geoms = { conifer: mergeGeometries([trunk, coneG]), broad: mergeGeometries([trunk.clone(), ballG]) };

  const items = { conifer: [], broad: [] };
  const { x0, x1, z0, z1 } = geo.mojiBox;
  let tries = 0;
  while (items.conifer.length + items.broad.length < count && tries++ < count * 30) {
    const x = x0 + (x1 - x0) * rand(), z = z0 + (z1 - z0) * rand();
    if (!geo.inMoji(x, z) || !geo.isLand(x, z)) continue;
    const h = geo.sample(geo.hm, x, z);
    if (h < 12 || geo.landYearAt(x, z) > -1e4) continue; // 埋め立て地には植えない
    const slope = geo.slopeAt(x, z);
    if (slope > 0.95) continue;
    // 森のまとまり：ノイズで濃い所と薄い所をつくる
    const nz = noise.noise(x * 0.018, z * 0.018) * 0.65 + noise.noise(x * 0.06, z * 0.06) * 0.35;
    if (rand() > 0.5 + 0.5 * nz) continue;
    const ty = h < 60 && slope < 0.22 ? townYear(x, z) : Infinity;
    const die = Number.isFinite(ty) ? ty + rand() * 14 : 1e5;
    const kind = h > 160 ? (rand() < 0.7 ? 'conifer' : 'broad') : rand() < 0.35 ? 'conifer' : 'broad';
    items[kind].push({ x, z, y: geo.heightAt(x, z) - 0.25, s: 0.8 + rand() * 0.55, r: rand() * Math.PI * 2, die, tone: rand() });
  }
  if (clear) for (const kind of ['conifer', 'broad']) items[kind] = items[kind].filter((t) => !clear(t.x, t.z));

  const group = new THREE.Group();
  group.name = 'trees';
  const crown = { conifer: [srgb('#3a5a37'), srgb('#4d6a3b')], broad: [srgb('#58793c'), srgb('#7a8c43')] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const patch = yearPatch(shared, 'attribute float aDie; ' + HOLE_GLSL, 'transformed *= clamp((aDie - uYear) / 4.0, 0.0, 1.0) * outsideHole(instanceMatrix[3].xz);',
    { uHole: shared.uHole, uHoleR: shared.uHoleR });
  for (const kind of ['conifer', 'broad']) {
    const list = items[kind];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88 });
    mat.onBeforeCompile = patch;
    mat.customProgramCacheKey = () => 'trees';
    const mesh = new THREE.InstancedMesh(geoms[kind], mat, list.length);
    const die = new Float32Array(list.length);
    const c = new THREE.Color();
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.r);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + 0.25 * t.tone), t.s));
      mesh.setMatrixAt(i, m4);
      // 幹は暗い色のまま、葉の色だけ揺らす（頂点色が白い所にだけ効く）
      c.copy(crown[kind][0]).lerp(crown[kind][1], t.tone);
      mesh.setColorAt(i, c);
      die[i] = t.die;
    });
    mesh.geometry.setAttribute('aDie', new THREE.InstancedBufferAttribute(die, 1));
    mesh.customDepthMaterial = depthMaterialWith(patch, 'trees');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ---------- 町並み ----------
// 切妻屋根の家（壁は aRoof=0、屋根は aRoof=1）
function houseGeometry() {
  const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
  walls.deleteAttribute('uv');
  const o = 0.08, rh = 0.62; // 軒の出・屋根の高さ
  const P = (x, y, z) => [x, y, z];
  const A = P(-0.5 - o, 1, -0.5 - o), B = P(0.5 + o, 1, -0.5 - o), Cc = P(0.5 + o, 1, 0.5 + o), D = P(-0.5 - o, 1, 0.5 + o);
  const E = P(-0.5 - o, 1 + rh, 0), F = P(0.5 + o, 1 + rh, 0);
  const roofTris = [A, E, F, A, F, B, D, Cc, F, D, F, E]; // 北の斜面・南の斜面（外向き）
  const gableTris = [P(-0.5, 1, 0.5), P(-0.5, 1 + rh * 0.92, 0), P(-0.5, 1, -0.5), P(0.5, 1, -0.5), P(0.5, 1 + rh * 0.92, 0), P(0.5, 1, 0.5)];
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...roofTris, ...gableTris].flat()), 3));
  roof.computeVertexNormals();
  const g = mergeGeometries([walls, roof]);
  const n = g.attributes.position.count, wallN = walls.attributes.position.count, roofN = roofTris.length;
  const aRoof = new Float32Array(n);
  for (let i = wallN; i < wallN + roofN; i++) aRoof[i] = 1;
  g.setAttribute('aRoof', new THREE.BufferAttribute(aRoof, 1));
  return g;
}
function blockGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
  g.deleteAttribute('uv');
  const nrm = g.attributes.normal, n = nrm.count;
  const aRoof = new Float32Array(n);
  for (let i = 0; i < n; i++) aRoof[i] = nrm.getY(i) > 0.5 ? 1 : 0;
  g.setAttribute('aRoof', new THREE.BufferAttribute(aRoof, 1));
  return g;
}

function planTown(geo) {
  const rand = rng(23);
  const noise = new SimplexNoise({ random: rand });
  const townYear = townYearFn(geo);
  const seeds = TOWN_SEEDS.map((s) => ({ ...s, xz: geo.toXZ(s.lon, s.lat) }));
  const port = seeds[0].xz;
  const out = [];
  const ok = (x, z, maxH = 60, maxSlope = 0.24) =>
    geo.inMoji(x, z) && geo.isLand(x, z) && geo.sample(geo.hm, x, z) < maxH && geo.slopeAt(x, z) < maxSlope && geo.sample(geo.landDist, x, z) > 0.6;
  const angleAt = (x, z, fallback) => {
    const e = geo.dx;
    const gx = geo.sample(geo.hm, x + e, z) - geo.sample(geo.hm, x - e, z);
    const gz = geo.sample(geo.hm, x, z + e) - geo.sample(geo.hm, x, z - e);
    return Math.hypot(gx, gz) > 3 ? Math.atan2(gz, gx) : fallback;
  };
  const wallOld = ['#8a7560', '#9b8a74', '#d6cdbb', '#7a6a58'];
  const wallNew = ['#d3cfc6', '#c1bcb2', '#aeaaa2', '#d9d2c4', '#b8b6b0'];
  const pick = (a) => a[Math.floor(rand() * a.length)];
  // 埋め立て地には、陸になって 1〜7 年たってから建てる（ずらし方は場所で決める。rand() の並びは変えない）
  const landed = (x, z, born) => {
    const ly = geo.landYearAt(x, z);
    if (ly < -1e4) return born;
    const j = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    return Math.max(born, ly + 1 + j * 6);
  };

  // 古い集落（関所・宿場・漁村）
  for (const v of VILLAGES) {
    const [cx, cz] = geo.toXZ(v.lon, v.lat);
    let placed = 0, tries = 0;
    while (placed < v.n && tries++ < v.n * 40) {
      const r = v.r * Math.sqrt(rand()), a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!ok(x, z, 45, 0.3)) continue;
      const born = landed(x, z, v.start + (r / v.r) * 160 * rand());
      out.push({ x, z, rot: angleAt(x, z, 0.4) + (rand() - 0.5) * 0.3, kind: 'house', born, y2: Math.max(born, 1950 + rand() * 40),
        w: 1.7 + rand() * 0.8, d: 1.3 + rand() * 0.6, h1: 0.9 + rand() * 0.35, h2: 1.4 + rand() * 1.4, wall: pick(wallOld), wall2: pick(wallNew),
        w2: 1.9 + rand() * 0.9, d2: 1.6 + rand() * 0.8 });
      placed++;
    }
  }
  // 明治以降の町：種から年ごとに広がる。マスごとに数棟
  for (let j = 0; j < geo.ny; j++) for (let i = 0; i < geo.nx; i++) {
    const cx = geo.xOf(i), cz = geo.zOf(j);
    if (!ok(cx, cz)) continue;
    const ty = townYear(cx, cz);
    if (ty > NOW_YEAR - 1) continue;
    let near = Infinity;
    for (const s of seeds) near = Math.min(near, Math.hypot(cx - s.xz[0], cz - s.xz[1]) * UNIT);
    const nz = noise.noise(cx * 0.03, cz * 0.03);
    const dens = Math.max(0.12, 1 - near / 5200) * (0.65 + 0.35 * nz);
    const k = Math.floor(dens * 2.6 + rand());
    const ld = geo.sample(geo.landDist, cx, cz);
    const h = geo.sample(geo.hm, cx, cz);
    const coreDist = Math.hypot(cx - port[0], cz - port[1]) * UNIT;
    for (let b = 0; b < k; b++) {
      const x = cx + (rand() - 0.5) * geo.dx * 0.9, z = cz + (rand() - 0.5) * geo.dz * 0.9;
      if (!ok(x, z)) continue;
      const born = landed(x, z, ty + rand() * 6);
      const rot = angleAt(x, z, 0.62) + (rand() < 0.8 ? 0 : Math.PI / 2);
      if (ld < 2.2 && h < 7 && rand() < 0.55) {
        // 港の倉庫：はじめから大きな箱
        out.push({ x, z, rot, kind: 'block', born, y2: born, w: 4.5 + rand() * 3, d: 2.6 + rand() * 1.4, h1: 0, h2: 1.4 + rand() * 1.0, wall: '#b9b2a4', wall2: rand() < 0.5 ? '#a99f8d' : '#c4beb2' });
        continue;
      }
      const core = coreDist < 1100;
      const y2 = Math.max(born, core ? 1912 + rand() * 26 : rand() < 0.12 ? 1e5 : Math.max(born + 22, 1952) + rand() * 32);
      const brick = core && y2 < 1940 && rand() < 0.4;
      const tall = core ? 2.6 + rand() * 3.4 : 1.4 + rand() * (y2 > 1965 ? 3.4 : 1.6);
      out.push({ x, z, rot, kind: 'house', born, y2, w: 1.7 + rand() * 0.9, d: 1.3 + rand() * 0.7, h1: 0.9 + rand() * 0.4, h2: tall,
        wall: pick(wallOld), wall2: brick ? '#94584a' : pick(wallNew), w2: 2.0 + rand() * 1.6, d2: 1.8 + rand() * 1.4 });
    }
  }
  // 門司港レトロハイマート（1999、127 m）
  const [tx, tz] = geo.toXZ(130.9632, 33.9458);
  out.push({ x: tx, z: tz, rot: 0.62, kind: 'block', born: 1997, y2: 1997, w: 2.8, d: 2.3, h1: 0, h2: 127 * Y_PER_M, wall: '#d8d3ca', wall2: '#d8d3ca', keep: true });
  return out;
}

// clear(x, z) が true の所（現代の道の上）には建てない。rand() の並びを変えないよう、決めたあとで外す
export function buildTown(geo, shared, clear = null) {
  const plan = clear ? planTown(geo).filter((b) => b.keep || !clear(b.x, b.z)) : planTown(geo);
  const group = new THREE.Group();
  group.name = 'town';
  const vCommon = 'attribute float aBorn; attribute float aEnd; attribute vec3 aWall; attribute float aRoof; attribute float aStep; uniform vec3 uRoofCol; uniform float uCoast; ' + HOLE_GLSL + ' varying vec3 vBCol;';
  // 埋め立て地の建物は、陸が水面から上がるのに合わせて出す（年を大きく飛ばしたとき、海の上に浮かないように）。
  // 特別な場面で模型を置くところ（uHole の帯の中）は消す
  const vBegin = `
    float bs = smoothstep(aBorn, aBorn + 2.0, uYear) * (1.0 - step(aEnd, uYear)) * clamp(uCoast - aStep + 1.0, 0.0, 1.0);
    bs *= outsideHole(instanceMatrix[3].xz);
    float on = step(0.001, bs);
    transformed *= vec3(on, bs, on);
    vBCol = mix(aWall, uRoofCol * (0.75 + 0.25 * aWall), aRoof);`;
  const make = (geom, list, opts, key) => {
    const patch = yearPatch(shared, vCommon, vBegin, { uRoofCol: { value: srgb(opts.roof) }, uCoast: shared.uCoast, uHole: shared.uHole, uHoleR: shared.uHoleR });
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, flatShading: true });
    mat.onBeforeCompile = (sh) => {
      patch(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBCol;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vBCol;');
    };
    mat.customProgramCacheKey = () => 'town-' + key;
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    const born = new Float32Array(list.length), end = new Float32Array(list.length), wall = new Float32Array(list.length * 3);
    const step = new Float32Array(list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    list.forEach((b, i) => {
      const s = opts.scale(b);
      q.setFromAxisAngle(up, -b.rot);
      const y = geo.heightAt(b.x, b.z) - 0.35;
      m4.compose(new THREE.Vector3(b.x, y, b.z), q, new THREE.Vector3(s[0], s[1], s[2]));
      mesh.setMatrixAt(i, m4);
      born[i] = opts.born(b); end[i] = opts.end(b);
      const k = geo.index(b.x, b.z);
      step[i] = k >= 0 && geo.coastStep[k] !== 255 ? geo.coastStep[k] : 0;
      c.set(opts.wall(b));
      wall.set([c.r, c.g, c.b], i * 3);
    });
    mesh.geometry.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 1));
    mesh.geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(end, 1));
    mesh.geometry.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 3));
    mesh.geometry.setAttribute('aStep', new THREE.InstancedBufferAttribute(step, 1));
    mesh.customDepthMaterial = depthMaterialWith(patch, 'town-' + key);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  };
  // 木造の家（建ってから建て替えまで）
  const houses = plan.filter((b) => b.kind === 'house');
  group.add(make(houseGeometry(), houses, {
    roof: '#4b4e57', scale: (b) => [b.w, b.h1, b.d], born: (b) => b.born, end: (b) => b.y2, wall: (b) => b.wall,
  }, 'house'));
  // 建て替え後のビル・倉庫
  group.add(make(blockGeometry(), plan, {
    roof: '#a29f97', scale: (b) => (b.kind === 'house' ? [b.w2, b.h2, b.d2] : [b.w, b.h2, b.d]),
    born: (b) => b.y2, end: () => 1e5, wall: (b) => b.wall2,
  }, 'block'));
  group.userData.count = plan.length;
  return group;
}

// ---------- 鉄道（1891 開業：門司〈今の門司港〉→ 大里〈今の門司〉→ 小倉） ----------
const RAIL = [
  [33.9447, 130.9622], [33.9420, 130.9575], [33.9399, 130.9525], [33.9382, 130.9487], [33.9361, 130.9470],
  [33.9339, 130.9462], [33.9317, 130.9450], [33.9279, 130.9443], [33.9241, 130.9435], [33.9198, 130.9402],
  [33.9160, 130.9390], [33.9122, 130.9363], [33.9079, 130.9343], [33.9047, 130.9327], [33.8990, 130.9270],
  [33.8950, 130.9180], [33.8920, 130.9080], [33.8890, 130.8980], [33.8870, 130.8880], [33.8860, 130.8800],
];
export function railCurve(geo) {
  const pts = RAIL.map(([lat, lon]) => { const [x, z] = geo.toXZ(lon, lat); return new THREE.Vector3(x, 0, z); });
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}
export function buildRail(geo, shared) {
  const curve = railCurve(geo);
  const n = Math.ceil(curve.getLength() / 2);
  // 駅の側を後ろにしておく（特別な場面で、駅の近くだけ線を引かずに模型の線路を置けるように）
  const pos = [];
  for (const p of curve.getSpacedPoints(n).reverse()) pos.push(p.x, geo.groundAt(p.x, p.z) + 0.6, p.z);
  const group = new THREE.Group();
  group.name = 'rail';
  const base = new Line2(new LineGeometry().setPositions(pos), fadeLineMaterial({ color: 0x23211e, linewidth: 3.4, transparent: true, depthWrite: false }, shared, 'rail-base'));
  const dash = new Line2(new LineGeometry().setPositions(pos), fadeLineMaterial({ color: 0xf2efe8, linewidth: 1.7, transparent: true, depthWrite: false, dashed: true, dashSize: 3.2, gapSize: 3.2 }, shared, 'rail-dash'));
  dash.computeLineDistances();
  base.renderOrder = 4; dash.renderOrder = 5;
  group.add(base, dash);
  group.userData.from = 1891;
  // 駅から dist（単位）までの線を描かない（0 で全部に戻す）
  group.userData.trim = (dist) => { for (const l of [base, dash]) l.geometry.instanceCount = dist > 0 ? Math.max(0, n - Math.ceil(dist / 2)) : Infinity; };
  return group;
}

// ---------- 現代の道（© OpenStreetMap contributors。tools/build_roads.py で作った data/roads.json） ----------
// 現代の地図と観光マップにだけ出す。年を動かすと現代だけ道が現れるので、目立ちすぎない明るい灰色にする。
// 太さは画面の px で、寄るほど太く（width → max）。町の中の細い道（minor）は寄ったときだけ出す。
// clear は町並み・木を置かない帯の幅（道の中心から、単位）
const ROADS = {
  major: { width: 1.7, max: 5, opacity: 0.62, clear: 1.7 },
  mid: { width: 1.2, max: 3.6, opacity: 0.5, clear: 1.3 },
  minor: { width: 0.9, max: 2.4, opacity: 0.42 },
};
const ROAD_COLOR = 0xe4ddd0;
// 描いている地形の面（三角形）の上の高さ。buildTerrain と同じ対角線で割って求める
// （heightAt の双一次補間のままだと、急な斜面で面の下にもぐって線が途切れる）
function surfaceAt(geo, x, z) {
  const { nx, ny, y: Y } = geo;
  const fx = Math.min(Math.max(geo.gx(x), 0), nx - 1.001), fz = Math.min(Math.max(geo.gz(z), 0), ny - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
  if (Math.abs(Y[a] - Y[e]) < Math.abs(Y[b] - Y[d])) {
    return u > v ? Y[a] + (Y[b] - Y[a]) * u + (Y[e] - Y[b]) * v : Y[a] + (Y[e] - Y[d]) * u + (Y[d] - Y[a]) * v;
  }
  return u + v <= 1 ? Y[a] + (Y[b] - Y[a]) * u + (Y[d] - Y[a]) * v : Y[e] + (Y[d] - Y[e]) * (1 - u) + (Y[b] - Y[e]) * (1 - v);
}
export function buildRoads(geo, shared, data) {
  const group = new THREE.Group();
  group.name = 'roads';
  group.visible = false;
  const lines = {};
  const keepOut = [];
  for (const [k, st] of Object.entries(ROADS)) {
    const pos = [];
    for (const flat of data?.[k] ?? []) {
      // m（地形の中心から、2 点目からは前の点との差）→ 単位
      const pts = [flat[0] / UNIT, flat[1] / UNIT];
      for (let i = 2; i < flat.length; i += 2) pts.push(pts[i - 2] + flat[i] / UNIT, pts[i - 1] + flat[i + 1] / UNIT);
      if (st.clear) keepOut.push({ pts, r: st.clear });
      // 地面の起伏に沿うよう、1.5 単位ごとに区切って高さを取る
      const yAt = (x, z) => Math.max(0, surfaceAt(geo, x, z)) + 0.6;
      for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
        let px = ax, pz = az, py = yAt(ax, az);
        for (let s = 1; s <= n; s++) {
          const qx = ax + ((bx - ax) * s) / n, qz = az + ((bz - az) * s) / n, qy = yAt(qx, qz);
          pos.push(px, py, pz, qx, qy, qz);
          px = qx; pz = qz; py = qy;
        }
      }
    }
    if (!pos.length) continue;
    const mat = fadeLineMaterial({ color: ROAD_COLOR, linewidth: st.width, transparent: true, opacity: 0, depthWrite: false }, shared, 'road-' + k);
    // 線のつなぎ目が重なって数珠のように濃くならないよう、同じ段の線は 1 画素に 1 回だけ塗る（ステンシル）
    Object.assign(mat, { stencilWrite: true, stencilRef: Object.keys(lines).length + 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    const line = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), mat);
    line.renderOrder = 3;
    lines[k] = line;
    group.add(line);
  }
  group.userData.clear = keepOut.length ? roadClear(keepOut) : null;
  // v：出し入れ（0〜1）。r：いつもの視点からの寄り具合（距離 ÷ いつもの距離）
  group.userData.show = (v, r) => {
    group.visible = v > 0;
    const zoom = 1 / Math.sqrt(Math.max(r, 0.01));
    for (const [k, line] of Object.entries(lines)) {
      const st = ROADS[k];
      const near = k === 'minor' ? 1 - THREE.MathUtils.smoothstep(r, 0.22, 0.4) : 1;
      line.material.opacity = st.opacity * v * near;
      line.material.linewidth = Math.min(st.max, st.width * zoom);
      line.visible = line.material.opacity > 0.004;
    }
  };
  return group;
}

// 道の中心から r（単位）より近いかどうかを、1 単位ごとの格子に印をつけて引けるようにする
function roadClear(list) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const { pts, r } of list) for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i] - r); x1 = Math.max(x1, pts[i] + r);
    z0 = Math.min(z0, pts[i + 1] - r); z1 = Math.max(z1, pts[i + 1] + r);
  }
  x0 = Math.floor(x0); z0 = Math.floor(z0);
  const w = Math.ceil(x1) - x0 + 1, hh = Math.ceil(z1) - z0 + 1;
  const grid = new Uint8Array(w * hh);
  for (const { pts, r } of list) {
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], az = pts[i - 1], dx = pts[i] - ax, dz = pts[i + 1] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const i0 = Math.floor(Math.min(ax, ax + dx) - r) - x0, i1 = Math.ceil(Math.max(ax, ax + dx) + r) - x0;
      const j0 = Math.floor(Math.min(az, az + dz) - r) - z0, j1 = Math.ceil(Math.max(az, az + dz) + r) - z0;
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
        const px = x0 + k - ax, pz = z0 + j - az;
        const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / L2));
        if (Math.hypot(px - dx * t, pz - dz * t) < r) grid[j * w + k] = 1;
      }
    }
  }
  return (x, z) => {
    const i = Math.round(x) - x0, j = Math.round(z) - z0;
    return i >= 0 && j >= 0 && i < w && j < hh && grid[j * w + i] === 1;
  };
}

// ---------- 関門橋（1973）：全長 1068 m、中央径間 712 m、主塔 141 m、桁の高さ 約61 m ----------
export function buildBridge(geo) {
  const [cx, cz] = geo.toXZ(130.9586, 33.9614);
  const brg = THREE.MathUtils.degToRad(308);
  const group = new THREE.Group();
  group.name = 'bridge';
  group.position.set(cx, 0, cz);
  // ローカル x が橋の軸（＋が下関側）
  group.rotation.y = Math.atan2(Math.cos(brg), Math.sin(brg));
  const mat = new THREE.MeshStandardMaterial({ color: srgb('#c9cdca'), roughness: 0.55, metalness: 0.15, flatShading: true });
  const deckY = 61 * Y_PER_M, towerY = 141 * Y_PER_M, half = 534 / UNIT, tower = 356 / UNIT, width = 3.0;
  const ext = 60;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(ext * 2, 1.15, width), mat);
  deck.position.y = deckY - 0.55;
  group.add(deck);
  // 主塔：脚2本と梁3本
  for (const sx of [-tower, tower]) {
    for (const sz of [-width / 2 - 0.25, width / 2 + 0.25]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.85, towerY, 0.85), mat);
      leg.position.set(sx, towerY / 2, sz);
      group.add(leg);
    }
    for (const by of [deckY - 1.6, towerY * 0.72, towerY - 0.5]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, width + 1.4), mat);
      beam.position.set(sx, by, 0);
      group.add(beam);
    }
  }
  // 陸の上の橋脚
  const dirX = Math.cos(group.rotation.y), dirZ = -Math.sin(group.rotation.y);
  for (let s = -ext + 3; s <= ext - 3; s += 7) {
    if (Math.abs(s) < tower + 2) continue;
    const wx = cx + dirX * s, wz = cz + dirZ * s;
    const gy = geo.groundAt(wx, wz);
    const hgt = deckY - 1.1 - gy;
    if (hgt <= 0.5) continue;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(0.9, hgt, 1.6), mat);
    pier.position.set(s, gy + hgt / 2, 0);
    group.add(pier);
  }
  // ケーブル：中央は放物線、側径間は塔からアンカーへ
  const cableY = (s) => {
    const a = Math.abs(s);
    if (a <= tower) return deckY + 1.0 + (towerY - deckY - 1.0) * (a / tower) ** 2;
    return towerY + (deckY + 0.6 - towerY) * Math.min(1, (a - tower) / (half - tower));
  };
  const lineMat = new LineMaterial({ color: 0xd9dcd8, linewidth: 0.32, worldUnits: true });
  const hangMat = new LineMaterial({ color: 0xc9ccc8, linewidth: 0.1, worldUnits: true, transparent: true, opacity: 0.8 });
  const hangers = [];
  for (const sz of [-width / 2 - 0.25, width / 2 + 0.25]) {
    const pts = [];
    for (let s = -half; s <= half + 0.01; s += 1.5) pts.push(s, cableY(s), sz);
    group.add(new Line2(new LineGeometry().setPositions(pts), lineMat));
    for (let s = -tower + 2.5; s < tower - 1; s += 2.5) hangers.push(s, cableY(s), sz, s, deckY, sz);
  }
  group.add(new LineSegments2(new LineSegmentsGeometry().setPositions(hangers), hangMat));
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.userData.lineMats = [lineMat, hangMat];
  group.userData.from = 1973;
  return group;
}
