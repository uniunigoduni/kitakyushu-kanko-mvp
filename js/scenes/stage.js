// 特別な場面：特別なピン（壇ノ浦・門司駅・戦時中の港）を開くと、カメラを決まった斜めの視点へ動かし、
// その場所だけの模型と光で出来事を見せる。左下の札に、いま起きていることを短く出す。
// 地図をドラッグしたら場面に入る前の視点へ、寄り引き（ホイール・2本指・＋／−）したら
// いちばん寄った普通の地図へ、すぐに戻してしまう。
import * as THREE from 'three';
import { h, reducedMotion, smooth } from '../util.js';
import { rng } from '../map/geo.js';
import { yearToT } from '../eras.js';

// 場面の中身は、開いたときに読み込む（史跡の special の値で選ぶ）。
// 場面ができたものから足していく（dannoura：壇ノ浦・station：門司駅・war：戦時中の港）。ここにない史跡は、いつもの吹き出しで開く
const SCENES = {};
const cache = {};
const load = (k) => (cache[k] ??= SCENES[k]().then((m) => m.default).catch((err) => { delete cache[k]; throw err; }));

const NOTE = '想像をまじえた再現です。地図を動かすと元に戻ります';
const M = 12; // 場面を収める四角の、地図の窓・札からの余白
const KEYS = ['night', 'bloom', 'threshold', 'tilt'];

export function createStage(app, world, pins, popup) {
  const map = world.renderer.domElement.parentElement;
  const { controls, camera, shared } = world;
  const body = document.body;
  const gl = world.renderer.getContext();
  const pointMax = { value: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] };

  // ---------- 左下の札 ----------
  const year = h('p', { class: 'stage-year' });
  const name = h('h2', { class: 'stage-name', id: 'stage-name' });
  const cap = h('p', { class: 'stage-cap', 'aria-live': 'polite' });
  const list = h('ol', { class: 'stage-list', hidden: true });
  const dots = h('div', { class: 'stage-dots', 'aria-hidden': 'true' });
  const read = h('button', { class: 'stage-btn is-main', type: 'button', text: '解説を読む', onclick: () => openDock() });
  const arBtn = h('button', { class: 'stage-btn', type: 'button', text: 'ARで探検', onclick: () => { if (cur) app.openAR(cur.s); } });
  const again = h('button', { class: 'stage-btn', type: 'button', text: 'もう一度', onclick: () => replay() });
  const card = h('section', { class: 'stage-card', 'aria-labelledby': 'stage-name', hidden: true },
    h('button', { class: 'stage-close', type: 'button', 'aria-label': '閉じる', text: '×', onclick: () => app.deselect() }),
    year, name, cap, list, dots,
    h('div', { class: 'stage-actions' }, read, arBtn, again),
    h('p', { class: 'stage-note', text: NOTE }));
  map.append(card);

  let cur = null, token = 0, docked = false, overlay = null, hideTimer = 0;

  function fillCard(c) {
    const { s, def } = c;
    const rm = reducedMotion();
    year.textContent = s.yearLabel;
    name.textContent = s.name;
    cap.textContent = '';
    cap.classList.remove('is-in');
    // 動きを減らす設定では、場面を1コマで止めるので、説明はまとめて並べる
    list.replaceChildren(...c.caps.map(([, t]) => h('li', { text: t })));
    list.hidden = !rm;
    cap.hidden = rm;
    dots.hidden = rm;
    dots.replaceChildren(...c.caps.map(() => h('i')));
    arBtn.hidden = !s.pano;
    again.hidden = rm || !!def.loop;
  }
  function setCap(c, t) {
    let i = -1;
    for (let k = 0; k < c.caps.length; k++) if (t >= c.caps[k][0]) i = k;
    if (i === c.capI) return;
    c.capI = i;
    cap.textContent = i >= 0 ? c.caps[i][1] : '';
    cap.classList.remove('is-in');
    void cap.offsetWidth;
    cap.classList.add('is-in');
    [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k <= i));
  }
  function showCard() {
    clearTimeout(hideTimer);
    card.hidden = false;
    card.classList.remove('is-under');
    void card.offsetWidth;
    card.classList.add('is-open');
  }
  function hideCard() {
    card.classList.remove('is-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!cur) card.hidden = true; }, 200);
  }
  // スマホでは札が窓の下いっぱいに出るので、拡大・縮小のボタンをその上へ逃がす（CSS の --stage-h）
  function syncH() {
    let hh = 0;
    if (cur) {
      const r = docked ? popup.rect : null;
      if (r) hh = r[3] - r[1];
      else if (!card.hidden) hh = card.offsetHeight;
    }
    map.style.setProperty('--stage-h', `${Math.round(hh)}px`);
  }

  // ---------- 視点 ----------
  const _t = new THREE.Vector3(), _s = new THREE.Spherical();
  // いまの行き先の視点（場面に入る前の視点として覚えておく）
  function snapshot() {
    controls.getTarget(_t, true);
    controls.getSpherical(_s, true);
    return { target: [_t.x, _t.y, _t.z], distance: _s.radius, polar: _s.phi, azimuth: _s.theta };
  }
  // 札（または横に出した解説）に重ならない、いちばん大きく映せる四角に、場面の範囲 fit を収める
  function obstacle() {
    if (docked) return popup.rect;
    if (card.hidden || card.classList.contains('is-under')) return null;
    return [card.offsetLeft, card.offsetTop, card.offsetLeft + card.offsetWidth, card.offsetTop + card.offsetHeight];
  }
  function frame(smoothly) {
    const c = cur;
    if (!c?.cam) return;
    const { W, H } = world.size;
    const { target: P, polar: p, azimuth: a, fit } = c.cam;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const need = (r) => Math.max((fit.w * H) / (2 * tan * Math.max(80, r.x1 - r.x0)), (fit.h * H) / (2 * tan * Math.max(80, r.y1 - r.y0)));
    const full = { x0: M, y0: M, x1: W - M, y1: H - M };
    let r = full;
    const ob = obstacle();
    if (ob && ob[0] < full.x1 && ob[2] > full.x0 && ob[1] < full.y1 && ob[3] > full.y0) {
      const cands = [{ ...full, y1: ob[1] - M }, { ...full, y0: ob[3] + M }, { ...full, x1: ob[0] - M }, { ...full, x0: ob[2] + M }]
        .filter((q) => q.x1 - q.x0 >= 80 && q.y1 - q.y0 >= 80);
      if (cands.length) r = cands.reduce((b, q) => (need(q) < need(b) ? q : b));
    }
    const d = need(r);
    const upp = (2 * d * tan) / H;
    const safe = world.safe;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const ax = (cx - (safe.left + W - safe.right) / 2) * upp, ay = (cy - (safe.top + H - safe.bottom) / 2) * upp;
    // 画面の右 = (cos a, 0, −sin a)、画面の上 = (−cos p sin a, sin p, −cos p cos a)。P が (cx, cy) に映るよう、注視点をずらす
    const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(p), sp = Math.sin(p);
    const T = [P[0] - ca * ax - cp * sa * ay, P[1] + sp * ay, P[2] + sa * ax - cp * ca * ay];
    env.focus = 1 - cy / H; // ぼかしの帯の真ん中を、場面の真ん中に
    world.setFx({ focus: env.focus });
    world.view({ target: T, distance: d, polar: p, azimuth: a }, smoothly);
  }

  // ---------- 光と色（夜の暗さ・にじみ・ぼかし・日の色）を、なめらかに切り替える ----------
  const fx0 = world.fx;
  const BASE = { night: shared.uNight.value, bloom: fx0.bloom, threshold: fx0.threshold, tilt: fx0.tilt, sun: world.sun.color.clone(), sky: world.hemi.color.clone() };
  const env = { ...BASE, sun: BASE.sun.clone(), sky: BASE.sky.clone(), focus: null };
  const goal = { ...BASE, sun: BASE.sun.clone(), sky: BASE.sky.clone() };
  let tau = 0.8, stepping = null;
  function envTo(o, t = 0.8) {
    for (const k of KEYS) if (o[k] != null) goal[k] = o[k];
    if (o.sun) goal.sun.set(o.sun);
    if (o.sky) goal.sky.set(o.sky);
    tau = reducedMotion() ? 0 : t;
    stepping ??= world.onFrame(stepEnv);
    if (tau === 0) stepEnv(1);
  }
  const near = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 1e-3;
  function stepEnv(dt) {
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    let busy = false;
    for (const key of KEYS) {
      const d = goal[key] - env[key];
      if (Math.abs(d) < 1e-3) env[key] = goal[key];
      else { env[key] += d * k; busy = true; }
    }
    for (const key of ['sun', 'sky']) {
      if (near(env[key], goal[key])) env[key].copy(goal[key]);
      else { env[key].lerp(goal[key], k); busy = true; }
    }
    world.setNight(env.night);
    world.setFx({ bloom: env.bloom, threshold: env.threshold, tilt: env.tilt, focus: env.focus });
    world.setLight(env.sun.equals(BASE.sun) && env.sky.equals(BASE.sky) ? null : { sun: env.sun, sky: env.sky });
    if (!busy && stepping) { stepping(); stepping = null; }
  }

  // ---------- 場面の小物 ----------
  function makeCtx(c) {
    const geo = world.geo;
    const yr = c.def.year ?? app.year;
    const step = geo.coastStepAt(yr);
    return {
      THREE, world, geo, shared, glow: world.glow, year: yr,
      pointScale: { value: 1 }, pointMax,
      wind: new THREE.Vector3(0.6, 0, -0.3),
      rand: rng(7),
      // その年に陸か（埋め立てがまだの所は海）
      land(x, z) { const k = geo.index(x, z); return k >= 0 && !!geo.land[k] && geo.coastStep[k] <= step; },
      ground: (x, z) => geo.groundAt(x, z),
      look: (o, t = 1.5) => envTo(o, t),
      reduced: reducedMotion(),
    };
  }
  function setPointScale(ctx) {
    ctx.pointScale.value = (world.size.H * world.quality.pr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  function removeInst(inst) {
    inst.group.removeFromParent();
    try { inst.dispose?.(); } catch (err) { console.error(err); }
    inst.group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) m.dispose();
    });
  }
  function resetLights() {
    for (const l of world.glow) { l.intensity = 0; l.position.set(0, -500, 0); l.color.set(0xff8a3c); }
    shared.uFlow.value.set(0, 0, 0, 0);
  }
  // 模型を置くところの木と建物を、真ん中から広げるように消す
  function openHole(c, hole) {
    if (c.hole) return;
    c.hole = hole;
    if (reducedMotion()) { world.setHole(hole); return; }
    let k = 0;
    const off = world.onFrame((dt) => {
      k = Math.min(1, k + dt / 0.6);
      world.setHole({ ...hole, r: hole.r * smooth(k) });
      if (k >= 1) off();
    });
    c.holeOff = off;
  }

  async function build(c) {
    const ctx = makeCtx(c);
    setPointScale(ctx);
    let inst;
    try { inst = c.def.build(ctx); } catch (err) { console.error(err); return; }
    await world.precompile(inst.group);
    if (cur !== c) { removeInst(inst); return; }
    c.ctx = ctx;
    c.inst = inst;
    world.fxRoot.add(inst.group);
    if (inst.hole) openHole(c, inst.hole);
    world.focusShadow(inst.shadowBox ?? null, !!inst.liveShadow);
    const d = c.def;
    if (ctx.reduced) {
      // 動きを減らす設定：見せ場の1コマまで進めて止める
      const T = d.still ?? d.duration;
      const dt = 1 / 30;
      for (let t = 0; t < T; t += dt) inst.update(t, dt, t);
      inst.update(T, 0, T);
      c.t = T;
      world.wake();
      return;
    }
    c.offs.push(world.onFrame((dt) => {
      c.t += dt;
      const t = d.loop ? c.t % d.duration : Math.min(c.t, d.duration);
      setPointScale(ctx);
      inst.update(t, dt, c.t);
      setCap(c, t);
      world.wake();
    }));
  }

  // ---------- 入る・出る ----------
  // base：場面に入る前の視点（ドラッグで出たときにここへ戻す）。読み込めなかったときだけ false を返す
  async function enter(s, base) {
    const id = ++token;
    base ??= snapshot();
    let def;
    try { def = await load(s.special); } catch (err) {
      console.warn('特別な場面を読み込めませんでした', err);
      return id !== token;
    }
    if (id !== token || app.selected !== s) return true;
    const rm = reducedMotion();
    const c = { s, def, base, t: 0, capI: -1, caps: def.captions ?? [], offs: [], cam: def.camera(world), inst: null, hole: null, holeOff: null, end: null };
    cur = c;
    body.classList.add('is-stage');
    fillCard(c);
    showCard();
    syncH();
    // ピンを押したボタンは隠れるので、札のボタンへフォーカスを移す
    if (map.contains(document.activeElement) || document.activeElement === document.body) read.focus({ preventScroll: true });
    controls.smoothTime = rm ? 0 : 0.8;
    c.end = world.takeover((kind) => { if (cur === c) leave(kind === 'zoom' ? 'zoom' : 'back'); });
    frame(!rm);
    envTo(def.look ?? {}, 0.8);
    if (def.year != null && Math.abs(app.year - def.year) > 0.6) app.animateT(yearToT(def.year + 0.5));
    build(c);
    return true;
  }

  // mode：'back' 入る前の視点へ／'zoom' いちばん寄った普通の地図へ／'other' 別の史跡を開くので、カメラはそのまま
  function leave(mode = 'back') {
    const c = cur;
    if (!c) return null;
    cur = null;
    token++;
    for (const off of c.offs) off();
    c.holeOff?.();
    if (c.inst) removeInst(c.inst);
    resetLights();
    world.setHole(null);
    world.focusShadow(null);
    env.focus = null;
    envTo(BASE, 0.15);
    closeDock(true);
    hideCard();
    body.classList.remove('is-stage');
    syncH();
    const rm = reducedMotion();
    let p = null;
    if (mode === 'zoom') {
      const pos = pins.position(c.s.id);
      controls.smoothTime = 0.45;
      p = world.view({ target: [pos.x, pos.y, pos.z], distance: controls.minDistance, polar: world.home.polar, azimuth: world.home.azimuth }, !rm);
    } else if (mode === 'back') {
      controls.smoothTime = 0.45;
      p = world.view(c.base, !rm);
    } else controls.smoothTime = 0.4;
    // 戻る動きが終わるまで、地図の操作は止めたまま（ホイールの惰性で、戻った先がずれないように）
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      c.end?.();
      if (!cur) setTimeout(() => { if (!cur) controls.smoothTime = 0.25; }, 400);
    };
    if (p) { p.then(release, release); setTimeout(release, 1200); } else release();
    if (app.selected === c.s) app.deselect();
    return c.base;
  }

  function replay() {
    const c = cur;
    if (!c?.inst) return;
    for (const off of c.offs) off();
    c.offs = [];
    removeInst(c.inst);
    c.inst = null;
    c.t = 0;
    c.capI = -1;
    resetLights();
    envTo(c.def.look ?? {}, 0.8);
    build(c);
  }

  // ---------- 解説（いつもの吹き出しの中身を、窓の端に寄せて出す） ----------
  function openDock() {
    if (!cur || docked) return;
    docked = true;
    overlay = { close: () => closeDock() };
    app.overlays.push(overlay);
    card.classList.add('is-under');
    popup.open(cur.s, { dock: true, onClose: () => closeDock() });
    requestAnimationFrame(() => { syncH(); frame(!reducedMotion()); });
  }
  function closeDock(quiet = false) {
    if (!docked) return;
    docked = false;
    const i = app.overlays.indexOf(overlay);
    if (i >= 0) app.overlays.splice(i, 1);
    overlay = null;
    popup.hide();
    card.classList.remove('is-under');
    if (quiet) return;
    syncH();
    requestAnimationFrame(() => frame(!reducedMotion()));
    read.focus({ preventScroll: true });
  }

  app.on('deselect', () => leave('back'));
  // 時代を動かして、その史跡がない時代に入ったら閉じる
  app.on('era', (era) => { if (cur && !cur.s.eras.includes(era.id)) app.deselect(); });
  new ResizeObserver(() => { if (cur) { syncH(); frame(false); } }).observe(map);
  // 場面の中身は、地図が落ち着いてから先に読み込んでおく
  setTimeout(() => { for (const k in SCENES) load(k).catch(() => {}); }, 2500);

  const stage = {
    has: (s) => !!(s && SCENES[s.special]),
    owns: (s) => stage.has(s),
    enter, leave, snapshot,
    get active() { return !!cur; },
    get site() { return cur?.s ?? null; },
  };
  app.stage = stage;
  return stage;
}
