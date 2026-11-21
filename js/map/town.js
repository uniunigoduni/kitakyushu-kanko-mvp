// 門司区の町並み（現実の建物）。
//
// もとのデータは、国土交通省 Project PLATEAU の建築物（LOD1・北九州市 2020 年度）。tools/build_buildings.mjs が
// 建物を「向きのある長方形」（場所・大きさ・高さ・建てた年・用途・構造）にして data/buildings.bin に入れている。
//
// - 今の建物は、建てた年から出す（年の記録がない建物は、道具がまわりの建物から見積もった年）。
// - それより前のことは記録にない。そこで「この区画にはいつごろから建物があったか」をまわりの様子から見積もり、
//   その年から今の建物が建つまでのあいだ、「前の建物」を置く。家の大きさの区画には家を 1 軒、広い区画には家の並び、
//   工場・倉庫の区画と、戦前の埋め立て地の広い区画には倉庫。昔の町並みは見積もりで、史実の再現ではない。
// - 今の建物の長方形 1 つ、前の建物 1 つが、それぞれ 1 つのインスタンス。建つ年となくなる年を持ち、頂点シェーダーが出し入れする。
// - 数が多いので、1.5 km ごとのかたまりに分け、画面で小さくしか見えない建物は描かない。
//   前の建物は今の建物と別のメッシュにして、1 つも残っていない年には描かない。
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
const FILL = 35;            // 町が広がってきてから、区画が建物で埋まるまでの年数
const HOUSE_LOT = 260;      // これより広い区画（m2）の「前の建物」は、1 軒の家ではなく、家の並びか倉庫にする
const ROW_MAX = 24;         // 1 つの区画に並べる家の数の上限
const SHED_MAX = 12;        // 1 つの区画に並べる倉庫の数の上限

const srgb = (h) => new THREE.Color(h);
const bytes = (h) => { const c = srgb(h); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };
const WALL_OLD = ['#8a7560', '#9b8a74', '#d6cdbb', '#7a6a58'].map(bytes);             // 木と土壁
const WALL_NEW = ['#d3cfc6', '#c1bcb2', '#aeaaa2', '#d9d2c4', '#b8b6b0'].map(bytes);
const WALL_SHED = ['#b9b2a4', '#a99f8d', '#c4beb2'].map(bytes);                       // 倉庫・工場
const WALL_BRICK = bytes('#94584a');
const pick = (list, u) => list[Math.min(list.length - 1, Math.floor(u * list.length))];

// 屋根の種類。インスタンスの色の 4 つめに「種類 × 64 ＋ 濃さ（0〜63）」で入れる
const FLAT = 0, TILE = 1, THATCH = 2, SHEET = 3;
const ROOFS = { flat: '#b9b8b3', tile: '#4b4e57', thatch: '#8b7b5e', sheet: '#8a8b88' }; // 平らな屋根・瓦・茅・波板
const tone = (kind, u) => kind * 64 + Math.min(63, Math.floor(u * 64));

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
        u: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => hash(xi, zi, s)),
        village: null, // 集落の家が建つ年（集落の区画だけ）
        pre: [],       // 前の建物
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
      if (b.village != null || b.area < 30 || b.area > 260 || b.landed !== -Infinity) continue; // 元からの陸だけ
      const d = Math.hypot(b.x - vx, b.z - vz);
      if (d <= v.r * 1.6) near.push({ b, d, order: d <= v.r ? hash(b.xi, b.zi, 20 + vi) : 1 + d });
    }
    near.sort((p, q) => p.order - q.order);
    for (const { b, d } of near.slice(0, v.n)) b.village = v.start + Math.min(1.5, d / v.r) * 160 * hash(b.xi, b.zi, 40 + vi);
  });

  // ---- 前の建物（今の建物が建つ前に、その区画にあったと見なす建物） ----
  // b.pre に { x, z, w, d, ang, h, pitch, born, die, step, wall, tone, size } を足す。
  // i = 置く長方形の行、(lx, lz) = その中心からのずれ（長方形の向きで）、turn = 棟を短い辺の向きにする
  const add = (b, i, lx, lz, w, d, turn, born, die, h, pitch, wall, kind, u) => {
    if (!(born < die - 3)) return;
    const c = Math.cos(ANG[i]), s = Math.sin(ANG[i]);
    b.pre.push({
      x: X[i] + lx * c - lz * s, z: Z[i] + lx * s + lz * c, w, d, ang: ANG[i] + (turn ? Math.PI / 2 : 0),
      h, pitch, born, die, step: b.step, wall, tone: tone(kind, u), size: Math.sqrt(w * d) * UNIT,
    });
  };
  // 家：区画（か、そのます目）に収まる大きさの、切妻の家。明治の初めまでに建つ家の多くは茅ぶきで、のちに瓦の家に建て替わる
  const house = (b, i, lx, lz, cw, cd, born, salt) => {
    const u = (n) => hash(b.xi + salt * 131, b.zi - salt * 57, 60 + n);
    const turn = cd > cw;
    const w = Math.min(Math.max(turn ? cd : cw, 0.55), 1.5), d = Math.min(Math.max(turn ? cw : cd, 0.45), 1.0);
    const h = 4.6 + 1.8 * u(1), wall = (y) => pick(y < 1950 ? WALL_OLD : WALL_NEW, u(2));
    const thatch = born < 1880 && u(0) < (born < 1750 ? 0.95 : 0.7);
    const rebuilt = Math.max(born + 30, 1885 + 50 * u(4));
    if (thatch && rebuilt < b.year2 - 3) {
      add(b, i, lx, lz, w, d, turn, born, rebuilt, h, 1.45, wall(born), THATCH, u(3));
      add(b, i, lx, lz, w, d, turn, rebuilt, b.year2, h + 0.6, 1, wall(rebuilt), TILE, u(5));
    } else add(b, i, lx, lz, w, d, turn, born, b.year2, h, thatch ? 1.45 : 1, wall(born), thatch ? THATCH : TILE, u(3));
  };
  // 倉庫：ゆるい切妻の大きな建物。昭和の初めまでは瓦、そのあとは波板の屋根
  const shed = (b, i, lx, lz, cw, cd, born, salt) => {
    const u = (n) => hash(b.xi + salt * 131, b.zi - salt * 57, 80 + n);
    const turn = cd > cw, early = born < 1935;
    const wall = born < 1930 && u(0) < 0.3 ? WALL_BRICK : born < 1950 && u(0) < 0.7 ? pick(WALL_OLD, u(1)) : pick(WALL_SHED, u(1));
    add(b, i, lx, lz, turn ? cd : cw, turn ? cw : cd, turn, born, b.year2, 6 + 3 * u(2), early ? 0.6 : 0.3, wall, early ? TILE : SHEET, u(3));
  };

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
  let olds = 0;
  for (const b of lots) {
    const i0 = b.first;
    if (b.village != null) house(b, i0, 0, 0, W[i0], D[i0], b.village, 0); // 集落の家
    else if (!b.lateFill && b.area >= 30) {
      // 戦後の埋め立て地は、工場や倉庫のために造った土地。今の建物が最初の建物とする。物置ほどの小さな区画にも置かない。
      // 町がそこまで広がった年：港や駅からの広がりのモデル（低くて平らな土地だけ）と、まわりに残るいちばん古い世代の建物の年の、早いほう
      const reach = geo.sample(geo.hm, b.x, b.z) < 60 && geo.slopeAt(b.x, b.z) < 0.22 ? townYear(b.x, b.z) : Infinity;
      const inTown = reach !== Infinity, base = Math.max(Math.min(reach, oldestAround(b.k)), b.landed);
      const chance = inTown || b.area <= 400 ? 0.9 : b.area <= 1500 ? 0.6 : 0.35;
      if (base < b.year2 - 6 && b.u[1] < chance) {
        // 町が来てから（埋め立て地は陸になってから）FILL 年のうちに建つ。早いうちに建つ区画が多い
        const span = Math.min(b.year2 - base, FILL), bornOf = (u) => base + span * u * u;
        if (b.area <= HOUSE_LOT) house(b, i0, 0, 0, W[i0], D[i0], bornOf(b.u[2]), 0);
        else {
          // 広い区画：ます目に割って、家の並び（1 軒はおよそ 10 × 8.5 m）か、倉庫（およそ 70 × 22 m まで）を置く。
          // 区画のどこか 1 か所から、まわりへ建て増していく
          const works = b.usage === 7 || b.usage === 8;
          const sheds = (works && b.area > 400) || (b.landed !== -Infinity && b.area > 800 && b.u[5] < 0.5);
          const cells = [];
          for (let i = i0; i < i0 + b.n; i++) {
            if (W[i] < 0.5 || D[i] < 0.4) continue;
            const nc = Math.max(1, Math.round(W[i] / (sheds ? 7 : 1))), nr = Math.max(1, Math.round(D[i] / (sheds ? 2.2 : 0.85)));
            const cw = W[i] / nc, cd = D[i] / nr, c = Math.cos(ANG[i]), s = Math.sin(ANG[i]);
            for (let r = 0; r < nr; r++) for (let q = 0; q < nc; q++) {
              const lx = (q + 0.5) * cw - W[i] / 2, lz = (r + 0.5) * cd - D[i] / 2;
              cells.push({ i, lx, lz, cw, cd, x: X[i] + lx * c - lz * s, z: Z[i] + lx * s + lz * c, order: 0 });
            }
          }
          if (cells.length) {
            const a = cells[Math.floor(b.u[7] * cells.length)];
            cells.forEach((q, j) => { q.order = Math.hypot(q.x - a.x, q.z - a.z) + 0.8 * hash(b.xi + j * 131, b.zi, 50); });
            cells.sort((p, q) => p.order - q.order);
            const n = Math.min(cells.length, sheds ? SHED_MAX : ROW_MAX, Math.max(1, Math.round(cells.length * (sheds || inTown ? 0.85 : 0.5))));
            for (let j = 0; j < n; j++) {
              const q = cells[j], born = bornOf((j + hash(b.xi + j * 17, b.zi + j * 29, 51)) / n);
              if (sheds) shed(b, q.i, q.lx, q.lz, q.cw * 0.94, q.cd * 0.86, born, j + 1);
              else house(b, q.i, q.lx, q.lz, q.cw * 0.88, q.cd * 0.84, born, j + 1);
            }
          }
        }
      }
    }
    b.from = b.pre.reduce((y, p) => Math.min(y, p.born), b.year2); // この区画に最初の建物が建つ年
    olds += b.pre.length;
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
    olds, // 前の建物の数
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
    // その年に建っている区画の数と、その年に建っている前の建物の数（確認用）
    countAt: (year) => lots.reduce((n, b) => n + (b.from <= year ? 1 : 0), 0),
    oldAt: (year) => lots.reduce((n, b) => n + b.pre.reduce((m, p) => m + (p.born <= year && year < p.die ? 1 : 0), 0), 0),
  };
}

// ---------- 形 ----------
// 1 つの建物の形。x = 長い辺、z = 短い辺（どちらも -0.5〜0.5）、y は高さの段（0 = 土台の下、1 = 軒、2 = 棟）。
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

// 今の建物の見た目（屋根の形と種類、壁の色）。用途と構造から決める
function lookOf(b, shortSide) {
  const light = b.struct <= 1; // 木造か、構造の記録なし
  let pitch = 0, kind = FLAT, wall = pick(WALL_NEW, b.u[4]);
  if (b.usage === 7 || b.usage === 8) {
    // 工場・倉庫：ゆるい勾配の大きな屋根。戦前からのものは瓦の色
    const old = b.year2 < 1945;
    if (shortSide <= 45) { pitch = old ? 0.6 : 0.3; kind = old ? TILE : SHEET; }
    wall = pick(old && light ? WALL_OLD : WALL_SHED, b.u[4]);
  } else if (light && b.h <= 11 && shortSide <= 14) {
    // 家：切妻の屋根。戦前からの家は木と土壁の色
    pitch = 1; kind = TILE;
    if (b.year2 < 1950) wall = pick(WALL_OLD, b.u[4]);
  }
  // 戦前から残る、木造でない建物：大正の初めまでのものは煉瓦色、そのあとのものは 3 つに 1 つ
  if (b.struct >= 2 && !b.yearGuess && b.year < 1945 && (b.year < 1915 || b.u[3] < 0.35)) wall = WALL_BRICK;
  return { pitch, wall, tone: tone(kind, b.u[6]) };
}

// ---------- 町を置く ----------
export function buildRealTown(geo, shared, town) {
  const { X, Z, W, D, ANG, lots } = town;
  const group = new THREE.Group();
  group.name = 'town';
  const state = { detail: DETAIL };
  const uBH = { value: HEIGHT };
  const roofs = Object.fromEntries(Object.entries(ROOFS).map(([k, v]) => [k, { value: srgb(v) }]));

  // インスタンスごと：aTimes = (建つ年, なくなる年, 陸になる段, 土台の高さ)、aDim = (長い辺, 高さ m, 短い辺, 屋根の勾配)、
  // aWall = (壁の色, 屋根の種類 × 64 ＋ 濃さ)
  const vCommon = `attribute vec4 aTimes; attribute vec4 aDim; attribute vec4 aWall; attribute float aRoof;
    uniform vec3 uRoofFlat; uniform vec3 uRoofTile; uniform vec3 uRoofThatch; uniform vec3 uRoofSheet; uniform float uCoast; uniform float uBH; ${HOLE_GLSL} varying vec3 vBCol;`;
  const vBegin = `
    float bs = smoothstep(aTimes.x, aTimes.x + 2.0, uYear) * (1.0 - smoothstep(aTimes.y - 1.0, aTimes.y, uYear)) * clamp(uCoast - aTimes.z + 1.0, 0.0, 1.0);
    bs *= outsideHole(instanceMatrix[3].xz);
    float on = step(0.001, bs);
    float rise = aDim.w * min(aDim.z * 2.5, aDim.y * 0.38);
    float eaveY = aTimes.w + (aDim.y - rise) * uBH;
    float y = step(0.5, position.y) * eaveY + step(1.5, position.y) * rise * uBH;
    vec2 over = aRoof * step(0.5, aDim.w) * 0.05 * sign(position.xz);
    transformed = vec3((position.x * aDim.x + over.x) * on, y * bs, (position.z * aDim.z + over.y) * on);
    float bTone = aWall.a * 255.0 + 0.5, bKind = floor(bTone / 64.0);
    vec3 bRoof = mix(mix(uRoofFlat, uRoofTile, step(0.5, bKind)), mix(uRoofThatch, uRoofSheet, step(2.5, bKind)), step(1.5, bKind));
    vBCol = mix(aWall.rgb, bRoof * (0.84 + 0.3 * (bTone - bKind * 64.0) / 64.0), aRoof);`;
  const patch = yearPatch(shared, vCommon, vBegin, {
    uRoofFlat: roofs.flat, uRoofTile: roofs.tile, uRoofThatch: roofs.thatch, uRoofSheet: roofs.sheet, uBH,
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

  // かたまりに分ける。今の建物（長方形ごと）と前の建物を、別の並びにする
  const cells = new Map();
  for (const b of lots) {
    const key = (Math.floor(b.x / CHUNK) + 64) * 128 + Math.floor(b.z / CHUNK) + 64;
    let cell = cells.get(key);
    if (!cell) cells.set(key, cell = { now: [], old: [] });
    const look = lookOf(b, D[b.first] * UNIT);
    for (let i = b.first; i < b.first + b.n; i++) {
      cell.now.push({ x: X[i], z: Z[i], w: W[i], d: D[i], ang: ANG[i], h: b.h, pitch: look.pitch, born: b.year2, die: NEVER, step: b.step, wall: look.wall, tone: look.tone, size: b.size });
    }
    for (const p of b.pre) cell.old.push(p);
  }
  const base = lotGeometry();
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const chunks = [], lo = new THREE.Vector3(), hi = new THREE.Vector3();
  // 1 つの並びを 1 つのメッシュにする。大きいものから並べる（小さいものから描くのをやめられるように）
  const makeMesh = (list) => {
    const n = list.length;
    if (!n) return;
    list.sort((p, q) => q.size - p.size);
    const g = new THREE.BufferGeometry();
    g.setIndex(base.index);
    g.setAttribute('position', base.position);
    g.setAttribute('normal', base.normal);
    g.setAttribute('aRoof', base.aRoof);
    const mesh = new THREE.InstancedMesh(g, mat, n);
    const M = mesh.instanceMatrix.array;
    const T = new Float32Array(n * 4), DM = new Float32Array(n * 4), C = new Uint8Array(n * 4), sizes = new Float32Array(n);
    const box = new THREE.Box3();
    let from = Infinity, until = -Infinity;
    list.forEach((p, r) => {
      const c = Math.cos(p.ang), s = Math.sin(p.ang), hw = p.w / 2, hd = p.d / 2;
      // 土台は、四隅と真ん中のうちいちばん低い地面の少し下から。壁の高さは真ん中の地面から測る
      const ground = Math.max(geo.heightAt(p.x, p.z), 0.1);
      let low = ground;
      for (const [sx, sz] of CORNERS) low = Math.min(low, Math.max(geo.heightAt(p.x + sx * hw * c - sz * hd * s, p.z + sx * hw * s + sz * hd * c), 0));
      const y0 = low - 0.12;
      // 長い辺（形の x）を、向き (cos, sin)（東, 南）に合わせる。回すだけで、大きさはシェーダーが決める
      M.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, p.x, y0, p.z, 1], r * 16);
      T.set([p.born, p.die, p.step, ground - y0], r * 4);
      DM.set([p.w, p.h, p.d, p.pitch], r * 4);
      C.set(p.wall, r * 4);
      C[r * 4 + 3] = p.tone;
      sizes[r] = p.size;
      const rad = Math.hypot(hw, hd) + 0.1;
      box.expandByPoint(lo.set(p.x - rad, y0, p.z - rad));
      box.expandByPoint(hi.set(p.x + rad, ground + p.h * Y_PER_M + 0.2, p.z + rad));
      from = Math.min(from, p.born);
      until = Math.max(until, p.die);
    });
    g.setAttribute('aTimes', new THREE.InstancedBufferAttribute(T, 4));
    g.setAttribute('aDim', new THREE.InstancedBufferAttribute(DM, 4));
    g.setAttribute('aWall', new THREE.InstancedBufferAttribute(C, 4, true));
    // 形はシェーダーが決めるので、画面に入るかどうかの判定に使う球は自分で決める
    mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    g.boundingSphere = mesh.boundingSphere.clone();
    mesh.customDepthMaterial = depthMat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    group.add(mesh);
    chunks.push({ mesh, box, sizes, n, from, until });
  };
  for (const cell of cells.values()) { makeMesh(cell.now); makeMesh(cell.old); }

  // 描く数を決める：かたまりごとに、カメラからの距離で「画面で detail px より小さくなる建物」を外す。
  // その年に 1 つも建っていないかたまり（まだ建っていない・もう残っていない）は、まるごと描かない。数が変わったら true（影を描き直す合図）
  function update(camera, bufferHeight, year) {
    const pxPerM = bufferHeight / (2 * Math.tan(camera.fov * Math.PI / 360)) / UNIT; // 距離 1 のとき、1 m が何 px に見えるか
    let changed = false;
    for (const c of chunks) {
      let n = 0;
      if (year >= c.from && year < c.until) {
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
    count: lots.length, rows: town.N, olds: town.olds, chunks, update, countAt: town.countAt, oldAt: town.oldAt,
    get detail() { return state.detail; },
    set detail(v) { state.detail = v; },
    get height() { return uBH.value; },
    set height(v) { uBH.value = v; },
    // 今描いているインスタンスの数（確認用）
    drawn: () => chunks.reduce((s, c) => s + (c.mesh.visible ? c.mesh.count : 0), 0),
    // 屋根の色を変える（確認用）。name = flat / tile / thatch / sheet
    roof: (name, hex) => { roofs[name].value.set(hex); },
  };
  return group;
}
