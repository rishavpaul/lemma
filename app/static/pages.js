// Progress, Questions and Settings pages.
'use strict';

// ---------- progress ----------
const PALETTE = ['#4c6ef5', '#12b886', '#f59f00', '#e64980', '#7950f2', '#15aabf', '#fd7e14', '#82c91e', '#868e96', '#d6336c'];

function dashedLinePlugin(value, label) {
  return {
    id: 'dashline',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart; const y = scales.y.getPixelForValue(value);
      ctx.save(); ctx.strokeStyle = cssVar('--bad'); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar('--bad'); ctx.font = '11px sans-serif'; ctx.fillText(label, chartArea.left + 6, y - 5); ctx.restore();
    },
  };
}

route('/progress', async (root) => {
  const [p, ] = await Promise.all([api('/api/progress')]);
  Chart.defaults.color = cssVar('--fg');
  const grid = cssVar('--border');
  const T = p.timeline;
  const labels = T.map((t, i) => `#${i + 1} ${new Date(t.started_at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}`);
  const yAxis = { min: 1, max: 4, ticks: { stepSize: 0.5 }, grid: { color: grid } };
  const mk = (canvas, cfg) => { const c = new Chart(canvas, cfg); onLeave(() => c.destroy()); return c; };

  const overallC = h('canvas'), dimC = h('canvas'), timeC = h('canvas');
  const box = (c, ht) => h('div', { class: 'card', style: `height:${ht}px` }, c);
  const fc = p.focus;
  const done = p.study_items.filter((x) => x.status === 'done').length;

  const studyList = h('div');
  const drawStudy = () => studyList.replaceChildren(p.study_items.length ? h('table', {}, h('tbody', {}, ...p.study_items.map((it) => {
    const sel = h('select', { style: 'width:auto' }, ...['todo', 'doing', 'done'].map((s) => h('option', { value: s, selected: it.status === s }, s)));
    sel.addEventListener('change', async () => { try { const r = await api('/api/study_items/' + it.id, { method: 'PATCH', body: { status: sel.value } }); it.status = r.status; drawStudy(); } catch (e) { alert(e.message); } });
    return h('tr', {}, h('td', {}, sel), h('td', {}, h('strong', {}, it.concept), h('div', { class: 'muted' }, it.why || ''), h('div', { class: 'muted' }, it.resource || '')));
  }))) : h('p', { class: 'muted' }, 'Nothing queued. Add items from a report’s study plan.'));
  drawStudy();

  root.replaceChildren(
    h('h1', {}, 'Progress'),
    h('div', { class: 'card' }, h('h3', {}, 'Next session focus'),
      fc.drill ? h('div', { class: 'callout' }, h('strong', {}, 'Drill: '), fc.drill) : h('p', { class: 'muted' }, 'Complete a graded session to get a drill.'),
      h('p', {}, 'Suggested question: ', h('strong', {}, fc.suggested.title), h('div', { class: 'muted' }, fc.suggested.reason)),
      h('button', { class: 'primary', onclick: async () => { const s = await api('/api/sessions', { method: 'POST', body: { question_id: fc.suggested.question_id } }); location.hash = '#/session/' + s.id; } }, 'Start it')),
    T.length ? h('div', {}, box(overallC, 300), box(dimC, 360)) : h('p', { class: 'muted' }, 'No graded sessions yet; charts appear after your first one.'),
    p.time_vs_budget.length ? box(timeC, 320) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Recurring gaps'), p.gaps.length ? h('table', {},
      h('thead', {}, h('tr', {}, ...['Tag', 'Sessions (all)', 'Sessions (last 5)', 'Last seen'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...p.gaps.map((g) => h('tr', {}, h('td', {}, chip(g.tag)), h('td', {}, g.count), h('td', {}, g.last5), h('td', {}, fmtDate(g.last_seen)))))) : h('p', { class: 'muted' }, 'No gaps recorded yet.')),
    h('div', { class: 'card' }, h('h3', {}, `Study queue (${done}/${p.study_items.length} done)`), studyList));

  if (T.length) {
    mk(overallC, { type: 'line', data: { labels, datasets: [{ label: 'Overall score', data: T.map((t) => t.overall_score), borderColor: PALETTE[0], backgroundColor: PALETTE[0], tension: 0.2, pointRadius: 4 }] },
      options: { plugins: { legend: { display: false }, title: { display: true, text: 'Overall score per session' } }, scales: { y: yAxis, x: { grid: { display: false } } }, maintainAspectRatio: false }, plugins: [dashedLinePlugin(3, 'staff bar')] });
    mk(dimC, { type: 'line', data: { labels, datasets: p.dimensions.map((d, i) => ({ label: DIM_LABEL(d), data: T.map((t) => t.dimensions[d] ?? null), borderColor: PALETTE[i % 10], backgroundColor: PALETTE[i % 10], tension: 0.2, pointRadius: 2, borderWidth: 1.8 })) },
      options: { plugins: { title: { display: true, text: 'Dimensions over time' }, legend: { position: 'bottom', labels: { boxWidth: 12 } } }, scales: { y: yAxis, x: { grid: { display: false } } }, maintainAspectRatio: false }, plugins: [dashedLinePlugin(3, 'staff bar')] });
  }
  if (p.time_vs_budget.length) {
    mk(timeC, { type: 'bar', data: { labels: p.time_vs_budget.map((r) => r.title), datasets: [
      { label: 'Avg used (s)', data: p.time_vs_budget.map((r) => Math.round(r.avg_used)), backgroundColor: PALETTE[0] },
      { label: 'Budget (s)', data: p.time_vs_budget.map((r) => Math.round(r.budget)), backgroundColor: grid }] },
      options: { plugins: { title: { display: true, text: 'Average time vs budget, last 5 sessions' } }, scales: { x: { ticks: { maxRotation: 40, minRotation: 40 }, grid: { display: false } }, y: { grid: { color: grid } } }, maintainAspectRatio: false } });
  }
});

// ---------- questions ----------
route('/questions', async (root) => {
  let showHints = false;
  const wrap = h('div');
  const load = async () => {
    const qs = await api('/api/questions?include_hints=' + showHints);
    const hintBox = h('label', { class: 'row' }, h('input', { type: 'checkbox', style: 'width:auto', checked: showHints }), 'Show grader hints (spoilers)');
    hintBox.querySelector('input').addEventListener('change', (e) => { showHints = e.target.checked; load(); });
    const title = h('input', { placeholder: 'Title' }), prompt = h('textarea', { placeholder: 'Question prompt, as an interviewer would say it', style: 'min-height:80px' });
    const add = h('button', { class: 'primary', onclick: async () => {
      if (!title.value.trim() || !prompt.value.trim()) return alert('Title and prompt are required');
      try { await api('/api/questions', { method: 'POST', body: { title: title.value, prompt: prompt.value } }); load(); } catch (e) { alert(e.message); }
    } }, 'Add custom question');
    wrap.replaceChildren(
      h('div', { class: 'card' }, h('h3', {}, 'Add a custom question'), title, h('div', { style: 'height:.5rem' }), prompt, h('div', { style: 'height:.5rem' }), add),
      hintBox,
      ...qs.map((q) => {
        const det = h('div', {});
        const status = h('span', { class: 'muted' });
        const view = h('button', { onclick: async () => {
          const r = await api(`/api/questions/${q.id}/research`);
          det.replaceChildren(h('div', { class: 'card' },
            r.brief ? h('div', {}, h('p', { class: 'muted' }, `Model ${r.model}, ${fmtDate(r.created_at)}`), r.grounding_warning ? h('div', { class: 'callout' }, r.grounding_warning) : null, mdToNode(r.brief_md))
              : h('p', { class: 'muted' }, 'No reference brief yet (' + r.state + ').')));
        } }, 'View research');
        const refresh = h('button', { onclick: async () => { await api(`/api/questions/${q.id}/research/refresh`, { method: 'POST' }); status.replaceChildren(spinner(), ' research queued'); } }, 'Refresh research');
        return h('div', { class: 'card' },
          h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, q.title), q.is_custom ? chip('custom') : null, q.has_research ? chip('research ready', 'ok') : chip('no research'), chip(q.attempts + ' attempts')),
          h('p', {}, q.prompt),
          h('div', { class: 'muted' }, 'Stresses: ' + q.stresses.map(DIM_LABEL).join(', ')),
          showHints && q.crux_hints ? h('div', { class: 'callout' }, h('strong', {}, 'Grader hints: '), q.crux_hints) : null,
          h('div', { class: 'row', style: 'margin-top:.5rem' }, view, refresh, status), det);
      }));
  };
  root.replaceChildren(h('h1', {}, 'Questions'), wrap);
  await load();
});

// ---------- settings ----------
route('/settings', async (root) => {
  const [s, hl] = await Promise.all([api('/api/settings'), api('/api/health')]);
  const f = {};
  const field = (key, label, el, hint) => { f[key] = el; return h('div', { class: 'card' }, h('label', {}, h('strong', {}, label), h('div', { style: 'height:.4rem' }), el), hint ? h('div', { class: 'muted' }, hint) : null); };
  const modelSel = (key) => h('select', {}, ...['opus', 'sonnet', 'fable', 'haiku'].map((m) => h('option', { value: m, selected: s[key] === m }, m)));
  const mResearch = modelSel('model_research'), mSection = modelSel('model_section'), mHolistic = modelSel('model_holistic');
  const conc = h('select', {}, ...['1', '2'].map((m) => h('option', { value: m, selected: s.claude_concurrency === m }, m)));
  const live = h('input', { type: 'checkbox', style: 'width:auto', checked: s.show_feedback_live === '1' });
  const cpath = h('input', { value: s.claude_path, placeholder: 'auto-detect' });
  const wmodel = h('input', { value: s.whisper_model });
  const vocab = h('textarea', { style: 'min-height:120px' }); vocab.value = s.vocabulary;
  const msg = h('span', { class: 'muted' });
  const save = h('button', { class: 'primary', onclick: async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: { model_research: mResearch.value, model_section: mSection.value, model_holistic: mHolistic.value, claude_concurrency: conc.value, show_feedback_live: live.checked ? '1' : '0', claude_path: cpath.value.trim(), whisper_model: wmodel.value.trim(), vocabulary: vocab.value } });
      msg.textContent = 'Saved. Whisper model/vocabulary changes apply to the next transcription.';
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  } }, 'Save settings');
  const recheck = h('button', { onclick: async () => { msg.textContent = 'Checking Claude…'; try { await api('/api/health/recheck', { method: 'POST' }); renderBanner(); render(); } catch (e) { msg.textContent = e.message; } } }, 'Re-check Claude');
  const yes = (v) => v ? chip('ok', 'ok') : chip('problem', 'bad');
  root.replaceChildren(h('h1', {}, 'Settings'),
    h('div', { class: 'card' }, h('h3', {}, 'Health'), h('table', {}, h('tbody', {},
      h('tr', {}, h('td', {}, 'Claude CLI'), h('td', {}, yes(hl.claude_ok), ' ', hl.claude_version || '', ' ', hl.claude_path || '', hl.claude_error ? h('div', { class: 'muted' }, hl.claude_error) : null)),
      h('tr', {}, h('td', {}, 'ffmpeg'), h('td', {}, yes(hl.ffmpeg_ok))),
      h('tr', {}, h('td', {}, 'Whisper model'), h('td', {}, hl.whisper_loaded ? chip('loaded', 'ok') : hl.whisper_loading ? chip('loading', 'warn') : chip('not loaded', 'bad'), hl.whisper_error ? ' ' + hl.whisper_error : '')),
      h('tr', {}, h('td', {}, 'Data directory'), h('td', {}, hl.data_dir)))), h('div', { style: 'height:.5rem' }), recheck),
    field('model_research', 'Model for research briefs', mResearch, 'Runs once per question and becomes the answer key for grading, so a stronger model pays off. Applies to the next research run.'),
    field('model_section', 'Model for section grades', mSection, '7 calls per session. Sonnet is about 2-3x faster and uses much less of your plan limit than Opus. Applies to new gradings.'),
    field('model_holistic', 'Model for the holistic grade', mHolistic, '1 call per session: your overall level, study plan and drill. Applies to new gradings.'),
    field('claude_path', 'Path to the claude CLI (optional)', cpath, 'Leave empty to auto-detect.'),
    field('claude_concurrency', 'Concurrent Claude calls', conc, '1 is safest for Pro usage limits.'),
    h('div', { class: 'card' }, h('label', { class: 'row' }, live, h('strong', {}, 'Show feedback after each section by default'))),
    field('whisper_model', 'Whisper model (Hugging Face repo)', wmodel),
    field('vocabulary', 'Vocabulary hint for speech-to-text', vocab, 'Comma-separated technical terms; only the first ~800 characters are used.'),
    h('div', { class: 'row' }, save, msg));
});

// ---------- usage ----------
route('/usage', async (root) => {
  const [u, plan] = await Promise.all([api('/api/usage'), api('/api/plan_usage')]);
  const t = u.total;
  const stat = (label, value, sub) => h('div', { class: 'card', style: 'flex:1;min-width:150px;margin:0' }, h('div', { class: 'muted' }, label), h('div', { style: 'font-size:1.6rem;font-weight:600' }, value), sub ? h('div', { class: 'muted' }, sub) : null);
  const rowCells = (r) => [h('td', {}, fmtNum(r.calls)), h('td', {}, fmtTok(r.input_tokens + r.cache_creation_tokens)), h('td', {}, fmtTok(r.cache_read_tokens)),
    h('td', {}, fmtTok(r.output_tokens)), h('td', {}, fmtTok(r.total_tokens)), h('td', {}, fmtUsd(r.cost_usd)), h('td', {}, Math.round(r.duration_s) + 's')];
  const head = (first) => h('thead', {}, h('tr', {}, ...[first, 'Calls', 'Input (new)', 'Cache read', 'Output', 'Total', '≈ Cost', 'Time'].map((x) => h('th', {}, x))));
  const table = (first, rows, label) => h('table', {}, head(first), h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, label(r)), ...rowCells(r)))));
  const dayC = h('canvas'), planC = h('canvas');
  const L = plan.latest;
  const bar = (label, u, resets) => { const pct = Math.round((u || 0) * 100); return h('div', { style: 'flex:1;min-width:240px' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, label), h('span', { class: 'timer', style: 'font-size:1.4rem' }, pct + '%')),
    h('div', { style: 'height:10px;border-radius:6px;background:var(--border);overflow:hidden' }, h('div', { style: `height:100%;width:${Math.min(pct, 100)}%;background:${pct >= 90 ? 'var(--bad)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)'}` })),
    h('div', { class: 'muted' }, 'Resets ' + fmtDate(resets))); };
  const refreshBtn = h('button', { onclick: async () => { refreshBtn.disabled = true; refreshBtn.textContent = 'Checking…'; try { await api('/api/plan_usage/refresh', { method: 'POST' }); } catch (e) { alert(e.message); } render(); } }, 'Refresh now');
  const planCard = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: 'margin:0;flex:1' }, 'Claude Pro plan limits'), refreshBtn),
    L ? h('div', {}, h('div', { class: 'row', style: 'margin:.8rem 0;gap:1.5rem' }, bar('5-hour window', L.five_hour_util, L.five_hour_resets), bar('7-day window', L.seven_day_util, L.seven_day_resets)),
      h('div', { class: 'muted' }, 'Reported by the Claude CLI as of ' + fmtDate(L.created_at) + ' (updates after every call; "Refresh now" costs a few tokens). These cover all your Claude usage, not just this app.'),
      plan.history.length > 2 ? h('div', { style: 'height:180px;margin-top:.6rem' }, planC) : null)
      : h('p', { class: 'muted' }, 'No plan data yet. It appears after the next Claude call, or press "Refresh now".'));
  const KIND = { research: 'Research (per question, first use)', grade_section: 'Section grades', grade_session: 'Holistic grades', health: 'Health checks' };
  root.replaceChildren(h('h1', {}, 'Claude usage'),
    h('p', { class: 'muted' }, 'Every `claude -p` call made through your Pro subscription' + (u.tracking_since ? ', tracked since ' + fmtDate(u.tracking_since) : '') +
      '. Cost is the API-equivalent value of the tokens, shown as a relative measure of how much of your plan limit is used; you are not billed per token.'),
    planCard,
    h('div', { class: 'row', style: 'align-items:stretch;margin-bottom:1rem' },
      stat('Calls', fmtNum(t.calls), t.calls - t.ok_calls ? `${t.calls - t.ok_calls} failed` : 'all succeeded'),
      stat('Total tokens', fmtTok(t.total_tokens), `${fmtTok(t.output_tokens)} output`),
      stat('≈ API-equivalent cost', fmtUsd(t.cost_usd)),
      stat('Time in Claude', Math.round(t.duration_s / 60) + ' min', `${t.web_searches} searches, ${t.web_fetches} fetches`)),
    u.by_day.length ? h('div', { class: 'card', style: 'height:300px' }, dayC) : null,
    h('div', { class: 'card' }, h('h3', {}, 'By call type'), table('Type', u.by_kind, (r) => KIND[r.kind] || r.kind)),
    h('div', { class: 'card' }, h('h3', {}, 'By model'), table('Model', u.by_model, (r) => r.model)),
    h('div', { class: 'card' }, h('h3', {}, 'By session'), u.by_session.length ? table('Session', u.by_session, (r) => h('a', { href: '#/report/' + r.session_id }, `#${r.session_id} ${r.title}`)) : h('p', { class: 'muted' }, 'No sessions yet.')),
    h('div', { class: 'card' }, h('h3', {}, 'Recent calls'), h('div', { style: 'overflow-x:auto' }, h('table', {}, h('thead', {}, h('tr', {}, ...['When', 'Type', 'Model', 'Session', 'Result', 'Tokens in / out', 'Cache read', '≈ Cost', 'Time'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...u.recent.map((c) => h('tr', {}, h('td', {}, fmtDate(c.created_at)), h('td', {}, c.kind), h('td', {}, c.model || ''),
        h('td', {}, c.session_id ? h('a', { href: '#/report/' + c.session_id }, '#' + c.session_id) : (c.title || '—')),
        h('td', {}, c.ok ? chip('ok', 'ok') : chip(c.error_kind || 'failed', 'bad')),
        h('td', {}, fmtTok(c.input_tokens + c.cache_creation_tokens) + ' / ' + fmtTok(c.output_tokens)), h('td', {}, fmtTok(c.cache_read_tokens)),
        h('td', {}, fmtUsd(c.cost_usd)), h('td', {}, Math.round(c.duration_s || 0) + 's'))))))),
    h('p', { class: 'muted' }, '“Input (new)” = uncached input plus tokens written to the prompt cache; “Cache read” = input served from the cache (cheap). Research calls made before tracking was added have no recorded tokens.'));
  if (plan.history.length > 2) {
    Chart.defaults.color = cssVar('--fg');
    const c = new Chart(planC, { type: 'line', data: { labels: plan.history.map((x) => new Date(x.created_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      datasets: [{ label: '5-hour %', data: plan.history.map((x) => Math.round((x.five_hour_util || 0) * 100)), borderColor: PALETTE[0], pointRadius: 1, tension: 0.2 },
                 { label: '7-day %', data: plan.history.map((x) => Math.round((x.seven_day_util || 0) * 100)), borderColor: PALETTE[2], pointRadius: 1, tension: 0.2 }] },
      options: { plugins: { title: { display: true, text: 'Plan utilization over time (%)' } }, scales: { y: { min: 0, max: 100, grid: { color: cssVar('--border') } }, x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } } }, maintainAspectRatio: false } });
    onLeave(() => c.destroy());
  }
  if (u.by_day.length) {
    Chart.defaults.color = cssVar('--fg');
    const c = new Chart(dayC, { type: 'bar', data: { labels: u.by_day.map((d) => d.day), datasets: [
      { label: 'Input (new)', data: u.by_day.map((d) => d.input_tokens + d.cache_creation_tokens), backgroundColor: PALETTE[0] },
      { label: 'Cache read', data: u.by_day.map((d) => d.cache_read_tokens), backgroundColor: PALETTE[5] },
      { label: 'Output', data: u.by_day.map((d) => d.output_tokens), backgroundColor: PALETTE[2] }] },
      options: { plugins: { title: { display: true, text: 'Tokens per day' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: cssVar('--border') } } }, maintainAspectRatio: false } });
    onLeave(() => c.destroy());
  }
});
