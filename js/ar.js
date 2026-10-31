// 「ARで探検」：横長の360度画像を円筒の内側に貼り、円の真ん中に固定したカメラの向きをドラッグで変えて眺める。
// 見どころには丸を描き、丸から線を伸ばした先に四角い枠で説明を出す（丸・線・枠はどれも3D空間に置く）。左上に「地図へ戻る」。
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clamp, easeInOut, h, svg, reducedMotion } from './util.js';
import { pinLabel } from './ui/pins.js';

const RAD = Math.PI / 180;
const OPEN_MS = 180;   // 吹き出しの画像から全画面へ広げる時間（--t-move と同じ）
const EASE = 'cubic-bezier(.22,.8,.2,1)';
const STACK = 0.9;     // 画面の横÷縦がこれより小さい（縦長）ときは、説明の枠を丸の真上か真下に出す
const LIFT = 34;       // 縦に出すときの、丸から枠までの線の長さ（画像の px）
const ELBOW = 24;      // 横に出すときの、線の折れ目から枠までの長さ（画像の px）
const NOTE_H = 70;     // 縦に出すときの枠の高さの目安（画像の px）。最初の向きを決めるのに使う
const KEY_STEP = 0.26; // 矢印キー1回で向きを変える角度（約15°）
const ARROWS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const FIND_MS = 1400;  // 開いてから、まだ見ていない見どころの方向の矢印を出すまで（最初に見える見どころを描き終えてから）
const FIND_GAP = 50;   // 方向の矢印どうしが重ならないように空ける間（px）

// gl_FragCoord は環境によって正しい値にならなかったので、画面の位置は頂点から渡す
const vertexShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vClip;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vClip = gl_Position.xyw;
  }`;
// 地図の白黒の時代（js/map/grade.js）と同じフィルムの傷み。film のない画像は周辺を少し落とすだけ
const fragmentShader = /* glsl */`
  uniform sampler2D map;
  uniform vec2 uRes;
  uniform float uFilm, uFlicker, uFrame;
  uniform vec4 uScratch;
  varying vec2 vUv;
  varying vec3 vClip;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // 円筒の内側から見ると左右が逆になるので、横を反転して読む
    gl_FragColor = texture2D(map, vec2(1.0 - vUv.x, vUv.y));
    #include <colorspace_fragment>
    vec3 c = gl_FragColor.rgb;
    vec2 uv = vClip.xy / vClip.z * 0.5 + 0.5; // 画面の中の位置（左下0・右上1）
    vec2 px = uv * uRes;
    if (uFilm > 0.5) {
      c *= uFlicker;
      c += (hash(floor(px / 1.5) + uFrame * 7.13) - 0.5) * 0.07;
      for (int i = 0; i < 3; i++) {
        float sx = uScratch[i];
        if (sx >= 0.0) {
          float d = abs(uv.x - sx) * uRes.x;
          float a = exp(-d * d / 1.2) * smoothstep(0.3, 0.75, vnoise(vec2(sx * 40.0, uv.y * 7.0 + uFrame)));
          c = mix(c, vec3(0.94, 0.92, 0.86), a * uScratch.w);
        }
      }
    }
    vec2 q = uv - 0.5;
    c *= clamp(1.0 - dot(q, q) * mix(0.55, 1.45, uFilm), 0.0, 1.0);
    c += (hash(px + fract(uFrame * 0.618) * 17.0) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

function icon(d) {
  const el = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.append(svg('path', { d }));
  return el;
}

export function createAR(app, world, data) {
  const [IW, IH] = data?.size ?? [2477, 1536];
  const R = IW / (2 * Math.PI); // 画像の横幅がちょうど一周になる半径（画像の 1px = 1）
  const appRoot = document.getElementById('app');
  const images = new Map();
  let gl = null;   // 描画の道具。最初に開いたときに作り、閉じても使い回す
  let view = null; // 開いている画面

  // 画像の px → 円筒の上の点
  const toWorld = (x, y) => {
    const th = (1 - x / IW) * Math.PI * 2;
    return new THREE.Vector3(R * Math.sin(th), IH / 2 - y, R * Math.cos(th));
  };
  const yawOf = (u) => (1 - u) * Math.PI * 2 + Math.PI;
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
    const rm = reducedMotion();
    const coarse = matchMedia('(pointer: coarse)').matches;
    const stage = h('div', { class: 'ar-stage', tabindex: 0, role: 'img', 'aria-label': '360度の想像図。ドラッグか矢印キーで見回せます' });
    const back = h('button', { class: 'ar-back', type: 'button', onclick: () => close() }, icon('M15 5l-7 7 7 7'), h('span', { text: '地図へ戻る' }));
    const caption = h('p', { class: 'ar-caption' }, h('b', { id: 'ar-name', text: pinLabel(s.name) }), h('span', { text: '想像図（AIで生成）' }));
    const hint = h('p', { class: 'ar-hint', 'aria-hidden': 'true' }, icon('M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4'), h('span', { text: coarse ? '指でなぞって見回す' : 'ドラッグして見回す' }));
    const finds = cfg.spots.map((_, i) => h('button', { class: 'ar-find', type: 'button', hidden: true, 'aria-label': `見どころ${i + 1}の方を向く`, title: '見どころの方を向く' }, icon('M5 12h14M13 6l6 6-6 6')));
    const list = h('ul', { class: 'sr-only', 'aria-label': '見どころ' }, cfg.spots.map((sp) => h('li', { text: sp.text })));
    const shade = h('div', { class: 'ar-shade' });
    const el = h('div', { class: 'ar', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ar-name' }, shade, stage, back, caption, hint, finds, list);
    document.body.append(el);

    const v = { yaw: 0, pitch: 0, vel: [0, 0], goal: null, tween: null, drag: null, W: 0, H: 0, f: 1, pitchMax: 0, mode: '', edge: null, finding: false, dirty: true, ready: false, closed: false };
    let clone = null, grow = null, texture = null, ro = null, hintTimer = 0, findTimer = 0;
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
    const u = {
      map: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uFilm: { value: cfg.film ? 1 : 0 }, uFlicker: { value: 1 }, uFrame: { value: 0 },
      uScratch: { value: new THREE.Vector4(-1, -1, -1, 0) },
    };
    scene.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, IH, 128, 1, true),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false })));

    const spots = cfg.spots.map((sp, i) => {
      // 下に黒い縁取り（太く薄く）、上に白い線
      const mats = [
        new LineMaterial({ color: 0x000000, linewidth: 6, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
        new LineMaterial({ color: 0xffffff, linewidth: 2.5, transparent: true, depthTest: false, depthWrite: false }),
      ];
      const lines = mats.map((m, i) => { const l = new Line2(undefined, m); l.renderOrder = i + 1; l.visible = false; scene.add(l); return l; });
      const box = h('div', { class: 'ar-note-box' }, h('p', { text: sp.text }));
      const label = new CSS2DObject(h('div', { class: 'ar-note' }, box));
      scene.add(label);
      const spot = { ...sp, mats, lines, box, label, find: finds[i], center: toWorld(sp.u * IW, sp.v * IH), L: 0, ring: 0, t0: null, done: false };
      spot.find.addEventListener('click', () => face(spot));
      return spot;
    });

    // 丸は線を伸ばす向きから描き始めて一周し、そのまま線を伸ばす。
    // 横長の画面では斜めに出てから水平に折れて枠へ、縦長の画面では真上か真下へまっすぐ伸ばす
    function layout() {
      for (const sp of spots) {
        const cx = sp.u * IW, cy = sp.v * IH, r = sp.r;
        let end, elbow = null;
        if (v.mode === 'stack') {
          const up = sp.to[1] < 0;
          end = [cx, cy + (up ? -1 : 1) * (r + LIFT)];
          sp.label.center.set(0.5, up ? 1 : 0);
        } else {
          const sx = sp.to[0] < 0 ? -1 : 1;
          end = [cx + sx * Math.max(Math.abs(sp.to[0]), r + 44), cy + sp.to[1]];
          elbow = [end[0] - sx * ELBOW, end[1]];
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
      if (k2 >= 1 && !sp.done) { sp.done = true; sp.box.classList.add('is-on'); }
    }

    // 見どころの真ん中が初めて画面の内側に入ったら描き始める（同時に入ったものは少しずつずらす）
    const ndc = new THREE.Vector3();
    function trigger(now) {
      let n = 0;
      for (const sp of spots) {
        if (sp.t0 != null) continue;
        ndc.copy(sp.center).project(camera);
        if (ndc.z > 1 || Math.abs(ndc.x) > 0.8 || Math.abs(ndc.y) > 0.8) continue;
        sp.t0 = now + 120 + n++ * 220;
        if (rm) sp.done = true;
        paint(sp, now);
      }
    }

    // まだ描いていない見どころは、画面の端にその方向を指す矢印を出す（押すとその方を向く）
    function edges() {
      const e = v.edge, cx = v.W / 2, cy = v.H / 2, placed = [];
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
      if (v.mode === 'stack') return [sp.u, sp.v + ((sp.to[1] < 0 ? -1 : 1) * (LIFT + NOTE_H)) / 2 / IH];
      // 丸の中心から枠の真ん中まで。枠の幅は 240px として、画像の px に直す
      const reach = Math.max(Math.abs(sp.to[0]), sp.r + 44) + 120 / (v.f / R);
      return [sp.u + ((sp.to[0] < 0 ? -1 : 1) * reach) / 2 / IW, sp.v + sp.to[1] / 2 / IH];
    }

    // 方向の矢印を押したら、その見どころの方へなめらかに向きを変える（遠いほど少し長く）
    function face(sp) {
      const [tu, tv] = aimAt(sp);
      let yaw = yawOf(tu);
      yaw += Math.round((v.yaw - yaw) / (Math.PI * 2)) * Math.PI * 2;
      const pitch = clamp(pitchOf(tv), -v.pitchMax, v.pitchMax);
      v.vel = [0, 0];
      v.goal = null;
      v.tween = null;
      if (rm) { v.yaw = yaw; v.pitch = pitch; }
      else v.tween = { from: [v.yaw, v.pitch], to: [yaw, pitch], t0: performance.now(), ms: clamp(300 + 350 * Math.hypot(yaw - v.yaw, pitch - v.pitch), 300, 1200) };
      v.dirty = true;
      hideHint();
      // 押した矢印は見どころが描かれると消えるので、キーボードの操作は画面に移しておく
      if (document.activeElement === sp.find) stage.focus({ preventScroll: true });
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
      // 方向の矢印の真ん中を置ける範囲：左右は「地図へ戻る」と題名の外側に合わせ、上はその下、下は操作の案内の下の端まで
      const rb = back.getBoundingClientRect(), rc = caption.getBoundingClientRect(), rh = hint.getBoundingClientRect();
      v.edge = { l: rb.left + 22, r: rc.right - 22, t: Math.max(rb.bottom, rc.bottom) + 8 + 22, b: rh.bottom - 22 };
      const mode = aspect < STACK ? 'stack' : 'side';
      if (mode !== v.mode) { v.mode = mode; layout(); }
      v.dirty = true;
    }
    fit();
    ro = new ResizeObserver(() => fit());
    ro.observe(stage);

    // 最初に向く所：横長の画面は画像ごとの決めた向き、縦長の画面は最初の見どころ（丸と枠がまとめて入るように）
    const [u0, v0] = v.mode === 'stack' ? aimAt(cfg.spots[0]) : cfg.view;
    v.yaw = yawOf(u0);
    v.pitch = clamp(pitchOf(v0), -v.pitchMax, v.pitchMax);

    // ---------- 開く動き：吹き出しの画像を、開いたあとに同じ所が来る位置・大きさまで広げる ----------
    if (btn && !rm) {
      const r0 = btn.getBoundingClientRect();
      const [cx, cy, cw, ch] = cfg.crop ?? [0, 0, IW, IH];
      // 吹き出しの枠には、切り抜きの真ん中が枠いっぱいに入っている（はみ出しは切ってある）
      const A = r0.width / r0.height;
      const vw = Math.min(cw, ch * A), vh = vw / A;
      const vx = cx + (cw - vw) / 2, vy = cy + (ch - vh) / 2;
      const k = v.f / R; // 画面の真ん中での、画像 1px の大きさ
      let dx = vx + vw / 2 - u0 * IW;
      dx -= Math.round(dx / IW) * IW;
      const dy = vy + vh / 2 - (IH / 2 - R * Math.tan(v.pitch));
      const w1 = vw * k, h1 = vh * k;
      clone = h('div', { class: 'ar-clone' });
      Object.assign(clone.style, {
        backgroundImage: `url(assets/pano/${s.pano}.jpg), url(assets/pano/${s.pano}_thumb.jpg)`,
        backgroundSize: `${(IW / vw) * 100}% ${(IH / vh) * 100}%, cover`,
        backgroundPosition: `${(vx / (IW - vw)) * 100}% ${(vy / (IH - vh)) * 100}%, center`,
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
    }

    // ---------- 描く ----------
    let last = performance.now(), filmT = 0, scratchT = 0;
    function draw(now) {
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
      // フィルムは 1 秒 24 コマ、縦傷は 0.4 秒ごとに出し直す
      if (cfg.film) {
        filmT += dt; scratchT += dt;
        if (filmT >= 1 / 24) {
          filmT %= 1 / 24;
          u.uFrame.value = (u.uFrame.value + 1) % 4096;
          u.uFlicker.value = 1 + (Math.random() - 0.5) * 0.07;
          v.dirty = true;
        }
        if (scratchT > 0.4) {
          scratchT = 0;
          const sc = u.uScratch.value;
          sc.set(...[0, 1, 2].map(() => (Math.random() < 0.25 ? 0.05 + Math.random() * 0.9 : -1)), 0.25 + Math.random() * 0.25);
        }
      }
      for (const sp of spots) if (sp.t0 != null && !sp.done) { paint(sp, now); v.dirty = true; }
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
      if (d.moved > 6) hideHint();
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
      v.dirty = true;
      hideHint();
    });

    // ---------- 画像がそろったら、広げた画像から本物の画面に切り替える ----------
    (async () => {
      let image;
      try { image = await preload(s.pano); } catch (err) { console.error(err); fail('画像を読み込めませんでした。地図へ戻って、もう一度お試しください。'); return; }
      if (v.closed) return;
      texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping; // 一周したつなぎ目もなめらかに
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
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
    })();

    function fail(message) {
      clone?.remove();
      clone = null;
      stage.hidden = true;
      hint.hidden = true;
      el.insertBefore(h('p', { class: 'ar-error', role: 'alert', text: message }), back);
      return { close };
    }

    // ---------- 閉じる ----------
    function close() {
      if (v.closed) return;
      v.closed = true;
      clearTimeout(hintTimer);
      clearTimeout(findTimer);
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
          renderer.renderLists.dispose();
          css.domElement.replaceChildren();
        }
        ro?.disconnect();
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
