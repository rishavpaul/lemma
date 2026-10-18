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
const marks = []; const cuts = []; let cutStart = null;

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
async function reveal() { if (cutStart) { cuts.push([cutStart, now() - 0.1]); cutStart = null; } await p.evaluate(() => { window.__go?.(); const f = document.getElementById('fade'); if (f) f.style.opacity = '0'; }); }
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

// A scene: fade in, narration begins 0.5s later, everything is held to the narration length + tail.
async function scene(key, fn, { tail = 0.8, min = 0 } = {}) {
  await reveal(); await sleep(450);
  const t0 = now(); const D = Math.max(dur[key] + 0.5 + tail, min);
  marks.push({ key, at: t0 + 0.5, dur: dur[key] });
  await fn(() => (now() - t0));
  const rest = D - (now() - t0); if (rest > 0) await sleep(rest * 1000);
}
const until = async (el, t) => { const w = t - el(); if (w > 0) await sleep(w * 1000); };

// ---------- timeline ----------
await card('design', 'Lemma.', 'Practice staff-level interviews, out loud.');
await scene('intro', async () => {}, { tail: 1.4 });

await fadeOut(); await open('/', 1800);
await scene('home', async el => {
  await caption('One streak across two tracks: system design and coding');
  await moveTo(760, 300, 1400); await until(el, 3.4);
  await hideCaption(); const s = scrollBy(560, 4200); await moveTo(1000, 520, 3600); await s;
});

await fadeOut(); await open('/session/?id=10', 2200);
await scene('session', async el => {
  await caption('Answer out loud, one section at a time. The clock runs only while you talk.');
  await moveTo(520, 420, 1600); await until(el, 5.5);
  await scrollBy(260, 3600); await moveTo(760, 560, 2600);
});
await scene('canvas', async el => {
  await caption('Draw while you talk. The grader reads your diagram too.');
  await moveTo(1000, 440, 1200); await moveTo(1290, 440, 1000); await moveTo(1500, 330, 900); await moveTo(1500, 500, 800);
}, { tail: 0.6 });

await fadeOut(); await open('/report/?id=9', 2000);
await scene('report', async el => {
  await caption('Graded against a researched answer key: level, hire signal, ten dimensions');
  await moveTo(1000, 320, 1400); await until(el, 3.2); await scrollBy(700, 5000);
});
await scene('report2', async el => {
  await caption('Evidence, gaps and a drill for next time, for every section');
  await scrollBy(900, 4200);
}, { tail: 0.6 });

await fadeOut(); await open('/articles/', 1500);
await scene('articles', async el => {
  await caption('Explainer articles, grouped by design problem');
  const loc = p.getByText('Token bucket vs sliding window').first();
  const bb = await loc.boundingBox();
  if (bb) { await moveTo(bb.x + 80, bb.y + bb.height / 2, 1400); await until(el, 3.3); await ripple(); await loc.click(); }
});

await fadeOut(); await open('/progress/', 2000);
await scene('progress', async el => {
  await caption('Progress tracks recurring gaps across sessions');
  await moveTo(900, 380, 1400); await scrollBy(520, 3200);
});

await fadeOut(); await card('code', 'Now, code.', 'Java, judged on your Mac.');
await scene('codecard', async () => {}, { tail: 1.4 });

await fadeOut(); await open('/code/', 1800);
await scene('roadmap', async el => {
  await caption('A roadmap of 160 problems, built and verified once, judged locally');
  await moveTo(820, 340, 1400); await until(el, 3.4); await scrollBy(900, 5600);
});

await fadeOut(); await open('/code/problem/?slug=group-anagrams&attempt=22', 2400);
await scene('problem', async el => {
  await caption('Real Java, with completion and live errors from the language server');
  await moveTo(560, 460, 1800); await until(el, 3.4); await moveTo(700, 560, 1600);
});
await scene('review', async el => {
  const tab = p.getByRole('tab', { name: 'Staff review' });
  const bb = await tab.boundingBox().catch(() => null);
  if (bb) { await moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2, 1100); await ripple(); await tab.click(); }
  await caption('A staff-level review reads your code, not just your test results');
  await sleep(700); await scrollBy(700, 3200);
}, { tail: 0.6 });

await fadeOut(); await card('design', 'Lemma.', 'Local, private, and free.');
await scene('outro', async () => {}, { tail: 2.2 });
await fadeOut(); await sleep(600);

await cdp.send('Page.stopScreencast'); await sleep(300);
const t0 = frames[0][1];
const inCut = t => cuts.some(([a, b]) => t >= a && t < b);
const shift = t => t - cuts.reduce((m, [a, b]) => m + Math.max(0, Math.min(t, b) - a), 0);
const kept = frames.filter(f => !inCut(f[1])).map(f => [f[0], shift(f[1])]);
for (const m of marks) m.at = shift(m.at);
let list = '';
for (let i = 0; i < kept.length; i++) {
  const d = i + 1 < kept.length ? kept[i + 1][1] - kept[i][1] : 0.5;
  list += `file 'frames/${kept[i][0]}'\nduration ${Math.max(d, 0.001).toFixed(4)}\n`;
}
list += `file 'frames/${kept.at(-1)[0]}'\n`;
fs.writeFileSync(out + '/list.txt', list);
fs.writeFileSync(out + '/marks.json', JSON.stringify(marks.map(m => ({ ...m, at: +(m.at - shift(t0)).toFixed(3) })), null, 1));
console.log('frames', frames.length, 'span', (frames.at(-1)[1] - t0).toFixed(1));
await b.close();
