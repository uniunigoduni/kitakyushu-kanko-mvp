// 「ガイドとつながる」の決済（デモ）。黒い地図から白い決済の画面に切り替え、確定するとガイドの電話番号を出す。
// 決済した史跡は1時間覚えておき、その間は吹き出しのボタンから、決済を通らずに番号を出す。
import { h, historicalName, svg, isPaid, setPaid, paidUntil, reducedMotion } from './util.js';
import { pinLabel } from './ui/pins.js';

const PHONE = '000-0000-0000'; // ダミーの番号
const WAIT_MS = 1200;          // 確定を押してから完了までの「処理しています」
const EASE = 'cubic-bezier(.22,.8,.2,1)';

function icon(d, width = 2) {
  const s = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svg('path', { d }));
  return s;
}
const clock = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

export function createPay(app, world) {
  const appRoot = document.getElementById('app');
  let view = null;

  function open(s) {
    if (view) return;
    view = show(s, document.activeElement);
  }

  function show(s, opener) {
    const rm = reducedMotion();
    const name = pinLabel(historicalName(s));
    const back = h('button', { class: 'pay-back', type: 'button', onclick: () => close() }, icon('M15 5l-7 7 7 7'), h('span', { text: '地図へ戻る' }));
    const card = h('section', { class: 'pay-card' });
    const el = h('div', { class: 'pay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pay-title' }, back, h('div', { class: 'pay-main' }, card));
    document.body.append(el);

    let timer = 0, closed = false;
    const entry = { close };
    app.overlays.push(entry);
    appRoot.inert = true;
    world.pause(true);

    const head = () => h('div', { class: 'pay-head' }, h('b', { text: '門司ヒストリーマップ' }), h('span', { class: 'pay-badge', text: 'デモ（実際の請求はありません）' }));

    // ---------- 支払い ----------
    function checkout() {
      const btn = h('button', { class: 'pay-btn', type: 'button', onclick: () => confirm() }, h('span', { text: '1,000円の決済を確定する' }));
      card.replaceChildren(
        head(),
        h('p', { class: 'pay-label', text: 'お支払い金額' }),
        h('p', { class: 'pay-amount', text: '¥1,000' }),
        h('div', { class: 'pay-item' },
          h('h2', { class: 'pay-title', id: 'pay-title', text: '電話ガイド（1時間）' }),
          h('p', { text: `「${name}」について、地元の方が電話で案内します` })),
        h('p', { class: 'pay-label', id: 'pay-card-label', text: 'カード情報' }),
        // 本物の番号を打ち込ませないよう、入力欄ではなく表示だけにする
        h('div', { class: 'pay-field', role: 'group', 'aria-labelledby': 'pay-card-label' },
          h('span', { 'aria-label': 'カード番号', text: '4242 4242 4242 4242' }),
          h('span', { 'aria-label': '有効期限', text: '12 / 34' }),
          h('span', { 'aria-label': 'セキュリティコード', text: '123' })),
        h('p', { class: 'pay-hint', text: 'デモ用の番号が入っています。入力はいりません。' }),
        btn);

      function confirm() {
        if (btn.hasAttribute('aria-disabled')) return;
        // disabled にするとフォーカスが外れるので、aria-disabled で押せなくする
        btn.setAttribute('aria-disabled', 'true');
        btn.replaceChildren(h('i', { class: 'pay-spin', 'aria-hidden': 'true' }), h('span', { text: '処理しています' }));
        timer = setTimeout(() => {
          setPaid(s.id);
          app.emit('paid', s);
          done(true);
        }, WAIT_MS);
      }
    }

    // ---------- 完了（電話番号） ----------
    function done(fresh) {
      const title = h('h2', { class: 'pay-title', id: 'pay-title', tabindex: -1, text: fresh ? '決済が完了しました' : '決済完了済み' });
      card.replaceChildren(
        head(),
        h('div', { class: 'pay-done' }, h('i', { class: 'pay-check' }, icon('M5 12.5l4.5 4.5L19 7.5', 2.4)), title),
        h('p', { class: 'pay-sub', text: `「${name}」の電話ガイド（1時間）・¥1,000` }),
        h('p', { class: 'pay-label', text: 'ガイドの電話番号' }),
        h('p', { class: 'pay-phone' }, h('span', { text: PHONE }), h('span', { class: 'pay-badge', text: 'ダミー' })),
        h('a', { class: 'pay-btn', href: `tel:${PHONE.replaceAll('-', '')}` },
          icon('M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'),
          h('span', { text: '電話をかける' })),
        h('p', { class: 'pay-hint', text: `${clock(paidUntil(s.id))}までは、吹き出しのボタンからこの番号をもう一度見られます。` }),
        h('button', { class: 'pay-text-btn', type: 'button', onclick: () => close(), text: '地図へ戻る' }));
      title.focus({ preventScroll: true });
      if (fresh && !rm) card.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE });
    }

    if (isPaid(s.id)) done(false);
    else { checkout(); back.focus({ preventScroll: true }); }

    // ---------- 閉じる ----------
    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      const i = app.overlays.indexOf(entry);
      if (i >= 0) app.overlays.splice(i, 1);
      appRoot.inert = false;
      world.pause(false);
      // 吹き出しのボタンは決済のあと作り直しているので、今あるほうに戻す
      const to = opener?.isConnected ? opener : document.querySelector('.popup:not([hidden]) .popup-foot .btn-primary');
      to?.focus({ preventScroll: true });
      const end = () => { el.remove(); view = null; };
      if (rm) end();
      else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease', fill: 'forwards' }).finished.then(end, end);
    }

    return { close };
  }

  return { open, get isOpen() { return !!view; } };
}
