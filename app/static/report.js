// Report page: #/report/:id
'use strict';

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// Draws a vertical reference line at `value` on the x axis of a horizontal bar chart.
function refLinePlugin(value, label) {
  return {
    id: 'refline',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart; const x = scales.x.getPixelForValue(value);
      ctx.save(); ctx.strokeStyle = cssVar('--bad'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = cssVar('--bad'); ctx.font = '11px sans-serif'; ctx.fillText(label, x + 4, chartArea.top + 11); ctx.restore();
    },
  };
}

function jobStatus(job, what) {
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') return h('span', { class: 'muted' }, spinner(), ' ' + what + (job.status === 'queued' ? ' (queued)' : '…'));
  if (job.status === 'failed' || job.status === 'pending_retry') {
    const hint = job.status === 'pending_retry' ? ' Claude Pro usage limits reset after a few hours.' : '';
    return h('div', { class: 'callout' }, h('strong', {}, what + ' ' + (job.status === 'pending_retry' ? 'paused' : 'failed') + ': '), job.error || '', hint, ' ',
      h('button', { onclick: async () => { await api('/api/jobs/' + job.id + '/retry', { method: 'POST' }); render(); } }, 'Retry'));
  }
  return null;
}

// Open/closed state of section cards survives auto-refresh (kept for the lifetime of the page).
const openSections = new Set();

function sectionCard(sec) {
  const g = sec.grade;
  const key = sec.session_id + ':' + sec.key;
  const used = sec.duration_sec ? fmt(sec.duration_sec) : '—';
  const body = h('div', {});
  const caret = h('span', { class: 'caret' }, '▸');
  const header = h('div', { class: 'row sec-head', role: 'button', tabindex: '0', style: 'cursor:pointer' },
    caret, h('h3', { style: 'margin:0;flex:1' }, `${sec.ord}. ${sec.title}`),
    g ? chip(g.score + ' · ' + LEVELS[g.level_signal], g.score >= 3 ? 'ok' : g.score >= 2 ? 'warn' : 'bad') : null,
    h('span', { class: 'muted' }, used + ' / ' + fmt(sec.budget_sec)));
  const preview = g ? h('p', { class: 'muted sec-preview' }, g.summary) : null;
  const card = h('div', { class: 'card sec-card', 'data-key': key }, header, preview,
    jobStatus(sec.grade_job && sec.grade_job.status !== 'done' ? sec.grade_job : null, 'Grading'), body);
  const apply = () => {
    const open = openSections.has(key);
    body.hidden = !open; if (preview) preview.hidden = open; caret.textContent = open ? '▾' : '▸';
  };
  const toggle = () => { openSections.has(key) ? openSections.delete(key) : openSections.add(key); apply(); };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  card.__key = key; card.__apply = apply;

  if (!g) { if (!sec.grade_job) body.append(h('p', { class: 'muted' }, 'Not graded yet.')); apply(); return card; }
  if (g.ungrounded) body.append(h('div', { class: 'callout' }, 'Ungrounded: this grade used general knowledge (no reference brief).'));
  body.append(h('p', {}, g.summary));
  if (g.evidence.length) body.append(h('details', {}, h('summary', {}, `Evidence (${g.evidence.length})`),
    ...g.evidence.map((e) => h('div', {}, h('div', { class: 'quote' }, '“' + e.quote + '”'), h('p', {}, e.observation)))));
  if (g.strengths.length) body.append(h('h4', {}, 'Strengths'), h('ul', {}, ...g.strengths.map((x) => h('li', {}, x))));
  if (g.gaps.length) body.append(h('h4', {}, 'Gaps'), ...g.gaps.map((x) => h('div', { class: 'card' },
    h('div', { class: 'row' }, chip(x.tag, x.severity === 'high' ? 'bad' : x.severity === 'medium' ? 'warn' : ''), chip(x.severity)),
    h('p', {}, x.description), h('p', { class: 'muted' }, 'Why it matters at staff: ' + x.why_it_matters_at_staff),
    h('div', { class: 'callout' }, h('strong', {}, 'A staff answer sounds like: '), x.what_a_staff_answer_sounds_like))));
  if (g.interviewer_followups.length) body.append(h('h4', {}, 'Interviewer follow-ups'), h('ul', {}, ...g.interviewer_followups.map((x) => h('li', {}, x))));
  if (g.fact_checks.length) body.append(h('h4', {}, 'Fact checks'), h('ul', {}, ...g.fact_checks.map((f) => h('li', {},
    chip(f.verdict.replace('_', ' '), f.verdict === 'correct' ? 'ok' : f.verdict === 'incorrect' ? 'bad' : 'warn'), ' ', f.claim, ' — ', f.explanation, ' ',
    f.url ? h('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'source') : null))));
  if (g.concepts_to_study.length) body.append(h('h4', {}, 'Concepts to study'), h('ul', {}, ...g.concepts_to_study.map((c) => h('li', {},
    h('strong', {}, c.concept), ' — ', c.why, ' (', c.resource, ') ',
    h('button', { onclick: (e) => addStudy(c.concept, c.why, c.resource, e.target) }, 'Add to study queue')))));
  if (g.notes_for_candidate) body.append(h('div', { class: 'callout' }, g.notes_for_candidate));
  if (g.sources.length) body.append(h('details', {}, h('summary', {}, `Sources (${g.sources.length})`), h('ul', {}, ...g.sources.map(srcLi))));
  apply();
  return card;
}

const srcLi = (s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || s.url));

async function addStudy(concept, why, resource, btn, sid) {
  try { await api('/api/study_items', { method: 'POST', body: { concept, why, resource, source_session_id: sid || null } }); btn.textContent = 'Added ✓'; btn.disabled = true; }
  catch (e) { alert(e.message); }
}

function holisticView(p) {
  const g = p.grade; if (!g) return null;
  const box = h('div', {});
  box.append(h('div', { class: 'card' }, h('h3', {}, 'Top gaps'), ...g.top_gaps.map((x) => h('div', {}, chip(x.tag, 'bad'), h('p', {}, x.description), h('div', { class: 'callout' }, x.how_to_fix)))));
  if (g.strengths.length) box.append(h('div', { class: 'card' }, h('h3', {}, 'Strengths'), h('ul', {}, ...g.strengths.map((x) => h('li', {}, x)))));
  if (g.improvements_vs_previous.length || g.recurring_patterns_vs_previous.length) box.append(h('div', { class: 'card' },
    g.improvements_vs_previous.length ? h('div', {}, h('h3', {}, 'Improvements vs previous'), h('ul', {}, ...g.improvements_vs_previous.map((x) => h('li', {}, x)))) : null,
    g.recurring_patterns_vs_previous.length ? h('div', {}, h('h3', {}, 'Recurring patterns'), h('ul', {}, ...g.recurring_patterns_vs_previous.map((x) => h('li', {}, x)))) : null));
  box.append(h('div', { class: 'card' }, h('h3', {}, 'Study plan'), h('table', {}, h('tbody', {}, ...g.study_plan.slice().sort((a, b) => a.priority - b.priority).map((x) => h('tr', {},
    h('td', {}, x.priority), h('td', {}, h('strong', {}, x.concept), h('div', { class: 'muted' }, x.why), h('div', { class: 'muted' }, x.resource)),
    h('td', {}, h('button', { onclick: (e) => addStudy(x.concept, x.why, x.resource, e.target, p.session.id) }, 'Add to queue'))))))));
  box.append(h('div', { class: 'card' }, h('h3', {}, 'Drill for next session'), h('div', { class: 'callout' }, g.drill_for_next_session)));
  box.append(h('div', { class: 'card' }, h('h3', {}, 'Model answer outline'), mdToNode(g.model_answer_outline)));
  if (g.sources.length) box.append(h('details', { class: 'card' }, h('summary', {}, `Sources (${g.sources.length})`), h('ul', {}, ...g.sources.map(srcLi))));
  return box;
}

function drawCharts(p, dimCanvas, timeCanvas) {
  if (p._charts) { p._charts.forEach((c) => c.resize()); return; }
  p._charts = [];
  const fg = cssVar('--fg'), grid = cssVar('--border'), accent = cssVar('--accent'), warn = cssVar('--warn');
  const common = { color: fg };
  Chart.defaults.color = fg;
  if (p.grade) {
    const keys = Object.keys(p.grade.dimension_scores);
    const c = new Chart(dimCanvas, {
      type: 'bar',
      data: { labels: keys.map(DIM_LABEL), datasets: [{ data: keys.map((k) => p.grade.dimension_scores[k].score), backgroundColor: keys.map((k) => p.grade.dimension_scores[k].score >= 3 ? cssVar('--ok') : accent) }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Dimension scores (3 = staff)', ...common } }, scales: { x: { min: 1, max: 4, ticks: { stepSize: 0.5 }, grid: { color: grid } }, y: { grid: { display: false } } }, maintainAspectRatio: false },
      plugins: [refLinePlugin(3, 'staff')],
    });
    p._charts.push(c);
    onLeave(() => c.destroy());
  }
  const t = new Chart(timeCanvas, {
    type: 'bar',
    data: { labels: p.sections.map((s) => s.title), datasets: [
      { label: 'Used (s)', data: p.sections.map((s) => Math.round(s.duration_sec || 0)), backgroundColor: accent },
      { label: 'Budget (s)', data: p.sections.map((s) => s.budget_sec), backgroundColor: grid }] },
    options: { plugins: { title: { display: true, text: 'Time used vs budget (seconds)', ...common } }, scales: { x: { ticks: { maxRotation: 40, minRotation: 40 }, grid: { display: false } }, y: { grid: { color: grid } } }, maintainAspectRatio: false },
  });
  p._charts.push(t);
  onLeave(() => t.destroy());
}

route('/report/:id', async (root, id) => {
  const p = await api('/api/sessions/' + id);
  if (p.session.status === 'in_progress') { location.hash = '#/session/' + id; return; }
  const g = p.grade;
  const pending = (j) => j && (j.status === 'queued' || j.status === 'running');
  const anyPending = pending(p.grade_job) || p.sections.some((s) => pending(s.grade_job)) || pending(p.research.job);
  if (anyPending) { const iv = setTimeout(() => { if (location.hash === '#/report/' + id) { softRender = true; render(); } }, 5000); onLeave(() => clearTimeout(iv)); }

  const modelSel = h('select', { style: 'width:auto' }, ...['opus', 'sonnet'].map((m) => h('option', { value: m }, m)));
  const regrade = h('button', { onclick: async () => {
    try { await api(`/api/sessions/${id}/regrade`, { method: 'POST', body: { model: modelSel.value } }); render(); } catch (e) { alert(e.message); }
  } }, 'Re-grade');
  const head = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h2', { style: 'margin:0;flex:1' }, p.question.title),
      h('a', { class: 'btn', href: `/api/sessions/${id}/export.md`, target: '_blank' }, 'Export markdown'),
      h('span', { class: 'muted' }, 'Re-grade with'), modelSel, regrade));
  if (g) head.append(h('div', { class: 'row', style: 'margin-top:.6rem' },
    chip(LEVELS[g.overall_level] + ' · ' + g.overall_score + '/4', g.overall_score >= 3 ? 'ok' : g.overall_score >= 2 ? 'warn' : 'bad'),
    chip('Staff signal: ' + SIGNALS[g.hire_signal_at_staff]), chip('model: ' + (p.grade_meta?.model || p.session.model))), h('p', {}, g.verdict));
  else head.append(jobStatus(p.grade_job, 'Overall grade') || h('p', { class: 'muted' }, 'No overall grade yet.'));
  if (p.research.state === 'researching') head.append(h('p', { class: 'muted' }, spinner(), ' Reference research in progress; grading waits for it.'));
  if (p.research.state === 'failed') head.append(h('div', { class: 'callout' }, 'Research failed; sections were graded ungrounded.'));
  if (p.research.brief && p.research.brief.grounding_warning) head.append(h('div', { class: 'callout' }, 'Grounding warning: ' + p.research.brief.grounding_warning));

  const dimC = h('canvas'), timeC = h('canvas');
  const charts = h('div', { class: 'row', style: 'align-items:stretch' },
    g ? h('div', { class: 'card', style: 'flex:1;min-width:300px;height:340px' }, dimC) : null,
    h('div', { class: 'card', style: 'flex:1;min-width:300px;height:340px' }, timeC));
  const cards = p.sections.map(sectionCard);
  const setAll = (open) => cards.forEach((c) => { open ? openSections.add(c.__key) : openSections.delete(c.__key); c.__apply(); });
  const allBar = h('div', { class: 'row', style: 'margin-bottom:.6rem' }, h('h2', { style: 'margin:0;flex:1' }, 'Sections'),
    h('button', { onclick: () => setAll(true) }, 'Expand all'), h('button', { onclick: () => setAll(false) }, 'Collapse all'));
  const reportTab = h('div', {}, charts, allBar, ...cards, holisticView(p));
  const transcriptTab = h('div', {}, ...p.sections.map((s) => h('div', { class: 'card' }, h('h3', {}, `${s.ord}. ${s.title}`), h('p', { style: 'white-space:pre-wrap' }, s.transcript_edited || '(empty)'))));
  const briefTab = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const tabs = { Report: reportTab, Transcript: transcriptTab, 'Reference brief': briefTab };
  const body = h('div');
  const bar = h('div', { class: 'tabs' });
  let briefLoaded = false;
  const savedTab = window.__reportTab && window.__reportTab.id === id ? window.__reportTab.name : 'Report';
  const show = async (name) => {
    window.__reportTab = { id, name };
    [...bar.children].forEach((b) => b.classList.toggle('active', b.textContent === name));
    body.replaceChildren(tabs[name]);
    if (name === 'Report') drawCharts(p, dimC, timeC);
    if (name === 'Reference brief' && !briefLoaded) {
      briefLoaded = true;
      const r = await api(`/api/questions/${p.question.id}/research`);
      briefTab.replaceChildren(r.brief ? h('div', { class: 'card' }, mdToNode(r.brief_md)) : h('p', { class: 'muted' }, 'No reference brief (' + r.state + ').'));
    }
  };
  Object.keys(tabs).forEach((n) => bar.append(h('button', { onclick: () => show(n) }, n)));
  root.replaceChildren(head, bar, body);
  await show(savedTab);
});
