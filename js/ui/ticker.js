// 年を動かしている間、地図の真ん中に大きく薄く年を出す。スライダーでも、史跡を押して年を移るときでも、
// 動いている途中の年をその場で数え上げ・数え下げして見せ、止まって少したつと消える。
// 地名とピンより下に置き、押す邪魔はしない。最初の流し（題字が数える）と観光マップでは出さない
import { formatYear } from '../eras.js';
import { h } from '../util.js';

const HOLD_MS = 650; // 年が止まってから消し始めるまで

export function createTicker(app, world) {
  const pre = h('span', { class: 'ticker-pre' });
  const num = h('span', { class: 'ticker-num' });
  const el = h('div', { class: 'year-ticker', 'aria-hidden': 'true' }, pre, num, h('span', { class: 'ticker-unit', text: '年' }));
  world.layers.labels.before(el);

  let timer = 0;
  app.on('t', () => {
    if (document.body.classList.contains('is-intro') || app.mode === 'tour') return;
    const y = formatYear(app.year); // 紀元前は「前」が付く。古い時代は年表と同じく 10 年・100 年きざみ
    const bc = y.startsWith('前');
    pre.textContent = bc ? '前' : '';
    num.textContent = bc ? y.slice(1) : y;
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-on'), HOLD_MS);
  });
  // 観光マップへ切り替えたら、すぐしまう
  app.on('mode', () => { clearTimeout(timer); el.classList.remove('is-on'); });
}
