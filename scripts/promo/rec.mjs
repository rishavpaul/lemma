import { chromium } from 'playwright';
import fs from 'fs';
import { dur } from './dur.mjs';
const token = fs.readFileSync('/tmp/lemma-demo/auth_token', 'utf8').trim();
const out = process.argv[2] || 'rec';
const B = 'http://localhost:3099';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out + '/frames', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CH });
const ctx = await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, colorScheme: 'light' });
await ctx.addCookies([{ name: 'sdc_token', value: token, url: B }]);
await ctx.addInitScript(() => {
  const mk = () => {
    if (document.getElementById('fade')) return;
    const f = document.createElement('div'); f.id = 'fade';
    f.style.cssText = 'position:fixed;inset:0;background:#f5f5f1;z-index:2147483647;opacity:1;transition:opacity .4s ease;pointer-events:none';
    document.documentElement.appendChild(f);
  };
  mk(); document.addEventListener('DOMContentLoaded', mk);
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const frames = []; let n = 0;
cdp.on('Page.screencastFrame', f => {
  const name = 'f' + String(n++).padStart(6, '0') + '.jpg';
  fs.writeFileSync(out + '/frames/' + name, Buffer.from(f.data, 'base64'));
  frames.push([name, f.metadata.timestamp]);
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 2880, maxHeight: 1620, everyNthFrame: 1 });
const now = () => Date.now() / 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const marks = []; const segs = []; let seg = null;

const ease = `const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;`;
async function cursorInit() {
  await p.evaluate(() => {
    if (document.getElementById('cur')) return;
    const c = document.createElement('div'); c.id = 'cur';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.6L9.8 19z" fill="#1d1d1a" stroke="#f5f5f1" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;transform:translate(' + (window.__cx ?? 900) + 'px,' + (window.__cy ?? 520) + 'px)';
    document.documentElement.appendChild(c);
  });
}
async function moveTo(x, y, ms = 900) {
  await p.evaluate(async ([x, y, ms]) => {
    const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
    const c = document.getElementById('cur'); const x0 = window.__cx ?? 900, y0 = window.__cy ?? 520;
    const t0 = performance.now();
    await new Promise(res => { const step = () => { const k = Math.min((performance.now() - t0) / ms, 1), e = ease(k);
      const cx = x0 + (x - x0) * e, cy = y0 + (y - y0) * e - Math.sin(Math.PI * e) * 14;
      c.style.transform = `translate(${cx}px,${cy}px)`; window.__cx = cx; window.__cy = cy;
      k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
  }, [x, y, ms]);
  await p.mouse.move(x, y);
}
async function ripple() {
  await p.evaluate(() => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${window.__cx}px;top:${window.__cy}px;width:18px;height:18px;margin:-9px;border-radius:50%;background:rgba(35,80,200,.35);z-index:2147483645;pointer-events:none;transition:transform .5s ease-out,opacity .5s ease-out`;
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(3.2)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  });
}
async function scrollBy(total, ms) {
  const t0 = now(); let done = 0;
  while (true) {
    const k = Math.min((now() - t0) * 1000 / ms, 1);
    const e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;
    const d = total * e - done; done += d;
    if (Math.abs(d) > .1) await p.mouse.wheel(0, d);
    if (k >= 1) break; await sleep(8);
  }
}
async function caption(text) { return;

  await p.evaluate(t => {
    document.getElementById('cap')?.remove();
    const d = document.createElement('div'); d.id = 'cap'; d.textContent = t;
    d.style.cssText = `position:fixed;left:50%;bottom:34px;transform:translate(-50%,8px);z-index:2147483640;background:rgba(29,29,26,.94);color:#f5f5f1;padding:14px 28px 15px;border-radius:5px;font:italic 400 26px/1.3 var(--font-serif),'STIX Two Text',Georgia,serif;max-width:1180px;text-align:center;opacity:0;transition:opacity .45s ease,transform .45s ease`;
    document.documentElement.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; d.style.transform = 'translate(-50%,0)'; });
  }, text);
}
async function hideCaption() { await p.evaluate(() => { const d = document.getElementById('cap'); if (d) d.style.opacity = '0'; }); }
async function fadeOut() { await p.evaluate(() => { const f = document.getElementById('fade'); if (f) f.style.opacity = '1'; }); await sleep(450); cutStart = now() + 0.12; }
async function reveal_old() { if (cutStart) { cuts.push([cutStart, now() - 0.1]); cutStart = null; } await p.evaluate(() => { window.__go?.(); const f = document.getElementById('fade'); if (f) f.style.opacity = '0'; }); }
async function open(url, settle = 1500) {
  await p.goto(B + url, { waitUntil: 'networkidle' });
  await sleep(settle); await cursorInit();
}
async function card(kind, title, sub) {
  await p.goto(B + '/', { waitUntil: 'networkidle' }); await sleep(600);
  await p.evaluate(([title, sub, kind]) => {
    const c = document.createElement('div');
    const accent = kind === 'code' ? '#2350c8' : '#a35f00';
    c.style.cssText = `position:fixed;inset:0;z-index:2147483000;background:#f5f5f1;color:#1d1d1a;display:flex;flex-direction:column;justify-content:center;padding:0 150px;font-family:var(--font-serif),'STIX Two Text',Georgia,serif`;
    const logo = `<svg width="86" height="86" viewBox="0 0 64 64" style="margin-bottom:44px"><rect width="64" height="64" rx="15" fill="#0b1311"/><path d="M19 10H17Q11 10 11 16V26Q11 32 5 32Q11 32 11 38V48Q11 54 17 54H19M45 10H47Q53 10 53 16V26Q53 32 59 32Q53 32 53 38V48Q53 54 47 54H45" fill="none" stroke="#6EA2FF" stroke-width="4" stroke-linecap="round"/><g fill="none" stroke="#F0A63A" stroke-width="3.2" stroke-linecap="round"><circle cx="32" cy="20" r="4"/><circle cx="24" cy="44" r="4"/><circle cx="40" cy="44" r="4"/><path d="M32 24L24 40M32 24L40 40"/></g></svg>`;
    c.innerHTML = `${logo}<div class="t" style="font-size:150px;line-height:1;letter-spacing:-4px;font-weight:500;opacity:0;transform:translateY(14px);transition:all .9s cubic-bezier(.2,.7,.2,1)">${title}</div>
      <div class="s" style="font-size:44px;font-style:italic;margin-top:30px;color:#555;opacity:0;transform:translateY(10px);transition:all .9s .25s cubic-bezier(.2,.7,.2,1)">${sub}</div>
      <div style="width:120px;height:4px;background:${accent};margin-top:46px;opacity:0;transition:opacity .9s .5s" class="r"></div>`;
    document.documentElement.appendChild(c);
    window.__go = () => c.querySelectorAll('.t,.s,.r').forEach(e => { e.style.opacity = '1'; e.style.transform = 'none'; });
  }, [title, sub, kind]);
}


const LEAD = 0.9, TAIL = 0.9;
async function beginSeg(name) {
  await p.evaluate(() => { const f = document.getElementById('fade'); if (f) { f.style.transition = 'none'; f.style.opacity = '0'; } window.__go?.(); });
  await sleep(150);
  seg = { name, start: now(), marks: [] };
}
async function endSeg() { seg.end = now(); segs.push(seg); seg = null; }
async function scene(key, fn, { tail = TAIL } = {}) {
  const t0 = now(); const D = dur[key] + LEAD + tail;
  seg.marks.push({ key, at: t0 + LEAD });
  await fn(() => (now() - t0));
  const rest = D - (now() - t0); if (rest > 0) await sleep(rest * 1000);
}
const until = async (el, t) => { const w = t - el(); if (w > 0) await sleep(w * 1000); };
async function loadFresh(url, settle = 1500) {
  await p.evaluate(() => { const f = document.getElementById('fade'); if (f) { f.style.transition = 'none'; f.style.opacity = '1'; } }).catch(() => {});
  await open(url, settle);
}

// ---------- timeline ----------
await card('design', 'Lemma.', 'Practice staff-level interviews, out loud.');
// the title waits for "This is Lemma."
await p.evaluate(() => { document.querySelectorAll('.t,.r').forEach(e => { e.style.transition = 'none'; e.style.opacity = '0'; }); window.__go = () => { document.querySelectorAll('.s').forEach(e => { e.style.opacity = '1'; e.style.transform = 'none'; }); }; });
await beginSeg('intro');
await scene('intro', async el => {
  await until(el, LEAD + dur.intro - 1.3);
  await p.evaluate(() => document.querySelectorAll('.t,.r').forEach(e => { e.style.transition = 'all 1s cubic-bezier(.2,.7,.2,1)'; e.style.opacity = '1'; e.style.transform = 'none'; }));
}, { tail: 1.6 });
await endSeg();

await loadFresh('/', 1800); await beginSeg('home');
await scene('home', async el => {
  await moveTo(760, 300, 1600); await until(el, 3.6);
  const s = scrollBy(560, 4200); await moveTo(1000, 520, 3600); await s;
});
await endSeg();

await loadFresh('/session/?id=10', 2200); await beginSeg('session');
await scene('session', async el => {
  await moveTo(520, 420, 1800); await until(el, 6.5);
  await scrollBy(260, 4000); await moveTo(760, 560, 2800);
});
await scene('canvas', async el => {
  await moveTo(1000, 440, 1200); await moveTo(1290, 440, 1100); await moveTo(1500, 330, 1000); await moveTo(1500, 500, 900);
});
await endSeg();

await loadFresh('/report/?id=9', 2000); await beginSeg('report');
await scene('report', async el => {
  await moveTo(1000, 320, 1400); await until(el, 3.6); await scrollBy(700, 5200);
});
await scene('report2', async el => { await scrollBy(900, 4200); });
await endSeg();

await loadFresh('/articles/', 1500); await beginSeg('articles');
await scene('articles', async el => {
  const loc = p.getByText('Token bucket vs sliding window').first();
  const bb = await loc.boundingBox();
  if (bb) { await moveTo(bb.x + 80, bb.y + bb.height / 2, 1500); await until(el, 3.6); await ripple(); await loc.click(); }
});
await endSeg();

await loadFresh('/progress/', 2000); await beginSeg('progress');
await scene('progress', async el => { await moveTo(900, 380, 1400); await scrollBy(520, 3600); });
await endSeg();

await card('code', 'Now, code.', 'Java, judged on your Mac.'); await beginSeg('codecard');
await scene('codecard', async () => {}, { tail: 1.3 });
await endSeg();

await loadFresh('/code/', 1800); await beginSeg('roadmap');
await scene('roadmap', async el => { await moveTo(820, 340, 1400); await until(el, 3.8); await scrollBy(900, 7000); });
await endSeg();

await loadFresh('/code/problem/?slug=group-anagrams&attempt=22', 2400); await beginSeg('problem');
await scene('problem', async el => { await moveTo(560, 460, 1800); await until(el, 3.2); await moveTo(700, 560, 1600); });
await scene('review', async el => {
  const tab = p.getByRole('tab', { name: 'Staff review' });
  const bb = await tab.boundingBox().catch(() => null);
  if (bb) { await moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2, 1100); await ripple(); await tab.click(); }
  await sleep(700); await scrollBy(700, 3400);
});
await endSeg();

await loadFresh('/settings/', 1800); await beginSeg('usage');
await p.evaluate(() => { // never show real key suffixes
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) n.textContent = n.textContent.replace(/(Saved\s*\S*?)\w{4}$/, '$1\u2022\u2022\u2022\u2022');
});
await scene('usage', async el => {
  await moveTo(700, 420, 1200); await scrollBy(560, 3600);
  await until(el, 6.2); await moveTo(780, 360, 1400); await scrollBy(420, 3600);
});
await endSeg();

await loadFresh('/usage/', 2200); await beginSeg('tracking');
await scene('tracking', async el => {
  await moveTo(900, 380, 1200); await until(el, 2.6); await scrollBy(640, 3200); await scrollBy(560, 2600);
});
await endSeg();

await card('design', 'Lemma.', 'Local, private, and free.'); await beginSeg('outro');
await scene('outro', async () => {}, { tail: 2.4 });
await endSeg();

await cdp.send('Page.stopScreencast'); await sleep(300);
const out_segs = [];
segs.forEach((sg, k) => {
  let startIdx = 0;
  frames.forEach((f, i) => { if (f[1] <= sg.start) startIdx = i; });
  const fr = frames.filter((f, i) => i >= startIdx && f[1] < sg.end);
  let list = '';
  fr.forEach((f, i) => {
    const t = Math.max(f[1], sg.start), nx = i + 1 < fr.length ? fr[i + 1][1] : sg.end;
    list += `file 'frames/${f[0]}'\nduration ${Math.max(nx - t, 0.001).toFixed(4)}\n`;
  });
  list += `file 'frames/${fr.at(-1)[0]}'\n`;
  fs.writeFileSync(`${out}/seg${k}.txt`, list);
  out_segs.push({ k, name: sg.name, len: +(sg.end - sg.start).toFixed(3), marks: sg.marks.map(m => ({ key: m.key, rel: +(m.at - sg.start).toFixed(3) })) });
});
fs.writeFileSync(out + '/segs.json', JSON.stringify(out_segs, null, 1));
console.log('frames', frames.length, 'segments', out_segs.length, 'total', out_segs.reduce((a, s) => a + s.len, 0).toFixed(1));
await b.close();
