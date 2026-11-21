// 門司区の町並み（現実の建物）。
//
// もとのデータは、国土交通省 Project PLATEAU の建築物（LOD1・北九州市 2020 年度）。tools/build_buildings.mjs が
// 建物を「向きのある長方形」（場所・大きさ・高さ・建てた年・用途・構造）にして data/buildings.bin に入れている。
//
// - 今の建物は、建てた年から出す（年の記録がない建物は、道具がまわりの建物から見積もった年）。
// - それより前のことは記録にない。そこで「この区画にはいつごろから家があったか」をまわりの様子から見積もり、
//   その年から今の建物が建つまでのあいだ、木造の家を置く。昔の町並みは見積もりで、史実の再現ではない。
// - 1 つの長方形が 1 つのインスタンス。頂点シェーダーが、年に合わせて「前の家」と「今の建物」を切り替える。
// - 数が多い（約 3 万 9 千）ので、1.5 km ごとのかたまりに分け、画面で小さくしか見えない建物は描かない。
import * as THREE from 'three';
import { VILLAGES, UNIT, Y_PER_M, townYearFn } from './geo.js';
import { HOLE_GLSL, yearPatch, depthMaterialWith } from './props.js';
import { NOW_YEAR } from '../eras.js';

const ROW = 14;             // buildings.bin の 1 行のバイト数
const PART = 0x80;          // 用途の欄の印：前の行と同じ建物の続き
const YEAR_GUESS = 0x8000;  // 年の欄の印：見積もった年
const NEVER = 1e5;
const CHUNK = 150;          // かたまりの一辺（地図の単位。1 = 10 m）
const HEIGHT = 0.13;        // 建物の高さ 1 m を、地図の高さいくつにするか（地形は 0.17。建物は少し控えめにする）
const DETAIL = 0.9;         // 画面でこの px より小さくなる建物は描かない

const srgb = (h) => new THREE.Color(h);
const bytes = (h) => { const c = srgb(h); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };
const WALL_OLD = ['#8a7560', '#9b8a74', '#d6cdbb', '#7a6a58'].map(bytes);             // 木と土壁
const WALL_NEW = ['#d3cfc6', '#c1bcb2', '#aeaaa2', '#d9d2c4', '#b8b6b0'].map(bytes);
const WALL_SHED = ['#b9b2a4', '#a99f8d', '#c4beb2'].map(bytes);                       // 倉庫・工場
const WALL_BRICK = bytes('#94584a');
const ROOF_TILE = '#4b4e57', ROOF_FLAT = '#a29f97';
const pick = (list, u) => list[Math.min(list.length - 1, Math.floor(u * list.length))];

// 場所から決まる 0〜1 の数（読み込むたびに同じ町になるように、乱数は使わない）
function hash(a, b, salt) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------- 読み込みと、年の見積もり ----------
// data = { meta: buildings.json, bin: buildings.bin（ArrayBuffer） }。読めない形のときは null（呼ぶ側が、推定だけの町に切り替える）
export function readTown(geo, data) {
  const bin = data?.bin;
  const N = bin ? Math.floor(bin.byteLength / ROW) : 0;
  if (!N || bin.byteLength !== N * ROW || (data.meta?.count ?? N) !== N) return null;
  const dv = new DataView(bin);
  // 行（長方形）ごと：中心・長い辺・短い辺（地図の単位）と、長い辺の向き
  const X = new Float32Array(N), Z = new Float32Array(N), W = new Float32Array(N), D = new Float32Array(N), ANG = new Float32Array(N);
  const owner = new Int32Array(N);
  const lots = []; // 建物ごと
  for (let i = 0; i < N; i++) {
    const xi = dv.getInt16(i * 2, true), zi = dv.getInt16(N * 2 + i * 2, true);
    X[i] = xi * 0.5 / UNIT;
    Z[i] = zi * 0.5 / UNIT;
    W[i] = dv.getUint16(N * 4 + i * 2, true) * 0.1 / UNIT;
    D[i] = dv.getUint16(N * 6 + i * 2, true) * 0.1 / UNIT;
    ANG[i] = dv.getUint8(N * 12 + i) * Math.PI / 256;
    const kind = dv.getUint8(N * 13 + i);
    if (!(kind & PART) || !lots.length) {
      const yr = dv.getUint16(N * 10 + i * 2, true);
      lots.push({
        first: i, n: 0, area: 0, x: X[i], z: Z[i], xi, zi,
        h: Math.max(2.5, dv.getUint16(N * 8 + i * 2, true) * 0.1),
        year: yr & 0x7fff, yearGuess: (yr & YEAR_GUESS) !== 0,
        usage: kind & 15, struct: (kind >> 4) & 3,
        u: [1, 2, 3, 4, 5].map((s) => hash(xi, zi, s)),
        bornA: null,
      });
    }
    const b = lots[lots.length - 1];
    b.n++;
    b.area += W[i] * D[i] * UNIT * UNIT;
    owner[i] = lots.length - 1;
  }

  const { nx, ny } = geo;
  const cellLots = new Map(); // マス → そこにある建物
  for (const b of lots) {
    b.size = Math.sqrt(b.area);
    const k = b.k = geo.index(b.x, b.z);
    // 埋め立て地は、陸になってから。海のマスにかかる建物（マスが 60 m と粗いため）は、隣の陸のうち最後にできた所に合わせる
    let kl = k;
    if (k >= 0 && !geo.land[k]) {
      const i0 = k % nx, j0 = (k - i0) / nx;
      let latest = -Infinity;
      for (let j = Math.max(0, j0 - 1); j <= Math.min(ny - 1, j0 + 1); j++) for (let i = Math.max(0, i0 - 1); i <= Math.min(nx - 1, i0 + 1); i++) {
        const kk = j * nx + i;
        if (geo.land[kk] && geo.landYear[kk] > latest) { latest = geo.landYear[kk]; kl = kk; }
      }
    }
    const ly = kl >= 0 ? geo.landYear[kl] : -NEVER;
    b.step = kl >= 0 && geo.coastStep[kl] !== 255 ? geo.coastStep[kl] : 0;
    b.landed = ly < -1e4 ? -Infinity : ly + 1 + b.u[0] * 6;
    b.lateFill = ly > 1945;
    b.year2 = Math.min(Math.max(b.year, b.landed), NOW_YEAR - 3);
    if (k >= 0) { let a = cellLots.get(k); if (!a) cellLots.set(k, a = []); a.push(b); }
  }
  const around = (k, r, f) => {
    const i0 = k % nx, j0 = (k - i0) / nx;
    for (let j = Math.max(0, j0 - r); j <= Math.min(ny - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(nx - 1, i0 + r); i++) {
      const a = cellLots.get(j * nx + i);
      if (a) for (const b of a) f(b);
    }
  };
  const pct = (arr, p) => { arr.sort((a, b) => a - b); return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; };
  const ys = [];

  // 明治より前からの集落（geo.js の VILLAGES）：中心のまわりの、家の大きさの区画に、古い順に家を置く
  VILLAGES.forEach((v, vi) => {
    const [vx, vz] = geo.toXZ(v.lon, v.lat);
    const near = [];
    for (const b of lots) {
      if (b.bornA != null || b.area < 30 || b.area > 260 || b.landed !== -Infinity) continue; // 元からの陸だけ
      const d = Math.hypot(b.x - vx, b.z - vz);
      if (d <= v.r * 1.6) near.push({ b, d, order: d <= v.r ? hash(b.xi, b.zi, 20 + vi) : 1 + d });
    }
    near.sort((p, q) => p.order - q.order);
    for (const { b, d } of near.slice(0, v.n)) b.bornA = v.start + Math.min(1.5, d / v.r) * 160 * hash(b.xi, b.zi, 40 + vi);
  });

  // そのほかの区画：町がそこまで広がった年（港や駅からの広がりのモデルと、まわりに残るいちばん古い世代の建物の年の、早いほう）から、
  // 今の建物が建つ年までのどこかで、前の家が建ったと見なす
  const townYear = townYearFn(geo);
  const oldest = new Map();
  const oldestAround = (k) => { // まわり（およそ 150 m）の、年の記録がある建物のうち古いほうから 1 割めの年
    if (k < 0) return Infinity;
    let v = oldest.get(k);
    if (v === undefined) {
      ys.length = 0;
      around(k, 2, (b) => { if (!b.yearGuess) ys.push(b.year); });
      v = ys.length >= 4 ? pct(ys, 0.1) : Infinity;
      oldest.set(k, v);
    }
    return v;
  };
  for (const b of lots) {
    if (b.bornA == null) {
      b.bornA = NEVER;
      // 戦後の埋め立て地は、工場や倉庫のために造った土地。今の建物が最初の建物とする
      const lowland = !b.lateFill && geo.sample(geo.hm, b.x, b.z) < 60 && geo.slopeAt(b.x, b.z) < 0.22;
      const start = b.lateFill ? Infinity : Math.min(lowland ? townYear(b.x, b.z) : Infinity, oldestAround(b.k));
      const chance = b.area <= 400 ? 0.9 : b.area <= 1500 ? 0.6 : 0.35;
      if (start < b.year2 - 6 && b.u[1] < chance) b.bornA = Math.max(b.landed, start + (b.year2 - start) * b.u[2] * b.u[2] * 0.85);
    }
    if (!(b.bornA < b.year2 - 3)) b.bornA = NEVER;
    b.hA = 4.6 + 1.8 * b.u[3];              // 前の家の高さ（m）
    b.from = Math.min(b.bornA, b.year2);    // この区画に最初の建物が建つ年
  }

  // 地面の町の色に使う：マスごとの「町になった年」（まわり 3×3 マスの区画の 3 割が建ったころ）
  const field = new Float32Array(nx * ny).fill(NEVER);
  const seen = new Uint8Array(nx * ny);
  for (const k0 of cellLots.keys()) {
    const i0 = k0 % nx, j0 = (k0 - i0) / nx;
    for (let j = Math.max(0, j0 - 1); j <= Math.min(ny - 1, j0 + 1); j++) for (let i = Math.max(0, i0 - 1); i <= Math.min(nx - 1, i0 + 1); i++) {
      const k = j * nx + i;
      if (seen[k]) continue;
      seen[k] = 1;
      ys.length = 0;
      let area = 0;
      around(k, 1, (b) => { ys.push(b.from); area += b.area; });
      if (ys.length >= 10 || area >= 3000) field[k] = pct(ys, 0.3);
    }
  }

  // 場所から、そこに建つ建物を探すための表（40 m のます）
  const HC = 4, hashRows = new Map();
  const hkey = (i, j) => (j + 2048) * 4096 + (i + 2048);
  for (let i = 0; i < N; i++) {
    const r = Math.hypot(W[i], D[i]) / 2 + 2;
    for (let j = Math.floor((Z[i] - r) / HC); j <= Math.floor((Z[i] + r) / HC); j++) for (let ii = Math.floor((X[i] - r) / HC); ii <= Math.floor((X[i] + r) / HC); ii++) {
      const key = hkey(ii, j);
      let a = hashRows.get(key);
      if (!a) hashRows.set(key, a = []);
      a.push(i);
    }
  }

  return {
    N, X, Z, W, D, ANG, owner, lots, field,
    // その場所（まわり margin まで。2 以下）に建物が建つ年（建たなければ Infinity）
    lotYearAt(x, z, margin = 0) {
      const a = hashRows.get(hkey(Math.floor(x / HC), Math.floor(z / HC)));
      let y = Infinity;
      if (a) for (const i of a) {
        const dx = x - X[i], dz = z - Z[i], c = Math.cos(ANG[i]), s = Math.sin(ANG[i]);
        if (Math.abs(dx * c + dz * s) <= W[i] / 2 + margin && Math.abs(dz * c - dx * s) <= D[i] / 2 + margin) y = Math.min(y, lots[owner[i]].from);
      }
      return y;
    },
    // その年に建っている区画の数（確認用）
    countAt: (year) => lots.reduce((n, b) => n + (b.from <= year ? 1 : 0), 0),
  };
}

// ---------- 形 ----------
// 1 つの区画の形。x = 長い辺、z = 短い辺（どちらも -0.5〜0.5）、y は高さの段（0 = 土台の下、1 = 軒、2 = 棟）。
// 実際の大きさは頂点シェーダーが決める。切妻のときは棟が上がり、平らな屋根のときは棟が軒と同じ高さになって、ふたになる
function lotGeometry() {
  const P = [], NV = [], R = [], I = [];
  const add = (verts, n, roof) => {
    const o = P.length / 3;
    for (const v of verts) { P.push(...v); NV.push(...n); R.push(roof); }
    I.push(o, o + 1, o + 2);
    if (verts.length === 4) I.push(o, o + 2, o + 3);
  };
  // 壁
  add([[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]], [0, 0, 1], 0);
  add([[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]], [0, 0, -1], 0);
  add([[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]], [1, 0, 0], 0);
  add([[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]], [-1, 0, 0], 0);
  // 屋根（棟は長い辺の向き）
  add([[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 2, 0], [-0.5, 2, 0]], [0, 0.8, 0.6], 1);
  add([[0.5, 1, -0.5], [-0.5, 1, -0.5], [-0.5, 2, 0], [0.5, 2, 0]], [0, 0.8, -0.6], 1);
  // 妻の三角（壁の色）
  add([[0.5, 1, 0.5], [0.5, 1, -0.5], [0.5, 2, 0]], [1, 0, 0], 0);
  add([[-0.5, 1, -0.5], [-0.5, 1, 0.5], [-0.5, 2, 0]], [-1, 0, 0], 0);
  return {
    index: new THREE.BufferAttribute(new Uint16Array(I), 1),
    position: new THREE.BufferAttribute(new Float32Array(P), 3),
    normal: new THREE.BufferAttribute(new Float32Array(NV), 3),
    aRoof: new THREE.BufferAttribute(new Float32Array(R), 1),
  };
}

// 今の建物の見た目（屋根の形と壁の色）。用途と構造から決める
function lookOf(b, shortSide) {
  const light = b.struct <= 1; // 木造か、構造の記録なし
  let gable = 0, wall = pick(WALL_NEW, b.u[4]);
  if (b.usage === 7 || b.usage === 8) {
    // 工場・倉庫：ゆるい勾配の大きな屋根
    gable = shortSide <= 45 ? 0.3 : 0;
    wall = pick(WALL_SHED, b.u[4]);
  } else if (light && b.h <= 11 && shortSide <= 14) {
    // 家：切妻の屋根。戦前からの家は木と土壁の色
    gable = 1;
    if (b.year2 < 1950) wall = pick(WALL_OLD, b.u[4]);
  }
  // 戦前から残る、木造でない建物の半分は煉瓦色
  if (b.struct >= 2 && !b.yearGuess && b.year < 1940 && b.u[3] < 0.5) wall = WALL_BRICK;
  return { gable, wall };
}

// ---------- 町を置く ----------
export function buildRealTown(geo, shared, town) {
  const { X, Z, W, D, ANG, lots } = town;
  const group = new THREE.Group();
  group.name = 'town';
  const state = { detail: DETAIL };
  const uBH = { value: HEIGHT };

  // aTimes = (前の家が建つ年, 今の建物が建つ年, 陸になる段, 土台の高さ)、aDimA・aDimB = (長い辺, 高さ m, 短い辺[, 屋根の勾配 0〜1])
  const vCommon = `attribute vec4 aTimes; attribute vec3 aDimA; attribute vec4 aDimB; attribute vec3 aWallA; attribute vec3 aWallB; attribute float aRoof;
    uniform vec3 uRoofFlat; uniform vec3 uRoofTile; uniform float uCoast; uniform float uBH; ${HOLE_GLSL} varying vec3 vBCol;`;
  const vBegin = `
    float isB = step(aTimes.y, uYear);
    vec3 dim = mix(aDimA, aDimB.xyz, isB);
    float gable = mix(1.0, aDimB.w, isB);
    float born = mix(aTimes.x, aTimes.y, isB);
    float bs = smoothstep(born, born + 2.0, uYear) * clamp(uCoast - aTimes.z + 1.0, 0.0, 1.0);
    bs *= outsideHole(instanceMatrix[3].xz);
    float on = step(0.001, bs);
    float rise = gable * min(dim.z * 2.5, dim.y * 0.38);
    float eaveY = aTimes.w + (dim.y - rise) * uBH;
    float y = step(0.5, position.y) * eaveY + step(1.5, position.y) * rise * uBH;
    vec2 over = aRoof * step(0.5, gable) * 0.05 * sign(position.xz);
    transformed = vec3((position.x * dim.x + over.x) * on, y * bs, (position.z * dim.z + over.y) * on);
    vec3 wall = mix(aWallA, aWallB, isB);
    vBCol = mix(wall, mix(uRoofFlat, uRoofTile, gable) * (0.75 + 0.25 * wall), aRoof);`;
  const patch = yearPatch(shared, vCommon, vBegin, {
    uRoofFlat: { value: srgb(ROOF_FLAT) }, uRoofTile: { value: srgb(ROOF_TILE) }, uBH,
    uCoast: shared.uCoast, uHole: shared.uHole, uHoleR: shared.uHoleR,
  });
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    patch(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vBCol;');
  };
  mat.customProgramCacheKey = () => 'town-real';
  const depthMat = depthMaterialWith(patch, 'town-real');

  // かたまりに分ける。かたまりの中は大きい建物から並べる（小さいものから描くのをやめられるように）
  const cells = new Map();
  for (const b of lots) {
    const key = (Math.floor(b.x / CHUNK) + 64) * 128 + Math.floor(b.z / CHUNK) + 64;
    let a = cells.get(key);
    if (!a) cells.set(key, a = []);
    a.push(b);
  }
  const base = lotGeometry();
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const chunks = [], lo = new THREE.Vector3(), hi = new THREE.Vector3();
  for (const list of cells.values()) {
    list.sort((p, q) => q.size - p.size);
    const n = list.reduce((s, b) => s + b.n, 0);
    const g = new THREE.BufferGeometry();
    g.setIndex(base.index);
    g.setAttribute('position', base.position);
    g.setAttribute('normal', base.normal);
    g.setAttribute('aRoof', base.aRoof);
    const mesh = new THREE.InstancedMesh(g, mat, n);
    const M = mesh.instanceMatrix.array;
    const T = new Float32Array(n * 4), A = new Float32Array(n * 3), B = new Float32Array(n * 4);
    const CA = new Uint8Array(n * 3), CB = new Uint8Array(n * 3), sizes = new Float32Array(n);
    const box = new THREE.Box3();
    let r = 0, from = Infinity;
    for (const b of list) {
      const look = lookOf(b, D[b.first] * UNIT);
      const wallA = pick(b.bornA < 1950 ? WALL_OLD : WALL_NEW, b.u[3]);
      from = Math.min(from, b.from);
      for (let i = b.first; i < b.first + b.n; i++, r++) {
        const c = Math.cos(ANG[i]), s = Math.sin(ANG[i]), hw = W[i] / 2, hd = D[i] / 2;
        // 土台は、四隅と真ん中のうちいちばん低い地面の少し下から。壁の高さは真ん中の地面から測る
        const ground = Math.max(geo.heightAt(X[i], Z[i]), 0.1);
        let low = ground;
        for (const [sx, sz] of CORNERS) low = Math.min(low, Math.max(geo.heightAt(X[i] + sx * hw * c - sz * hd * s, Z[i] + sx * hw * s + sz * hd * c), 0));
        const y0 = low - 0.12;
        // 長い辺（形の x）を、向き (cos, sin)（東, 南）に合わせる。回すだけで、大きさはシェーダーが決める
        M.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, X[i], y0, Z[i], 1], r * 16);
        // 前の家は、建物のいちばん大きい長方形にだけ置く
        T.set([i === b.first ? b.bornA : NEVER, b.year2, b.step, ground - y0], r * 4);
        A.set([Math.min(Math.max(W[i], 0.55), 1.5), b.hA, Math.min(Math.max(D[i], 0.45), 1.0)], r * 3);
        B.set([W[i], b.h, D[i], look.gable], r * 4);
        CA.set(wallA, r * 3);
        CB.set(look.wall, r * 3);
        sizes[r] = b.size;
        const rad = Math.hypot(hw, hd) + 0.1;
        box.expandByPoint(lo.set(X[i] - rad, y0, Z[i] - rad));
        box.expandByPoint(hi.set(X[i] + rad, ground + b.h * Y_PER_M + 0.2, Z[i] + rad));
      }
    }
    g.setAttribute('aTimes', new THREE.InstancedBufferAttribute(T, 4));
    g.setAttribute('aDimA', new THREE.InstancedBufferAttribute(A, 3));
    g.setAttribute('aDimB', new THREE.InstancedBufferAttribute(B, 4));
    g.setAttribute('aWallA', new THREE.InstancedBufferAttribute(CA, 3, true));
    g.setAttribute('aWallB', new THREE.InstancedBufferAttribute(CB, 3, true));
    // 形はシェーダーが決めるので、画面に入るかどうかの判定に使う球は自分で決める
    mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    g.boundingSphere = mesh.boundingSphere.clone();
    mesh.customDepthMaterial = depthMat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    group.add(mesh);
    chunks.push({ mesh, box, sizes, n, from });
  }

  // 描く数を決める：かたまりごとに、カメラからの距離で「画面で detail px より小さくなる建物」を外す。
  // その年にまだ 1 つも建っていないかたまりは、まるごと描かない。数が変わったら true（影を描き直す合図）
  function update(camera, bufferHeight, year) {
    const pxPerM = bufferHeight / (2 * Math.tan(camera.fov * Math.PI / 360)) / UNIT; // 距離 1 のとき、1 m が何 px に見えるか
    let changed = false;
    for (const c of chunks) {
      let n = 0;
      if (year >= c.from) {
        const min = state.detail * Math.max(c.box.distanceToPoint(camera.position), 20) / pxPerM; // これより小さい建物（m）は描かない
        n = c.n;
        if (c.sizes[n - 1] < min) {
          let a = 0, z = n;
          while (a < z) { const m = (a + z) >> 1; if (c.sizes[m] >= min) a = m + 1; else z = m; }
          n = a;
        }
      }
      if (n !== c.mesh.count) { c.mesh.count = n; c.mesh.visible = n > 0; changed = true; }
    }
    return changed;
  }

  group.userData = {
    count: lots.length, rows: town.N, chunks, update, countAt: town.countAt,
    get detail() { return state.detail; },
    set detail(v) { state.detail = v; },
    get height() { return uBH.value; },
    set height(v) { uBH.value = v; },
    // 今描いている長方形の数（確認用）
    drawn: () => chunks.reduce((s, c) => s + (c.mesh.visible ? c.mesh.count : 0), 0),
  };
  return group;
}
