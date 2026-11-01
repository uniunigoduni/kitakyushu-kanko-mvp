// 「ARで探検」：横長の360度画像を円筒の内側に貼り、円の真ん中に固定したカメラの向きをドラッグで変えて眺める。
// 見どころには丸を描き、丸から線を伸ばした先に四角い枠で説明を出す（丸・線・枠はどれも3D空間に置く）。左上に「地図へ戻る」。
// 時代ごとの場面がある史跡（巌流島）は、右の端に時代の一覧を出し、同じ向きのまま別の時代の画像に入れ替える。
// 動画がある史跡（壇ノ浦）は、動画の1コマ目の画像で開き、動画が動き出したら入れ替える。「地図へ戻る」の下に再生と音のボタン。
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clamp, easeInOut, h, historicalName, svg, reducedMotion } from './util.js';
import { pinLabel } from './ui/pins.js';

const RAD = Math.PI / 180;
const OPEN_MS = 180;   // 吹き出しの画像から全画面へ広げる時間（--t-move と同じ）
const EASE = 'cubic-bezier(.22,.8,.2,1)';
const STACK = 0.9;     // 画面の横÷縦がこれより小さい（縦長）ときは、説明の枠を丸の真上か真下に出す
// 線の長さなどは、横 2477px の画像の px で決めてある（大きさの違う画像・動画では K を掛けて、画面の上で同じ長さにする）
const LIFT = 34;       // 縦に出すときの、丸から枠までの線の長さ
const ELBOW = 24;      // 横に出すときの、線の折れ目から枠までの長さ
const NOTE_H = 70;     // 縦に出すときの枠の高さの目安。最初の向きを決めるのに使う
const KEY_STEP = 0.26; // 矢印キー1回で向きを変える角度（約15°）
const ARROWS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const FIND_MS = 1400;  // 開いてから、まだ見ていない見どころの方向の矢印を出すまで（最初に見える見どころを描き終えてから）
const FIND_GAP = 50;   // 方向の矢印どうしが重ならないように空ける間（px）
const FADE_MS = 700;   // 時代を切り替えるとき、前の画像から次の画像へ移る時間
const ERAS_HOT = 72;   // 画面の右の端からこの幅にマウスが来たら、時代の一覧を出す（px）
const ERAS_LEAVE = 250; // 一覧からマウスが離れてから閉じるまで（ms）
const PEEK_AT = 900, PEEK_MS = 1800; // 初めて開いたとき、一覧があることを知らせるために少しの間だけ出す
let peeked = false;

// gl_FragCoord は環境によって正しい値にならなかったので、画面の位置は頂点から渡す
const vertexShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vClip;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vClip = gl_Position.xyw;
  }`;
// 画像は周辺を少し落とすだけ（時代ごとのフィルターはかけない）。時代を切り替える間は map から map2 へ混ぜていく。
// 動画は一周したつなぎ目が合っていないので、右の端の uSeam（横幅の割合）を左の端に重ねてなじませる。
// また three.js は動画の色を変換せずに渡す（速さのため）ので、ここで直す（uVideo：map・map2 が動画なら 1）
const fragmentShader = /* glsl */`
  uniform sampler2D map;
  uniform sampler2D map2;
  uniform float uMix;
  uniform float uSeam;
  uniform vec2 uVideo;
  uniform vec2 uRes;
  varying vec2 vUv;
  varying vec3 vClip;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec4 pano(sampler2D m, vec2 st, float vid) {
    vec4 c = texture2D(m, st);
    if (uSeam > 0.0) {
      float t = clamp(st.x / uSeam, 0.0, 1.0);
      c = mix(texture2D(m, vec2(st.x + 1.0 - uSeam, st.y)), c, t * t * (3.0 - 2.0 * t));
    }
    return vid > 0.5 ? sRGBTransferEOTF(c) : c;
  }
  void main() {
    // 円筒の内側から見ると左右が逆になるので、横を反転して読む（一周は、左の端に重ねた分だけ短い）
    vec2 st = vec2((1.0 - vUv.x) * (1.0 - uSeam), vUv.y);
    gl_FragColor = pano(map, st, uVideo.x);
    if (uMix > 0.0) gl_FragColor = mix(gl_FragColor, pano(map2, st, uVideo.y), uMix);
    #include <colorspace_fragment>
    vec3 c = gl_FragColor.rgb;
    vec2 uv = vClip.xy / vClip.z * 0.5 + 0.5; // 画面の中の位置（左下0・右上1）
    vec2 q = uv - 0.5;
    c *= clamp(1.0 - dot(q, q) * 0.55, 0.0, 1.0);
    c += (hash(uv * uRes) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

function icon(d) {
  const el = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.append(svg('path', { d }));
  return el;
}
// 動画のボタンの絵
const PLAY = 'M7 4.5l12 7.5-12 7.5v-15z', PAUSE = 'M7 5h3v14H7zM14 5h3v14h-3z';
const SOUND = 'M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07', MUTED = 'M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6';

export function createAR(app, world, data) {
  const SIZE = data?.size ?? [2477, 1536];
  // 開いている画像の大きさ（動画は大きさが違うので、開くたびに measure で決める）。
  // TW・IH：画像の横・縦（px）。IW：一周の長さ（右の端の seam を左の端に重ねるので、そのぶん短い）。
  // R：一周がちょうど IW になる円筒の半径（画像の 1px = 1）。K：横 2477px の画像で決めた長さに掛ける割合
  let TW, IW, IH, R, K;
  function measure(cfg) {
    [TW, IH] = cfg.size ?? SIZE;
    IW = TW - (cfg.seam ?? 0);
    R = IW / (2 * Math.PI);
    K = IW / SIZE[0];
  }
  const appRoot = document.getElementById('app');
  const images = new Map();
  let gl = null;   // 描画の道具。最初に開いたときに作り、閉じても使い回す
  let view = null; // 開いている画面

  // 画像の px → 円筒の上の点
  const toWorld = (x, y) => {
    const th = (1 - x / IW) * Math.PI * 2;
    return new THREE.Vector3(R * Math.sin(th), IH / 2 - y, R * Math.cos(th));
  };
  // 画像の割合（u は横幅 TW に対する割合）→ その所を向くカメラの向き
  const yawOf = (u) => (1 - (u * TW) / IW) * Math.PI * 2 + Math.PI;
  const pitchOf = (v) => Math.atan(((0.5 - v) * IH) / R);

  // 史跡を選んだときに先に読み込んでおく
  function preload(pano) {
    if (!images.has(pano)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `assets/pano/${pano}.jpg`;
      images.set(pano, img.decode().then(() => img, (err) => { images.delete(pano); throw err; }));
    }
    return images.get(pano);
  }

  function tools() {
    if (gl) return gl;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.domElement.className = 'ar-canvas';
    const css = new CSS2DRenderer();
    css.domElement.className = 'ar-notes';
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 4000);
    camera.rotation.order = 'YXZ';
    gl = { renderer, css, camera };
    return gl;
  }

  function open(s, img) {
    const cfg = data?.panos?.[s.pano];
    if (view || !cfg) return;
    view = show(s, cfg, img?.closest('.popup-ar') ?? null);
  }

  function show(s, cfg, btn) {
    measure(cfg);
    const rm = reducedMotion();
    const coarse = matchMedia('(pointer: coarse)').matches;
    const stage = h('div', { class: 'ar-stage', tabindex: 0, role: 'img', 'aria-label': `360度の想像図${cfg.video ? 'の動画' : ''}。ドラッグか矢印キーで見回せます` });
    const back = h('button', { class: 'ar-back', type: 'button', onclick: () => close() }, icon('M15 5l-7 7 7 7'), h('span', { text: '地図へ戻る' }));
    // 動画：音を出して流す（できない端末では音を消して流す）。動きを減らす設定のときは、再生のボタンを押すまで止めておく
    const video = cfg.video ? h('video', { class: 'ar-video', src: cfg.video, loop: true, playsinline: true, preload: rm ? 'metadata' : 'auto', disablepictureinpicture: true, 'aria-hidden': 'true' }) : null;
    const playBtn = video && h('button', { class: 'ar-play', type: 'button', onclick: () => (video.paused ? play() : video.pause()) }, icon(PLAY));
    const soundBtn = video && h('button', { class: 'ar-sound', type: 'button', onclick: () => { video.muted = !video.muted; } }, icon(SOUND));
    const media = video && h('div', { class: 'ar-media', role: 'group', 'aria-label': '動画' }, playBtn, soundBtn);
    const scenes = s.scenes?.length > 1 ? s.scenes : null;
    let cur = scenes ? scenes.find((c) => c.pano === s.pano) ?? scenes[0] : null; // いま見ている場面（選んだ時点で切り替える）
    let shown = cur;                                          // 画像まで入れ替え終わった場面
    const sceneLine = scenes && h('span', { class: 'ar-scene', 'aria-live': 'polite' });
    const caption = h('p', { class: 'ar-caption' }, h('b', { id: 'ar-name', text: pinLabel(historicalName(s)) }), sceneLine, h('span', { text: '想像図（AIで生成）' }));
    const hint = h('p', { class: 'ar-hint', 'aria-hidden': 'true' }, icon('M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4'), h('span', { text: coarse ? '指でなぞって見回す' : 'ドラッグして見回す' }));
    const list = h('ul', { class: 'sr-only', 'aria-label': '見どころ' });
    const shade = h('div', { class: 'ar-shade' });
    const stamp = scenes && h('p', { class: 'ar-stamp', 'aria-hidden': 'true' });
    const el = h('div', { class: 'ar', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ar-name' }, shade, stage, back, media, caption, hint, list, stamp, video);
    const eras = scenes && erasPanel();
    if (eras) { el.append(eras.nav); markScene(); }
    document.body.append(el);

    const v = { yaw: 0, pitch: 0, vel: [0, 0], goal: null, tween: null, drag: null, W: 0, H: 0, f: 1, pitchMax: 0, mode: '', edge: null, finding: false, hold: 0, fade: null, own: false, dirty: true, ready: false, closed: false };
    let clone = null, grow = null, texture = null, ro = null, hintTimer = 0, findTimer = 0, aimTimer = 0, switching = 0;
    // 閉じるときに使うものは、途中で失敗して先へ進まなかったときにも使えるように、ここで用意しておく
    let stampAnim = null, vtex = null, vfc = 0, resume = false;
    const rvfc = !!video && 'requestVideoFrameCallback' in video;
    const entry = { close };
    app.overlays.push(entry);
    appRoot.inert = true;
    world.pause(true);
    back.focus({ preventScroll: true });

    let renderer, css, camera;
    try { ({ renderer, css, camera } = tools()); } catch (err) { console.error(err); return fail('この端末では360度の画像を表示できませんでした。'); }
    stage.append(renderer.domElement, css.domElement);

    // ---------- 円筒と見どころ ----------
    const scene = new THREE.Scene();
    const u = { map: { value: null }, map2: { value: null }, uMix: { value: 0 }, uSeam: { value: (cfg.seam ?? 0) / TW }, uVideo: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(1, 1) } };
    scene.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, IH, 128, 1, true),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false })));

    // 見どころ（時代を切り替えたら、前の場面のものを片付けて作り直す）
    let spots = [];
    function buildSpots() {
      for (const sp of spots) {
        for (const l of sp.lines) scene.remove(l);
        for (const g of new Set(sp.lines.map((l) => l.geometry))) g.dispose();
        for (const m of sp.mats) m.dispose();
        scene.remove(sp.label); // 外すと説明の枠の要素も消える
        if (document.activeElement === sp.find) stage.focus({ preventScroll: true });
        sp.find.remove();
      }
      spots = cfg.spots.map((sp, i) => {
        // 下に黒い縁取り（太く薄く）、上に白い線
        const mats = [
          new LineMaterial({ color: 0x000000, linewidth: 6, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
          new LineMaterial({ color: 0xffffff, linewidth: 2.5, transparent: true, depthTest: false, depthWrite: false }),
        ];
        const lines = mats.map((m, j) => { const l = new Line2(undefined, m); l.renderOrder = j + 1; l.visible = false; scene.add(l); return l; });
        const box = h('div', { class: 'ar-note-box' }, h('p', { text: sp.text }));
        const label = new CSS2DObject(h('div', { class: 'ar-note' }, box));
        scene.add(label);
        const find = h('button', { class: 'ar-find', type: 'button', hidden: true, 'aria-label': `見どころ${i + 1}の方を向く`, title: '見どころの方を向く' }, icon('M5 12h14M13 6l6 6-6 6'));
        // side：枠を出す側（layout で決める）、ax：上下に出す枠の、線を付ける横の位置（0〜1）
        const spot = { ...sp, mats, lines, box, label, find, center: toWorld(sp.u * TW, sp.v * IH), side: '', ax: 0.5, L: 0, ring: 0, t0: null, done: false };
        find.addEventListener('click', () => face(spot));
        return spot;
      });
      list.before(...spots.map((sp) => sp.find));
      list.replaceChildren(...cfg.spots.map((sp) => h('li', { text: sp.text })));
      if (v.mode) layout();
    }
    buildSpots();

    // 丸は線を伸ばす向きから描き始めて一周し、そのまま線を伸ばす。
    // 枠を出す側（side）：l・r は斜めに出てから水平に折れて丸の左右の枠へ、u・d は真上か真下へまっすぐ伸ばす。
    // 横長の画面はデータで決めた左右、縦長の画面は上下から始め、描き始めるときに画面に収まる側を選び直す（placeNotes）
    const vertical = (side) => side === 'u' || side === 'd';
    const homeSide = (sp) => (v.mode === 'stack' ? (sp.to[1] < 0 ? 'u' : 'd') : sp.to[0] < 0 ? 'l' : 'r');
    const lineEnd = (sp, side) => {
      const cx = sp.u * TW, cy = sp.v * IH;
      return vertical(side)
        ? [cx, cy + (side === 'u' ? -1 : 1) * (sp.r + LIFT * K)]
        : [cx + (side === 'r' ? 1 : -1) * Math.max(Math.abs(sp.to[0]), sp.r + 44 * K), cy + sp.to[1]];
    };
    function layout() {
      for (const sp of spots) { sp.side = homeSide(sp); sp.ax = 0.5; layoutSpot(sp); }
    }
    function layoutSpot(sp) {
      const cx = sp.u * TW, cy = sp.v * IH, r = sp.r;
      const end = lineEnd(sp, sp.side);
      let elbow = null;
      if (vertical(sp.side)) sp.label.center.set(sp.ax, sp.side === 'u' ? 1 : 0);
      else {
        const sx = sp.side === 'r' ? 1 : -1;
        elbow = [end[0] - sx * ELBOW * K, end[1]];
        sp.label.center.set(sx > 0 ? 0 : 1, 0.5);
      }
      const aim = elbow ?? end;
      const a0 = Math.atan2(aim[1] - cy, aim[0] - cx);
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const a = a0 + (i / 64) * Math.PI * 2;
        pts.push(toWorld(cx + r * Math.cos(a), cy + r * Math.sin(a)));
      }
      if (elbow) pts.push(toWorld(...elbow));
      pts.push(toWorld(...end));
      sp.L = 0;
      for (let i = 1; i < pts.length; i++) {
        sp.L += pts[i].distanceTo(pts[i - 1]);
        if (i === 64) sp.ring = sp.L;
      }
      const geo = new LineGeometry().setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      for (const old of new Set(sp.lines.map((l) => l.geometry))) old.dispose();
      for (const l of sp.lines) l.geometry = geo;
      sp.lines[1].computeLineDistances();
      for (const m of sp.mats) { m.dashSize = sp.L; m.gapSize = sp.L + 1; }
      sp.label.position.copy(pts.at(-1));
      paint(sp, performance.now());
    }

    // 描き始める見どころの枠を、画面からはみ出さず、ほかの枠や丸に重ならない側に置く。
    // 時代を切り替えると前の場面の向きのまま見どころが入ってくるので、データで決めた側では端で切れることがある。
    // 置き方の組み合わせ（1つの見どころに 2〜4 通り、同時に描き始めるのは多くて 3 つ）を全部くらべて、いちばん良いものにする
    const scr = new THREE.Vector3();
    function screenOf(x, y) {
      scr.copy(toWorld(x, y)).project(camera);
      return scr.z < 1 ? [((scr.x + 1) / 2) * v.W, ((1 - scr.y) / 2) * v.H] : null;
    }
    const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    function placeNotes(fresh) {
      const L = 8, Rt = v.W - 8, T = 8, B = v.H - 8;
      // 「地図へ戻る」・動画のボタン・題名・時代の一覧のつまみには重ねない（少し余白をとる）
      const blocks = [back, media, caption, eras?.tab].filter(Boolean).map((b) => { const r = b.getBoundingClientRect(); return [r.left - 6, r.top - 6, r.right + 6, r.bottom + 6]; });
      // 枠の四角（画面の px）。縦に出す枠は、画面の内側に収まるように線を付ける位置（ax）を左右にずらす
      function noteRect(sp, side) {
        const w = sp.box.offsetWidth || 240, nh = sp.box.offsetHeight || 130;
        const e = screenOf(...lineEnd(sp, side));
        if (!e) return null;
        const [ex, ey] = e;
        if (side === 'l') return { r: [ex - w, ey - nh / 2, ex, ey + nh / 2] };
        if (side === 'r') return { r: [ex, ey - nh / 2, ex + w, ey + nh / 2] };
        const right = Rt - (eras ? eras.tabW() : 0); // 上下に出す枠は、右の端のつまみの手前までに収める
        const ax = clamp(clamp(0.5, 1 - (right - ex) / w, (ex - L) / w), 0.12, 0.88), x0 = ex - w * ax;
        return { ax, r: side === 'u' ? [x0, ey - nh, x0 + w, ey] : [x0, ey, x0 + w, ey + nh] };
      }
      const rings = [];
      for (const sp of spots) {
        const cx = sp.u * TW, cy = sp.v * IH, a = screenOf(cx - sp.r, cy - sp.r), b = screenOf(cx + sp.r, cy + sp.r);
        if (a && b) rings.push({ sp, r: [Math.min(a[0], b[0]), a[1], Math.max(a[0], b[0]), b[1]] });
      }
      const fixed = spots.filter((sp) => sp.t0 != null).map((sp) => noteRect(sp, sp.side)?.r).filter(Boolean);
      const opts = fresh.map((sp) => {
        const home = homeSide(sp);
        const sides = v.mode === 'stack' ? ['u', 'd'] : ['l', 'r', 'u', 'd'];
        sides.sort((a, b) => (b === home) - (a === home) || (vertical(a) === vertical(home) ? -1 : 0) - (vertical(b) === vertical(home) ? -1 : 0));
        return sides.map((side, i) => {
          const o = noteRect(sp, side);
          if (!o) return null;
          const [x0, y0, x1, y1] = o.r;
          // はみ出し（px）は重く、決めた側から変えるのは少しだけ損にする
          let cost = [0, 30, 60, 70][i] + 4 * (Math.max(0, L - x0) + Math.max(0, x1 - Rt) + Math.max(0, T - y0) + Math.max(0, y1 - B));
          for (const g of rings) if (g.sp !== sp) { const a = overlap(o.r, g.r); if (a > 0) cost += 500 + a / 50; }
          for (const b of blocks) { const a = overlap(o.r, b); if (a > 0) cost += 800 + a / 20; }
          for (const f of fixed) { const a = overlap(o.r, f); if (a > 0) cost += 2000 + a / 50; }
          return { side, ...o, cost };
        }).filter(Boolean);
      });
      let best = null, bestCost = Infinity;
      const pick = [];
      (function walk(i, acc) {
        if (acc >= bestCost) return;
        if (i === fresh.length) { bestCost = acc; best = pick.slice(); return; }
        for (const o of opts[i]) {
          let c = acc + o.cost;
          for (let j = 0; j < i; j++) { const a = overlap(o.r, pick[j].r); if (a > 0) c += 2000 + a / 50; }
          pick[i] = o;
          walk(i + 1, c);
        }
      })(0, 0);
      fresh.forEach((sp, i) => {
        const o = best?.[i];
        if (!o) return;
        sp.side = o.side;
        sp.ax = o.ax ?? 0.5;
        layoutSpot(sp);
      });
    }

    // 描き込み：丸を 300ms、線を 250ms で引いてから枠を出す。破線の「線の部分」を伸ばして描く
    function paint(sp, now) {
      const t = sp.done ? Infinity : sp.t0 == null ? -1 : now - sp.t0;
      for (const l of sp.lines) l.visible = t >= 0;
      if (t < 0) return;
      const k1 = clamp(t / 300, 0, 1), k2 = clamp((t - 300) / 250, 0, 1);
      const drawn = sp.ring * easeInOut(k1) + (sp.L - sp.ring) * (1 - (1 - k2) ** 2);
      // 引き終えたら破線をやめて、つなぎ目を丸くする
      for (const m of sp.mats) { m.dashed = k2 < 1; m.dashOffset = sp.L - drawn; }
      if (k2 >= 1) { sp.done = true; sp.box.classList.add('is-on'); } // 動きを減らす設定では、はじめから引き終えた形
    }

    // 見どころの真ん中が初めて画面の内側に入ったら描き始める（同時に入ったものは少しずつずらす）
    const ndc = new THREE.Vector3();
    function trigger(now) {
      if (now < v.hold) return;
      const fresh = spots.filter((sp) => {
        if (sp.t0 != null) return false;
        ndc.copy(sp.center).project(camera);
        return ndc.z <= 1 && Math.abs(ndc.x) <= 0.8 && Math.abs(ndc.y) <= 0.8;
      });
      if (!fresh.length) return;
      placeNotes(fresh);
      fresh.forEach((sp, n) => {
        sp.t0 = now + 120 + n * 220;
        if (rm) sp.done = true;
        paint(sp, now);
      });
    }

    // まだ描いていない見どころは、画面の端にその方向を指す矢印を出す（押すとその方を向く）
    function edges() {
      const e = v.edge && eras?.open ? { ...v.edge, r: v.edge.rOpen } : v.edge;
      const cx = v.W / 2, cy = v.H / 2, placed = [];
      for (const sp of spots) {
        const off = !v.finding || !e || sp.t0 != null;
        if (sp.find.hidden !== off) {
          if (off && document.activeElement === sp.find) stage.focus({ preventScroll: true });
          sp.find.hidden = off;
        }
        if (off) continue;
        // 向きの差（左右は近いほうの回り方）。画面では右と下がプラス
        let dyaw = yawOf(sp.u) - v.yaw;
        dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
        const dx = -dyaw, dy = v.pitch - pitchOf(sp.v);
        let k = Infinity;
        if (dx) k = Math.min(k, ((dx > 0 ? e.r : e.l) - cx) / dx);
        if (dy) k = Math.min(k, ((dy > 0 ? e.b : e.t) - cy) / dy);
        if (!Number.isFinite(k)) continue;
        let x = cx + dx * k, y = cy + dy * k;
        // 先に置いた矢印と重なるときは、縁に沿ってずらす
        for (const q of placed) {
          if (Math.abs(q[0] - x) >= FIND_GAP || Math.abs(q[1] - y) >= FIND_GAP) continue;
          if (x <= e.l + 1 || x >= e.r - 1) y = clamp(y >= q[1] ? q[1] + FIND_GAP : q[1] - FIND_GAP, e.t, e.b);
          else x = clamp(x >= q[0] ? q[0] + FIND_GAP : q[0] - FIND_GAP, e.l, e.r);
        }
        placed.push([x, y]);
        sp.find.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        sp.find.firstChild.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      }
    }

    // 見どころの丸と説明の枠がまとめて画面の真ん中に入る向き（画像の割合）
    function aimAt(sp) {
      if (vertical(sp.side)) return [sp.u, sp.v + ((sp.side === 'u' ? -1 : 1) * (LIFT + NOTE_H) * K) / 2 / IH];
      // 丸の中心から枠の真ん中まで。枠の幅は 240px として、画像の px に直す
      const reach = Math.max(Math.abs(sp.to[0]), sp.r + 44 * K) + 120 / (v.f / R);
      return [sp.u + ((sp.side === 'r' ? 1 : -1) * reach) / 2 / TW, sp.v + sp.to[1] / 2 / IH];
    }

    // 方向の矢印を押したら、その見どころの方へなめらかに向きを変える（遠いほど少し長く）
    function face(sp, auto = false) {
      const [tu, tv] = aimAt(sp);
      let yaw = yawOf(tu);
      yaw += Math.round((v.yaw - yaw) / (Math.PI * 2)) * Math.PI * 2;
      const pitch = clamp(pitchOf(tv), -v.pitchMax, v.pitchMax);
      v.vel = [0, 0];
      v.goal = null;
      v.tween = null;
      if (rm) { v.yaw = yaw; v.pitch = pitch; }
      else {
        v.tween = { from: [v.yaw, v.pitch], to: [yaw, pitch], t0: performance.now(), ms: clamp(300 + 350 * Math.hypot(yaw - v.yaw, pitch - v.pitch), 300, 1200) };
        // 向き終わってから説明の枠を置く（動いている途中の向きで置くと、止まったときに端へ寄ってしまう）
        v.hold = Math.max(v.hold, v.tween.t0 + v.tween.ms);
      }
      v.dirty = true;
      if (auto) return;
      hideHint();
      // 押した矢印は見どころが描かれると消えるので、キーボードの操作は画面に移しておく
      if (document.activeElement === sp.find) stage.focus({ preventScroll: true });
    }

    // 時代を切り替えて、新しい見どころが1つも画面に入っていなければ、いちばん近いものの方を向く
    // （細い画面で起きやすい。自分で向きを変えた後は、同じ所を見比べられるようにそのままにする）
    function aimNearest() {
      if (v.own || v.drag || spots.some((sp) => sp.t0 != null)) return;
      let best = null, bd = Infinity;
      for (const sp of spots) {
        const [tu, tv] = aimAt(sp);
        let dyaw = yawOf(tu) - v.yaw;
        dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
        const d = Math.hypot(dyaw, pitchOf(tv) - v.pitch);
        if (d < bd) { bd = d; best = sp; }
      }
      if (best) face(best, true);
    }

    // ---------- 画面の大きさ ----------
    // 縦の画角は 60°。横に広い画面では横 90° まで、縦長の画面では横 45° を保つ（縦は 80° まで）
    function fit() {
      const W = stage.clientWidth, H = stage.clientHeight;
      if (!W || !H) return;
      v.W = W; v.H = H;
      const aspect = W / H;
      let fov = 60 * RAD;
      const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
      if (hfov > 90 * RAD) fov = 2 * Math.atan(1 / aspect);
      else if (hfov < 45 * RAD) fov = Math.min(80 * RAD, 2 * Math.atan(Math.tan(22.5 * RAD) / aspect));
      // 縦に短い動画（上下 78° ほど）でも、円筒の上下の縁が画面に入らないようにする
      fov = Math.min(fov, 2 * Math.atan(IH / 2 / R));
      camera.fov = fov / RAD;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      v.f = H / 2 / Math.tan(fov / 2);
      // 円筒の上下の縁が見えない所までしか見上げ・見下ろしできない
      v.pitchMax = Math.max(0, Math.atan(IH / 2 / R) - fov / 2);
      v.pitch = clamp(v.pitch, -v.pitchMax, v.pitchMax);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(W, H);
      css.setSize(W, H);
      renderer.getDrawingBufferSize(u.uRes.value);
      // 方向の矢印の真ん中を置ける範囲：左右は「地図へ戻る」と題名の外側に合わせ、上はそれと動画のボタンの下、下は操作の案内の下の端まで
      const rb = back.getBoundingClientRect(), rc = caption.getBoundingClientRect(), rh = hint.getBoundingClientRect();
      const top = Math.max(rb.bottom, rc.bottom, media ? media.getBoundingClientRect().bottom : 0);
      v.edge = { l: rb.left + 22, r: rc.right - 22, t: top + 8 + 22, b: rh.bottom - 22 };
      // 時代の一覧があるときは、右の端のつまみ（開いているときは一覧）にかからないようにする
      if (eras) {
        v.edge.r = Math.min(v.edge.r, W - eras.tabW() - 8 - 22);
        v.edge.rOpen = Math.min(v.edge.r, W - eras.openW() - 8 - 22);
      }
      const mode = aspect < STACK ? 'stack' : 'side';
      if (mode !== v.mode) { v.mode = mode; layout(); }
      v.dirty = true;
    }
    fit();
    ro = new ResizeObserver(() => fit());
    ro.observe(stage);

    // 最初に向く所：横長の画面は画像ごとの決めた向き、縦長の画面は最初の見どころ（丸と枠がまとめて入るように）
    const [u0, v0] = v.mode === 'stack' ? aimAt(spots[0]) : cfg.view;
    v.yaw = yawOf(u0);
    v.pitch = clamp(pitchOf(v0), -v.pitchMax, v.pitchMax);

    // ---------- 開く動き：吹き出しの画像を、開いたあとに同じ所が来る位置・大きさまで広げる ----------
    if (btn && !rm) {
      const r0 = btn.getBoundingClientRect();
      const [cx, cy, cw, ch] = cfg.crop ?? [0, 0, TW, IH];
      // 吹き出しの枠には、切り抜きの真ん中が枠いっぱいに入っている（はみ出しは切ってある）
      const A = r0.width / r0.height;
      const vw = Math.min(cw, ch * A), vh = vw / A;
      const vx = cx + (cw - vw) / 2, vy = cy + (ch - vh) / 2;
      const k = v.f / R; // 画面の真ん中での、画像 1px の大きさ
      let dx = vx + vw / 2 - u0 * TW;
      dx -= Math.round(dx / IW) * IW;
      const dy = vy + vh / 2 - (IH / 2 - R * Math.tan(v.pitch));
      const w1 = vw * k, h1 = vh * k;
      // 背景の位置（%）。画像の高さいっぱいを切り抜いたとき（動画）は動かす余地がないので真ん中
      const pos = (a, room) => (room > 0.5 ? (a / room) * 100 : 50);
      clone = h('div', { class: 'ar-clone' });
      Object.assign(clone.style, {
        backgroundImage: `url(assets/pano/${s.pano}.jpg), url(assets/pano/${s.pano}_thumb.jpg)`,
        backgroundSize: `${(TW / vw) * 100}% ${(IH / vh) * 100}%, cover`,
        backgroundPosition: `${pos(vx, TW - vw)}% ${pos(vy, IH - vh)}%, center`,
      });
      el.insertBefore(clone, back);
      btn.style.visibility = 'hidden';
      grow = clone.animate([
        { left: `${r0.left}px`, top: `${r0.top}px`, width: `${r0.width}px`, height: `${r0.height}px`, borderRadius: '12px' },
        { left: `${v.W / 2 + dx * k - w1 / 2}px`, top: `${v.H / 2 + dy * k - h1 / 2}px`, width: `${w1}px`, height: `${h1}px`, borderRadius: '0px' },
      ], { duration: OPEN_MS, easing: EASE, fill: 'forwards' });
      shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'ease' });
    } else if (!rm) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease' });
    }

    // 線の描き方は2通り（引いている途中は破線、引き終わったら普通の線）。両方を先に用意して、描き始めに引っかからないようにする
    function warm() {
      for (const dashed of [true, false]) {
        for (const sp of spots) for (const m of sp.mats) m.dashed = dashed;
        renderer.compile(scene, camera);
      }
      renderer.initTexture(texture);
      if (v.fade) renderer.initTexture(v.fade.next);
    }

    // ---------- 描く ----------
    let last = performance.now();
    function draw(now) {
      u.uVideo.value.set(u.map.value?.isVideoTexture ? 1 : 0, u.map2.value?.isVideoTexture ? 1 : 0);
      camera.rotation.set(v.pitch, v.yaw, 0);
      camera.updateMatrixWorld();
      if (v.ready) { trigger(now); edges(); }
      renderer.render(scene, camera);
      css.render(scene, camera);
    }
    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // 手を離したあとの惰性
      if (!v.drag && (v.vel[0] || v.vel[1])) {
        v.yaw += v.vel[0] * dt;
        const p = v.pitch + v.vel[1] * dt;
        v.pitch = clamp(p, -v.pitchMax, v.pitchMax);
        if (v.pitch !== p) v.vel[1] = 0;
        const k = Math.exp(-5 * dt);
        v.vel = Math.hypot(v.vel[0], v.vel[1]) * k < 0.01 ? [0, 0] : [v.vel[0] * k, v.vel[1] * k];
        v.dirty = true;
      }
      // 方向の矢印を押したときの向き直り
      if (v.tween) {
        const tw = v.tween, k = clamp((now - tw.t0) / tw.ms, 0, 1), e = easeInOut(k);
        v.yaw = tw.from[0] + (tw.to[0] - tw.from[0]) * e;
        v.pitch = tw.from[1] + (tw.to[1] - tw.from[1]) * e;
        if (k >= 1) v.tween = null;
        v.dirty = true;
      }
      // 矢印キーで決めた向きへ寄せる
      if (v.goal) {
        const k = 1 - Math.exp(-10 * dt);
        v.yaw += (v.goal[0] - v.yaw) * k;
        v.pitch += (v.goal[1] - v.pitch) * k;
        if (Math.abs(v.goal[0] - v.yaw) + Math.abs(v.goal[1] - v.pitch) < 1e-3) { [v.yaw, v.pitch] = v.goal; v.goal = null; }
        v.dirty = true;
      }
      // 時代の切り替え：前の画像から次の画像へ混ぜていく
      if (v.fade) {
        const k = clamp((now - v.fade.t0) / FADE_MS, 0, 1);
        u.uMix.value = easeInOut(k);
        if (k >= 1) endFade();
        v.dirty = true;
      }
      for (const sp of spots) if (sp.t0 != null && !sp.done) { paint(sp, now); v.dirty = true; }
      // 動画のコマが届いたことを知らせる仕組みがないブラウザでは、流している間は毎回描く
      if (video && !rvfc && !video.paused && video.readyState >= video.HAVE_CURRENT_DATA) { useVideo(); v.dirty = true; }
      if (!v.dirty) return;
      v.dirty = false;
      draw(now);
    }

    // ---------- 操作 ----------
    // つかんで動かす：指・マウスを右へ動かすと、画像も右へ動く（右に隠れていた所が左から出てくる）
    const hideHint = () => { clearTimeout(hintTimer); hint.classList.add('is-gone'); };
    stage.addEventListener('pointerdown', (e) => {
      if (v.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      v.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: 0 };
      v.vel = [0, 0];
      v.goal = null;
      v.tween = null;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', (e) => {
      const d = v.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = (e.clientX - d.x) / v.f, dy = (e.clientY - d.y) / v.f;
      if (!dx && !dy) return;
      const dt = Math.max(8, e.timeStamp - d.t) / 1000;
      d.moved += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
      d.x = e.clientX; d.y = e.clientY; d.t = e.timeStamp;
      v.yaw += dx;
      v.pitch = clamp(v.pitch + dy, -v.pitchMax, v.pitchMax);
      v.vel = [v.vel[0] * 0.5 + (dx / dt) * 0.5, v.vel[1] * 0.5 + (dy / dt) * 0.5];
      v.dirty = true;
      if (d.moved > 6) { v.own = true; hideHint(); }
    });
    const release = (e) => {
      const d = v.drag;
      if (!d || e.pointerId !== d.id) return;
      // 止めてから離したときや、動きを減らす設定のときは惰性をつけない
      if (rm || e.timeStamp - d.t > 80) v.vel = [0, 0];
      v.drag = null;
      stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    el.addEventListener('keydown', (e) => {
      const d = ARROWS[e.key];
      if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      v.tween = null;
      const g = v.goal ?? [v.yaw, v.pitch];
      v.goal = [g[0] + d[0] * KEY_STEP, clamp(g[1] + d[1] * KEY_STEP, -v.pitchMax, v.pitchMax)];
      v.vel = [0, 0];
      if (rm) { [v.yaw, v.pitch] = v.goal; v.goal = null; }
      v.own = true;
      v.dirty = true;
      hideHint();
    });

    // ---------- 動画：1コマ目の画像で開いておき、画面ができてから動画のコマが届いたら動画に入れ替える ----------
    // 再生は「ARで探検」を押した流れの中で始める（あとからだと、音を出して流せない端末がある）
    function play() {
      video.play()?.catch((err) => {
        if (err.name === 'NotAllowedError' && !video.muted && !v.closed) { video.muted = true; play(); }
      });
    }
    // 新しいコマが届くたびに描き直す（止めている間は描かない）
    function onFrame() {
      vfc = video.requestVideoFrameCallback(onFrame);
      useVideo();
      v.dirty = true;
    }
    function useVideo() {
      if (vtex || !v.ready || v.closed) return;
      vtex = new THREE.VideoTexture(video);
      vtex.colorSpace = THREE.SRGBColorSpace;
      vtex.wrapS = THREE.RepeatWrapping;
      vtex.needsUpdate = true; // いま出ているコマをすぐ貼る（止めているときは、次のコマを待っても来ない）
      if (v.fade) endFade();
      if (rm) { texture?.dispose(); texture = vtex; u.map.value = vtex; }
      else { u.map2.value = vtex; u.uMix.value = 0; v.fade = { t0: performance.now(), next: vtex }; }
      v.dirty = true;
    }
    const setButton = (b, d, label) => { b.querySelector('path').setAttribute('d', d); b.setAttribute('aria-label', label); b.title = label; };
    function showMedia() {
      setButton(playBtn, video.paused ? PLAY : PAUSE, video.paused ? '動画を再生する' : '動画を止める');
      setButton(soundBtn, video.muted ? MUTED : SOUND, video.muted ? '音を出す' : '音を消す');
      // 読み込みを待っている間は、再生のボタンを点滅させる
      media.classList.toggle('is-waiting', !video.paused && video.readyState < video.HAVE_FUTURE_DATA);
    }
    // ほかのタブやアプリに移ったら止め、戻ったら続ける
    function onVisible() {
      if (document.hidden) { if (!video.paused) { resume = true; video.pause(); } }
      else if (resume) { resume = false; play(); }
    }
    if (video) {
      for (const t of ['play', 'pause', 'playing', 'waiting', 'canplay', 'volumechange']) video.addEventListener(t, showMedia);
      // 動画を読めないときは、1コマ目の画像のままにしてボタンを隠す
      video.addEventListener('error', () => { if (v.closed) return; console.error(video.error); video.pause(); media.hidden = true; fit(); });
      document.addEventListener('visibilitychange', onVisible);
      if (rvfc) vfc = video.requestVideoFrameCallback(onFrame);
      showMedia();
      if (!rm) play();
    }

    // ---------- 画像がそろったら、広げた画像から本物の画面に切り替える ----------
    (async () => {
      let image;
      try { image = await preload(s.pano); } catch (err) { console.error(err); fail('画像を読み込めませんでした。地図へ戻って、もう一度お試しください。'); return; }
      if (v.closed) return;
      texture = makeTexture(image);
      u.map.value = texture;
      await grow?.finished.catch(() => {});
      if (v.closed) return;
      warm();
      draw(performance.now());
      el.classList.add('is-ready');
      v.ready = true;
      v.dirty = true;
      last = performance.now();
      renderer.setAnimationLoop(tick);
      if (clone) {
        const c = clone;
        clone = null;
        c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease', fill: 'forwards' }).finished.then(() => c.remove(), () => c.remove());
      }
      hintTimer = setTimeout(hideHint, 4000);
      findTimer = setTimeout(() => { v.finding = true; v.dirty = true; }, FIND_MS);
      if (eras) {
        preloadNear();
        // 初めて開いたときだけ、時代の一覧があることを知らせる
        if (!peeked && !rm) { peeked = true; eras.peek(); }
      }
    })();

    function makeTexture(image) {
      const tex = new THREE.Texture(image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping; // 一周したつなぎ目もなめらかに
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.needsUpdate = true;
      return tex;
    }

    // ---------- 時代の切り替え：向きはそのままで、画像と見どころを入れ替える ----------
    async function go(c) {
      if (!v.ready || v.closed || c === cur) return;
      cur = c;
      markScene();
      const id = ++switching;
      if (c === shown) return;
      let image;
      try { image = await preload(c.pano); } catch (err) {
        console.error(err);
        if (id === switching) { cur = shown; markScene(); }
        return;
      }
      if (v.closed || id !== switching) return;
      if (v.fade) endFade(); // 前の切り替えの途中なら、そこで終えてから始める
      const next = makeTexture(image);
      cfg = data.panos[c.pano];
      shown = c;
      buildSpots();
      warm();
      renderer.initTexture(next);
      const now = performance.now();
      clearTimeout(findTimer);
      clearTimeout(aimTimer);
      v.finding = false;
      if (rm) {
        texture?.dispose();
        texture = next;
        u.map.value = next;
      } else {
        u.map2.value = next;
        u.uMix.value = 0;
        v.fade = { t0: now, next };
        v.hold = now + FADE_MS * 0.6;
      }
      findTimer = setTimeout(() => { v.finding = true; v.dirty = true; }, FIND_MS + (rm ? 0 : FADE_MS));
      aimTimer = setTimeout(() => { if (!v.closed) aimNearest(); }, (rm ? 0 : FADE_MS) + 250);
      showStamp(c);
      preloadNear();
      v.dirty = true;
    }
    function endFade() {
      const old = texture;
      texture = v.fade.next;
      u.map.value = texture;
      u.map2.value = null;
      u.uMix.value = 0;
      v.fade = null;
      old?.dispose();
    }
    // 前後の時代の画像を先に読んでおく
    function preloadNear() {
      const i = scenes.indexOf(cur);
      for (const c of [scenes[i + 1], scenes[i - 1]]) if (c) preload(c.pano).catch(() => {});
    }
    function markScene() {
      sceneLine.textContent = `${cur.year}　${cur.name}`;
      eras.mark(cur);
    }
    // 切り替えた時代の名前を、画面の真ん中に少しの間だけ出す
    function showStamp(c) {
      stamp.replaceChildren(h('span', { text: c.year }), h('b', { text: c.name }));
      stampAnim?.cancel();
      stampAnim = stamp.animate(rm
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.95 }, { opacity: 0 }]
        : [{ opacity: 0, transform: 'translate(-50%, -50%) scale(.97)' }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.15 }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%, -50%)' }],
        { duration: 1700, easing: 'ease', fill: 'forwards' });
    }

    // ---------- 時代の一覧（右の端。普段はつまみだけ出しておき、マウスを寄せるか押すと開く） ----------
    function erasPanel() {
      const lead = data.views?.[s.id]?.lead;
      const btns = scenes.map((c) => h('button', { class: 'ar-era', type: 'button', onclick: () => go(c) },
        h('img', { src: `assets/pano/${c.pano}_thumb.jpg`, alt: '', decoding: 'async' }),
        h('span', { class: 'ar-era-text' }, h('span', { class: 'ar-era-year', text: c.year }), h('span', { class: 'ar-era-name', text: c.name }))));
      const tab = h('button', { class: 'ar-eras-tab', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ar-eras-panel', 'aria-label': '別の時代を見る',
        // マウスを寄せて開いたときに押しても閉じない。キーボードで開いたら、いまの時代へ移る
        onclick: (e) => { set(hover || !api.open); if (api.open && e.detail === 0) current().focus({ preventScroll: true }); } },
        icon('M15 5l-7 7 7 7'), h('span', { text: '別の時代' }));
      // 新しい時代を上に
      const panel = h('div', { class: 'ar-eras-panel thin-scroll', id: 'ar-eras-panel' },
        h('p', { class: 'ar-eras-title', text: '同じ場所の、別の時代' }),
        lead && h('p', { class: 'ar-eras-lead', text: lead }),
        h('ol', { class: 'ar-eras-list' }, btns.map((b) => h('li', {}, b)).reverse()));
      const nav = h('nav', { class: 'ar-eras', 'aria-label': '同じ場所の別の時代' }, tab, panel);
      panel.inert = true;
      let timer = 0, peekTimer = 0, peeking = false, hover = false;
      const current = () => btns[scenes.indexOf(cur)] ?? btns[0];
      const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(() => { timer = 0; fn(); }, ms); };
      function set(open, peek = false) {
        clearTimeout(timer);
        timer = 0;
        peeking = open && peek;
        if (open === api.open) return;
        api.open = open;
        nav.classList.toggle('is-open', open);
        tab.setAttribute('aria-expanded', String(open));
        panel.inert = !open;
        if (open) {
          // いまの時代が見える所まで一覧を流しておく
          const li = current().parentElement;
          if (li.offsetTop < panel.scrollTop || li.offsetTop + li.offsetHeight > panel.scrollTop + panel.clientHeight) {
            panel.scrollTop = li.offsetTop - (panel.clientHeight - li.offsetHeight) / 2;
          }
        }
        v.dirty = true;
      }
      // マウスが上にあるとき・キーボードで一覧の中を選んでいるときは閉じない
      function close() {
        if (hover || nav.querySelector(':focus-visible')) return;
        if (nav.contains(document.activeElement)) stage.focus({ preventScroll: true });
        set(false);
      }
      // 一覧から離れたら少し待って閉じる（動かし続けていても待つ時間は延ばさない）
      const closeSoon = () => { if (api.open && !timer) later(close, ERAS_LEAVE); };

      el.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || v.drag || !v.ready) return;
        if (e.clientX >= v.W - ERAS_HOT) set(true);
        else if (!hover && !peeking) closeSoon();
      });
      nav.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true; set(true); } });
      nav.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = false; closeSoon(); } });
      el.addEventListener('pointerleave', () => { hover = false; if (!peeking) closeSoon(); });
      // 画像に触れたら閉じる（指で開いたとき・知らせている間も）
      stage.addEventListener('pointerdown', () => { clearTimeout(peekTimer); if (api.open) set(false); });
      nav.addEventListener('focusout', (e) => { if (!nav.contains(e.relatedTarget)) closeSoon(); });
      nav.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && api.open) { e.stopPropagation(); tab.focus({ preventScroll: true }); set(false); return; }
        if (!ARROWS[e.key] && e.key !== 'Home' && e.key !== 'End') return;
        const items = [...panel.querySelectorAll('.ar-era')];
        const i = items.indexOf(document.activeElement);
        if (i < 0) return; // つまみの上では、矢印キーでそのまま見回せる
        e.preventDefault();
        e.stopPropagation(); // 一覧の中の矢印キーでは見回さない
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : clamp(i + step, 0, items.length - 1)].focus();
      });

      const api = {
        nav, open: false,
        tab,
        tabW: () => tab.offsetWidth,
        openW: () => panel.offsetWidth + tab.offsetWidth,
        mark(c) {
          for (const [i, b] of btns.entries()) {
            if (scenes[i] === c) b.setAttribute('aria-current', 'true');
            else b.removeAttribute('aria-current');
          }
        },
        // マウスの端末では一覧を少しの間だけ出し、指の端末ではつまみを揺らす（一覧を出すと画像の大半が隠れるので）
        peek() {
          peekTimer = setTimeout(() => {
            if (api.open || v.closed) return;
            if (coarse) {
              tab.animate([{ transform: 'none' }, { transform: 'translateX(-10px)', backgroundColor: 'rgba(255, 255, 255, .28)', offset: 0.35 }, { transform: 'none', offset: 0.7 }, { transform: 'none' }],
                { duration: 1100, easing: 'ease-in-out', iterations: 2 });
              return;
            }
            set(true, true);
            peekTimer = setTimeout(() => { if (peeking) close(); }, PEEK_MS);
          }, PEEK_AT);
        },
        stop() { clearTimeout(timer); clearTimeout(peekTimer); },
      };
      return api;
    }

    function fail(message) {
      clone?.remove();
      clone = null;
      video?.pause();
      if (media) media.hidden = true;
      stage.hidden = true;
      hint.hidden = true;
      el.insertBefore(h('p', { class: 'ar-error', role: 'alert', text: message }), back);
      return { close };
    }

    // ---------- 閉じる ----------
    function close() {
      if (v.closed) return;
      v.closed = true;
      video?.pause();
      clearTimeout(hintTimer);
      clearTimeout(findTimer);
      clearTimeout(aimTimer);
      eras?.stop();
      stampAnim?.cancel();
      const i = app.overlays.indexOf(entry);
      if (i >= 0) app.overlays.splice(i, 1);
      appRoot.inert = false;
      world.pause(false);
      if (btn) { btn.style.visibility = ''; if (btn.isConnected) btn.focus({ preventScroll: true }); }
      const done = () => {
        if (renderer) {
          renderer.setAnimationLoop(null);
          scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
          texture?.dispose();
          v.fade?.next.dispose();
          renderer.renderLists.dispose();
          css.domElement.replaceChildren();
        }
        ro?.disconnect();
        // 動画の読み込みも止める
        if (video) {
          document.removeEventListener('visibilitychange', onVisible);
          if (vfc) video.cancelVideoFrameCallback(vfc);
          video.removeAttribute('src');
          video.load();
        }
        el.remove();
        view = null;
      };
      if (rm) done();
      else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease', fill: 'forwards' }).finished.then(done, done);
    }

    return { close };
  }

  return { open, preload, get isOpen() { return !!view; } };
}
