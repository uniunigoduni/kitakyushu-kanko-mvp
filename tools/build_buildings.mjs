#!/usr/bin/env node
// PLATEAU（国土交通省）の門司区の建築物（LOD1・3D Tiles）から、地図に並べる建物の一覧を作る。
//   出力: data/buildings.bin（1 行 14 バイトの表）と data/buildings.json（表の読み方・出典・集計）
//
// 使い方（draco3d を入れた作業フォルダで実行する。リポジトリの中には node_modules もタイルも置かない）:
//   mkdir work && cd work && npm install draco3d
//   node <リポジトリ>/tools/build_buildings.mjs
//       … タイルを ./plateau_moji_lod1 に取ってきて（約 145 MB。2 回目からは取り直さない）変換する
//   node <リポジトリ>/tools/build_buildings.mjs --tiles <フォルダ> --out <フォルダ> --dump <調べ用.json> --no-download
//
// 元データ: 3D都市モデル（Project PLATEAU）北九州市（2020年度）の建築物 LOD1（門司区）。測量は 2016 年。
//   https://www.geospatial.jp/ckan/dataset/plateau-40100-kitakyushu-shi-2020
// 取ってきたタイルはデータとして読むだけで、実行しない。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const TILESET = 'https://assets.cms.plateau.reearth.io/assets/51/b0eef2-b883-42b7-a140-82e6a6b16a30/40100_kitakyushu-shi_city_2020_citygml_7_op_bldg_3dtiles_40101_moji-ku_lod1/tileset.json';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const opt = { tiles: path.resolve('plateau_moji_lod1'), out: path.join(REPO, 'data'), dump: null, download: true, minArea: 10 };
for (let a = process.argv.slice(2), i = 0; i < a.length; i++) {
  if (a[i] === '--tiles') opt.tiles = path.resolve(a[++i]);
  else if (a[i] === '--out') opt.out = path.resolve(a[++i]);
  else if (a[i] === '--dump') opt.dump = path.resolve(a[++i]);
  else if (a[i] === '--min-area') opt.minArea = Number(a[++i]);
  else if (a[i] === '--no-download') opt.download = false;
  else { console.error('分からない指定: ' + a[i]); process.exit(1); }
}

let draco3d;
try {
  draco3d = createRequire(path.join(process.cwd(), 'noop.js'))('draco3d');
} catch {
  console.error('draco3d が見つかりません。作業フォルダで npm install draco3d を実行し、そのフォルダで動かしてください。');
  process.exit(1);
}

// 地図の座標（m。地形の中心から東が +x、南が +z）。js/map/geo.js の toXZ と同じ式
const terrain = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'terrain.json'), 'utf8'));
const CENTER = terrain.center, M_LON = terrain.mPerDegLon, M_LAT = terrain.mPerDegLat;

// 表に入れる用途・構造の番号（js/map/town.js と同じ並び）
const USAGE = ['住宅', '店舗等併用住宅', '共同住宅', '商業施設', '業務施設', '文教厚生施設', '官公庁施設', '工場', '運輸倉庫施設', '農林漁業用施設', 'その他'];
const USAGE_OF = {
  住宅: 0, 店舗等併用住宅: 1, 作業所併用住宅: 1, 共同住宅: 2, 店舗等併用共同住宅: 2, 商業施設: 3, 商業系複合施設: 3, 宿泊施設: 3,
  業務施設: 4, 文教厚生施設: 5, 官公庁施設: 6, 工場: 7, 供給処理施設: 7, 運輸倉庫施設: 8, 農林漁業用施設: 9,
};
const STRUCT = ['不明', '木造・土蔵造', '非木造', '鉄筋コンクリート造'];
const STRUCT_OF = { '木造・土蔵造': 1, 非木造: 2, 鉄筋コンクリート造: 3 };
const PART = 0x80, H_GUESS = 0x40, YEAR_GUESS = 0x8000;

// ---------- タイルを取ってくる ----------
async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'plateau-tiles-fetch' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw new Error(`${url} を取れない: ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}
async function tileFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tsPath = path.join(dir, 'tileset.json');
  if (!fs.existsSync(tsPath)) {
    if (!opt.download) throw new Error(tsPath + ' が無い（--no-download を外すと取りにいく）');
    fs.writeFileSync(tsPath, await get(TILESET));
  }
  const list = [];
  (function walk(t, depth) {
    const uri = t.content?.uri ?? t.content?.url;
    if (uri) list.push({ uri, depth });
    for (const c of t.children ?? []) walk(c, depth + 1);
  })(JSON.parse(fs.readFileSync(tsPath, 'utf8')).root, 0);
  for (const t of list) {
    // 保存する名前は英数字と . _ - だけにする（取ってきた一覧に書かれた名前をそのまま道に使わない）
    t.name = t.uri.replace(/[\\/]/g, '_');
    if (!/^[A-Za-z0-9._-]+\.b3dm$/.test(t.name) || t.name.includes('..')) throw new Error('タイルの名前が想定外: ' + t.uri);
    t.file = path.join(dir, t.name);
  }
  const todo = list.filter((t) => !fs.existsSync(t.file));
  if (todo.length) {
    if (!opt.download) throw new Error(`タイルが ${todo.length} 枚足りない`);
    console.log(`タイルを取ってくる: ${todo.length} / ${list.length} 枚`);
    let next = 0, done = 0, bytes = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < todo.length) {
        const t = todo[next++];
        const buf = await get(new URL(t.uri, TILESET).href);
        if (buf.toString('latin1', 0, 4) !== 'b3dm') throw new Error('b3dm ではない: ' + t.uri);
        fs.writeFileSync(t.file + '.part', buf);
        fs.renameSync(t.file + '.part', t.file);
        bytes += buf.length;
        if (++done % 20 === 0 || done === todo.length) console.log(`  ${done} / ${todo.length} 枚（${(bytes / 1e6).toFixed(0)} MB）`);
      }
    }));
  }
  // 細かいタイルを先に読む（同じ建物が粗いタイルにも入っていたら、細かい方を使う）
  return list.sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));
}

// ---------- b3dm（属性の表 ＋ Draco で圧縮した glb）を開く ----------
const WGS_A = 6378137, WGS_F = 1 / 298.257222101, WGS_E2 = WGS_F * (2 - WGS_F);
function ecefToLLH(X, Y, Z) {
  const lon = Math.atan2(Y, X), p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - WGS_E2)), h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat), N = WGS_A / Math.sqrt(1 - WGS_E2 * s * s);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(Z, p * (1 - WGS_E2 * N / (N + h)));
  }
  return [lon * 180 / Math.PI, lat * 180 / Math.PI, h];
}
const FMT = {
  BYTE: [1, (dv, o) => dv.getInt8(o)], UNSIGNED_BYTE: [1, (dv, o) => dv.getUint8(o)],
  SHORT: [2, (dv, o) => dv.getInt16(o, true)], UNSIGNED_SHORT: [2, (dv, o) => dv.getUint16(o, true)],
  INT: [4, (dv, o) => dv.getInt32(o, true)], UNSIGNED_INT: [4, (dv, o) => dv.getUint32(o, true)],
  FLOAT: [4, (dv, o) => dv.getFloat32(o, true)], DOUBLE: [8, (dv, o) => dv.getFloat64(o, true)],
};
function readB3dm(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('latin1', 0, 4) !== 'b3dm') throw new Error('b3dm ではない');
  const ftj = dv.getUint32(12, true), ftb = dv.getUint32(16, true), btj = dv.getUint32(20, true), btb = dv.getUint32(24, true);
  let p = 28;
  const ft = ftj ? JSON.parse(buf.toString('utf8', p, p + ftj)) : {};
  p += ftj + ftb;
  const bt = btj ? JSON.parse(buf.toString('utf8', p, p + btj)) : {};
  const bin0 = p + btj, n = ft.BATCH_LENGTH ?? 0;
  const col = (name) => {
    const v = bt[name];
    if (v == null) return null;
    if (Array.isArray(v)) return v;
    const [size, read] = FMT[v.componentType];
    return Array.from({ length: n }, (_, i) => read(dv, bin0 + v.byteOffset + i * size));
  };
  const g0 = bin0 + btb;
  if (buf.toString('latin1', g0, g0 + 4) !== 'glTF') throw new Error('glb が見つからない');
  const glen = dv.getUint32(g0 + 8, true);
  let gltf = null, bin = null;
  for (let q = g0 + 12; q < g0 + glen;) {
    const clen = dv.getUint32(q, true), ctype = dv.getUint32(q + 4, true);
    if (ctype === 0x4e4f534a) gltf = JSON.parse(buf.toString('utf8', q + 8, q + 8 + clen));
    else if (ctype === 0x004e4942) bin = buf.subarray(q + 8, q + 8 + clen);
    q += 8 + clen;
  }
  return { n, col, gltf, bin };
}
function decodeDraco(dm, data, ids) {
  const decoder = new dm.Decoder(), b = new dm.DecoderBuffer();
  b.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
  if (decoder.GetEncodedGeometryType(b) !== dm.TRIANGULAR_MESH) throw new Error('三角形の面ではない');
  const mesh = new dm.Mesh(), st = decoder.DecodeBufferToMesh(b, mesh);
  if (!st.ok() || mesh.ptr === 0) throw new Error('Draco を開けない: ' + st.error_msg());
  const nf = mesh.num_faces(), np = mesh.num_points();
  const iptr = dm._malloc(nf * 12);
  decoder.GetTrianglesUInt32Array(mesh, nf * 12, iptr);
  const index = new Uint32Array(dm.HEAPU32.buffer, iptr, nf * 3).slice();
  dm._free(iptr);
  const floats = (uid, comps) => {
    const nb = np * comps * 4, ptr = dm._malloc(nb);
    decoder.GetAttributeDataArrayForAllPoints(mesh, decoder.GetAttributeByUniqueId(mesh, uid), dm.DT_FLOAT32, nb, ptr);
    const out = new Float32Array(dm.HEAPF32.buffer, ptr, np * comps).slice();
    dm._free(ptr);
    return out;
  };
  const pos = floats(ids.POSITION, 3), bid = floats(ids._BATCHID, 1);
  dm.destroy(mesh); dm.destroy(decoder); dm.destroy(b);
  return { index, pos, bid, np, nf };
}

// ---------- 形 ----------
// 凸包（Andrew の方法）。点は [x, z] の並び
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// 面積がいちばん小さい外接長方形（凸包の辺に沿わせて調べる）。s は辺の向き (ux, uz)、t はそれに直角 (-uz, ux)
function minRect(h) {
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const q of h) {
      const s = q[0] * ux + q[1] * uz, t = -q[0] * uz + q[1] * ux;
      if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, s0, s1, t0, t1 };
  }
  return best;
}
// L 字・コの字・中庭のある建物を、外接長方形の向きにそろえた長方形いくつかに分ける。
// tris は屋根の三角形（外接長方形の角を原点にした s, t）。細かいマスに塗ってから、いちばん大きい長方形を順に取る
const MAX_PARTS = 5;
function splitRects(tris, w, d) {
  const c = Math.min(4, Math.max(0.5, Math.max(w, d) / 64));
  const nx = Math.max(1, Math.round(w / c)), ny = Math.max(1, Math.round(d / c)), cw = w / nx, ch = d / ny;
  const g = new Uint8Array(nx * ny);
  for (const [ax, ay, bx, by, cx, cy] of tris) {
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / cw)), i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) / cw));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / ch)), j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy) / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * cw, py = (j + 0.5) * ch;
      const e0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax), e1 = (cx - bx) * (py - by) - (cy - by) * (px - bx), e2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
      if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) g[j * nx + i] = 1;
    }
  }
  let total = 0;
  for (const v of g) total += v;
  if (!total) return null;
  const rects = [], hgt = new Int32Array(nx), stack = [];
  let left = total;
  while (rects.length < MAX_PARTS) {
    hgt.fill(0);
    let best = null;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) hgt[i] = g[j * nx + i] ? hgt[i] + 1 : 0;
      // 柱の並びの中でいちばん大きい長方形
      stack.length = 0;
      for (let i = 0; i <= nx; i++) {
        const h = i < nx ? hgt[i] : 0;
        let start = i;
        while (stack.length && stack.at(-1)[1] >= h) {
          const [si, sh] = stack.pop();
          if (!best || sh * (i - si) > best.cells) best = { cells: sh * (i - si), i0: si, i1: i - 1, j0: j - sh + 1, j1: j };
          start = si;
        }
        if (h > 0) stack.push([start, h]);
      }
    }
    if (!best || best.cells < Math.max(1, total * 0.04) || best.cells * cw * ch < 9) break;
    for (let j = best.j0; j <= best.j1; j++) g.fill(0, j * nx + best.i0, j * nx + best.i1 + 1);
    left -= best.cells;
    rects.push({ s: (best.i0 + best.i1 + 1) / 2 * cw, t: (best.j0 + best.j1 + 1) / 2 * ch, w: (best.i1 - best.i0 + 1) * cw, d: (best.j1 - best.j0 + 1) * ch });
    if (left < total * 0.06) break;
  }
  return { rects, covered: 1 - left / total, painted: total * cw * ch };
}

// ---------- 読む ----------
const dm = await draco3d.createDecoderModule({});
const files = await tileFiles(opt.tiles);
const seen = new Map();
const t0 = Date.now();
let dup = 0, nv = 0, nt = 0, boundsErr = 0;
for (const tile of files) {
  const t = readB3dm(fs.readFileSync(tile.file));
  if (!t.n) continue;
  const g = t.gltf, prim = g.meshes[0].primitives[0];
  if (g.meshes.length !== 1 || g.meshes[0].primitives.length !== 1) throw new Error('メッシュが1つではない: ' + tile.name);
  for (const node of g.nodes ?? []) {
    const same = !node.matrix || node.matrix.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
    if (!same || node.translation || node.rotation || node.scale) throw new Error('ノードに変形がある: ' + tile.name);
  }
  const ext = prim.extensions.KHR_draco_mesh_compression, bv = g.bufferViews[ext.bufferView];
  const m = decodeDraco(dm, t.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), ext.attributes);
  const c = g.extensions.CESIUM_RTC.center;
  nv += m.np; nt += m.nf;
  // 頂点 → 地図の座標（m）と高さ。glTF は y が上なので、地心の座標へは (x, -z, y) で戻す
  const X = new Float64Array(m.np), Z = new Float64Array(m.np), H = new Float64Array(m.np), LON = new Float64Array(m.np), LAT = new Float64Array(m.np);
  for (let i = 0; i < m.np; i++) {
    const [lon, lat, h] = ecefToLLH(c[0] + m.pos[i * 3], c[1] - m.pos[i * 3 + 2], c[2] + m.pos[i * 3 + 1]);
    LON[i] = lon; LAT[i] = lat; H[i] = h;
    X[i] = (lon - CENTER.lon) * M_LON; Z[i] = -(lat - CENTER.lat) * M_LAT;
  }
  const tris = Array.from({ length: t.n }, () => []);
  for (let k = 0; k < m.nf; k++) tris[Math.round(m.bid[m.index[k * 3]])].push(k);
  const ids = t.col('gml_id'), years = t.col('bldg:yearOfConstruction'), mh = t.col('bldg:measuredHeight'), st = t.col('bldg:storeysAboveGround');
  const usage = t.col('bldg:usage'), struct = t.col('uro:BuildingDetailAttribute_uro:buildingStructureType');
  const bx0 = t.col('_xmin'), bx1 = t.col('_xmax'), by0 = t.col('_ymin'), by1 = t.col('_ymax');
  for (let b = 0; b < t.n; b++) {
    if (seen.has(ids[b])) { dup++; continue; }
    const vs = new Set(), tops = [];
    let area = 0, cx = 0, cz = 0;
    for (const k of tris[b]) {
      const i0 = m.index[k * 3], i1 = m.index[k * 3 + 1], i2 = m.index[k * 3 + 2];
      vs.add(i0); vs.add(i1); vs.add(i2);
      // 水平面に落とした面積（符号つき。東 x・北 -z で反時計回りなら上向き）と、傾きを入れた面積
      const a2 = (X[i1] - X[i0]) * (-(Z[i2] - Z[i0])) - (-(Z[i1] - Z[i0])) * (X[i2] - X[i0]);
      const ux = X[i1] - X[i0], uy = H[i1] - H[i0], uz = Z[i1] - Z[i0], vx = X[i2] - X[i0], vy = H[i2] - H[i0], vz = Z[i2] - Z[i0];
      const a3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (a3 < 1e-9 || a2 / a3 < 0.7) continue; // 壁と底
      const a = a2 / 2;
      area += a; cx += a * (X[i0] + X[i1] + X[i2]) / 3; cz += a * (Z[i0] + Z[i1] + Z[i2]) / 3;
      tops.push(i0, i1, i2);
    }
    seen.set(ids[b], null);
    if (!vs.size) continue;
    let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
    for (const i of vs) { lon0 = Math.min(lon0, LON[i]); lon1 = Math.max(lon1, LON[i]); lat0 = Math.min(lat0, LAT[i]); lat1 = Math.max(lat1, LAT[i]); }
    // 属性に付いている範囲と、形から求めた範囲の差（読み違いの検査）
    if (bx0) boundsErr = Math.max(boundsErr, Math.abs(lon0 - bx0[b]) * M_LON, Math.abs(lon1 - bx1[b]) * M_LON, Math.abs(lat0 - by0[b]) * M_LAT, Math.abs(lat1 - by1[b]) * M_LAT);
    const r = minRect(hull([...vs].map((i) => [X[i], Z[i]])));
    if (!r) continue;
    const w = r.s1 - r.s0, d = r.t1 - r.t0;
    const world = (s, tt) => [s * r.ux - tt * r.uz, s * r.uz + tt * r.ux];
    const base = Math.atan2(r.uz, r.ux);
    const box = (s, tt, bw, bd) => {
      const [x, z] = world(s, tt);
      return bw >= bd ? { x, z, w: bw, d: bd, ang: base } : { x, z, w: bd, d: bw, ang: base + Math.PI / 2 };
    };
    if (!(area > 0)) area = r.area;
    const fill = Math.min(1, area / r.area);
    // 長方形に近い建物は、面積が合うように外接長方形を少し縮めて 1 つの箱にする。
    // 形が外接長方形から大きく外れる建物は、いくつかの長方形に分ける
    let parts = null, split = null;
    if (fill < 0.8 && area >= 80) {
      const local = [];
      for (let i = 0; i < tops.length; i += 3) {
        const q = [];
        for (let e = 0; e < 3; e++) { const v = tops[i + e]; q.push(X[v] * r.ux + Z[v] * r.uz - r.s0, -X[v] * r.uz + Z[v] * r.ux - r.t0); }
        local.push(q);
      }
      split = splitRects(local, w, d);
      if (split && split.rects.length && split.covered >= 0.7) parts = split.rects.map((p) => box(r.s0 + p.s, r.t0 + p.t, p.w, p.d));
    }
    if (!parts) {
      const k = Math.sqrt(fill);
      const mid = area > 0 && cx !== 0 ? [cx / area, cz / area] : world((r.s0 + r.s1) / 2, (r.t0 + r.t1) / 2);
      parts = [{ ...box(0, 0, w * k, d * k), x: mid[0], z: mid[1] }];
    }
    const yr = years ? years[b] : null, height = mh ? mh[b] : null, floors = st ? st[b] : null;
    seen.set(ids[b], {
      parts, area, fill, rectW: Math.max(w, d), rectD: Math.min(w, d),
      year: Number.isInteger(yr) && yr >= 1850 && yr <= 2020 ? yr : 0,
      mh: typeof height === 'number' && height > 0 ? height : 0,
      floors: Number.isInteger(floors) && floors > 0 ? floors : 0,
      usage: usage ? usage[b] : null, struct: struct ? struct[b] : null,
      split: split ? { n: split.rects.length, covered: split.covered } : null,
    });
  }
}
const all = [...seen.values()].filter(Boolean);
console.log(`タイル ${files.length} 枚  頂点 ${nv}  三角形 ${nt}  建物 ${all.length}  同じ建物の重なり ${dup}  ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
console.log(`形から求めた範囲と、属性の範囲の差の最大: ${boundsErr.toFixed(3)} m`);

// ---------- 高さ・年を決める ----------
// 地形の格子（60 m）の外、門司区の外に出るものは使わない
const { nx: GX, ny: GY, width: GW, depth: GD } = terrain;
const tbuf = fs.readFileSync(path.join(REPO, 'data', 'terrain.bin'));
const landRaw = new Int16Array(tbuf.buffer.slice(tbuf.byteOffset, tbuf.byteOffset + GX * GY * 2)), wardMask = tbuf.subarray(GX * GY * 2, GX * GY * 3);
const cellOf = (x, z) => {
  const i = Math.round((x + GW / 2) / (GW / (GX - 1))), j = Math.round((z + GD / 2) / (GD / (GY - 1)));
  return i < 0 || j < 0 || i >= GX || j >= GY ? -1 : j * GX + i;
};
let outside = 0, small = 0, onSea = 0, noHeight = 0;
const rows = [];
for (const b of all) {
  const [p] = b.parts, k = cellOf(p.x, p.z);
  if (k < 0 || !wardMask[k]) { outside++; continue; }
  if (b.area < opt.minArea) { small++; continue; }
  if (landRaw[k] === -32768) onSea++;
  // 高さ：計測した高さ。無ければ階数 × 3 m ＋ 1 m。それも無ければ、小屋は 3.5 m・ほかは 6.5 m とみなす
  b.hGuess = !b.mh;
  b.h = b.mh || (b.floors ? b.floors * 3 + 1 : b.area < 30 ? 3.5 : 6.5);
  if (b.hGuess) noHeight++;
  rows.push(b);
}
// 建てた年の記録が無い建物は、近くの記録がある建物からもらう（近い 8 棟までの中から、場所で決まる 1 棟）
const CELL = 100, dated = new Map();
const key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
for (const b of rows) if (b.year) { const k = key(b.parts[0].x, b.parts[0].z); if (!dated.has(k)) dated.set(k, []); dated.get(k).push(b); }
const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
let guessed = 0, alone = 0;
const allYears = rows.filter((b) => b.year).map((b) => b.year).sort((a, b) => a - b), median = allYears[allYears.length >> 1];
for (const b of rows) {
  if (b.year) continue;
  const { x, z } = b.parts[0];
  let near = [];
  for (const reach of [1, 2, 4]) {
    near = [];
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let j = cj - reach; j <= cj + reach; j++) for (let i = ci - reach; i <= ci + reach; i++) {
      for (const o of dated.get(i + ',' + j) ?? []) {
        const dist = Math.hypot(o.parts[0].x - x, o.parts[0].z - z);
        if (dist <= reach * CELL * 1.5) near.push([dist, o.year]);
      }
    }
    if (near.length >= 3) break;
  }
  near.sort((a, b) => a[0] - b[0]);
  if (near.length) b.yearGuess = near[Math.min(near.length, 8) * hash(x, z) | 0][1];
  else { b.yearGuess = median; alone++; }
  guessed++;
}

// ---------- 書き出す ----------
// 大きい建物から並べる（遠くから見るときは前の方だけ描けるように）。分けた建物の 2 つ目からは PART の印
rows.sort((a, b) => b.area - a.area);
const recs = [];
for (const b of rows) {
  const kind = (USAGE_OF[b.usage] ?? 10) | (STRUCT_OF[b.struct] ?? 0) << 4 | (b.hGuess ? H_GUESS : 0);
  b.parts.forEach((p, i) => recs.push({
    x: Math.round(p.x * 2), z: Math.round(p.z * 2), w: Math.round(p.w * 10), d: Math.round(p.d * 10), h: Math.round(b.h * 10),
    year: b.year || (b.yearGuess | YEAR_GUESS), ang: Math.round((((p.ang % Math.PI) + Math.PI) % Math.PI) / Math.PI * 256) & 255, kind: kind | (i ? PART : 0),
  }));
}
const N = recs.length, bin = Buffer.alloc(N * 14), dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
recs.forEach((r, i) => {
  if (Math.abs(r.x) > 32767 || Math.abs(r.z) > 32767 || r.w > 65535 || r.d > 65535 || r.h > 65535) throw new Error('表に入らない値: ' + JSON.stringify(r));
  dv.setInt16(i * 2, r.x, true); dv.setInt16(N * 2 + i * 2, r.z, true);
  dv.setUint16(N * 4 + i * 2, r.w, true); dv.setUint16(N * 6 + i * 2, r.d, true);
  dv.setUint16(N * 8 + i * 2, r.h, true); dv.setUint16(N * 10 + i * 2, r.year, true);
  dv.setUint8(N * 12 + i, r.ang); dv.setUint8(N * 13 + i, r.kind);
});
const count = (f) => rows.reduce((n, b) => n + (f(b) ? 1 : 0), 0);
const meta = {
  count: N,
  buildings: rows.length,
  source: '国土交通省 Project PLATEAU「3D都市モデル 北九州市（2020年度）」建築物 LOD1・門司区（加工して作成）',
  sourceUrl: 'https://www.geospatial.jp/ckan/dataset/plateau-40100-kitakyushu-shi-2020',
  surveyYear: 2016,
  layout: '同じ項目を count 個ずつ、次の順に並べる（リトルエンディアン）。大きい建物から順',
  fields: [
    { name: 'x', type: 'int16', scale: 0.5, unit: 'm', note: '地形の中心から東へ' },
    { name: 'z', type: 'int16', scale: 0.5, unit: 'm', note: '地形の中心から南へ' },
    { name: 'w', type: 'uint16', scale: 0.1, unit: 'm', note: '長い辺' },
    { name: 'd', type: 'uint16', scale: 0.1, unit: 'm', note: '短い辺' },
    { name: 'h', type: 'uint16', scale: 0.1, unit: 'm', note: '地面からの高さ' },
    { name: 'year', type: 'uint16', note: '建てた年。0x8000 が立っていれば、近くの建物からの推定' },
    { name: 'ang', type: 'uint8', scale: Math.PI / 256, unit: 'rad', note: '長い辺の向き（東から南へ回る角）' },
    { name: 'kind', type: 'uint8', note: '下 4 ビット = 用途、次の 2 ビット = 構造、0x40 = 高さが推定、0x80 = 前の行と同じ建物の続き' },
  ],
  usage: USAGE,
  struct: STRUCT,
  stats: {
    yearRecorded: count((b) => b.year), yearGuessed: guessed, heightGuessed: noHeight,
    split: count((b) => b.parts.length > 1), droppedSmall: small, droppedOutside: outside, onSeaCell: onSea,
  },
};
fs.mkdirSync(opt.out, { recursive: true });
fs.writeFileSync(path.join(opt.out, 'buildings.bin'), bin);
fs.writeFileSync(path.join(opt.out, 'buildings.json'), JSON.stringify(meta, null, 1) + '\n');

// ---------- 集計（画面に出すだけ） ----------
const pct = (vals, ps = [0, 5, 25, 50, 75, 95, 99, 100]) => {
  const v = vals.slice().sort((a, b) => a - b);
  return ps.map((p) => `${p}%:${v[Math.min(v.length - 1, Math.floor(v.length * p / 100))].toFixed(1)}`).join(' ');
};
const tally = (f) => { const c = new Map(); for (const b of rows) c.set(f(b), (c.get(f(b)) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' / '); };
console.log(`使う建物 ${rows.length}（行 ${N}・${(bin.length / 1024).toFixed(0)} KB）  区や格子の外 ${outside}  ${opt.minArea} m2 未満で外した ${small}  海のマスの上 ${onSea}`);
console.log(`年の記録あり ${meta.stats.yearRecorded}  近くからの推定 ${guessed}（近くに記録が無く全体の中央値 ${median} にした ${alone}）  高さの推定 ${noHeight}`);
console.log('面積 m2  ' + pct(rows.map((b) => b.area)));
console.log('高さ m   ' + pct(rows.map((b) => b.h)));
console.log('面積 ÷ 外接長方形  ' + pct(rows.map((b) => b.fill)));
const tried = rows.filter((b) => b.split);
console.log(`分ける対象 ${tried.length}  分けた ${meta.stats.split}  1 つのまま ${tried.length - meta.stats.split}  覆えた割合 ${tried.length ? pct(tried.map((b) => b.split.covered)) : '-'}`);
console.log('分けた数  ' + [2, 3, 4, 5].map((n) => `${n}個:${count((b) => b.parts.length === n)}`).join(' '));
console.log('用途  ' + tally((b) => USAGE[USAGE_OF[b.usage] ?? 10]));
console.log('構造  ' + tally((b) => STRUCT[STRUCT_OF[b.struct] ?? 0]));
console.log('年代  ' + [1850, 1900, 1920, 1945, 1960, 1975, 1990, 2005].map((y, i, a) => `${y}〜:${count((b) => b.year >= y && b.year < (a[i + 1] ?? 9999))}`).join(' '));
if (opt.dump) {
  fs.writeFileSync(opt.dump, JSON.stringify(rows.map((b) => ({
    x: +b.parts[0].x.toFixed(1), z: +b.parts[0].z.toFixed(1), w: +b.rectW.toFixed(1), d: +b.rectD.toFixed(1), area: +b.area.toFixed(1), fill: +b.fill.toFixed(3),
    h: +b.h.toFixed(1), hGuess: b.hGuess, year: b.year, yearGuess: b.yearGuess ?? 0, floors: b.floors, usage: b.usage, struct: b.struct, parts: b.parts.length,
  }))));
  console.log('調べ用: ' + opt.dump);
}
console.log('書き出し: ' + path.join(opt.out, 'buildings.bin'));
