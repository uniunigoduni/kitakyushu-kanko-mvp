// 一押しの史跡の「いま」と「当時」をつなぐ演出。現代の地図でそのピンを押すと、年を数えながらその年まで戻り、
// 地図の真ん中の大きな年の下に「いまの名前 → 当時の名前」を大きく添える（札は出さない）。
// 吹き出しの「現代へ戻る」では、同じように数えながら今へ戻る
import { clamp, h, reducedMotion } from '../util.js';
import { pinLabel, yearTag } from './pins.js';

const HOLD_MS = 1300; // 着いてから消し始めるまで

export function createTravel(app, world, ticker) {
  // 読み上げには、着いた先だけを知らせる
  const sr = h('p', { class: 'sr-only', role: 'status' });
  world.renderer.domElement.parentElement.append(sr);
  let run = 0;

  // 行き先の名前を金色に。名前が当時と変わらないもの（神社・灯台など）は名前だけ
  function names(now, then, back) {
    const [from, to] = back ? [then, now] : [now, then];
    if (from === to) return [h('span', { class: 'cap-to', text: to })];
    return [h('span', { class: 'cap-from', text: from }), h('span', { class: 'cap-to' }, h('span', { class: 'cap-arrow', text: '→' }), to)];
  }

  return {
    // スライダーを to までゆっくり動かす。途中で別の操作が入ったら false
    async go(s, to, back = false) {
      const id = ++run;
      const now = s.nowName ?? pinLabel(s.name), then = s.thenName ?? pinLabel(s.name);
      ticker.caption(names(now, then, back));
      sr.textContent = '';
      const ms = reducedMotion() ? 0 : clamp(Math.abs(to - app.t) * 3000, 1500, 2600);
      const ok = await app.animateT(to, ms);
      if (id !== run) return ok;
      if (!ok) { ticker.caption(null); return ok; }
      ticker.land(back ? null : yearTag(s), HOLD_MS);
      sr.textContent = back ? `現代の${now}` : `${yearTag(s)}の${then}`;
      return ok;
    },
  };
}
