// 地図の拡大・縮小ボタン（地図の窓の右下）。1回押すごとに2倍ずつ寄る・引く。
// 端まで来た向きのボタンは押せない見た目にする。吹き出しが重なる間は隠す。
import { h, svg, reducedMotion } from '../util.js';

const STEP = 2;

function icon(d) {
  const el = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' });
  el.append(svg('path', { d }));
  return el;
}

export function createZoom(world, popup) {
  const canvas = world.renderer.domElement;
  const button = (label, d, k) => h('button', {
    type: 'button', 'aria-label': label, title: label,
    onclick: () => { if (world.canZoom(k)) world.zoom(k, !reducedMotion()); },
  }, icon(d));
  const zin = button('拡大', 'M12 5v14M5 12h14', 1 / STEP);
  const zout = button('縮小', 'M5 12h14', STEP);
  const el = h('div', { class: 'map-zoom', role: 'group', 'aria-label': '地図の拡大・縮小' }, zin, zout);
  // キーボードでピンを順に送る前に届くよう、キャンバスのすぐ後ろに置く
  canvas.after(el);

  // 自分の四角（地図の窓の中の px）。窓か自分の大きさが変わったときだけ測り直す
  const box = [0, 0, 0, 0];
  const ro = new ResizeObserver(() => {
    box[0] = el.offsetLeft; box[1] = el.offsetTop;
    box[2] = box[0] + el.offsetWidth; box[3] = box[1] + el.offsetHeight;
  });
  ro.observe(canvas.parentElement);
  ro.observe(el);

  // disabled にするとフォーカスが外れるので、aria-disabled で押せない見た目にする
  let canIn = null, canOut = null, covered = false;
  world.onFrame(() => {
    const i = world.canZoom(1 / STEP), o = world.canZoom(STEP);
    if (i !== canIn) { canIn = i; zin.setAttribute('aria-disabled', String(!i)); }
    if (o !== canOut) { canOut = o; zout.setAttribute('aria-disabled', String(!o)); }
    // 吹き出しの下から半分だけのぞくと散らかって見えるので隠す。
    // ただし押している途中（ポインターが乗っている・キーボードで選んでいる）は、吹き出しの上に出したまま
    const r = popup.rect;
    const c = !!r && r[0] < box[2] && r[2] > box[0] && r[1] < box[3] && r[3] > box[1]
      && !el.matches(':hover') && !el.querySelector(':focus-visible');
    if (c !== covered) { covered = c; el.classList.toggle('is-covered', c); }
  });
  return el;
}
