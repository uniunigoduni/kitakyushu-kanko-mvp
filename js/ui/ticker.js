// 年を動かしている間、地図の真ん中に大きく薄く年を出す。スライダーでも、史跡を押して年を移るときでも、
// 動いている途中の年をその場で数え上げ・数え下げして見せ、止まって少したつと消える。
// 現代と当時を行き来するとき（js/ui/travel.js）は、年の下に名前を大きく添え、着いたらその史跡の年の書き方で止める。
// 地名とピンより下に置き、押す邪魔はしない。最初の流し（題字が数える）では出さない
import { formatYear } from '../eras.js';
import { h } from '../util.js';

const HOLD_MS = 650; // 年が止まってから消し始めるまで
const FADE_MS = 700; // 消えきるまで（style.css の .year-ticker の transition と同じ）

export function createTicker(app, world) {
  const pre = h('span', { class: 'ticker-pre' });
  const num = h('span', { class: 'ticker-num' });
  const unit = h('span', { class: 'ticker-unit' });
  const cap = h('p', { class: 'ticker-cap' });
  const el = h('div', { class: 'year-ticker', 'aria-hidden': 'true' }, h('p', { class: 'ticker-year' }, pre, num, unit), cap);
  world.layers.labels.before(el);

  let timer = 0, live = false; // live：名前を添えたまま年を動かしている間

  // 「前300」「1914」「1183年頃」「1912〜1913年」は数字を大きく、「平安末期」のような言葉はそのまま出す
  function write(label) {
    const m = label.match(/^(前)?(\d+(?:〜\d+)?)(年頃?)?$/);
    pre.textContent = m?.[1] ?? '';
    num.textContent = m ? m[2] : label;
    unit.textContent = m ? m[3] ?? '年' : '';
    el.classList.toggle('is-word', !m);
    el.classList.toggle('is-long', !!m && m[2].length > 5);
  }
  function drop() {
    live = false;
    cap.replaceChildren();
  }
  function show(hold) {
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('is-on');
      timer = setTimeout(() => { if (!live) drop(); }, FADE_MS);
    }, hold);
  }

  app.on('t', () => {
    if (document.body.classList.contains('is-intro')) return;
    if (!live) drop(); // 行き来が終わったあとに年を動かしたら、名前は外す
    write(formatYear(app.year)); // 紀元前は「前」が付く。古い時代は年表と同じく 10 年・100 年きざみ
    show(HOLD_MS);
  });

  return {
    // 年の下に名前を添える（null で外す）。次に年が止まるまで残す
    caption(nodes) {
      if (!nodes) { drop(); return; }
      live = true;
      cap.replaceChildren(...nodes);
    },
    // 着いた：その史跡の年の書き方（null ならいまの年のまま）で止め、名前と一緒に hold ミリ秒残して消す
    land(label, hold) {
      live = false;
      if (label) write(label);
      show(hold);
    },
  };
}
