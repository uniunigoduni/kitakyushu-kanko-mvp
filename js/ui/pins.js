// 地図の上のピン。時代の区切りでだけ入れ替え、ズームに合わせて小さいピンを出し入れする。
// 大事なピンから順に置き、先に置いたピンと重なるピンは名前を隠すか、ピンごと隠す（HOI4 の都市のように、寄るほど増える）。
// 時代ごとの注目の史跡には、赤ペンで描いたような矢印を一度だけ引く。
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { formatYear } from '../eras.js';
import { h, svg } from '../util.js';
import { shortYear } from './band.js';

// ピンの頭の幅・高さと軸の高さ（css/style.css の .pin.lv* などと同じ値）。頭の中心は根元から軸の高さだけ上
const GEOM = {
  1: { w: 10, h: 10, stem: 0 },
  2: { w: 15, h: 15, stem: 12 },
  3: { w: 22, h: 22, stem: 18 },
  special: { w: 26, h: 26, stem: 20 }, // 特別演出のある史跡
  frame: { w: 62, h: 40, stem: 34 },   // 写真の枠のピン（時代ごとの場面がある場所）
  dummy: { w: 8, h: 8, stem: 0 },      // MVP 用のダミー
};
// 一押しの史跡（pick）は、出す順では最大レベルのまま、大きさは中のピンにして色で見分ける。
// 現代の地図に出すとき（today）は、特別演出のある史跡も中のピンにそろえる
export const geomOf = (s, today = false) => GEOM[s.scenes ? 'frame' : s.special && !today ? 'special' : s.dummy ? 'dummy' : s.pick ? 2 : s.level];
// ピンに添える短い名前：「戦時中の門司港：出征の港と空襲」→「戦時中の門司港」
export const pinLabel = (name) => name.split('：')[0].replace(/（[^）]*）/g, '');
// 一押しの史跡は、その時代に加えて現代の地図にも「いまの姿」として出す
export const isToday = (s, era) => !!s.pick && era?.id === 'now' && !s.eras.includes('now');
// 現代の地図で名前に添える、さかのぼる先の年（「1934年」「1183年頃」「1912〜1913年」）。
// 年がはっきりしない伝承などは、データの yearShort（「平安末期」など）をそのまま使う
export const yearTag = (s) => s.yearShort ?? shortYear(s.yearLabel ?? '').match(/^前?\d+(?:〜\d+)?年頃?/)?.[0] ?? `${formatYear(s.year)}年`;

// 置く順（小さいほど先）：写真の枠 → 特別演出 → 最大レベル → 中 → 小 → ダミー。同じレベルは注目の史跡が先
const tierOf = (s) => (s.scenes ? 0 : s.special ? 1 : s.dummy ? 8 : (3 - s.level) * 2 + (s.featured ? 2 : 3));
// 出す近さ（ホームの距離に対する比がこれより小さいとき）。注目の史跡と中・最大レベルはいつでも出す
const SMALL_R = 0.6, NAME_R = 0.4;        // 小さいピン、その名前
const DUMMY_R = 0.36, DUMMY_NAME_R = 0.2; // ダミーのピン、その名前
const showUnder = (s) => (s.dummy ? DUMMY_R : s.level < 2 && !s.featured ? SMALL_R : Infinity);
const nameUnder = (s) => (s.dummy ? DUMMY_NAME_R : s.level < 2 && !s.featured ? NAME_R : Infinity);
// 重なりの判定の余白。出ているピンは少しの重なりまで許し、隠れているピンは余裕ができてから出す（ちらつかないように）
const PAD_KEEP = 2, PAD_SHOW = 8;
// 赤い矢印の引き始め（ピンの頭から見た位置。上から順に、それぞれ短くしたものも試す）
const STARTS = [[-108, -84], [-132, -40], [108, -84], [-140, 24], [-108, 84], [-60, 120], [108, 84]];
const SCALES = [1, 0.72];

export function createPins(app, world, sites) {
  const pins = new Map();
  for (const s of sites) {
    const head = h('span', { class: 'pin-head' });
    const label = h('span', { class: 'pin-name', text: pinLabel(s.name) });
    const hit = h('button', { class: 'pin-hit', type: 'button', tabindex: -1, 'aria-label': s.name }, head, label);
    const kind = (s.scenes ? ' is-frame' : s.special ? ' is-special' : s.dummy ? ' is-dummy' : '') + (s.pick ? ' is-pick' : '');
    const el = h('div', { class: `pin lv${s.level}${kind} is-off` }, h('i', { class: 'pin-shadow' }), h('i', { class: 'pin-stem' }), hit);
    const obj = new CSS2DObject(el);
    obj.position.copy(world.at(s.lon, s.lat, 0.4));
    obj.visible = false; // その時代になるまでは描かない（ダミーを入れると数が多いので）
    const tier = tierOf(s);
    obj.renderOrder = 10 - tier; // 大事なピンほど上に重ねる
    world.pinScene.add(obj);
    const p = { s, g: geomOf(s), el, hit, head, label, obj, tier, n: pins.size, show: showUnder(s), name: nameUnder(s), on: false, today: false, state: '', w: 0, offTimer: 0 };
    if (s.scenes) {
      p.img = h('img', { alt: '', decoding: 'async' });
      head.append(p.img);
      setFrame(p, s.pano);
    }
    hit.addEventListener('click', () => app.selectSite(s.id, { from: 'map' }));
    hit.addEventListener('pointerenter', () => { if (A.pin === p && A.drawn) g.classList.remove('is-dim'); });
    hit.addEventListener('pointerleave', () => { if (A.pin === p && A.drawn) g.classList.add('is-dim'); });
    pins.set(s.id, p);
  }

  // 写真の枠には、いまの年の場面の切り抜きを入れる（読み込めてから差し替える）
  function setFrame(p, pano) {
    const src = `assets/pano/${pano}_thumb.jpg`;
    if (p.src === src) return;
    p.src = src;
    const im = new Image();
    im.onload = () => { if (p.src === src) p.img.src = src; };
    im.src = src;
  }

  // 現代の地図に出す一押しの史跡は、いまの名前に、さかのぼる先の年を添える
  function setToday(p, today) {
    const s = p.s;
    p.today = today;
    p.g = geomOf(s, today);
    p.el.classList.toggle('is-today', today);
    if (s.special) p.el.classList.toggle('is-special', !today);
    p.label.replaceChildren(today ? s.nowName ?? pinLabel(s.name) : pinLabel(s.name));
    if (today) p.label.append(h('span', { class: 'pin-year', text: yearTag(s) }));
    p.hit.setAttribute('aria-label', today ? `${s.nowName ?? pinLabel(s.name)}（${yearTag(s)}へさかのぼる）` : s.name);
    p.w = 0;
  }

  // ---------- 時代 ----------
  const fadeIn = new Set();
  let dirty = true, needMeasure = true;
  function setEra(era) {
    for (const p of pins.values()) {
      const today = isToday(p.s, era);
      if (today !== p.today) setToday(p, today);
      const on = p.s.eras.includes(era.id) || today;
      if (on === p.on) continue;
      p.on = on;
      clearTimeout(p.offTimer);
      if (on) {
        // 描き始めてから is-off を外すと、ふわっと出る
        p.obj.visible = true;
        fadeIn.add(p);
      } else {
        fadeIn.delete(p);
        p.el.classList.add('is-off');
        p.hit.tabIndex = -1;
        p.state = '';
        p.offTimer = setTimeout(() => { if (!p.on) p.obj.visible = false; }, 200);
      }
    }
    needMeasure = true;
    dirty = true;
  }

  // ---------- ズームと重なり ----------
  // 頭・名前・軸の四角（地図の窓の中の px）。q にはピンの根元の位置が入っている
  const headRect = (p, q, out) => {
    const { w, h: hh, stem } = p.g, cy = q.y - stem;
    out[0] = q.x - w / 2 - 2; out[1] = cy - hh / 2 - 2; out[2] = q.x + w / 2 + 2; out[3] = cy + hh / 2 + 2;
    return out;
  };
  const nameRect = (p, q, out) => {
    const { w, stem } = p.g, cy = q.y - stem;
    out[0] = q.x + w / 2; out[1] = cy - 10; out[2] = q.x - w / 2 + Math.max(p.w, w) + 4; out[3] = cy + 10;
    return out;
  };
  const stemRect = (p, q, out) => {
    const { h: hh, stem } = p.g;
    out[0] = q.x - 3; out[1] = q.y - stem + hh / 2; out[2] = q.x + 3; out[3] = q.y + 2;
    return out;
  };

  // 名前の幅（頭＋間＋名前）を測る。まだ描いていない（display:none の）ピンは 0 なので、次のコマで測り直す
  function measure() {
    let missing = false;
    for (const p of pins.values()) {
      if (!p.on || p.w) continue;
      p.w = p.hit.offsetWidth;
      if (!p.w) missing = true;
    }
    needMeasure = missing;
  }

  const placed = [];
  const hits = (b, pad) => {
    for (const a of placed) if (b[0] < a[2] + pad && b[2] > a[0] - pad && b[1] < a[3] + pad && b[3] > a[1] - pad) return true;
    return false;
  };
  const Q = {};
  let lastR = -1, lastLayout = 0;
  // 大事なピンから順に置く。選んでいるピンと矢印のピン、写真の枠のピン（どの時代でも押せるように）は必ず出す
  function layout() {
    dirty = false;
    lastLayout = performance.now();
    if (needMeasure) { measure(); if (needMeasure) dirty = true; }
    const r = world.distance() / world.home.distance;
    lastR = r;
    const sel = app.selected;
    const rank = (p) => (p.s === sel ? -2 : p === A.pin ? -1 : p.tier);
    const list = [...pins.values()].filter((p) => p.on).sort((a, b) => rank(a) - rank(b) || a.n - b.n);
    placed.length = 0;
    for (const p of list) {
      const forced = p.s === sel || p === A.pin || !!p.s.scenes;
      let state;
      if (!forced && r >= p.show) state = 'far';
      else {
        const wantName = forced || r < p.name;
        world.project(p.obj.position, Q);
        if (!Q.visible) state = wantName ? 'full' : 'dot';
        else {
          const pad = p.state === 'full' || p.state === 'dot' ? PAD_KEEP : PAD_SHOW;
          const hr = headRect(p, Q, [0, 0, 0, 0]);
          if (!forced && hits(hr, pad)) state = 'crowded';
          else {
            const nr = nameRect(p, Q, [0, 0, 0, 0]);
            state = wantName && (forced || !hits(nr, pad)) ? 'full' : 'dot';
            placed.push(hr);
            if (state === 'full') placed.push(nr);
            if (p.g.stem > p.g.h / 2) placed.push(stemRect(p, Q, [0, 0, 0, 0]));
          }
        }
      }
      setState(p, state);
    }
  }
  function setState(p, st) {
    if (st === p.state) return;
    p.state = st;
    p.el.classList.toggle('is-far', st === 'far');
    p.el.classList.toggle('is-crowded', st === 'crowded');
    p.el.classList.toggle('is-dot', st === 'dot');
    p.hit.tabIndex = st === 'full' || st === 'dot' ? 0 : -1;
  }
  const shown = (p) => p.on && (p.state === 'full' || p.state === 'dot');

  // ---------- ピンの下の地名を消す ----------
  // 出ているピンの頭と名前・軸の四角。skip のピンは除く
  function pinRects(out, skip) {
    for (const p of pins.values()) {
      if (!shown(p) || p === skip) continue;
      world.project(p.obj.position, Q);
      if (!Q.visible) continue;
      const { w, h: hh, stem } = p.g, cy = Q.y - stem, half = Math.max(12, hh / 2 + 2);
      out.push([Q.x - w / 2 - 4, cy - half, Q.x - w / 2 + (p.state === 'full' ? Math.max(p.w, w) : w) + 4, cy + half]);
      if (stem > hh / 2) out.push([Q.x - 9, cy + hh / 2, Q.x + 9, Q.y + 4]);
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
  const headAt = (p, out) => { world.project(p.obj.position, out); out.y -= p.g.stem; return out; };

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
    const r = Math.max(p.g.w, p.g.h) / 2 + 7;
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
      pop(p);
      A.dimTimer = setTimeout(() => g.classList.add('is-dim'), 2400);
    }).catch(() => { /* 途中で取り消した */ });
  }

  // 左上から引く。引き始めが窓からはみ出すときや、線が地名・ほかのピン・自分の名前にかかるときは、
  // 短くするか、左・右上・左下・下・右下の順に向きを変える（P にはピンの頭の位置が入っている）
  function pickStart(p) {
    const { W, H } = world.size;
    const hw = p.g.w;
    const avoid = pinRects(world.labelRects(), p);
    if (p.w) avoid.push([P.x + hw / 2, P.y - 11, P.x - hw / 2 + p.w, P.y + 11]);
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

  // ピンを一度だけ弾ませる
  function pop(p) {
    p.el.classList.remove('is-pop');
    void p.el.offsetWidth;
    p.el.classList.add('is-pop');
    setTimeout(() => p.el.classList.remove('is-pop'), 320);
  }

  function follow() {
    if (!A.drawn || !A.pin) return;
    headAt(A.pin, P);
    if (!P.visible) { g.style.display = 'none'; return; }
    g.style.display = '';
    g.setAttribute('transform', `translate(${P.x.toFixed(1)} ${P.y.toFixed(1)})`);
  }

  // ---------- 出来事に合わせる ----------
  // 矢印を引く史跡：その時代に出ている注目の史跡のうち、いちばん先に置くもの（どの時代にも出る写真の枠とダミーは除く）。
  // 現代では、一押しの門司港駅（現代の地図から 1914 年へさかのぼれる）がいちばん先になる
  const featuredOf = () => {
    let best = null;
    for (const p of pins.values()) {
      if (!p.s.featured || p.s.scenes || p.s.dummy || !p.on) continue;
      if (!best || p.tier < best.tier) best = p;
    }
    return best;
  };
  app.on('era', (era, prev) => {
    setEra(era);
    resetArrow();
    A.pin = featuredOf();
    // 題字と同じく地名・ピンの書体も変わるので、大きさを測り直す
    if (prev?.font !== era.font) remeasure();
  });
  app.on('t', () => schedule(600)); // 時代が決まって 0.6 秒たったら引く
  app.on('scene', (s) => { const p = pins.get(s.id); if (p?.img) setFrame(p, s.pano); });
  app.on('select', (s) => {
    for (const p of pins.values()) {
      const on = p.s === s;
      p.el.classList.toggle('is-selected', on);
      p.obj.renderOrder = on ? 20 : 10 - p.tier;
    }
    layer.classList.add('is-hidden');
    dirty = true;
  });
  app.on('deselect', () => {
    for (const p of pins.values()) { p.el.classList.remove('is-selected'); p.obj.renderOrder = 10 - p.tier; }
    layer.classList.remove('is-hidden');
    if (A.pending) { A.pending = false; schedule(300); }
    dirty = true;
  });
  function remeasure() {
    for (const p of pins.values()) p.w = 0;
    needMeasure = true;
    dirty = true;
    world.measureLabels();
  }

  // 寄り引きはすぐ、動かしている間は 0.18 秒ごと、窓の大きさが変わったときと止まったときに置き直す
  const C = { x: NaN, y: NaN, z: NaN, W: 0, H: 0 };
  world.onFrame(() => {
    const cp = world.camera.position, { W, H } = world.size;
    const r = world.distance() / world.home.distance;
    const moved = cp.x !== C.x || cp.y !== C.y || cp.z !== C.z;
    if (dirty || Math.abs(r - lastR) > 0.004 || W !== C.W || H !== C.H || (moved && performance.now() - lastLayout > 180)) {
      C.x = cp.x; C.y = cp.y; C.z = cp.z; C.W = W; C.H = H;
      layout();
    }
    // 描き始めたピン（display が付いたもの）から、ふわっと出す
    for (const p of fadeIn) {
      if (p.el.style.display === 'none' || !p.el.isConnected) continue;
      fadeIn.delete(p);
      if (p.on) p.el.classList.remove('is-off');
    }
    follow();
  });
  document.fonts?.ready.then(remeasure);
  // ピンが画面の外で引けなかったときは、地図が止まったところでもう一度
  world.controls.addEventListener('rest', () => { dirty = true; schedule(300); });

  return {
    pins,
    // 冒頭の流しの間は矢印を止め、終わってから delay ミリ秒後に引く
    holdArrow() { A.hold = true; clearTimeout(A.timer); },
    releaseArrow(delay = 1000) { A.hold = false; schedule(delay); },
    position: (id) => pins.get(id)?.obj.position,
    // 現代へ戻ったとき、いまの場所のピンを弾ませる
    pop(id) { const p = pins.get(id); if (p) pop(p); },
  };
}
