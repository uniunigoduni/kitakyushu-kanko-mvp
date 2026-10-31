// 地図の上のピン。時代の区切りでだけ入れ替え、ズームに合わせて小さいピンを出し入れする。
// 時代ごとの注目の史跡には、赤ペンで描いたような矢印を一度だけ引く。
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { h, svg } from '../util.js';

// 段階ごとの頭の直径と軸の高さ（css/style.css の .pin.lv* と同じ値）
export const HEAD = { 1: 10, 2: 15, 3: 22 };
export const STEM = { 1: 0, 2: 12, 3: 18 };
// ピンに添える短い名前：「戦時中の門司港：出征の港と空襲」→「戦時中の門司港」
export const pinLabel = (name) => name.split('：')[0].replace(/（[^）]*）/g, '');

const SMALL_R = 0.6; // 小さいピンを出す近さ（ホームの距離に対する比）
const NAME_R = 0.4;  // 小さいピンの名前も出す近さ
// 赤い矢印の引き始め（ピンの頭から見た位置。上から順に、それぞれ短くしたものも試す）
const STARTS = [[-108, -84], [-132, -40], [108, -84], [-140, 24], [-108, 84], [-60, 120], [108, 84]];
const SCALES = [1, 0.72];

export function createPins(app, world, sites) {
  const pins = new Map();
  for (const s of sites) {
    const hit = h('button', { class: 'pin-hit', type: 'button', tabindex: -1, 'aria-label': s.name },
      h('span', { class: 'pin-head' }),
      h('span', { class: 'pin-name', text: pinLabel(s.name) }));
    const el = h('div', { class: `pin lv${s.level} is-off` }, h('i', { class: 'pin-shadow' }), h('i', { class: 'pin-stem' }), hit);
    const obj = new CSS2DObject(el);
    obj.position.copy(world.at(s.lon, s.lat, 0.4));
    world.pinScene.add(obj);
    const p = { s, el, hit, obj, on: false, far: false, near: false };
    hit.addEventListener('click', () => app.selectSite(s.id, { from: 'map' }));
    hit.addEventListener('pointerenter', () => { if (A.pin === p && A.drawn) g.classList.remove('is-dim'); });
    hit.addEventListener('pointerleave', () => { if (A.pin === p && A.drawn) g.classList.add('is-dim'); });
    pins.set(s.id, p);
  }

  // ---------- 時代とズーム ----------
  let lastR = -1;
  function setEra(era) {
    for (const p of pins.values()) {
      const on = p.s.eras.includes(era.id);
      if (on === p.on) continue;
      p.on = on;
      p.el.classList.toggle('is-off', !on);
      p.hit.tabIndex = on ? 0 : -1;
    }
    lastR = -1;
  }
  function zoom() {
    const r = world.distance() / world.home.distance;
    if (Math.abs(r - lastR) < 0.005) return;
    lastR = r;
    for (const p of pins.values()) {
      const far = p.s.level < 2 && !p.s.featured && r >= SMALL_R;
      const near = p.s.featured || r < NAME_R;
      if (far !== p.far) { p.far = far; p.el.classList.toggle('is-far', far); }
      if (near !== p.near) { p.near = near; p.el.classList.toggle('is-near', near); }
    }
  }

  // ---------- ピンの下の地名を消す ----------
  // 見えているピンの頭と名前の四角（地図の窓の中の px）。skip のピンは除く
  let sized = false;
  const Q = {};
  function pinRects(out, skip) {
    for (const p of pins.values()) {
      if (!p.on || p.far || p === skip) continue;
      world.project(p.obj.position, Q);
      if (!Q.visible) continue;
      if (!sized || !p.w) { sized = true; for (const q of pins.values()) q.w = q.hit.offsetWidth; }
      const hd = HEAD[p.s.level], cy = Q.y - STEM[p.s.level];
      const named = p.s.level >= 2 || p.near;
      out.push([Q.x - hd / 2 - 4, cy - 12, Q.x - hd / 2 + (named ? p.w : hd) + 4, cy + 12]);
      if (STEM[p.s.level]) out.push([Q.x - 9, cy, Q.x + 9, Q.y + 4]);
    }
    return out;
  }
  const rects = [];
  world.setLabelBlockers(() => { rects.length = 0; return pinRects(rects); });

  // ---------- 赤い矢印 ----------
  const map = world.renderer.domElement.parentElement;
  const layer = svg('svg', { class: 'arrow-layer', 'aria-hidden': 'true' });
  const g = svg('g');
  const shaft = svg('path');
  const tip = svg('path');
  g.append(shaft, tip);
  layer.append(g);
  map.append(layer);
  g.style.display = 'none';

  const A = { pin: null, drawn: false, hold: true, pending: false, timer: 0, dimTimer: 0, anims: [] };
  const P = {};
  const headAt = (p, out) => { world.project(p.obj.position, out); out.y -= STEM[p.s.level]; return out; };

  function resetArrow() {
    clearTimeout(A.timer); clearTimeout(A.dimTimer);
    for (const a of A.anims) a.cancel();
    A.anims = []; A.drawn = false; A.pending = false;
    g.style.display = 'none';
    g.classList.remove('is-dim');
  }
  function schedule(delay) {
    clearTimeout(A.timer);
    if (A.hold || A.drawn || !A.pin) return;
    A.timer = setTimeout(draw, delay);
  }

  function draw() {
    const p = A.pin;
    if (!p || A.drawn || A.hold) return;
    if (app.selected) { A.pending = true; return; }
    headAt(p, P);
    const { W, H } = world.size;
    if (!P.visible || P.x < 24 || P.x > W - 24 || P.y < 24 || P.y > H - 24) return; // 画面の外なら、次に止まったときに
    const S = pickStart(p);
    const sx = Math.sign(S[0]), sy = Math.sign(S[1]);
    const len = Math.hypot(S[0], S[1]);
    const u = [S[0] / len, S[1] / len];
    const r = HEAD[p.s.level] / 2 + 7;
    const T = [u[0] * r, u[1] * r];
    // 手で引いたような、ゆるい弧
    const d = [T[0] - S[0], T[1] - S[1]];
    const dl = Math.hypot(d[0], d[1]);
    const n = [-d[1] / dl, d[0] / dl];
    const bow = 15 * sx * sy * Math.min(1, len / 137);
    const C1 = [S[0] + d[0] * 0.35 + n[0] * bow, S[1] + d[1] * 0.35 + n[1] * bow];
    const C2 = [S[0] + d[0] * 0.75 + n[0] * bow * 0.45, S[1] + d[1] * 0.75 + n[1] * bow * 0.45];
    shaft.setAttribute('d', `M${S[0].toFixed(1)} ${S[1].toFixed(1)}C${C1[0].toFixed(1)} ${C1[1].toFixed(1)} ${C2[0].toFixed(1)} ${C2[1].toFixed(1)} ${T[0].toFixed(1)} ${T[1].toFixed(1)}`);
    // 矢じり：終わりの向きから左右 27° 開いた 2 本
    const tl = Math.hypot(T[0] - C2[0], T[1] - C2[1]);
    const b = [(C2[0] - T[0]) / tl, (C2[1] - T[1]) / tl];
    const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
    const w1 = rot(b, 0.47), w2 = rot(b, -0.47);
    tip.setAttribute('d', `M${(T[0] + w1[0] * 14).toFixed(1)} ${(T[1] + w1[1] * 14).toFixed(1)}L${T[0].toFixed(1)} ${T[1].toFixed(1)}L${(T[0] + w2[0] * 14).toFixed(1)} ${(T[1] + w2[1] * 14).toFixed(1)}`);

    A.drawn = true;
    g.classList.remove('is-dim');
    g.style.display = '';
    follow();
    const L1 = shaft.getTotalLength(), L2 = tip.getTotalLength();
    for (const [el, L] of [[shaft, L1], [tip, L2]]) { el.style.strokeDasharray = `${L} ${L}`; el.style.strokeDashoffset = `${L}`; }
    const a1 = shaft.animate([{ strokeDashoffset: `${L1}` }, { strokeDashoffset: '0' }], { duration: Math.max(350, (L1 / 500) * 1000), easing: 'cubic-bezier(0.65,0,0.35,1)', fill: 'forwards' });
    A.anims = [a1];
    a1.finished.then(() => {
      const a2 = tip.animate([{ strokeDashoffset: `${L2}` }, { strokeDashoffset: '0' }], { duration: 150, easing: 'ease-out', fill: 'forwards' });
      A.anims.push(a2);
      return a2.finished;
    }).then(() => {
      p.el.classList.remove('is-pop');
      void p.el.offsetWidth;
      p.el.classList.add('is-pop');
      setTimeout(() => p.el.classList.remove('is-pop'), 320);
      A.dimTimer = setTimeout(() => g.classList.add('is-dim'), 2400);
    }).catch(() => { /* 途中で取り消した */ });
  }

  // 左上から引く。引き始めが窓からはみ出すときや、線が地名・ほかのピン・自分の名前にかかるときは、
  // 短くするか、左・右上・左下・下・右下の順に向きを変える（P にはピンの頭の位置が入っている）
  function pickStart(p) {
    const { W, H } = world.size;
    const hd = HEAD[p.s.level];
    const avoid = pinRects(world.labelRects(), p);
    if (p.w) avoid.push([P.x + hd / 2, P.y - 11, P.x - hd / 2 + p.w, P.y + 11]);
    const inWin = ([dx, dy]) => P.x + dx > 16 && P.x + dx < W - 16 && P.y + dy > 16 && P.y + dy < H - 16;
    const clear = ([dx, dy]) => {
      for (let i = 0; i < 12; i++) {
        const k = i / 12, x = P.x + dx * (1 - k), y = P.y + dy * (1 - k);
        for (const b of avoid) if (x > b[0] - 6 && x < b[2] + 6 && y > b[1] - 6 && y < b[3] + 6) return false;
      }
      return true;
    };
    const fit = STARTS.flatMap(([dx, dy]) => SCALES.map((k) => [dx * k, dy * k])).filter(inWin);
    return fit.find(clear) ?? fit[0] ?? STARTS[0];
  }

  function follow() {
    if (!A.drawn || !A.pin) return;
    headAt(A.pin, P);
    if (!P.visible) { g.style.display = 'none'; return; }
    g.style.display = '';
    g.setAttribute('transform', `translate(${P.x.toFixed(1)} ${P.y.toFixed(1)})`);
  }

  // ---------- 出来事に合わせる ----------
  const featuredOf = (era) => {
    let best = null;
    for (const p of pins.values()) if (p.s.featured && p.s.eras.includes(era.id) && (!best || p.s.level > best.s.level)) best = p;
    return best;
  };
  app.on('era', (era, prev) => {
    setEra(era);
    resetArrow();
    A.pin = featuredOf(era);
    // 題字と同じく地名・ピンの書体も変わるので、大きさを測り直す
    if (prev?.font !== era.font) { sized = false; world.measureLabels(); }
  });
  app.on('t', () => schedule(600)); // 時代が決まって 0.6 秒たったら引く
  app.on('select', (s) => {
    for (const p of pins.values()) p.el.classList.toggle('is-selected', p.s === s);
    layer.classList.add('is-hidden');
  });
  app.on('deselect', () => {
    for (const p of pins.values()) p.el.classList.remove('is-selected');
    layer.classList.remove('is-hidden');
    if (A.pending) { A.pending = false; schedule(300); }
  });
  world.onFrame(() => { zoom(); follow(); });
  document.fonts?.ready.then(() => { sized = false; world.measureLabels(); });
  // ピンが画面の外で引けなかったときは、地図が止まったところでもう一度
  world.controls.addEventListener('rest', () => schedule(300));

  return {
    pins,
    // 冒頭の流しの間は矢印を止め、終わってから delay ミリ秒後に引く
    holdArrow() { A.hold = true; clearTimeout(A.timer); },
    releaseArrow(delay = 1000) { A.hold = false; schedule(delay); },
    position: (id) => pins.get(id)?.obj.position,
  };
}
