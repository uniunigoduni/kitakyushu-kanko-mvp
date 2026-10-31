// 一押しの史跡の「いま」と「当時」をつなぐ演出。現代の地図でそのピンを押すと、年を数えながらその年までさかのぼり、
// いまの名前と当時の名前を並べて見せる。吹き出しの「現代へ戻る」では、同じように数えながら今へ戻る。
import { formatYear } from '../eras.js';
import { clamp, h, reducedMotion } from '../util.js';
import { pinLabel, yearTag } from './pins.js';

const HOLD_MS = 1300; // 着いてから札を消すまで

export function createTravel(app, world) {
  const map = world.renderer.domElement.parentElement;
  const year = h('p', { class: 'travel-year' });
  const lead = h('p', { class: 'travel-lead' });
  const rows = h('dl', { class: 'travel-rows' });
  const el = h('div', { class: 'travel', role: 'status', hidden: true }, h('div', { class: 'travel-when' }, year, lead), rows);
  map.append(el);

  let run = 0, hideTimer = 0, target = null;
  const row = (tag, text) => [h('dt', { text: tag }), h('dd', { text })];

  // 年を数える（着いたら、その史跡の年の書き方にそろえる）
  app.on('t', () => { if (target && !el.hidden && !el.classList.contains('is-done')) year.textContent = formatYear(app.year); });

  function show(s, back) {
    clearTimeout(hideTimer);
    const now = s.nowName ?? pinLabel(s.name), then = s.thenName ?? pinLabel(s.name);
    target = s;
    lead.textContent = back ? '現代へ' : 'さかのぼる';
    year.textContent = formatYear(app.year);
    // 名前が当時と変わらないもの（神社・灯台など）は「いまも」の1行にする
    rows.replaceChildren(...(now === then ? row('いまも', now)
      : back ? [...row('当時', then), ...row('いま', now)] : [...row('いま', now), ...row('当時', then)]));
    el.classList.toggle('is-back', back);
    el.classList.remove('is-done', 'is-open');
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-open');
  }
  function done(s, back, ok) {
    if (!ok) { hide(0); return; }
    el.classList.add('is-done');
    year.textContent = back ? formatYear(app.year) : yearTag(s);
    hide(HOLD_MS);
  }
  function hide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.classList.remove('is-open');
      target = null;
      hideTimer = setTimeout(() => { el.hidden = true; }, 220);
    }, delay);
  }

  return {
    // スライダーを to までゆっくり動かす。途中で別の操作が入ったら false
    async go(s, to, back = false) {
      const id = ++run;
      show(s, back);
      const ms = reducedMotion() ? 0 : clamp(Math.abs(to - app.t) * 3000, 1500, 2600);
      const ok = await app.animateT(to, ms);
      if (id === run) done(s, back, ok);
      return ok;
    },
  };
}
