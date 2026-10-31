// 起動：地形と史跡のデータを読み込み、地図と画面の部品をつなぐ。
// 開いた直後は、年代のスライダーを縄文から現代まで1秒で流してから現代で止まる。
import { loadGeo } from './map/geo.js';
import { createWorld } from './map/world.js';
import { NOW_YEAR, ERAS, ERA_BY_ID, eraIndexAtT, accentAtT, tToYear, yearToT, toCss } from './eras.js';
import { clamp, easeInOut, reducedMotion, sceneAt } from './util.js';
import { createTitle } from './ui/title.js';
import { createTimeline } from './ui/timeline.js';
import { createBand } from './ui/band.js';
import { createPins, isToday } from './ui/pins.js';
import { createPopup } from './ui/popup.js';
import { createTravel } from './ui/travel.js';
import { createAR } from './ar.js';
import { createPay } from './pay.js';
import { createFlavor } from './ui/flavor.js';
import { createZoom } from './ui/zoom.js';

// 現代の今年（小数の誤差で前の年に見えないよう、年の途中に置く）
const T_NOW = yearToT(NOW_YEAR + 0.5);
const body = document.body;
const root = document.documentElement;
const loading = document.getElementById('loading');
const params = new URLSearchParams(location.search);

async function loadJSON(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`${url} を読み込めませんでした`, err);
    return fallback;
  }
}

// 年表のデータ。timeline.json がまだないときは、史跡から詳しい年表だけを作る
function timelineData(raw, sites) {
  const major = (raw?.major ?? [])
    .map((m) => ({ year: Number(m.year), label: m.label ?? m.text ?? m.title, moji: !!m.moji }))
    .filter((m) => Number.isFinite(m.year) && m.label);
  let detail = (raw?.detail ?? [])
    .map((d) => ({ year: Number(d.year), era: d.era, text: d.text ?? d.label ?? d.title, siteId: d.siteId ?? d.site }))
    .filter((d) => Number.isFinite(d.year) && d.text);
  if (!detail.length) detail = sites.filter((s) => !s.dummy).map((s) => ({ year: s.year, era: s.eras[0], text: s.name, siteId: s.id }));
  return { major, detail };
}

function fail(message, err) {
  console.error(err);
  loading.textContent = message;
  loading.classList.add('is-error');
}

let geo, world;
const [geoResult, sitesData, timelineRaw, arData, dummyData] = await Promise.all([
  loadGeo('data/').catch((err) => err),
  loadJSON('data/sites.json', { sites: [] }),
  loadJSON('data/timeline.json', null),
  loadJSON('data/ar.json', { sites: {}, panos: {} }),
  // MVP 用のダミーの小さいピン（実在の史跡ではない。tools/build_dummy_pins.py）
  loadJSON('data/dummy_pins.json', { sites: [] }),
]);
if (geoResult instanceof Error) {
  fail('地図のデータを読み込めませんでした。ページを読み込み直してください。', geoResult);
} else {
  geo = geoResult;
  try {
    world = await createWorld(document.getElementById('map'), geo);
  } catch (err) {
    fail('この端末では立体の地図を表示できませんでした。別のブラウザか、パソコンで開いてください。', err);
  }
}
if (world) start(world, [...(sitesData?.sites ?? []), ...(dummyData?.sites ?? []).map((s) => ({ ...s, dummy: true }))], arData);

function start(world, sites, arData) {
  // 360度の画像がある史跡にだけ「ARで探検」を出す。
  // 時代ごとの場面がある史跡（巌流島）は、いまの年の場面を s.pano にして、年を動かすと入れ替える
  const sceneSites = [];
  for (const s of sites) {
    const scenes = arData?.views?.[s.id]?.scenes?.filter((c) => arData.panos?.[c.pano]);
    if (scenes?.length) {
      s.scenes = scenes;
      s.pano = sceneAt(s, NOW_YEAR).pano;
      sceneSites.push(s);
      continue;
    }
    const pano = arData?.sites?.[s.id];
    if (pano && arData.panos?.[pano]) s.pano ??= pano;
  }

  // ---------- 画面全体の状態 ----------
  const listeners = new Map();
  const app = {
    t: -1, year: NOW_YEAR, era: null, selected: null, tNow: T_NOW,
    sites, byId: new Map(sites.map((s) => [s.id, s])),
    overlays: [], // AR・決済の画面（上に重なったものから Esc で閉じる）
    on(type, f) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(f);
      return () => listeners.get(type).delete(f);
    },
    emit(type, ...args) { for (const f of listeners.get(type) ?? []) f(...args); },
    setT: (t) => setT(t),
    animateT, selectSite, deselect, backToNow,
    openAR: () => {},
    openPay: () => {},
  };

  const title = createTitle();

  // 年代を動かす。ピンは時代の区切りで入れ替わり、差し色と年は細かく変わる
  function setT(t, fromAnim = false) {
    if (!fromAnim) stopAnim();
    t = clamp(t, 0, 1);
    if (t === app.t) return;
    app.t = t;
    app.year = Math.min(NOW_YEAR, tToYear(t));
    world.setYear(app.year);
    root.style.setProperty('--era-accent', toCss(accentAtT(t)));
    const era = ERAS[eraIndexAtT(t)];
    if (era !== app.era) {
      const prev = app.era;
      app.era = era;
      title.setEra(era);
      body.dataset.era = era.id;
      app.emit('era', era, prev);
    }
    title.setYear(app.year);
    for (const s of sceneSites) {
      const c = sceneAt(s, app.year);
      if (c.pano !== s.pano) { s.pano = c.pano; app.emit('scene', s, c); }
    }
    app.emit('t', t);
  }

  let anim = null;
  function stopAnim() {
    if (!anim) return;
    cancelAnimationFrame(anim.raf);
    anim.resolve(false);
    anim = null;
  }
  // t をなめらかに動かす。途中で別の操作が入ったら false で終わる
  function animateT(to, ms) {
    stopAnim();
    to = clamp(to, 0, 1);
    const from = app.t;
    if (reducedMotion() || Math.abs(to - from) < 1e-4) { setT(to); return Promise.resolve(true); }
    ms ??= clamp(Math.abs(to - from) * 1400, 280, 720);
    return new Promise((resolve) => {
      const a = { resolve, raf: 0 };
      const t0 = performance.now();
      const step = (now) => {
        if (anim !== a) return;
        const k = Math.min(1, (now - t0) / ms);
        setT(from + (to - from) * easeInOut(k), true);
        if (k < 1) a.raf = requestAnimationFrame(step);
        else { anim = null; resolve(true); }
      };
      anim = a;
      a.raf = requestAnimationFrame(step);
    });
  }

  // ---------- 史跡を選ぶ ----------
  // 吹き出しが下に収まるよう、ピンを地図の窓の上寄り（高さ 28%）・左右の真ん中に置く視点
  function viewFor(s) {
    const pos = pins.position(s.id);
    const c = world.controls;
    const { H } = world.size;
    const d = Math.min(c.distance, world.home.distance * 0.55);
    const polar = c.polarAngle, az = c.azimuthAngle;
    const upp = (2 * d * Math.tan((world.camera.fov * Math.PI) / 360)) / H;
    const shift = ((0.5 - 0.28) * H * upp) / Math.max(0.35, Math.cos(polar));
    return { target: [pos.x + Math.sin(az) * shift, pos.y, pos.z + Math.cos(az) * shift], distance: d, polar, azimuth: az };
  }
  const eraOfSite = (s) => ERA_BY_ID[s.eras.find((id) => s.year >= ERA_BY_ID[id].start && s.year < ERA_BY_ID[id].end) ?? s.eras[0]];

  async function selectSite(id, { from = 'list' } = {}) {
    const s = app.byId.get(id);
    if (!s) return;
    if (app.selected === s) { if (from !== 'map') world.view(viewFor(s)); return; }
    if (isToday(s, app.era)) {
      // 現代の地図の一押しの史跡：その場所へ寄りながら、年を数えてその年までさかのぼる
      deselect();
      const e = eraOfSite(s);
      const m = (e.t1 - e.t0) * 0.01;
      world.view(viewFor(s));
      if (!(await travel.go(s, clamp(yearToT(s.year + 0.5), e.t0 + m, e.t1 - m)))) return;
      from = 'travel';
    } else if (!s.eras.includes(app.era.id)) {
      // その史跡の時代へ移ってから開く
      deselect();
      const e = eraOfSite(s);
      const pad = (e.t1 - e.t0) * 0.08;
      if (!(await animateT(clamp(yearToT(s.year), e.t0 + pad, e.t1 - pad)))) return;
    }
    app.selected = s;
    app.emit('select', s);
    // 地図の上で押したとき（さかのぼってきたときも）は、吹き出しが収まらない場合だけ視点を動かす
    if ((from !== 'map' && from !== 'travel') || popup.cramped) world.view(viewFor(s));
  }
  // 一押しの史跡の吹き出しから、年を数えながら現代へ戻る。戻ったら、いまの場所のピンを弾ませる
  async function backToNow(s) {
    deselect();
    if (await travel.go(s, T_NOW, true)) pins.pop(s.id);
  }
  function deselect() {
    const s = app.selected;
    if (!s) return;
    app.selected = null;
    app.emit('deselect', s);
  }

  // ---------- 画面の部品 ----------
  const { major, detail } = timelineData(timelineRaw, sites);
  const pins = createPins(app, world, sites);
  const popup = createPopup(app, world, pins);
  const travel = createTravel(app, world);
  createZoom(world, popup);
  const ar = createAR(app, world, arData);
  app.openAR = (s, img) => ar.open(s, img);
  const pay = createPay(app, world);
  app.openPay = (s) => pay.open(s);
  // 吹き出しを開いたら、360度の画像を先に読み込んでおく
  app.on('select', (s) => { if (s.pano) ar.preload(s.pano).catch(() => {}); });
  createBand(app, sites.filter((s) => !s.dummy)); // ダミーのピンは一覧に出さない
  createTimeline(app, { major, detail });
  createFlavor(app);

  // Esc：上に重なった画面から閉じる。何もなければ吹き出しを閉じる
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = app.overlays.at(-1);
    if (top) top.close();
    else deselect();
  });
  // 地図の何もないところを押したら（ドラッグでなければ）吹き出しを閉じる
  const canvas = world.renderer.domElement;
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && performance.now() - down.t < 300) deselect();
    down = null;
  });

  // ---------- 最初の画面 ----------
  const linkEra = ERA_BY_ID[params.get('era')];
  const linkT = params.has('t') ? clamp(Number(params.get('t')) || 0, 0, 1) : null;
  const linkSite = app.byId.get(params.get('site'));
  const deepLink = !!(linkEra || linkT != null || linkSite);
  const playIntro = !deepLink && params.get('intro') !== '0' && !reducedMotion();

  const startT = linkSite ? clamp(yearToT(linkSite.year), eraOfSite(linkSite).t0, eraOfSite(linkSite).t1 - 1e-6)
    : linkEra ? linkEra.tc : linkT ?? (playIntro ? 0 : T_NOW);
  setT(startT);
  world.settleCoast(); // 最初の画面は、その時代の海岸線から始める

  // 題字の書体がそろうまで待つ（最大 1.5 秒）
  const fonts = ['32px "Moji Brush"', '600 29px "Moji Mincho"', '700 27px "Moji Gothic"'].map((f) => document.fonts.load(f, '門司ヒストリーマップ現代'));
  Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 1500))]).then(() => {
    body.classList.remove('is-loading');
    if (playIntro) intro();
    else {
      body.classList.remove('is-intro');
      pins.releaseArrow(700);
      if (linkSite) setTimeout(() => selectSite(linkSite.id, { from: 'link' }), 350);
    }
  });

  // 冒頭の流し：はじめにゆっくり、すぐ速く、最後はブレーキをかけて現代へ（合計 1 秒）
  function sweep(tau) {
    const p = tau <= 0.12 ? 0.6 * tau + (1.6 / 0.24) * tau * tau
      : tau <= 0.45 ? 0.168 + 2.2 * (tau - 0.12)
        : (() => { const u = (tau - 0.45) / 0.55; return 0.894 + 0.55 * (2.2 * u - 1.9 * (u ** 3 - u ** 4 / 2)); })();
    return Math.min(1, p / 1.5815);
  }
  function intro() {
    const c = world.controls, home = world.home;
    let done = false;
    const stop = new AbortController();
    title.spin(true);
    // 少し寄って傾けたところから、引いて真上寄りのいつもの視点へ
    c.smoothTime = 0.5;
    world.view({ target: home.target, distance: home.distance * 0.82, polar: home.polar + 0.12, azimuth: home.azimuth }, false);
    world.goHome(true);
    const finish = () => {
      if (done) return;
      done = true;
      stop.abort();
      setT(T_NOW);
      title.spin(false);
      body.classList.remove('is-intro');
      setTimeout(() => { c.smoothTime = 0.25; }, 1600);
      pins.releaseArrow(1000);
    };
    for (const type of ['pointerdown', 'wheel', 'keydown']) addEventListener(type, finish, { capture: true, passive: true, signal: stop.signal });
    const t0 = performance.now();
    const step = (now) => {
      if (done) return;
      const tau = Math.min(1, (now - t0) / 1000);
      setT(sweep(tau) * T_NOW, true);
      if (tau < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }

  window.__app = app;
}
