// System Design Coach SPA: hash routing, no framework. All dynamic text goes through textContent.
'use strict';

// ---------- helpers ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
const $app = () => document.getElementById('app');
const fmt = (s) => { const neg = s < 0; s = Math.abs(Math.round(s)); return (neg ? '-' : '') + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtDate = (t) => t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const chip = (text, cls) => h('span', { class: 'chip ' + (cls || '') }, text);
const spinner = () => h('span', { class: 'spinner' });
const LEVELS = { below_senior: 'Below senior', senior: 'Senior', staff: 'Staff', senior_staff_plus: 'Senior staff+' };
const SIGNALS = { strong_no: 'Strong no', lean_no: 'Lean no', lean_hire: 'Lean hire', strong_hire: 'Strong hire' };
const fmtNum = (n) => Math.round(n || 0).toLocaleString();
const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0));
const fmtUsd = (n) => '$' + (n || 0).toFixed(2);
const DIM_LABEL = (k) => k.replace(/_/g, ' ');

async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.detail || JSON.stringify(j); } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

// Tiny escape-first markdown: headings, bold, lists, links (http/https only), inline + fenced code.
function mdToNode(src) {
  const root = h('div', { class: 'md' });
  const inline = (text, parent) => {
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[1]) parent.append(h('code', {}, m[1].slice(1, -1)));
      else if (m[2]) parent.append(h('strong', {}, m[2].slice(2, -2)));
      else { const mm = /\[([^\]]+)\]\((.+)\)/.exec(m[3]); parent.append(h('a', { href: mm[2], target: '_blank', rel: 'noopener noreferrer' }, mm[1])); }
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  };
  let list = null, code = null;
  for (const line of String(src || '').split('\n')) {
    if (line.startsWith('```')) {
      if (code) { root.append(h('pre', {}, h('code', {}, code.join('\n')))); code = null; } else { code = []; list = null; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    const lm = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (hm) { list = null; const n = h('h' + Math.min(hm[1].length + 1, 5)); inline(hm[2], n); root.append(n); }
    else if (lm) {
      if (!list) { list = h('ul'); root.append(list); }
      const li = h('li'); inline(lm[1], li); list.append(li);
    } else if (line.trim() === '') { list = null; }
    else { list = null; const p = h('p'); inline(line, p); root.append(p); }
  }
  if (code) root.append(h('pre', {}, h('code', {}, code.join('\n'))));
  return root;
}

// ---------- router ----------
const routes = [];
function route(pattern, fn) { routes.push([new RegExp('^' + pattern.replace(/:[a-z]+/g, '([^/]+)') + '$'), fn]); }
let cleanup = [];
function onLeave(fn) { cleanup.push(fn); }

let softRender = false;
async function render() {
  const soft = softRender; softRender = false;
  const y = window.scrollY;
  cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  cleanup = [];
  const path = (location.hash || '#/').slice(1) || '/';
  renderNav(path);
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (m) {
      const root = $app();
      if (!soft) root.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
      try { await fn(root, ...m.slice(1)); } catch (e) { root.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Something went wrong'), h('p', {}, String(e.message || e)))); console.error(e); }
      if (soft) window.scrollTo(0, y);
      return;
    }
  }
  $app().replaceChildren(h('p', {}, 'Not found'));
}

function renderNav(path) {
  const items = [['#/', 'Home'], ['#/progress', 'Progress'], ['#/questions', 'Questions'], ['#/usage', 'Usage'], ['#/settings', 'Settings']];
  document.getElementById('nav').replaceChildren(h('strong', {}, 'Design Coach'),
    ...items.map(([href, label]) => h('a', { href, class: (href.slice(1) === path || (href === '#/' && path.startsWith('/session'))) ? 'active' : '' }, label)));
}

async function renderBanner() {
  const b = document.getElementById('banner');
  try {
    const hl = await api('/api/health');
    const msgs = [];
    if (hl.claude_ok === false) msgs.push('Claude CLI problem: ' + (hl.claude_error || 'not available') + ' Grading will not work until this is fixed.');
    if (!hl.ffmpeg_ok) msgs.push('ffmpeg not found (brew install ffmpeg).');
    if (hl.whisper_error) msgs.push('Whisper error: ' + hl.whisper_error);
    b.replaceChildren(...msgs.map((m) => h('div', { class: 'banner' }, m)));
    if (!msgs.length && hl.whisper_loading) b.replaceChildren(h('div', { class: 'banner info' }, 'Loading the speech model (first run downloads it)…'));
    if (hl.claude_ok === null) setTimeout(renderBanner, 3000);
  } catch (e) { b.replaceChildren(h('div', { class: 'banner' }, 'Cannot reach the server.')); }
}

// ---------- home ----------
route('/', async (root) => {
  const [qs, sessions] = await Promise.all([api('/api/questions'), api('/api/sessions')]);
  let suggestion = null;
  try { suggestion = await api('/api/questions/suggest'); } catch (e) { /* not available */ }
  const start = async (body) => {
    try { const s = await api('/api/sessions', { method: 'POST', body }); location.hash = '#/session/' + s.id; }
    catch (e) { alert(e.message); }
  };
  const sel = h('select', {}, h('option', { value: '' }, 'Pick a question…'), ...qs.map((q) => h('option', { value: q.id }, q.title)));
  sel.addEventListener('change', () => { if (sel.value) start({ question_id: +sel.value }); });
  root.replaceChildren(
    h('h1', {}, 'Practice'),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => start({ mode: 'suggested' }) }, 'Start suggested question'),
        h('button', { onclick: () => start({ mode: 'random' }) }, 'Random'),
        h('div', { style: 'min-width:220px;flex:1' }, sel)),
      suggestion ? h('p', { class: 'muted' }, 'Suggested: ', h('strong', {}, suggestion.title), ' — ', suggestion.reason) : null),
    h('h2', {}, 'Questions'),
    h('div', { class: 'card' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['Question', 'Attempts', 'Last score', 'Research'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...qs.map((q) => h('tr', {},
        h('td', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); start({ question_id: q.id }); } }, q.title), q.is_custom ? ' ' : '', q.is_custom ? chip('custom') : null),
        h('td', {}, q.attempts), h('td', {}, q.last_score != null ? q.last_score.toFixed(1) : '—'),
        h('td', {}, q.has_research ? chip('ready', 'ok') : chip('none'))))))),
    h('h2', {}, 'Recent sessions'),
    h('div', { class: 'card' }, sessions.length ? h('table', {},
      h('thead', {}, h('tr', {}, ...['When', 'Question', 'Status', 'Level', 'Score'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...sessions.slice(0, 15).map((s) => h('tr', {},
        h('td', {}, fmtDate(s.started_at)),
        h('td', {}, h('a', { href: s.status === 'in_progress' ? '#/session/' + s.id : '#/report/' + s.id }, s.title)),
        h('td', {}, s.status === 'in_progress' ? s.sections_saved + '/7 saved' : s.status),
        h('td', {}, s.overall_level ? LEVELS[s.overall_level] : '—'),
        h('td', {}, s.overall_score != null ? s.overall_score.toFixed(1) : '—'))))) : h('p', { class: 'muted' }, 'No sessions yet.')));
});

// ---------- session runner ----------
route('/session/:id', async (root, id) => {
  let data = await api('/api/sessions/' + id);
  if (data.session.status !== 'in_progress') { location.hash = '#/report/' + id; return; }
  const st = { recording: false, recorder: null, stream: null, chunks: [], recStart: 0, accMs: {}, phase: 'idle', timer: null, poll: null, started: {}, sessionStart: null, busy: false };
  let current = () => data.sections.findIndex((s) => s.status !== 'saved');
  const refresh = async () => { data = await api('/api/sessions/' + id); };

  const tick = () => {
    const i = current(); if (i < 0) return;
    const sec = data.sections[i];
    const used = (st.accMs[sec.key] || 0) / 1000 + (st.recording ? (Date.now() - st.recStart) / 1000 : 0);
    const left = sec.budget_sec - used;
    const t = document.getElementById('sec-timer');
    if (t) { t.textContent = fmt(left); t.className = 'timer' + (used > sec.budget_sec ? ' red' : used > sec.budget_sec * 0.8 ? ' amber' : ''); }
    const total = document.getElementById('total-timer');
    if (total) total.textContent = st.sessionStart ? fmt((Date.now() - st.sessionStart) / 1000) : '00:00';
  };
  st.timer = setInterval(tick, 250);

  const stopStream = () => { if (st.stream) st.stream.getTracks().forEach((t) => t.stop()); st.stream = null; };
  onLeave(() => { clearInterval(st.timer); clearInterval(st.poll); if (st.recorder && st.recording) { try { st.recorder.stop(); } catch (e) { /* ignore */ } } stopStream(); document.removeEventListener('keydown', onKey); });

  async function startRec() {
    const sec = data.sections[current()];
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { alert('Microphone unavailable: ' + e.message + '\nGrant microphone permission for this site and retry.'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    st.chunks = [];
    st.recorder = new MediaRecorder(st.stream, mime ? { mimeType: mime } : undefined);
    st.recorder.ondataavailable = (e) => { if (e.data && e.data.size) st.chunks.push(e.data); };
    st.recorder.onstop = () => onRecorded(sec, st.recorder.mimeType || mime || 'audio/webm');
    st.recorder.start(1000);
    st.recording = true; st.recStart = Date.now();
    if (!st.sessionStart) st.sessionStart = Date.now();
    draw();
  }
  function stopRec() {
    if (!st.recording) return;
    st.accMs[data.sections[current()].key] = (st.accMs[data.sections[current()].key] || 0) + (Date.now() - st.recStart);
    st.recording = false;
    st.recorder.stop(); stopStream();
    st.phase = 'uploading'; draw();
  }
  async function onRecorded(sec, mime) {
    const blob = new Blob(st.chunks, { type: mime });
    const fd = new FormData();
    fd.append('file', blob, 'clip.' + (mime.includes('mp4') ? 'mp4' : 'webm'));
    try {
      const r = await api(`/api/sessions/${id}/sections/${sec.key}/audio`, { method: 'POST', body: fd });
      st.phase = 'transcribing'; draw();
      await waitJob(r.job_id);
      await refresh(); st.phase = 'idle'; draw();
    } catch (e) { alert('Upload/transcription failed: ' + e.message); await refresh(); st.phase = 'idle'; draw(); }
  }
  function waitJob(jobId) {
    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const j = await api('/api/jobs/' + jobId);
          if (j.status === 'done') { clearInterval(iv); resolve(); }
          else if (j.status === 'failed' || j.status === 'pending_retry') { clearInterval(iv); reject(new Error(j.error || j.status)); }
        } catch (e) { clearInterval(iv); reject(e); }
      }, 1000);
    });
  }
  async function save(finish) {
    if (st.busy) return; st.busy = true;
    const i = current(), sec = data.sections[i];
    const text = document.getElementById('transcript').value;
    const used = (st.accMs[sec.key] || 0) / 1000;
    try {
      await api(`/api/sessions/${id}/sections/${sec.key}/transcript`, { method: 'PUT', body: { text, duration_sec: used > 0 ? used : null } });
      await refresh();
      if (finish) { await api(`/api/sessions/${id}/finish`, { method: 'POST' }); location.hash = '#/report/' + id; return; }
      st.phase = 'idle';
    } catch (e) { alert(e.message); }
    st.busy = false; draw();
  }
  function rerecord() { st.accMs[data.sections[current()].key] = 0; const s = data.sections[current()]; s.status = 'pending'; s.transcript_edited = null; st.phase = 'idle'; draw(); }

  function onKey(e) {
    const typing = ['TEXTAREA', 'INPUT', 'SELECT'].includes((e.target.tagName || ''));
    if (e.code === 'Space' && !typing) {
      const i = current(); if (i < 0) return;
      const s = data.sections[i];
      if (st.phase === 'idle' && ['pending', 'recorded'].includes(s.status)) { e.preventDefault(); st.recording ? stopRec() : startRec(); }
      else if (st.recording) { e.preventDefault(); stopRec(); }
    }
    if (e.code === 'Enter' && (e.metaKey || e.ctrlKey) && document.getElementById('transcript')) { e.preventDefault(); save(current() === data.sections.length - 1); }
  }
  document.addEventListener('keydown', onKey);

  function gradeCard(sec) {
    if (!sec.grade) return h('p', { class: 'muted' }, spinner(), ' grading ', sec.title, '…');
    const g = sec.grade;
    return h('div', { class: 'card' }, h('strong', {}, sec.title), ' ', chip(g.score + ' · ' + LEVELS[g.level_signal]), h('p', {}, g.summary),
      h('div', { class: 'row' }, ...g.gaps.map((x) => chip(x.tag, x.severity === 'high' ? 'bad' : x.severity === 'medium' ? 'warn' : ''))));
  }

  function draw() {
    const keepY = window.scrollY;
    const i = current();
    const strip = h('div', { class: 'strip' }, ...data.sections.map((s, k) => h('div', { class: s.status === 'saved' ? 'done' : k === i ? 'cur' : '' }, (k + 1) + '. ' + s.title)));
    const rs = data.research.state;
    const rchip = rs === 'ready' ? chip('research ready', 'ok') : rs === 'researching' ? h('span', { class: 'chip warn' }, spinner(), ' researching') : rs === 'failed' ? chip('research failed', 'bad') : chip('no research');
    const liveBox = h('input', { type: 'checkbox', style: 'width:auto', checked: !!data.session.show_feedback_live });
    const live = h('label', { class: 'row' }, liveBox, 'Show feedback after each section');
    liveBox.addEventListener('change', () => { data.session.show_feedback_live = liveBox.checked ? 1 : 0; draw(); });
    const kids = [
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { style: 'margin:0;flex:1' }, data.question.title), rchip), h('p', {}, data.question.prompt)),
      strip];
    if (i >= 0) {
      const sec = data.sections[i];
      const isLast = i === data.sections.length - 1;
      const reviewing = ['transcribed', 'saved'].includes(sec.status) && st.phase === 'idle';
      const body = [];
      body.push(h('div', { class: 'row' },
        h('div', { style: 'flex:1' }, h('h3', { style: 'margin:0' }, `${i + 1}. ${sec.title}`), h('div', { class: 'muted' }, 'Budget ' + fmt(sec.budget_sec))),
        h('div', {}, h('div', { class: 'muted' }, 'Section'), h('div', { id: 'sec-timer', class: 'timer' }, fmt(sec.budget_sec))),
        h('div', {}, h('div', { class: 'muted' }, 'Total'), h('div', { id: 'total-timer', class: 'timer' }, '00:00'))));
      body.push(h('ul', {}, ...sec.cover.map((c) => h('li', {}, c))));
      if (st.recording) body.push(h('button', { id: 'rec-btn', class: 'big rec', onclick: stopRec }, '■ Stop'));
      else if (st.phase === 'uploading') body.push(h('p', {}, spinner(), ' Uploading…'));
      else if (st.phase === 'transcribing' || ['recorded', 'transcribing'].includes(sec.status) && st.phase !== 'idle') body.push(h('p', { id: 'transcribing' }, spinner(), ' Transcribing…'));
      else if (reviewing) {
        const ta = h('textarea', { id: 'transcript' }); ta.value = sec.transcript_edited || '';
        body.push(h('p', { class: 'muted' }, 'Fix any transcription errors before saving.'), ta,
          h('div', { class: 'row', style: 'margin-top:.6rem' },
            h('button', { onclick: rerecord }, 'Re-record'),
            h('button', { id: 'save-btn', class: 'primary', onclick: () => save(isLast) }, isLast ? 'Save & Finish (⌘↵)' : 'Save & Next (⌘↵)')));
      } else if (['recorded', 'transcribing'].includes(sec.status)) {
        body.push(h('p', { id: 'transcribing' }, spinner(), ' Transcribing…'));
        resumePoll(sec);
      } else body.push(h('button', { id: 'rec-btn', class: 'big primary', onclick: startRec }, '● Record (Space)'));
      kids.push(h('div', { class: 'card' }, ...body));
    }
    kids.push(live);
    if (data.session.show_feedback_live) kids.push(...data.sections.filter((s) => s.status === 'saved').map(gradeCard));
    $app().replaceChildren(...kids);
    window.scrollTo(0, keepY);
    tick();
  }
  function resumePoll(sec) {
    if (st.polling || !sec.transcribe_job) return; st.polling = true;
    waitJob(sec.transcribe_job.id).catch(() => {}).then(async () => { st.polling = false; await refresh(); draw(); });
  }
  // keep research chip and live feedback fresh
  st.poll = setInterval(async () => {
    if (st.recording || st.phase !== 'idle' || document.activeElement?.id === 'transcript') return;
    const needs = data.research.state === 'researching' || (data.session.show_feedback_live && data.sections.some((s) => s.status === 'saved' && !s.grade));
    if (needs) { await refresh(); if (!st.recording && document.activeElement?.id !== 'transcript') draw(); }
  }, 4000);
  draw();
});
