// 開発時に動かす：画面の確認用の撮影。年と視点を変えながら地図を撮り、1 コマの描く量とエラーも記録する。
// GPU のあるパソコンで、リポジトリの外に作業フォルダを作り、そこを今いる場所にして動かす
// （playwright-core は今いる場所の node_modules から読む。node_modules とブラウザはリポジトリに入れない）。
//   npm install playwright-core            … 確かめたのは 1.65.1
//   npx playwright-core install chromium   … ブラウザの置き場所は、環境変数 PLAYWRIGHT_BROWSERS_PATH で作業フォルダの中にしておく（入れるときも、動かすときも同じ値）
//   node <リポジトリ>/tools/shots.mjs <リポジトリ> <出力フォルダ> <仕事.json>
// 配信は 127.0.0.1 だけ・キャッシュなしで、この道具の中で立てて、終わったら止める。ブラウザも閉じる。
// 出力は <出力フォルダ>/<name>.jpg と report.json。画面には 1 枚ごとの描く量と、最後に errors: の数を出す。
//
// 仕事.json の形（動かした実例は tools/shots_example.json）：{ "query": "?intro=0", "args": [...], "probe": "式", "shots": [ ... ] }
//   shots の 1 件に書けるもの
//     name    … 画像のファイル名
//     size    … desktop（1440×900。書かなければこれ）・desktop2x・laptop（1280×720）・phone（390×844・タップ）
//     year    … その年にする
//     view    … { lon, lat, distance, polar, azimuth }。その地点を真ん中にする（polar・azimuth は書かなくてよい）
//     home    … true にすると、いつもの視点にする（view を書かないとき）
//     eval    … 撮る前にページの中で実行する式
//     wait    … 撮る前に待つミリ秒（書かなければ 1500）
//     click   … CSS セレクター。その要素の真ん中を実際に押して、click が届くかを確かめる
//     probe   … 撮る直前にページの中で計算して、結果を記録に出す式
//     clip    … CSS セレクター。その要素のまわりだけを撮る（pad に余白のピクセル。書かなければ 16）
//     quality … JPEG の品質（書かなければ 76）
// ブラウザの起動の引数は Windows の GPU 向け（--use-angle=d3d11）。ほかの OS では、仕事.json の args に書いて差し替える。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { chromium } = require('playwright-core');
const root = path.resolve(process.argv[2]), outDir = path.resolve(process.argv[3]);
const job = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let st = null;
  try { st = fs.statSync(file); if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); } } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
  const head = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let a = m[1] ? Number(m[1]) : st.size - Number(m[2]), b = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    a = Math.max(0, a); b = Math.min(st.size - 1, b);
    if (a > b) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
  } else {
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  desktop2x: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const report = { base, shots: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: job.args ?? ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
try {
  for (const size of [...new Set(job.shots.map((s) => s.size ?? 'desktop'))]) {
    const ctx = await browser.newContext(SIZES[size]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(`[${size}] pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`[${size}] console: ${m.text().slice(0, 300)}`); });
    page.on('requestfailed', (r) => report.errors.push(`[${size}] failed: ${r.url().replace(base, '')} ${r.failure()?.errorText ?? ''}`));
    page.on('response', (r) => { if (r.status() >= 400) report.errors.push(`[${size}] ${r.status()}: ${r.url().replace(base, '')}`); });
    const t0 = Date.now();
    await page.goto(base + '/' + (job.query ?? '?intro=0'), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app && window.__app.sites && window.__world && !document.body.classList.contains('is-loading'), null, { timeout: 90000 });
    const loadMs = Date.now() - t0;
    for (const s of job.shots.filter((x) => (x.size ?? 'desktop') === size)) {
      const info = await page.evaluate(async (s) => {
        const w = window.__world;
        if (s.year != null) {
          const { yearToT } = await import('/js/eras.js');
          window.__app.setT(yearToT(s.year + 0.5));
          w.settleCoast();
        }
        if (s.view) {
          const t = w.at(s.view.lon, s.view.lat, 0);
          await w.view({ target: [t.x, t.y, t.z], distance: s.view.distance, polar: s.view.polar, azimuth: s.view.azimuth }, false);
        } else if (s.home) await w.goHome?.(false);
        if (s.eval) await (0, eval)(s.eval);
        await new Promise((r) => setTimeout(r, s.wait ?? 1500));
        // 1 コマの描く量（数コマの平均）と、コマの間隔
        const r = w.renderer;
        r.info.autoReset = false; r.info.reset();
        let frames = 0;
        const start = performance.now();
        await new Promise((done) => { const tick = () => { if (++frames >= 20 || performance.now() - start > 4000) done(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        const ms = (performance.now() - start) / frames;
        const out = { calls: Math.round(r.info.render.calls / frames), triangles: Math.round(r.info.render.triangles / frames), frameMs: +ms.toFixed(1) };
        r.info.autoReset = true;
        const town = w.scene.getObjectByName('town');
        const ud = town?.userData;
        out.town = !town ? null : ud.update
          ? { lots: ud.count, rows: ud.rows, drawn: ud.drawn(), chunks: `${town.children.filter((m) => m.visible).length}/${town.children.length}`, built: ud.countAt(w.shared.uYear.value), olds: ud.olds, old: ud.oldAt?.(w.shared.uYear.value) }
          : { count: ud.count, meshes: town.children.length };
        const c = w.controls;
        out.cam = { distance: +c.distance.toFixed(1), polar: +c.polarAngle.toFixed(3), azimuth: +c.azimuthAngle.toFixed(3) };
        const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        out.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
        out.geometries = r.info.memory.geometries;
        return out;
      }, s);
      // 押せるかの確認：その要素の真ん中を実際に押して（スマホの大きさではタップ）、click が届いたかを見る。ページの移動は止める
      if (s.click) {
        await page.evaluate((sel) => {
          window.__clicked = null;
          document.querySelector(sel).addEventListener('click', (e) => { e.preventDefault(); window.__clicked = e.currentTarget.getAttribute('href') ?? 'clicked'; }, { once: true });
        }, s.click);
        const b = await page.locator(s.click).boundingBox();
        if (SIZES[size].hasTouch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(300);
        const got = await page.evaluate(() => window.__clicked);
        console.log(`  click ${s.click} -> ${got}  (${Math.round(b.width)}x${Math.round(b.height)} px)`);
        if (!got) report.errors.push(`[${size}] click が届かない: ${s.click}`);
      }
      // probe に式を書くと、撮る直前にページの中で計算して、結果を記録に出す
      const probe = s.probe ?? job.probe; // 仕事の全体に書いた probe は、どの撮影にも使う
      if (probe) {
        const v = await page.evaluate((src) => (0, eval)(src), probe);
        info.probe = v;
        console.log(`  probe ${s.name} ${JSON.stringify(v)}`);
      }
      // clip に CSS セレクターを書くと、その要素のまわりだけを撮る
      let clip = s.clip;
      if (typeof clip === 'string') {
        const b = await page.locator(clip).boundingBox(), pad = s.pad ?? 16;
        clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
      }
      const file = path.join(outDir, s.name + '.jpg');
      await page.screenshot({ path: file, type: 'jpeg', quality: s.quality ?? 76, ...(clip ? { clip } : {}) });
      report.shots.push({ name: s.name, size, loadMs, bytes: fs.statSync(file).size, ...info });
      console.log(`${s.name}  ${info.triangles} tris  ${info.calls} calls  ${info.frameMs} ms/frame  cam ${JSON.stringify(info.cam)}  town ${JSON.stringify(info.town)}`);
    }
    await ctx.close();
  }
} catch (e) {
  report.errors.push('道具の失敗: ' + (e.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
console.log('gpu: ' + (report.shots[0]?.gpu ?? '-'));
console.log(`errors: ${report.errors.length}`);
for (const e of report.errors.slice(0, 20)) console.log('  ' + e);
console.log('DONE');
