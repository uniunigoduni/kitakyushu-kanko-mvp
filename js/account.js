// 会員登録とログイン（見た目だけのデモ）。右上のボタンから、旅行者・お店（事業者）の登録の画面を開く。
// 入力した内容はどこにも送らず、保存もしない。登録すると、ページを開いている間だけ右上に名前を出す（読み込み直すと消える）。
// パスワードは確かめるだけで、どこにも残さない。
import { h, svg, reducedMotion } from './util.js';
import { toast } from './ui/toast.js';

const WAIT_MS = 900; // 「登録しています」を見せる時間
const EASE = 'cubic-bezier(.22,.8,.2,1)';
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHOP_KINDS = ['飲食店', 'カフェ・甘味', 'おみやげ・物販', '体験・レンタル', '宿泊', 'そのほか'];
// 地点（お店の広告のピン）の登録をすぐ実演できるよう、欄に最初から入れておくダミー
const DEMO = { name: 'hogehoge', email: 'hogehoge@example.com', pass: 'hogehoge', kind: SHOP_KINDS[0] };

const PERSON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0';
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const CHEVRON = 'M7 10l5 5 5-5';

const TYPES = {
  traveler: {
    tab: '旅行者',
    lead: '巡った史跡の記録や、お店のクーポンを受け取れます。',
    perks: ['行きたい史跡を保存して、あとで見返せる', '電話ガイドの決済の記録が残る', '門司港のお店のクーポンを受け取れる'],
  },
  shop: {
    tab: 'お店・事業者',
    lead: 'お店の広告を、地図の上のピンとして出せます。',
    perks: ['地図にお店の広告のピンを出せる', '広告を見た人・道順を調べた人の数がわかる', '史跡を巡る人にクーポンを届けられる'],
  },
};

function icon(d, width = 2) {
  const s = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svg('path', { d }));
  return s;
}
// 丸いアイコンに入れる、名前の最初の1文字
const initial = (name) => ([...name.trim()][0] ?? '?').toUpperCase();
const avatar = (name, big) => h('i', { class: big ? 'acct-avatar is-big' : 'acct-avatar', 'aria-hidden': 'true', text: initial(name) });
const typeLabel = (u) => (u.type === 'shop' ? `お店・事業者（${u.kind}）` : '旅行者');

// 入力欄ひとつ（見出し・欄・補足・誤りの知らせ）
function field(id, label, attrs = {}, hint) {
  const input = h('input', { class: 'acct-input', id, autocomplete: 'off', spellcheck: 'false', ...attrs });
  const err = h('p', { class: 'acct-err', id: `${id}-err`, hidden: true });
  const wrap = h('div', { class: 'acct-field' }, h('label', { for: id, text: label }), input, hint && h('p', { class: 'acct-hint', id: `${id}-hint`, text: hint }), err);
  if (hint) input.setAttribute('aria-describedby', `${id}-hint`);
  return { wrap, input, err };
}

export function createAccount(app, world) {
  const appRoot = document.getElementById('app');
  const title = document.getElementById('title');
  let view = null, menu = null;
  app.user = null; // { type: 'traveler' | 'shop', name, email, kind }。ページを開いている間だけ

  // ---------- 右上のボタン（地点の登録の実演用に、お店の登録から開く）。登録したあとのメニューはボタンの下に出す ----------
  const btn = h('button', { class: 'hdr-btn acct-btn', type: 'button', onclick: () => (app.user ? toggleMenu() : open('shop')) });
  const wrap = h('div', { class: 'acct-wrap' }, btn);
  title.querySelector('.title-actions').append(wrap);
  function renderBtn() {
    const u = app.user;
    btn.classList.toggle('is-user', !!u);
    if (u) {
      btn.replaceChildren(avatar(u.name), h('span', { class: 'hdr-btn-text', text: u.name }), icon(CHEVRON));
      btn.setAttribute('aria-label', `${u.name}さんのメニュー`);
      btn.setAttribute('aria-expanded', String(!!menu));
      btn.setAttribute('aria-controls', 'acct-menu');
      btn.removeAttribute('aria-haspopup');
    } else {
      btn.replaceChildren(icon(PERSON), h('span', { class: 'hdr-btn-text', text: '新規登録' }));
      btn.setAttribute('aria-label', '新規登録・ログイン');
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.removeAttribute('aria-expanded');
      btn.removeAttribute('aria-controls');
    }
  }
  function setUser(u) {
    app.user = u;
    renderBtn();
    app.emit('user', u);
  }
  renderBtn();

  // ---------- 登録したあとのメニュー（名前・ログアウト） ----------
  function toggleMenu() { if (menu) closeMenu(); else openMenu(); }
  function openMenu() {
    const u = app.user;
    const items = [];
    if (u.type === 'shop' && app.showAdPreview) {
      items.push(h('button', { class: 'acct-menu-item', type: 'button', onclick: () => { closeMenu(); app.showAdPreview(); }, text: '広告の見本を地図で見る' }));
    }
    items.push(h('button', { class: 'acct-menu-item', type: 'button', onclick: logout, text: 'ログアウト' }));
    const el = h('div', { class: 'acct-menu', id: 'acct-menu' },
      h('div', { class: 'acct-menu-who' }, avatar(u.name, true),
        h('div', {},
          h('p', { class: 'acct-menu-name', text: u.name }),
          h('p', { class: 'acct-menu-sub', text: typeLabel(u) }),
          h('p', { class: 'acct-menu-sub', text: u.email }))),
      ...items,
      h('p', { class: 'acct-menu-note', text: 'デモのため、読み込み直すと登録は消えます' }));
    wrap.append(el);
    // メニューの外を押したら閉じる。Esc でも閉じる
    const onDown = (e) => { if (!el.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
    addEventListener('pointerdown', onDown, true);
    menu = { el, onDown, entry: { close: () => closeMenu(true) } };
    app.overlays.push(menu.entry);
    btn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu(refocus = false) {
    if (!menu) return;
    const { el, onDown, entry } = menu;
    menu = null;
    removeEventListener('pointerdown', onDown, true);
    const i = app.overlays.indexOf(entry);
    if (i >= 0) app.overlays.splice(i, 1);
    if (refocus || el.contains(document.activeElement)) btn.focus({ preventScroll: true });
    el.remove();
    if (app.user) btn.setAttribute('aria-expanded', 'false');
  }
  function logout() {
    closeMenu(true);
    setUser(null);
    toast('ログアウトしました（デモ）');
  }

  // ---------- 登録の画面 ----------
  function open(type = 'traveler') {
    if (view) return;
    closeMenu();
    view = show(TYPES[type] ? type : 'traveler', document.activeElement);
  }

  function show(type, opener) {
    const rm = reducedMotion();
    const card = h('section', { class: 'acct-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acct-title' });
    const el = h('div', { class: 'acct' }, h('div', { class: 'acct-main' }, card));
    document.body.append(el);

    let timer = 0, closed = false;
    const entry = { close };
    app.overlays.push(entry);
    appRoot.inert = true;
    world.pause(true);

    // 窓の外の暗いところで押して離したら閉じる（窓の中で押して外で離したときは閉じない）
    let downOutside = false;
    el.addEventListener('pointerdown', (e) => { downOutside = !card.contains(e.target); });
    el.addEventListener('click', (e) => { if (downOutside && !card.contains(e.target)) close(); downOutside = false; });

    const head = (text) => {
      const t = h('h2', { class: 'acct-title', id: 'acct-title', tabindex: -1, text });
      return [t, h('div', { class: 'acct-head' }, t, h('button', { class: 'acct-close', type: 'button', 'aria-label': '閉じる', onclick: () => close() }, '×'))];
    };
    const demo = () => h('p', { class: 'acct-demo', text: 'デモ：入力した内容は送信も保存もしません' });
    const spin = (text) => [h('i', { class: 'acct-spin', 'aria-hidden': 'true' }), h('span', { text })];
    // 欄ごとの決まり。誤りがあれば知らせの文を返す
    function judge(rules, show) {
      let first = null;
      for (const [f, rule] of rules) {
        if (f.wrap.hidden) continue;
        const msg = rule();
        if (show || f.err.textContent) { // 一度知らせた欄は、直したらすぐ消す
          f.err.textContent = msg;
          f.err.hidden = !msg;
          f.wrap.classList.toggle('is-bad', !!msg);
          f.input.setAttribute('aria-invalid', String(!!msg));
          const ids = [f.input.id + '-hint', f.err.id].filter((id) => card.querySelector('#' + id) && (id !== f.err.id || msg));
          f.input.setAttribute('aria-describedby', ids.join(' '));
        }
        if (msg && !first) first = f.input;
      }
      return first;
    }

    // ---------- 新規登録（旅行者・お店） ----------
    function register(focusTab) {
      const [t, headEl] = head('新規登録');
      const tabs = Object.keys(TYPES).map((k) => h('button', {
        class: 'acct-tab', type: 'button', role: 'tab', id: `acct-tab-${k}`, 'aria-controls': 'acct-form',
        onclick: () => setType(k), text: TYPES[k].tab,
      }));
      const tabList = h('div', { class: 'acct-tabs', role: 'tablist', 'aria-label': '登録の種類' }, tabs);
      tabList.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setType(type === 'traveler' ? 'shop' : 'traveler');
        tabs.find((b) => b.id === `acct-tab-${type}`).focus();
      });
      const lead = h('p', { class: 'acct-lead' });

      const nick = field('acct-nick', 'ニックネーム', { maxlength: 20, placeholder: '例：もじたろう' });
      const shop = field('acct-shop', '店名・事業者名', { maxlength: 30, placeholder: '例：門司港〇〇食堂' });
      const kindSel = h('select', { class: 'acct-input is-empty', id: 'acct-kind' },
        h('option', { value: '', text: '選んでください' }), SHOP_KINDS.map((k) => h('option', { value: k, text: k })));
      kindSel.addEventListener('change', () => kindSel.classList.toggle('is-empty', !kindSel.value));
      const kind = { input: kindSel, err: h('p', { class: 'acct-err', id: 'acct-kind-err', hidden: true }) };
      kind.wrap = h('div', { class: 'acct-field' }, h('label', { for: 'acct-kind', text: '業種' }), h('div', { class: 'acct-select' }, kindSel), kind.err);
      const mail = field('acct-mail', 'メールアドレス', { type: 'email', inputmode: 'email', placeholder: '例：moji@example.com' });
      const pass = field('acct-pass', 'パスワード', { type: 'password', autocomplete: 'new-password' }, '8文字以上。デモなので、ふだん使っているパスワードは入れないでください');
      const peek = h('button', { class: 'acct-peek', type: 'button', 'aria-pressed': 'false', 'aria-label': 'パスワードを表示', text: '表示' });
      peek.addEventListener('click', () => {
        const on = pass.input.type === 'password';
        pass.input.type = on ? 'text' : 'password';
        peek.textContent = on ? '隠す' : '表示';
        peek.setAttribute('aria-pressed', String(on));
      });
      const passBox = h('div', { class: 'acct-pass' });
      pass.input.replaceWith(passBox);
      passBox.append(pass.input, peek);
      const agreeBox = h('input', { type: 'checkbox', id: 'acct-agree' });
      const agree = { input: agreeBox, err: h('p', { class: 'acct-err', id: 'acct-agree-err', hidden: true }) };
      agree.wrap = h('div', { class: 'acct-field' },
        h('label', { class: 'acct-check', for: 'acct-agree' }, agreeBox, h('span', { text: '利用規約とプライバシーポリシーに同意する' })), agree.err);
      // ダミーを入れておき、「登録する」を押すだけで地図にピンが出るところまで見せられるようにする
      nick.input.value = shop.input.value = DEMO.name;
      kindSel.value = DEMO.kind;
      kindSel.classList.remove('is-empty');
      mail.input.value = DEMO.email;
      pass.input.value = DEMO.pass;
      agreeBox.checked = true;

      const submit = h('button', { class: 'btn-primary', type: 'submit', text: '登録する' });
      const form = h('form', { class: 'acct-form', id: 'acct-form', role: 'tabpanel', novalidate: true, autocomplete: 'off' },
        nick.wrap, shop.wrap, kind.wrap, mail.wrap, pass.wrap, agree.wrap, submit);

      const rules = [
        [nick, () => (nick.input.value.trim() ? '' : 'ニックネームを入れてください')],
        [shop, () => (shop.input.value.trim() ? '' : '店名・事業者名を入れてください')],
        [kind, () => (kindSel.value ? '' : '業種を選んでください')],
        [mail, () => { const v = mail.input.value.trim(); return !v ? 'メールアドレスを入れてください' : MAIL.test(v) ? '' : 'メールアドレスの形になっていません（例：moji@example.com）'; }],
        [pass, () => { const n = [...pass.input.value].length; return n >= 8 ? '' : n ? `8文字以上にしてください（いま${n}文字）` : 'パスワードを入れてください'; }],
        [agree, () => (agreeBox.checked ? '' : '登録するには、同意のチェックを入れてください')],
      ];
      form.addEventListener('input', () => judge(rules, false));
      form.addEventListener('change', () => judge(rules, false));

      let busy = false;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        const bad = judge(rules, true);
        if (bad) { bad.focus(); return; }
        busy = true;
        // disabled にするとフォーカスが外れるので、aria-disabled で押せなくする
        submit.setAttribute('aria-disabled', 'true');
        submit.replaceChildren(...spin('登録しています'));
        const u = { type, name: (type === 'shop' ? shop : nick).input.value.trim(), email: mail.input.value.trim(), kind: type === 'shop' ? kindSel.value : '' };
        timer = setTimeout(() => done(u), WAIT_MS);
      });

      function setType(k) {
        if (busy) return;
        type = k;
        for (const b of tabs) {
          const on = b.id === `acct-tab-${k}`;
          b.setAttribute('aria-selected', String(on));
          b.tabIndex = on ? 0 : -1;
        }
        form.setAttribute('aria-labelledby', `acct-tab-${k}`);
        lead.textContent = TYPES[k].lead;
        nick.wrap.hidden = k !== 'traveler';
        shop.wrap.hidden = kind.wrap.hidden = k !== 'shop';
        judge(rules, false);
      }
      setType(type);

      card.replaceChildren(headEl, demo(), tabList, lead, form,
        h('p', { class: 'acct-switch' }, h('span', { text: 'すでに登録している方は' }),
          h('button', { class: 'acct-link', type: 'button', onclick: () => login(), text: 'ログイン' })));
      (focusTab ? tabs.find((b) => b.id === `acct-tab-${type}`) : t).focus({ preventScroll: true });
    }

    // ---------- ログイン ----------
    function login() {
      const [t, headEl] = head('ログイン');
      const mail = field('acct-mail', 'メールアドレス', { type: 'email', inputmode: 'email', placeholder: '例：moji@example.com' });
      const pass = field('acct-pass', 'パスワード', { type: 'password', autocomplete: 'current-password' });
      mail.input.value = DEMO.email;
      pass.input.value = DEMO.pass;
      const submit = h('button', { class: 'btn-primary', type: 'submit', text: 'ログインする' });
      const form = h('form', { class: 'acct-form', novalidate: true, autocomplete: 'off' }, mail.wrap, pass.wrap, submit);
      const rules = [
        [mail, () => { const v = mail.input.value.trim(); return !v ? 'メールアドレスを入れてください' : MAIL.test(v) ? '' : 'メールアドレスの形になっていません（例：moji@example.com）'; }],
        [pass, () => (pass.input.value ? '' : 'パスワードを入れてください')],
      ];
      form.addEventListener('input', () => judge(rules, false));
      let busy = false;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        const bad = judge(rules, true);
        if (bad) { bad.focus(); return; }
        busy = true;
        submit.setAttribute('aria-disabled', 'true');
        submit.replaceChildren(...spin('ログインしています'));
        // 登録の記録は持っていないので、メールアドレスの @ より前を名前にする
        const email = mail.input.value.trim();
        const u = { type: 'traveler', name: email.split('@')[0].slice(0, 20), email, kind: '' };
        timer = setTimeout(() => { setUser(u); close(); toast(`ようこそ、${u.name}さん（デモのログイン）`); }, WAIT_MS);
      });
      card.replaceChildren(headEl, demo(), form,
        h('p', { class: 'acct-switch' }, h('span', { text: 'はじめての方は' }),
          h('button', { class: 'acct-link', type: 'button', onclick: () => register(), text: '新規登録' })));
      t.focus({ preventScroll: true });
    }

    // ---------- 登録の完了 ----------
    function done(u) {
      setUser(u);
      const [t, headEl] = head('登録が完了しました');
      const preview = u.type === 'shop' && app.showAdPreview;
      card.replaceChildren(...[headEl,
        h('div', { class: 'acct-welcome' }, avatar(u.name, true),
          h('div', {},
            h('p', { class: 'acct-welcome-name', text: u.type === 'shop' ? u.name : `ようこそ、${u.name}さん` }),
            h('p', { class: 'acct-welcome-sub', text: `${typeLabel(u)}として登録しました` }))),
        h('p', { class: 'acct-label', text: 'できるようになったこと' }),
        h('ul', { class: 'acct-perks' }, TYPES[u.type].perks.map((p) => h('li', {}, icon(CHECK, 2.4), h('span', { text: p })))),
        preview && h('button', { class: 'btn-primary', type: 'button', onclick: () => { close(); app.showAdPreview(); }, text: '広告の見本を地図で見る' }),
        h('button', { class: preview ? 'acct-text-btn' : 'btn-primary', type: 'button', onclick: () => close(), text: '地図へ戻る' }),
        h('p', { class: 'acct-note', text: 'デモのため、登録した内容はどこにも送っていません。ページを読み込み直すと消えます。' })].filter(Boolean));
      t.focus({ preventScroll: true });
      if (!rm) card.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE });
    }

    register();

    // ---------- 閉じる ----------
    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      const i = app.overlays.indexOf(entry);
      if (i >= 0) app.overlays.splice(i, 1);
      appRoot.inert = false;
      world.pause(false);
      (opener?.isConnected ? opener : btn).focus({ preventScroll: true });
      const end = () => { el.remove(); view = null; };
      if (rm) end();
      else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease', fill: 'forwards' }).finished.then(end, end);
    }

    return { close };
  }

  return { open, get isOpen() { return !!view; } };
}
