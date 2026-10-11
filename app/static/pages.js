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
  const model = h('select', {}, ...['opus', 'sonnet', 'fable', 'haiku'].map((m) => h('option', { value: m, selected: s.model === m }, m)));
  const conc = h('select', {}, ...['1', '2'].map((m) => h('option', { value: m, selected: s.claude_concurrency === m }, m)));
  const live = h('input', { type: 'checkbox', style: 'width:auto', checked: s.show_feedback_live === '1' });
  const cpath = h('input', { value: s.claude_path, placeholder: 'auto-detect' });
  const wmodel = h('input', { value: s.whisper_model });
  const vocab = h('textarea', { style: 'min-height:120px' }); vocab.value = s.vocabulary;
  const msg = h('span', { class: 'muted' });
  const save = h('button', { class: 'primary', onclick: async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: { model: model.value, claude_concurrency: conc.value, show_feedback_live: live.checked ? '1' : '0', claude_path: cpath.value.trim(), whisper_model: wmodel.value.trim(), vocabulary: vocab.value } });
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
    field('model', 'Claude model for grading and research', model, 'Pro plan: opus is the most thorough, sonnet is faster and uses less of your usage limit.'),
    field('claude_path', 'Path to the claude CLI (optional)', cpath, 'Leave empty to auto-detect.'),
    field('claude_concurrency', 'Concurrent Claude calls', conc, '1 is safest for Pro usage limits.'),
    h('div', { class: 'card' }, h('label', { class: 'row' }, live, h('strong', {}, 'Show feedback after each section by default'))),
    field('whisper_model', 'Whisper model (Hugging Face repo)', wmodel),
    field('vocabulary', 'Vocabulary hint for speech-to-text', vocab, 'Comma-separated technical terms; only the first ~800 characters are used.'),
    h('div', { class: 'row' }, save, msg));
});
