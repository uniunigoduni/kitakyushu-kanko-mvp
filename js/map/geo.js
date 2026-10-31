// 地形データ（国土地理院の標高・門司区の範囲）と、緯度経度 ⇔ 3D座標の変換。
// 1単位 = 10 m。高さは 1.7 倍に強調する。x = 東、z = 南、y = 上。
export const UNIT = 10;
export const VEX = 1.7;
export const Y_PER_M = VEX / UNIT;
const SEA = -32768;

export async function loadGeo(base = 'data/') {
  const [meta, buf] = await Promise.all([
    fetch(base + 'terrain.json').then((r) => r.json()),
    fetch(base + 'terrain.bin').then((r) => r.arrayBuffer()),
  ]);
  return new Geo(meta, buf);
}

// 陸（または海）からの距離（マス数）。1 と √2 の重みで2回なめる。
function distanceField(isSource, nx, ny) {
  const INF = 1e9, D2 = Math.SQRT2;
  const d = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = isSource(k) ? 0 : INF;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) {
      v = Math.min(v, d[k - nx] + 1);
      if (i > 0) v = Math.min(v, d[k - nx - 1] + D2);
      if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + D2);
    }
    d[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
    if (j < ny - 1) {
      v = Math.min(v, d[k + nx] + 1);
      if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + D2);
      if (i > 0) v = Math.min(v, d[k + nx - 1] + D2);
    }
    d[k] = v;
  }
  return d;
}

export class Geo {
  constructor(meta, buf) {
    const { nx, ny } = meta;
    this.meta = meta;
    this.nx = nx; this.ny = ny;
    this.W = meta.width / UNIT; this.D = meta.depth / UNIT;
    this.dx = this.W / (nx - 1); this.dz = this.D / (ny - 1);
    const n = nx * ny;
    const raw = new Int16Array(buf, 0, n);
    this.mask = new Uint8Array(buf, n * 2, n);
    this.land = new Uint8Array(n);
    this.hm = new Float32Array(n); // 陸の標高 m（海は 0）
    for (let k = 0; k < n; k++) {
      if (raw[k] !== SEA) { this.land[k] = 1; this.hm[k] = Math.max(0.6, raw[k] / 10); }
    }
    this.seaDist = distanceField((k) => this.land[k] === 1, nx, ny); // 海のマスから陸まで
    this.landDist = distanceField((k) => this.land[k] === 0, nx, ny); // 陸のマスから海まで
    this.wardDist = distanceField((k) => this.mask[k] === 1 && this.land[k] === 1, nx, ny); // 門司区の陸まで
    // 頂点の高さ。海底は岸から沖へゆるく下げる（水面との交わりがちょうど岸になる）
    this.y = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      this.y[k] = this.land[k] ? this.hm[k] * Y_PER_M : -(0.15 + (Math.min(this.seaDist[k], 12) - 1) * 0.9);
    }
    // 門司区の陸の範囲（ワールド座標の外接箱）。区の境界は海の上にも引かれているので、陸のマスで測る
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!this.mask[k] || !this.land[k]) continue;
      const x = this.xOf(i), z = this.zOf(j);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    this.mojiBox = { x0, x1, z0, z1 };
    this.mojiRings = meta.mojiRings.map((r) => r.map(([mx, mz]) => [mx / UNIT, mz / UNIT]));
  }

  toXZ(lon, lat) {
    const c = this.meta.center;
    return [(lon - c.lon) * this.meta.mPerDegLon / UNIT, -(lat - c.lat) * this.meta.mPerDegLat / UNIT];
  }
  toLonLat(x, z) {
    const c = this.meta.center;
    return [c.lon + x * UNIT / this.meta.mPerDegLon, c.lat - z * UNIT / this.meta.mPerDegLat];
  }
  gx(x) { return (x + this.W / 2) / this.dx; }
  gz(z) { return (z + this.D / 2) / this.dz; }
  xOf(i) { return -this.W / 2 + i * this.dx; }
  zOf(j) { return -this.D / 2 + j * this.dz; }
  index(x, z) {
    const i = Math.round(this.gx(x)), j = Math.round(this.gz(z));
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }
  sample(arr, x, z) {
    const fx = Math.min(Math.max(this.gx(x), 0), this.nx - 1.001);
    const fz = Math.min(Math.max(this.gz(z), 0), this.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j;
    const k = j * this.nx + i;
    return (arr[k] * (1 - ax) + arr[k + 1] * ax) * (1 - az) + (arr[k + this.nx] * (1 - ax) + arr[k + this.nx + 1] * ax) * az;
  }
  heightAt(x, z) { return this.sample(this.y, x, z); }
  groundAt(x, z) { return Math.max(0, this.heightAt(x, z)); }
  isLand(x, z) { const k = this.index(x, z); return k >= 0 && this.land[k] === 1; }
  inMoji(x, z) { const k = this.index(x, z); return k >= 0 && this.mask[k] === 1; }
  // 斜面の傾き（m/m）
  slopeAt(x, z) {
    const e = this.dx;
    const hx = (this.sample(this.hm, x + e, z) - this.sample(this.hm, x - e, z)) / (2 * e * UNIT);
    const hz = (this.sample(this.hm, x, z + e) - this.sample(this.hm, x, z - e)) / (2 * e * UNIT);
    return Math.hypot(hx, hz);
  }
}

// 決まった種から同じ並びを出す乱数（毎回同じ町並み・森になる）
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 町の広がり：種の場所から年 spread m ずつ、max m まで広がる。返り値はその地点が町になる年（ならなければ Infinity）
// 門司の市街は西の海岸ぞい（門司港〜小森江〜大里）に細長く、東側は田野浦と新門司・吉志のほかは浦の集落が点在する
export const TOWN_SEEDS = [
  { name: '門司港', lat: 33.9445, lon: 130.9620, start: 1889, spread: 40, max: 2300 },
  { name: '小森江', lat: 33.9262, lon: 130.9448, start: 1905, spread: 30, max: 1500 },
  { name: '大里', lat: 33.9050, lon: 130.9330, start: 1891, spread: 35, max: 2800 },
  { name: '田野浦', lat: 33.9560, lon: 130.9870, start: 1910, spread: 25, max: 1300 },
  { name: '新門司', lat: 33.8618, lon: 130.9953, start: 1975, spread: 60, max: 2400 },
  { name: '吉志', lat: 33.8760, lon: 130.9750, start: 1970, spread: 45, max: 1400 },
];
export const VILLAGES = [
  { name: '門司関', lat: 33.9600, lon: 130.9640, start: 800, r: 22, n: 26 },
  { name: '大里宿', lat: 33.9070, lon: 130.9320, start: 1650, r: 26, n: 40 },
  { name: '田野浦', lat: 33.9560, lon: 130.9870, start: 1200, r: 20, n: 22 },
  { name: '白野江', lat: 33.9520, lon: 131.0030, start: 1600, r: 18, n: 16 },
  { name: '青浜', lat: 33.9474, lon: 131.0194, start: 1600, r: 16, n: 14 },
  { name: '恒見', lat: 33.8521, lon: 130.9849, start: 1600, r: 18, n: 16 },
];
export function townYearFn(geo) {
  const seeds = TOWN_SEEDS.map((s) => ({ ...s, xz: geo.toXZ(s.lon, s.lat) }));
  return (x, z) => {
    let best = Infinity;
    for (const s of seeds) {
      const dm = Math.hypot(x - s.xz[0], z - s.xz[1]) * UNIT;
      if (dm <= s.max) best = Math.min(best, s.start + dm / s.spread);
    }
    return best;
  };
}
