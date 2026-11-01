// 地図の土台。描画（影・後処理）、カメラ操作、地名、年の切り替えをまとめる。
// 描画の流れ：場面を半精度の下書き（MSAA 4倍）へ → 特別な場面だけ光のにじみ → grade.js で仕上げて画面へ。
import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GradeShader } from './grade.js';
import { buildTerrain, buildWater, createCoastline } from './terrain.js';
import { buildTrees, buildTown, buildRail, buildBridge, buildRoads } from './props.js';
import { NOW_YEAR } from '../eras.js';
import { reducedMotion } from '../util.js';

CameraControls.install({ THREE });

const deg = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;
// 太陽：方位 250°（西南西）、高さ 32°。影は北東へ伸びる
const SUN_AZ = deg(250), SUN_EL = deg(32);
export const SUN_DIR = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)).normalize();

// 地名。alt = [[年, 名前]] はその年より前の呼び名、from はその年から出す
export const LABELS = [
  { t: '門司港', lat: 33.9445, lon: 130.9620, cls: 'town', alt: [[1889, '門司']] },
  { t: '大里', lat: 33.9050, lon: 130.9330, cls: 'town' },
  { t: '田野浦', lat: 33.9560, lon: 130.9870, cls: 'village' },
  { t: '白野江', lat: 33.9520, lon: 131.0030, cls: 'village' },
  { t: '青浜', lat: 33.9474, lon: 131.0168, cls: 'village' },
  { t: '恒見', lat: 33.8521, lon: 130.9849, cls: 'village' },
  { t: '新門司', lat: 33.8618, lon: 130.9953, cls: 'town', from: 1971 },
  { t: '和布刈', lat: 33.9610, lon: 130.9622, cls: 'small' },
  { t: '部埼', lat: 33.9577, lon: 131.0193, cls: 'small' },
  { t: '風師山', lat: 33.9236, lon: 130.9564, cls: 'peak' },
  { t: '戸ノ上山', lat: 33.8640, lon: 130.9226, cls: 'peak' },
  { t: '古城山', lat: 33.9583, lon: 130.9687, cls: 'peak small' },
  { t: '下関', lat: 33.962, lon: 130.935, cls: 'outer', alt: [[1902, '赤間関']] },
  { t: '彦島', lat: 33.935, lon: 130.905, cls: 'outer' },
  { t: '小倉', lat: 33.878, lon: 130.895, cls: 'outer' },
  { t: '巌流島', lat: 33.9355, lon: 130.9291, cls: 'small outer', alt: [[1612, '船島']] },
  { t: '関門海峡', lat: 33.946, lon: 130.942, cls: 'sea' },
  { t: '周防灘', lat: 33.905, lon: 131.048, cls: 'sea' },
  { t: '響灘', lat: 33.978, lon: 130.895, cls: 'sea' },
  { t: '北九州空港', lat: 33.8459, lon: 131.0349, cls: 'small outer', from: 2006 },
];

export async function createWorld(container, geo, { roads: roadData = null } = {}) {
  // ---------- 共通の uniform（地形・海・線・小物で同じものを参照する） ----------
  const shared = {
    uTime: { value: 0 },
    uYear: { value: NOW_YEAR },
    uBg: { value: new THREE.Color(0x1a2630) },
    uEdge: { value: new THREE.Vector4(geo.W / 2, geo.D / 2, 150, 0) },
    uNight: { value: 0 },
    uSunDir: { value: SUN_DIR.clone() },
    uFlow: { value: new THREE.Vector4() },
    // 特別な場面の模型を置くところ：線分（a.x, a.z, b.x, b.z）から uHoleR より近い木・建物を消す
    uHole: { value: new THREE.Vector4() },
    uHoleR: { value: 0 },
  };

  // ---------- 描画の準備 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.className = 'map-canvas';
  container.appendChild(renderer.domElement);

  const quality = { pr: Math.min(window.devicePixelRatio || 1, 1.5), bloom: true, samples: 4, slowFor: 0 };
  const hdr = renderer.extensions.has('EXT_color_buffer_float');
  // stencilBuffer：現代の道（半透明の線）のつなぎ目が重なって濃くならないように使う（props.js buildRoads）
  const sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: quality.samples, stencilBuffer: true });
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.7, 0.45, 0.85);
  const bloomQuad = new FullScreenQuad(null);
  const grade = new THREE.ShaderMaterial({
    name: 'Grade',
    uniforms: THREE.UniformsUtils.clone(GradeShader.uniforms),
    vertexShader: GradeShader.vertexShader,
    fragmentShader: GradeShader.fragmentShader,
    depthTest: false, depthWrite: false,
  });
  grade.uniforms.tDiffuse.value = sceneRT.texture;
  grade.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
  const gradeQuad = new FullScreenQuad(grade);

  // ---------- 場面・カメラ ----------
  const scene = new THREE.Scene();
  scene.background = shared.uBg.value;
  const camera = new THREE.PerspectiveCamera(30, 1, 4, 9000);
  // 手前の切り口（near）は引くほど遠くへ。4 のままだと、引いたときに奥行きの細かさが足りず、
  // 水面のすぐ下に沈めた埋め立て地が海から縞になって透ける。いちばん高い山より上の範囲でだけ動かす
  let topY = 0;
  for (const y of geo.y) if (y > topY) topY = y;
  function fitNear() {
    const n = Math.max(4, Math.min(controls.distance * 0.05, (camera.position.y - topY - 20) * 0.8));
    if (Math.abs(n - camera.near) < camera.near * 0.02) return;
    camera.near = n;
    camera.updateProjectionMatrix();
  }

  const hemi = new THREE.HemisphereLight(0xdfe6ea, 0x5d5240, 1.3);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
  const base = { hemi: 1.3, sun: 2.8 };
  sun.position.copy(SUN_DIR).multiplyScalar(2600);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.3;
  sun.shadow.radius = 2.5;
  scene.add(hemi, sun, sun.target);
  // 特別な場面の炎・爆発の光。足したり外したりすると全部の材質を組み立て直すことになるので、
  // はじめから2つ置いておき、使わない間は明るさ 0 にしておく
  const glow = [0, 1].map(() => {
    const l = new THREE.PointLight(0xff8a3c, 0, 60, 2);
    l.position.set(0, -500, 0);
    scene.add(l);
    return l;
  });
  const sunColor = sun.color.clone(), hemiColor = hemi.color.clone();

  // 時代の海岸線を先に作る（地形・海・町が、その uniform を使う）
  const coastline = createCoastline(geo, shared);
  const terrain = buildTerrain(geo, shared);
  const water = buildWater(geo, shared);
  // 現代の道。道の上には木も家も置かない（道が建物に隠れて途切れないように）
  const roads = buildRoads(geo, shared, roadData);
  const trees = buildTrees(geo, shared, { clear: roads.userData.clear });
  const town = buildTown(geo, shared, roads.userData.clear);
  const rail = buildRail(geo, shared);
  const bridge = buildBridge(geo);
  scene.add(water, terrain, coastline.group, trees, town, roads, rail, bridge);
  // 特別な場面の船・汽車・炎などはここに入れる
  const fxRoot = new THREE.Group();
  fxRoot.name = 'fx';
  scene.add(fxRoot);

  const lineMats = [];
  scene.traverse((o) => { if (o.material?.isLineMaterial) lineMats.push(o.material); });
  for (const m of bridge.userData.lineMats) if (!lineMats.includes(m)) lineMats.push(m);

  // ---------- 地名とピンの層（DOM） ----------
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'map-layer map-labels';
  const pinRenderer = new CSS2DRenderer();
  pinRenderer.domElement.className = 'map-layer map-pins';
  container.append(labelRenderer.domElement, pinRenderer.domElement);
  const labelScene = new THREE.Scene();
  const pinScene = new THREE.Scene();
  // ピンの上でホイールしても地図が拡大縮小するように、キャンバスへ渡す
  pinRenderer.domElement.addEventListener('wheel', (e) => {
    if (e.target === pinRenderer.domElement) return;
    e.preventDefault();
    renderer.domElement.dispatchEvent(new WheelEvent('wheel', e));
  }, { passive: false });

  const labels = LABELS.map((L) => {
    const el = document.createElement('div');
    el.className = 'lbl ' + L.cls;
    el.textContent = L.t;
    const [x, z] = geo.toXZ(L.lon, L.lat);
    const lift = L.cls.includes('sea') ? 2 : L.cls.includes('peak') ? 3 : 4;
    const obj = new CSS2DObject(el);
    obj.position.set(x, Math.max(0, geo.heightAt(x, z)) + lift, z);
    labelScene.add(obj);
    // 埋め立て地の地名（新門司・空港）は、陸が上がってから出す
    return { ...L, el, obj, name: L.t, on: true, w: 0, h: 0, step: L.from ? geo.coastStepAt(L.from) : 0 };
  });
  // ピンの下に入った地名は消す（ピンの側から、画面上の四角を渡してもらう）
  let blockers = null;
  let labelSizes = true; // 地名の大きさを測り直す
  const _lp = {};

  // ---------- カメラ操作 ----------
  const controls = new CameraControls(camera, renderer.domElement);
  const A = CameraControls.ACTION;
  // 回せると操作が複雑になるので、向きは変えさせない。どのボタンのドラッグも移動、2本指は拡大・縮小と移動
  controls.mouseButtons.left = A.SCREEN_PAN;
  controls.mouseButtons.right = A.SCREEN_PAN;
  controls.mouseButtons.middle = A.SCREEN_PAN;
  controls.mouseButtons.wheel = A.DOLLY;
  controls.touches.one = A.TOUCH_SCREEN_PAN;
  controls.touches.two = A.TOUCH_DOLLY_SCREEN_PAN;
  controls.touches.three = A.TOUCH_DOLLY_SCREEN_PAN;
  controls.dollyToCursor = true;
  controls.smoothTime = 0.25;
  controls.draggingSmoothTime = 0.1;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = 1.134;
  controls.minAzimuthAngle = -Math.PI / 2;
  controls.maxAzimuthAngle = Math.PI / 2;
  controls.minDistance = 90; // いちばん寄ると、50m ほどしか離れていない史跡のピンも重ならずに並ぶ近さ
  controls.maxDistance = 3600;
  const mb = geo.mojiBox;
  controls.setBoundary(new THREE.Box3(new THREE.Vector3(mb.x0 - 160, -20, mb.z0 - 160), new THREE.Vector3(mb.x1 + 160, 120, mb.z1 + 160)));

  // ---------- 画面の大きさ・安全な範囲（スライダー・タイトル・帯に隠れない所） ----------
  let W = 1, H = 1;
  const safe = { left: 0, top: 0, right: 0, bottom: 0 };
  const fx = { tilt: 2, bloom: 0, threshold: 0.85, focus: null };
  const home = { target: new THREE.Vector3(), polar: 0.72, azimuth: 0, distance: 2200 };
  let atHome = true;

  function applyViewOffset() {
    const cx = (safe.left + W - safe.right) / 2, cy = (safe.top + H - safe.bottom) / 2;
    camera.aspect = W / H;
    camera.setViewOffset(W, H, -(cx - W / 2), -(cy - H / 2), W, H);
    camera.updateProjectionMatrix();
  }
  // 視点の下見用のカメラ。本物のカメラは controls だけが動かす
  const probe = camera.clone();
  function placeCamera(cam, target, polar, azimuth, d) {
    cam.position.set(
      target.x + d * Math.sin(polar) * Math.sin(azimuth),
      target.y + d * Math.cos(polar),
      target.z + d * Math.sin(polar) * Math.cos(azimuth),
    );
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }
  const _p = new THREE.Vector3();
  function projectWith(cam, v, out = {}) {
    _p.copy(v).project(cam);
    out.x = (_p.x + 1) / 2 * W;
    out.y = (1 - _p.y) / 2 * H;
    out.z = _p.z;
    out.visible = _p.z > -1 && _p.z < 1;
    return out;
  }
  const project = (v, out) => projectWith(camera, v, out);
  // 画面上の点から地面（高さ y）へ
  const _ray = new THREE.Vector3();
  function toGroundWith(cam, sx, sy, y = 0, out = new THREE.Vector3()) {
    _ray.set(sx / W * 2 - 1, 1 - sy / H * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = _ray.y < -1e-4 ? (y - cam.position.y) / _ray.y : 6000;
    return out.copy(cam.position).addScaledVector(_ray, Math.min(t, 6000));
  }
  const toGround = (sx, sy, y, out) => toGroundWith(camera, sx, sy, y, out);

  // 門司区の陸の点（3マスおき）。ホームの視点で区全体が安全な範囲に収まるように使う
  const wardPts = [];
  for (let j = 0; j < geo.ny; j += 3) for (let i = 0; i < geo.nx; i += 3) {
    const k = j * geo.nx + i;
    if (geo.mask[k] && geo.land[k]) wardPts.push(new THREE.Vector3(geo.xOf(i), geo.y[k], geo.zOf(j)));
  }
  function computeHome() {
    const m = 22;
    const top = m + 36; // 北の端のピン（頭と軸）と赤い矢印が窓の上に詰まらないよう、上は広めに空ける
    probe.copy(camera);
    const target = new THREE.Vector3((mb.x0 + mb.x1) / 2, 0, (mb.z0 + mb.z1) / 2);
    const bbox = (d) => {
      placeCamera(probe, target, home.polar, home.azimuth, d);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const o = {};
      for (const v of wardPts) {
        projectWith(probe, v, o);
        x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x); y0 = Math.min(y0, o.y); y1 = Math.max(y1, o.y);
      }
      return { x0, x1, y0, y1 };
    };
    const fits = (b) => b.x0 >= safe.left + m && b.x1 <= W - safe.right - m && b.y0 >= safe.top + top && b.y1 <= H - safe.bottom - m;
    let d = 2200;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 300, hi = 5000;
      for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(bbox(mid))) hi = mid; else lo = mid; }
      d = hi;
      // 区の見た目の中心を、安全な範囲の中心へ寄せる
      const b = bbox(d);
      const cx = (safe.left + W - safe.right) / 2, cy = (safe.top + top - m + H - safe.bottom) / 2;
      const g0 = toGroundWith(probe, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), g1 = toGroundWith(probe, cx, cy);
      target.x += g0.x - g1.x; target.z += g0.z - g1.z;
    }
    home.target.copy(target);
    home.distance = clamp(d * 1.03, controls.minDistance, controls.maxDistance);
  }

  // ---------- 影：見えている地面の範囲に合わせて当てる（光の向きは固定、範囲だけ動かす） ----------
  const shadowCam = sun.shadow.camera;
  shadowCam.position.copy(sun.position);
  shadowCam.lookAt(sun.target.position);
  shadowCam.updateMatrixWorld();
  const shadowState = { key: '', pinned: null, last: 0, dirty: true };
  const _c = new THREE.Vector3();
  function fitShadow(x0, x1, z0, z1, y0 = -6, y1 = 110) {
    shadowCam.position.copy(sun.position);
    shadowCam.lookAt(sun.target.position);
    shadowCam.updateMatrixWorld();
    const inv = shadowCam.matrixWorldInverse;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
      _c.set(x, y, z).applyMatrix4(inv);
      a0 = Math.min(a0, _c.x); a1 = Math.max(a1, _c.x); b0 = Math.min(b0, _c.y); b1 = Math.max(b1, _c.y); c0 = Math.min(c0, _c.z); c1 = Math.max(c1, _c.z);
    }
    // 大きさは √2 刻み、位置は影の1画素刻みにそろえる（動かしても影がちらつかない）
    const size = 2 ** (Math.ceil(Math.log2(Math.max(a1 - a0, b1 - b0, 8)) * 2) / 2);
    const texel = size / sun.shadow.mapSize.x;
    const mx = Math.round((a0 + a1) / 2 / texel) * texel, my = Math.round((b0 + b1) / 2 / texel) * texel;
    const key = `${size}|${mx.toFixed(3)}|${my.toFixed(3)}`;
    if (key === shadowState.key) return false;
    shadowState.key = key;
    shadowCam.left = mx - size / 2; shadowCam.right = mx + size / 2;
    shadowCam.bottom = my - size / 2; shadowCam.top = my + size / 2;
    shadowCam.near = Math.max(1, -c1 - 40); shadowCam.far = -c0 + 40;
    shadowCam.updateProjectionMatrix();
    sun.shadow.normalBias = clamp(texel * 1.1, 0.03, 0.6);
    return true;
  }
  const _g = new THREE.Vector3();
  function fitShadowToView() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [W, 0], [W, H], [0, H], [W / 2, 0]]) {
      for (const y of [0, 60]) {
        toGround(sx, sy, y, _g);
        x0 = Math.min(x0, _g.x); x1 = Math.max(x1, _g.x); z0 = Math.min(z0, _g.z); z1 = Math.max(z1, _g.z);
      }
    }
    const px = (x1 - x0) * 0.18, pz = (z1 - z0) * 0.18;
    x0 = Math.max(x0 - px, -geo.W / 2); x1 = Math.min(x1 + px, geo.W / 2);
    z0 = Math.max(z0 - pz, -geo.D / 2); z1 = Math.min(z1 + pz, geo.D / 2);
    if (x1 <= x0 || z1 <= z0) return false;
    return fitShadow(x0, x1, z0, z1);
  }
  function updateShadow(now, force = false) {
    if (shadowState.pinned) return;
    if (!force && now - shadowState.last < 220) return;
    if (fitShadowToView() || shadowState.dirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowState.dirty = false;
      shadowState.last = now;
    }
  }
  let yearShadowTimer = 0;
  function scheduleShadow() {
    clearTimeout(yearShadowTimer);
    yearShadowTimer = setTimeout(() => { shadowState.dirty = true; renderer.shadowMap.needsUpdate = true; }, 150);
  }

  // ---------- 大きさの変更 ----------
  function resize() {
    W = Math.max(1, container.clientWidth); H = Math.max(1, container.clientHeight);
    const pr = quality.pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H);
    const bw = Math.round(W * pr), bh = Math.round(H * pr);
    sceneRT.setSize(bw, bh);
    bloom.setSize(bw, bh);
    grade.uniforms.uRes.value = [bw, bh];
    for (const m of lineMats) m.resolution.set(W, H);
    labelRenderer.setSize(W, H);
    pinRenderer.setSize(W, H);
    applyViewOffset();
    applyFx();
    computeHome();
    if (atHome) controls.setLookAt(...homePosition(), home.target.x, home.target.y, home.target.z, false);
    shadowState.key = '';
    wake();
  }
  function homePosition() {
    placeCamera(probe, home.target, home.polar, home.azimuth, home.distance);
    return [probe.position.x, probe.position.y, probe.position.z];
  }
  new ResizeObserver(() => resize()).observe(container);

  // ---------- ミニチュア風のぼかし・年・夜 ----------
  function applyFx() {
    const pr = quality.pr;
    const cy = (safe.top + H - safe.bottom) / 2;
    const focus = fx.focus ?? 1 - cy / H;
    grade.uniforms.uTilt.value = [fx.tilt * pr, focus, fx.tilt > 3 ? 0.12 : 0.2];
  }
  // 時代の海岸線：年が変わったら、陸の形を少し時間をかけて移す（v は段の番号。小数のときは2つの段の間）。
  // 行き先が途中で変わっても止まらないよう、ばねのように追いかける（SmoothDamp と同じ式）
  const coast = { v: coastline.steps - 1, to: coastline.steps - 1, vel: 0 };
  const railStep = geo.coastStepAt(rail.userData.from);
  function coastTo(s, instant = false) {
    coast.to = s;
    if (instant || reducedMotion()) {
      coast.v = s; coast.vel = 0;
      showCoast();
      scheduleShadow();
    }
    wake();
  }
  function stepCoast(dt) {
    if (coast.v === coast.to && coast.vel === 0) return;
    const T = 0.3, maxChange = 3; // T 秒ほどで追いつく。遠いときは 1 秒あたり 10 段くらいまで
    const w = 2 / T, x = w * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = clamp(coast.v - coast.to, -maxChange, maxChange);
    const tmp = (coast.vel + w * change) * dt;
    coast.vel = (coast.vel - w * tmp) * ex;
    let v = coast.v - change + (change + tmp) * ex;
    if ((coast.to - coast.v > 0) === (v > coast.to)) { v = coast.to; coast.vel = 0; }
    if (Math.abs(coast.to - v) < 0.002 && Math.abs(coast.vel) < 0.02) { v = coast.to; coast.vel = 0; }
    coast.v = v;
    showCoast();
    wake();
    if (v === coast.to) scheduleShadow();
  }
  function showCoast() {
    coastline.show(coast.v);
    // 線路は埋め立てた岸に沿うので、陸が上がってから出す
    rail.visible = year >= rail.userData.from && coast.v > railStep - 0.25;
  }
  // 年を大きく飛ばしたあと（最初の画面など）に、海岸線をその場で合わせる
  function settleCoast() { coastTo(coast.to, true); }

  // 現代の道：年を動かしている途中で現代を通り過ぎるたびにちらつかないよう、現代に着いて少し待ってから、ゆっくり出す。
  // 現代を離れるときはすぐ消す
  const ROAD_WAIT = 0.55, ROAD_IN = 0.7, ROAD_OUT = 0.2;
  const road = { on: false, v: 0, wait: 0, r: -1 };
  function setRoads(on) {
    if (on === road.on) return;
    road.on = on;
    road.wait = on && road.v === 0 && !reducedMotion() ? ROAD_WAIT : 0;
    wake();
  }
  function stepRoads(dt) {
    if (road.on && road.wait > 0) { road.wait -= dt; wake(); return; }
    const to = road.on ? 1 : 0;
    const r = controls.distance / home.distance;
    if (road.v === to && (to === 0 || Math.abs(r - road.r) < 1e-3)) return;
    if (road.v !== to) {
      road.v = reducedMotion() ? to : to > road.v ? Math.min(1, road.v + dt / ROAD_IN) : Math.max(0, road.v - dt / ROAD_OUT);
      wake();
    }
    road.r = r;
    roads.userData.show(road.v * road.v * (3 - 2 * road.v), r);
  }

  let year = NOW_YEAR;
  function setYear(y) {
    if (y === year) return;
    year = y;
    shared.uYear.value = y;
    coastTo(geo.coastStepAt(y));
    rail.visible = y >= rail.userData.from && coast.v > railStep - 0.25;
    bridge.visible = y >= bridge.userData.from;
    for (const L of labels) {
      let name = L.t;
      if (L.alt) for (const [Y, n] of L.alt) if (y < Y) { name = n; break; }
      if (name !== L.name) { L.name = name; L.el.textContent = name; labelSizes = true; }
    }
    scheduleShadow();
    wake();
  }
  function setNight(n) {
    shared.uNight.value = n;
    grade.uniforms.uNight.value = n;
    sun.intensity = base.sun * (1 - 0.88 * n);
    hemi.intensity = base.hemi * (1 - 0.72 * n);
    wake();
  }
  function setFx(o) { Object.assign(fx, o); applyFx(); wake(); }
  function setSafeArea(s) {
    Object.assign(safe, s);
    applyViewOffset(); applyFx(); computeHome();
    if (atHome) controls.setLookAt(...homePosition(), home.target.x, home.target.y, home.target.z, false);
    wake();
  }
  // 特別な場面：影を場面の範囲だけに絞る（細かく落ちる）。live なら毎コマ描き直す
  function focusShadow(box, live = false) {
    if (box) {
      shadowState.pinned = box;
      fitShadow(box.x0, box.x1, box.z0, box.z1, box.y0 ?? -6, box.y1 ?? 60);
      renderer.shadowMap.autoUpdate = live;
      renderer.shadowMap.needsUpdate = true;
    } else {
      shadowState.pinned = null;
      shadowState.key = '';
      renderer.shadowMap.autoUpdate = false;
      fitShadowToView();
      renderer.shadowMap.needsUpdate = true;
    }
  }

  // ---------- 地名の出し入れ（近づくほど細かい地名を出す） ----------
  function updateLabels() {
    const d = controls.distance;
    const r = d / home.distance;
    if (labelSizes && blockers) {
      // 画面の外（display:none）の地名は 0 になるので、見えてきたらもう一度測る
      labelSizes = false;
      for (const L of labels) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    }
    const rects = blockers?.() ?? [];
    for (const L of labels) {
      let on = !(L.from && (year < L.from || coast.v < L.step - 0.25));
      if (L.cls.includes('small')) on &&= r < 0.62;
      else if (L.cls.includes('peak')) on &&= r < 0.9;
      else if (L.cls.includes('village')) on &&= r < 1.25;
      if (on && rects.length) {
        project(L.obj.position, _lp);
        if (!L.w) { if (_lp.visible && _lp.x > 0 && _lp.x < W && _lp.y > 0 && _lp.y < H) labelSizes = true; }
        else {
          const x0 = _lp.x - L.w / 2, x1 = _lp.x + L.w / 2, y0 = _lp.y - L.h / 2, y1 = _lp.y + L.h / 2;
          for (const b of rects) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) { on = false; break; }
        }
      }
      if (on !== L.on) { L.on = on; L.el.classList.toggle('off', !on); }
    }
  }

  // ---------- 光のにじみ（UnrealBloomPass の中身を、最後の合成の手前まで使う） ----------
  const _oldClear = new THREE.Color();
  function runBloom(tex) {
    const b = bloom;
    renderer.getClearColor(_oldClear);
    const oldAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    b.highPassUniforms.tDiffuse.value = tex;
    b.highPassUniforms.luminosityThreshold.value = fx.threshold;
    bloomQuad.material = b.materialHighPassFilter;
    renderer.setRenderTarget(b.renderTargetBright); renderer.clear(); bloomQuad.render(renderer);
    let input = b.renderTargetBright;
    for (let i = 0; i < b.nMips; i++) {
      const m = b.separableBlurMaterials[i];
      bloomQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(b.renderTargetsHorizontal[i]); renderer.clear(); bloomQuad.render(renderer);
      m.uniforms.colorTexture.value = b.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(b.renderTargetsVertical[i]); renderer.clear(); bloomQuad.render(renderer);
      input = b.renderTargetsVertical[i];
    }
    bloomQuad.material = b.compositeMaterial;
    b.compositeMaterial.uniforms.bloomStrength.value = b.strength;
    b.compositeMaterial.uniforms.bloomRadius.value = b.radius;
    b.compositeMaterial.uniforms.bloomTintColors.value = b.bloomTintColors;
    renderer.setRenderTarget(b.renderTargetsHorizontal[0]); renderer.clear(); bloomQuad.render(renderer);
    renderer.setClearColor(_oldClear, oldAlpha);
  }

  // ---------- 毎コマ ----------
  const hooks = new Set();
  let last = performance.now(), started = last, lastWake = last, lastMove = last;
  let time = 0, frameNo = 0;
  function wake() { lastWake = performance.now(); }

  function degrade() {
    if (quality.bloom && fx.bloom > 0) { quality.bloom = false; return; }
    if (quality.samples > 2) { quality.samples = 2; sceneRT.samples = 2; sceneRT.dispose(); return; }
    if (quality.pr > 0.75) { quality.pr = Math.max(0.75, quality.pr - 0.25); resize(); }
  }

  function render() {
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    const useBloom = fx.bloom > 0 && quality.bloom;
    if (useBloom) runBloom(sceneRT.texture);
    grade.uniforms.uBloom.value = useBloom ? fx.bloom : 0;
    renderer.setRenderTarget(null);
    gradeQuad.render(renderer);
    labelRenderer.render(labelScene, camera);
    pinRenderer.render(pinScene, camera);
  }

  function loop() {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    const hiccup = dt > 0.25;
    if (hiccup) dt = 1 / 60;
    time += dt;
    shared.uTime.value = time;
    const moved = controls.update(dt);
    if (moved) { lastMove = now; updateShadow(now); }
    fitNear();
    stepCoast(dt);
    stepRoads(dt);
    for (const f of hooks) f(dt, time);
    updateLabels();
    // 動きが止まって 2 秒たったら 1 コマおきに描く
    const idle = now - Math.max(lastMove, lastWake) > 2000;
    frameNo++;
    if (!idle || frameNo % 2 === 0) render();
    // 重いときは段階的に軽くする（最初の 3 秒と、タブ切り替え直後は数えない）
    if (!hiccup && now - started > 3000 && !idle) {
      if (dt > 0.024) quality.slowFor += dt; else quality.slowFor = Math.max(0, quality.slowFor - dt * 0.5);
      if (quality.slowFor > 1.5) { quality.slowFor = 0; degrade(); }
    }
  }

  // AR の画面を開いている間は地図を描かない
  let paused = false;
  function pause(on) {
    if (on === paused) return;
    paused = on;
    renderer.setAnimationLoop(on ? null : loop);
    if (!on) { last = performance.now(); wake(); }
  }

  // ---------- 特別な場面の間は、地図の操作を場面に渡す ----------
  // カメラは場面が動かす。ドラッグしたら 'pan'、ホイール・2本指・＋／−なら 'zoom' を1回だけ知らせる。
  // 知らせたあとも、場面が手放すまで（戻る動きの間）は操作を止めておく（トラックパッドの惰性で地図が動かないように）
  let guard = null;
  function takeover(onInput) {
    guard?.end();
    const el = renderer.domElement, ac = new AbortController(), on = { signal: ac.signal };
    const g = { fired: false, pts: new Map(), pinch: null };
    const fire = (kind) => { if (g.fired) return; g.fired = true; onInput(kind); };
    const pinchOf = () => {
      const [a, b] = [...g.pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    controls.enabled = false;
    // camera-controls は止めると touch-action を空に戻すので、スマホで画面ごと動かないように付け直す
    el.style.touchAction = 'none';
    // 地図とピン・地名の上のホイールは、地図の窓で先に受け止める（吹き出しの中を流すホイールはそのまま）
    const onMap = (t) => t === el || pinRenderer.domElement.contains(t) || labelRenderer.domElement.contains(t);
    container.addEventListener('wheel', (e) => {
      if (!onMap(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      fire('zoom');
    }, { ...on, capture: true, passive: false });
    el.addEventListener('pointerdown', (e) => {
      g.pts.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      g.pinch = g.pts.size === 2 ? pinchOf() : null;
    }, on);
    addEventListener('pointermove', (e) => {
      const p = g.pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (g.pts.size === 1) { if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) fire('pan'); return; }
      if (!g.pinch) return;
      // 2本指：指の間が開いた・閉じたなら寄り引き、2本そろって動いたなら移動
      const q = pinchOf();
      if (Math.abs(q.d - g.pinch.d) > 14) fire('zoom');
      else if (Math.hypot(q.x - g.pinch.x, q.y - g.pinch.y) > 14) fire('pan');
    }, on);
    const up = (e) => { g.pts.delete(e.pointerId); g.pinch = null; };
    addEventListener('pointerup', up, on);
    addEventListener('pointercancel', up, on);
    g.input = fire;
    g.end = () => {
      if (guard !== g) return;
      ac.abort();
      guard = null;
      controls.enabled = true;
    };
    guard = g;
    return g.end;
  }
  // 場面の小物を、地図に入れる前に組み立てておく（入れた瞬間に止まらないように）
  async function precompile(obj) {
    renderer.setRenderTarget(sceneRT);
    const p = renderer.compileAsync(obj, camera, scene);
    renderer.setRenderTarget(null);
    await p.catch(() => {});
  }
  // 木と町の建物を、線分 a → b（[x, z]）から r より近い所だけ消す（b を省くと円。null で戻す）
  function setHole(c) {
    if (c) shared.uHole.value.set(c.a[0], c.a[1], (c.b ?? c.a)[0], (c.b ?? c.a)[1]);
    shared.uHoleR.value = c ? c.r : 0;
    shadowState.dirty = true;
    renderer.shadowMap.needsUpdate = true;
    wake();
  }
  // 場面の光の色（null でいつもの色）
  function setLight(o) {
    sun.color.copy(o?.sun ?? sunColor);
    hemi.color.copy(o?.sky ?? hemiColor);
    wake();
  }

  controls.addEventListener('controlstart', () => { atHome = false; wake(); });
  controls.addEventListener('rest', () => updateShadow(performance.now(), true));
  renderer.domElement.addEventListener('wheel', () => { atHome = false; }, { passive: true });

  // ---------- 視点を動かす ----------
  function view({ target, distance, polar, azimuth }, smooth = true) {
    atHome = false; // 窓の大きさが変わっても、いつもの視点へ戻さない
    const t = new THREE.Vector3(...(Array.isArray(target) ? target : [target.x, target.y, target.z]));
    placeCamera(probe, t, polar ?? controls.polarAngle, azimuth ?? controls.azimuthAngle, distance ?? controls.distance);
    const p = probe.position;
    return controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, smooth);
  }
  function goHome(smooth = true) {
    atHome = true;
    controls.normalizeRotations();
    return controls.setLookAt(...homePosition(), home.target.x, home.target.y, home.target.z, smooth);
  }
  // 寄るときに、カメラが山にめりこまないように。カメラは c0 から a へ向かって、a からの距離が k 倍のところまで進む。
  // 途中でカメラの真下の地面から CLEAR より近くなるなら、その手前で止める（止めたところの倍率を返す。1 なら進めない）
  const CLEAR = 12, _cw = new THREE.Vector3(), _c0 = new THREE.Vector3(), _t0 = new THREE.Vector3();
  function clearK(c0, a, k) {
    for (let j = 1; j > k;) {
      const j2 = Math.max(k, j - 0.02);
      _cw.copy(c0).sub(a).multiplyScalar(j2).add(a);
      if (_cw.y < geo.groundAt(_cw.x, _cw.z) + CLEAR) return j;
      j = j2;
    }
    return k;
  }
  // ボタンで寄る・引く（k < 1 で寄る）。続けて押したときは、動いている途中でも行き先の距離から数える
  const _sph = new THREE.Spherical();
  function zoom(k, smooth = true) {
    if (guard) { guard.input('zoom'); return Promise.resolve(); }
    atHome = false;
    wake();
    const r = controls.getSpherical(_sph).radius;
    if (k < 1) k = clearK(controls.getPosition(_c0), controls.getTarget(_t0), Math.max(k, controls.minDistance / r));
    return controls.dollyTo(r * k, smooth);
  }
  // その向きにまだ動けるか（行き先が近さ・遠さの端に着いていたら false。寄る向きは、山にぶつかるときも false）
  function canZoom(k) {
    if (guard) return true;
    const r = controls.getSpherical(_sph).radius;
    if (k >= 1) return r < controls.maxDistance - 0.5;
    return r > controls.minDistance + 0.5 && clearK(controls.getPosition(_c0), controls.getTarget(_t0), Math.max(k, controls.minDistance / r)) < 1;
  }
  // ホイール・2本指・トラックパッドのピンチで寄る・引くときは、カーソルの下の地面が動かないように中心も動かす。
  // camera-controls の dollyToCursor は画面に平行な面の上で中心を動かすので、斜めに見下ろすこの地図では
  // 中心が空中に浮いたり地面に沈んだりして、いちばん寄っても地面が遠いままになる。中心はいまの高さの面から出さない
  // 山にぶつかるときは、その手前で止める
  const _g0 = new THREE.Vector3();
  controls._dollyInternal = (delta, x, y) => {
    const s = controls.getSpherical(_sph);
    const r0 = s.radius;
    const r1 = clamp(r0 * Math.pow(0.95, -delta * controls.dollySpeed), controls.minDistance, controls.maxDistance);
    if (Math.abs(r1 - r0) < 1e-3) return;
    const t = controls.getTarget(_t0);
    probe.copy(camera);
    placeCamera(probe, t, s.phi, s.theta, r0);
    const g = toGroundWith(probe, ((x + 1) / 2) * W, ((1 - y) / 2) * H, t.y, _g0);
    let k = r1 / r0;
    if (k < 1 && (k = clearK(controls.getPosition(_c0), g, k)) === 1) return;
    controls._dollyToNoClamp(r0 * k, true);
    controls.moveTo(g.x + (t.x - g.x) * k, t.y, g.z + (t.z - g.z) * k, true);
    // 距離と中心を同じ速さで動かす（ずれると、動いている途中でカーソルの下が流れる）
    controls._isUserControllingDolly = true;
    controls._isUserControllingTruck = true;
  };
  // ctrl＋ホイール（トラックパッドのピンチ）も、レンズのズームではなく同じ寄り引きにする
  controls._zoomInternal = (delta, x, y) => controls._dollyInternal(delta, x, y);
  function at(lon, lat, lift = 0) {
    const [x, z] = geo.toXZ(lon, lat);
    return new THREE.Vector3(x, Math.max(0, geo.heightAt(x, z)) + lift, z);
  }

  resize();
  setYear(NOW_YEAR - 0.5);
  settleCoast();
  controls.setLookAt(...homePosition(), home.target.x, home.target.y, home.target.z, false);
  controls.update(0);
  fitShadowToView();
  renderer.shadowMap.needsUpdate = true;
  // 下書き（線形の色・トーンマップなし）へ描くときと同じ設定でシェーダーを先に組み立てておく
  renderer.setRenderTarget(sceneRT);
  try { await renderer.compileAsync(scene, camera); } catch { /* 古いブラウザは最初の描画で組み立てる */ }
  renderer.setRenderTarget(null);
  renderer.setAnimationLoop(loop);

  const world = {
    THREE, geo, renderer, scene, camera, controls, shared, fxRoot, sun, hemi, rail, roads, labelScene, pinScene,
    layers: { labels: labelRenderer.domElement, pins: pinRenderer.domElement },
    get year() { return year; }, get size() { return { W, H }; },
    get home() { return home; }, get quality() { return quality; }, get safe() { return { ...safe }; },
    setYear, settleCoast, setNight, setFx, setSafeArea, focusShadow, setRoads,
    project, toGround, at, view, goHome, zoom, canZoom, wake, pause,
    glow, takeover, precompile, setHole, setLight, get fx() { return { ...fx }; },
    onFrame(f) { hooks.add(f); return () => hooks.delete(f); },
    distance: () => controls.distance,
    // f() は地名を消したい画面上の四角 [x0, y0, x1, y1] の配列を返す
    setLabelBlockers(f) { blockers = f; labelSizes = true; },
    // 書体が変わったときなどに、地名の大きさを測り直す
    measureLabels() { labelSizes = true; },
    // いま出ている地名の画面上の四角 [x0, y0, x1, y1]（赤い矢印が地名を避けるのに使う）
    labelRects() {
      const out = [];
      for (const L of labels) {
        if (!L.on || !L.w) continue;
        project(L.obj.position, _lp);
        if (_lp.visible) out.push([_lp.x - L.w / 2, _lp.y - L.h / 2, _lp.x + L.w / 2, _lp.y + L.h / 2]);
      }
      return out;
    },
  };
  window.__world = world;
  return world;
}
