const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[char]));

let lastData = null;

function fmtValue(value) {
  if (value === null || value === undefined || value === '') return '(no answer)';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function elapsedLabel(startedAtMs, atIso) {
  if (!startedAtMs) return '';
  const deltaSeconds = Math.max(0, Math.round((new Date(atIso).getTime() - startedAtMs) / 1000));
  const m = Math.floor(deltaSeconds / 60);
  const s = deltaSeconds % 60;
  return `+${m}:${String(s).padStart(2, '0')}`;
}

function secondsLabel(seconds) {
  if (seconds === null || seconds === undefined) return '&mdash;';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function severityRank(sev) { return sev === 'high' ? 0 : sev === 'medium' ? 1 : 2; }

// ---------------------------------------------------------------------------
// Flag glossary: plain-English meaning + reliability note for every
// integrity event type the client can emit. Rendered as a reference panel
// and also used to annotate individual events in each session's timeline, so
// a reviewer never has to guess what a flag means or how much to trust it.
// ---------------------------------------------------------------------------
const FLAG_INFO = {
  'session-start': { label: 'Session started', explain: 'Candidate began the interview.', confidence: 'info' },
  'visibility-hidden': { label: 'Left the tab', explain: 'Candidate switched away from the interview tab or minimized the window.', confidence: 'certain' },
  'visibility-restored': { label: 'Returned to tab', explain: 'Candidate came back to the interview tab after being away. Longer absences are treated as higher severity.', confidence: 'certain' },
  'window-blur': { label: 'Window lost focus', explain: 'The browser window lost OS-level focus (e.g. candidate clicked another app or a second monitor). Common and can be a false positive on multi-monitor setups.', confidence: 'heuristic' },
  'focus-restored': { label: 'Window regained focus', explain: 'The window came back into focus without a full tab-switch being detected. Logged for completeness alongside visibility-restored.', confidence: 'info' },
  'major-resize': { label: 'Large window resize', explain: 'Window dimensions changed by more than 180px. Can happen from normal window snapping, not only suspicious activity.', confidence: 'heuristic' },
  'devtools-suspected': { label: 'DevTools suspected', explain: 'Heuristic based on the gap between outer and inner window size, which often appears when a docked DevTools panel opens. Can false-positive on some browser toolbars/extensions.', confidence: 'heuristic' },
  'devtools-shortcut-blocked': { label: 'DevTools shortcut blocked', explain: 'Candidate pressed F12 or a DevTools-opening shortcut (Ctrl/Cmd+Shift+I/J/C). The keypress itself is unambiguous, though intent may vary.', confidence: 'certain' },
  'paste-blocked': { label: 'Paste blocked', explain: 'Candidate attempted to paste content into the page; the paste was blocked. A strong signal of copied external content.', confidence: 'certain' },
  'copy-blocked': { label: 'Copy blocked', explain: 'Candidate attempted to copy content from the page.', confidence: 'certain' },
  'cut-blocked': { label: 'Cut blocked', explain: 'Candidate attempted to cut content from the page.', confidence: 'certain' },
  'context-menu-blocked': { label: 'Right-click blocked', explain: 'Candidate right-clicked; the context menu was blocked. Often incidental.', confidence: 'heuristic' },
  'shortcut-blocked': { label: 'Clipboard/view-source shortcut blocked', explain: 'Candidate pressed a keyboard shortcut for copy/paste/cut/view-source/save/print.', confidence: 'certain' },
  'fullscreen-exit': { label: 'Exited fullscreen lockdown', explain: 'Candidate left the enforced fullscreen mode, which can be used to reveal other windows or a second screen.', confidence: 'certain' },
  'fullscreen-restored': { label: 'Fullscreen resumed', explain: 'Candidate re-entered fullscreen lockdown mode after exiting it.', confidence: 'info' },
  'print-attempt': { label: 'Print triggered', explain: 'Candidate triggered the browser print dialog.', confidence: 'certain' },
  'honeypot-triggered': { label: 'Honeypot triggered', explain: 'A hidden form field only a script or someone inspecting the page would fill was populated. Very rarely a false positive.', confidence: 'certain' },
  'user-agent-mismatch': { label: 'User-agent changed mid-session', explain: 'Requests arrived from a different browser/device signature than the one the session started with -- may indicate the session link was shared or replayed.', confidence: 'certain' },
  'suspiciously-fast-completion': { label: 'Unusually fast completion', explain: 'Average time per question was below the expected minimum, consistent with pre-written or copy-pasted answers.', confidence: 'heuristic' },
  'excessive-duration': { label: 'Session open unusually long', explain: 'The session stayed open far longer than a timed test should, which may indicate the candidate stepped away repeatedly or got outside help.', confidence: 'heuristic' },
  'heartbeat': { label: 'Heartbeat', explain: 'Routine liveness ping sent every ~20s while the exam is open. Not a concern by itself -- gaps between heartbeats can indicate the tab was suspended.', confidence: 'info' }
};
function flagInfo(type) {
  return FLAG_INFO[type] || { label: type, explain: 'No description available for this event type.', confidence: 'heuristic' };
}
function confidenceBadge(confidence) {
  if (confidence === 'certain') return '<span class="conf-badge conf-certain" title="Unambiguous: this event type has no realistic innocent explanation">Certain</span>';
  if (confidence === 'heuristic') return '<span class="conf-badge conf-heuristic" title="Heuristic: this event type can occasionally be triggered by innocent behavior">Heuristic</span>';
  return '<span class="conf-badge conf-info" title="Informational only, not an integrity concern">Info</span>';
}

function renderLegend() {
  const rows = Object.entries(FLAG_INFO).map(([type, info]) => `
    <tr>
      <td><code>${escapeHtml(type)}</code></td>
      <td>${escapeHtml(info.label)}</td>
      <td>${confidenceBadge(info.confidence)}</td>
      <td>${escapeHtml(info.explain)}</td>
    </tr>`).join('');
  $('legend-body').innerHTML = `
    <table class="legend-table">
      <thead><tr><th>Flag</th><th>Meaning</th><th>Reliability</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// Risk scoring & reviewer suggestions: turns the raw event/timing data into
// one computed recommendation per session, so a reviewer gets a starting
// point instead of having to mentally tally counts themselves.
// ---------------------------------------------------------------------------
function computeRisk(session) {
  const integrity = session.integrity;
  let score = integrity.high * 3 + integrity.medium * 1;
  const reasons = [];

  if (integrity.autoFlagged) reasons.push('Auto-flagged: hit the high-severity event threshold.');

  const counts = integrity.eventTypeCounts || {};
  if (counts['visibility-hidden'] >= 3) reasons.push(`Left the tab ${counts['visibility-hidden']} times.`);
  if (counts['paste-blocked'] >= 1) reasons.push(`${counts['paste-blocked']} blocked paste attempt(s).`);
  if (counts['honeypot-triggered'] >= 1) reasons.push('Honeypot field was triggered (likely automation).');
  if (counts['user-agent-mismatch'] >= 1) reasons.push('Session user-agent changed mid-session (possible link sharing).');
  if (counts['fullscreen-exit'] >= 2) reasons.push(`Exited fullscreen lockdown ${counts['fullscreen-exit']} times.`);
  if (counts['devtools-shortcut-blocked'] >= 1 || counts['devtools-suspected'] >= 1) reasons.push('DevTools activity suspected.');
  if (counts['suspiciously-fast-completion'] >= 1) reasons.push('Completed far faster than the expected minimum time.');

  // Cross-reference clusters: a visibility-hidden immediately followed by
  // a visibility-restored is one real tab-switch, not two isolated
  // incidents -- surfaced so reviewers don't double-count noise.
  const events = [...session.events].sort((a, b) => new Date(a.at) - new Date(b.at));
  let tabSwitchClusters = 0;
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].type === 'visibility-hidden' && events[i + 1].type === 'visibility-restored') tabSwitchClusters++;
  }
  if (tabSwitchClusters >= 2) reasons.push(`${tabSwitchClusters} distinct tab-switch episodes detected.`);

  let level, label;
  if (score === 0 && reasons.length === 0) {
    level = 'clean'; label = 'Clean -- no integrity concerns detected.';
  } else if (score <= 2 && !integrity.autoFlagged) {
    level = 'low'; label = 'Minor -- low-severity noise only, spot check recommended.';
  } else if (score <= 6 && !integrity.autoFlagged) {
    level = 'medium'; label = 'Notable -- review the event timeline before approving.';
  } else {
    level = 'high'; label = 'Review required -- multiple strong integrity signals.';
  }
  return { score, level, label, reasons };
}

function riskBadge(risk) {
  return `<span class="risk-badge risk-${risk.level}">${escapeHtml(risk.label)}</span>`;
}

// Full, exact event timeline for a session: absolute timestamp, time elapsed
// since the session started, event type, detail, and severity -- annotated
// with the plain-English meaning and confidence for each flag.
function eventsTable(session) {
  if (!session.events.length) return '<p class="muted-note"><em>No integrity events recorded.</em></p>';
  const rows = [...session.events]
    .map((event, index) => ({ ...event, index }))
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map(event => {
      const info = flagInfo(event.type);
      return `
      <tr class="sev-${escapeHtml(event.severity)}">
        <td>${event.index + 1}</td>
        <td>${escapeHtml(elapsedLabel(session.startedAtMs, event.at))}</td>
        <td><strong>${escapeHtml(info.label)}</strong><br><span class="muted-note">${escapeHtml(event.type)}</span></td>
        <td>${confidenceBadge(info.confidence)}</td>
        <td>${escapeHtml(event.detail)}</td>
        <td><span class="badge-${escapeHtml(event.severity)}">${escapeHtml(event.severity)}</span></td>
      </tr>`;
    }).join('');
  return `
    <table class="events-table">
      <thead><tr><th>#</th><th>Elapsed</th><th>Flag</th><th>Reliability</th><th>Detail</th><th>Severity</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function eventTypeSummary(counts) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<em>None</em>';
  return entries.map(([type, count]) => {
    const info = flagInfo(type);
    return `<span class="badge muted" title="${escapeHtml(info.explain)}">${escapeHtml(info.label)} &times; ${count}</span>`;
  }).join(' ');
}

// Per-question timing table: how long the candidate spent on each question,
// how many times they revisited it, alongside grading outcome.
function timingTable(session) {
  if (!session.breakdown || !session.breakdown.length) return '';
  const avg = session.timing ? session.timing.secondsPerQuestion : null;
  const rows = session.breakdown.map((item, index) => {
    const seconds = item.secondsSpent;
    const isOutlier = avg && seconds !== null && (seconds < avg * 0.25 || seconds > avg * 3);
    return `<tr class="${isOutlier ? 'time-outlier' : ''}">
      <td>${index + 1}</td>
      <td><code>${escapeHtml(item.id)}</code></td>
      <td>${escapeHtml(item.area)}${item.difficulty ? ` <span class="badge-${escapeHtml(item.difficulty)}">${escapeHtml(item.difficulty)}</span>` : ''}</td>
      <td>${secondsLabel(seconds)}</td>
      <td>${item.visits || 0}</td>
    </tr>`;
  }).join('');
  return `
    <table class="timing-table">
      <thead><tr><th>#</th><th>Question</th><th>Area</th><th>Time spent</th><th>Visits</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${avg ? `<p class="muted-note">Session average: ${secondsLabel(avg)}/question. Rows in red spent far less or far more time than that average.</p>` : ''}`;
}

// Per-question row for the admin: prompt, exactly what the candidate
// answered, the correct answer (when the question has one), and how it was
// graded -- everything a reviewer needs without leaving the page.
function breakdownRow(item) {
  const auto = item.auto
    ? `${item.auto.passed}/${item.auto.total} auto-graded tests passed`
    : (item.type === 'code' ? 'no auto-grader available, review manually' : `${Math.round(item.points * 100)}% credit`);
  const cls = item.points >= 0.999 ? '' : item.points === 0 ? 'flag' : 'partial';
  const difficulty = item.difficulty ? ` &middot; <span class="badge-${item.difficulty}">${escapeHtml(item.difficulty)}</span> (weight ${item.weight})` : '';
  const correct = item.correctAnswer !== null && item.correctAnswer !== undefined
    ? `<div class="answer-line"><strong>Correct answer:</strong> ${escapeHtml(fmtValue(item.correctAnswer))}</div>` : '';
  const timing = item.secondsSpent !== null && item.secondsSpent !== undefined
    ? ` &middot; <span class="muted-note">${secondsLabel(item.secondsSpent)} spent${item.visits > 1 ? `, ${item.visits} visits` : ''}</span>` : '';
  return `<li class="${cls}">
      <div><strong>${escapeHtml(item.id)}</strong> (${escapeHtml(item.area)}, ${escapeHtml(item.type)})${difficulty} &mdash; ${escapeHtml(auto)}${timing}</div>
      <div class="prompt-line">${escapeHtml(item.prompt || '')}</div>
      <div class="answer-line"><strong>Candidate answered:</strong> <pre class="inline-pre">${escapeHtml(fmtValue(item.answerGiven))}</pre></div>
      ${correct}
    </li>`;
}

function reviewForm(session) {
  const statuses = ['pending', 'approved', 'flagged', 'rejected'];
  return `
    <form class="review-form" data-session="${escapeHtml(session.id)}">
      <label>Status
        <select name="status">
          ${statuses.map(status => `<option value="${status}" ${session.review?.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
      </label>
      <label>Reviewer<input name="reviewer" value="${escapeHtml(session.review?.reviewer || '')}" placeholder="Your name"></label>
      <label>Notes<textarea name="notes" placeholder="Reviewer notes">${escapeHtml(session.review?.notes || '')}</textarea></label>
      <button type="submit">Save review</button>
      <span class="save-status"></span>
    </form>`;
}

function trackLabel(track) {
  return track === 'cybersecurity' ? 'Cybersecurity' : track === 'coding' ? 'Software Coding' : track || 'Unknown';
}

function sessionCard(session) {
  const risk = computeRisk(session);
  const reasonsList = risk.reasons.length
    ? `<ul class="risk-reasons">${risk.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
    : '';
  return `
    <article class="card session-card risk-border-${risk.level}" data-session-id="${escapeHtml(session.id)}" data-status="${escapeHtml(session.review?.status || 'pending')}">
      <div class="card-head">
        <div>
          <h2>${escapeHtml(session.candidate.name)}</h2>
          <p class="muted-note">${escapeHtml(session.candidate.email)} &middot; ${escapeHtml(session.candidate.role || 'no role given')} &middot; <span class="badge">${escapeHtml(trackLabel(session.track))}</span></p>
        </div>
        <div class="card-head-right">
          ${riskBadge(risk)}
          <span class="status-pill status-${escapeHtml(session.review?.status || 'pending')}">${escapeHtml(session.review?.status || 'pending')}</span>
        </div>
      </div>

      ${reasonsList ? `<div class="risk-panel"><strong>Why this suggestion:</strong>${reasonsList}</div>` : ''}

      <div class="stat-grid">
        <div class="stat">
          <span class="stat-label">Score</span>
          <span class="stat-value">${session.score ? `${session.score.percent}%` : 'Not submitted'}</span>
          ${session.score ? `<span class="stat-sub">${session.score.earned.toFixed(2)}/${session.score.possible} weighted pts</span>` : ''}
        </div>
        <div class="stat">
          <span class="stat-label">Timing</span>
          <span class="stat-value">${session.timing ? secondsLabel(session.timing.elapsedSeconds) : '&mdash;'}</span>
          ${session.timing ? `<span class="stat-sub">${session.timing.secondsPerQuestion}s/question avg</span>` : ''}
        </div>
        <div class="stat">
          <span class="stat-label">Integrity events</span>
          <span class="stat-value">${session.integrity.total}</span>
          <span class="stat-sub">
            <span class="${session.integrity.high ? 'flag' : ''}">${session.integrity.high} high</span> &middot;
            ${session.integrity.medium} med &middot; ${session.integrity.low} low
          </span>
        </div>
        <div class="stat">
          <span class="stat-label">Started</span>
          <span class="stat-value stat-value-sm">${escapeHtml(new Date(session.startedAt).toLocaleString())}</span>
          <span class="stat-sub">${session.submittedAt ? `submitted ${escapeHtml(new Date(session.submittedAt).toLocaleString())}` : 'in progress'}</span>
        </div>
      </div>

      <p><strong>Event types:</strong> ${eventTypeSummary(session.integrity.eventTypeCounts)}</p>
      <p class="muted-note">User-agent: <code>${escapeHtml(session.userAgent || 'unknown')}</code></p>

      ${session.breakdown
        ? `<details><summary>Question-by-question breakdown</summary><ul class="breakdown">${session.breakdown.map(breakdownRow).join('')}</ul></details>
           <details><summary>Time spent per question (${session.breakdown.length})</summary>${timingTable(session)}</details>`
        : '<p class="muted-note"><em>Not yet submitted.</em></p>'}
      <details><summary>Integrity event timeline (${session.events.length})</summary>${eventsTable(session)}</details>
      <details><summary>Raw session data (JSON)</summary><pre>${escapeHtml(JSON.stringify(session, null, 2))}</pre></details>
      ${reviewForm(session)}
    </article>`;
}

function applyFiltersAndSort(sessions) {
  const statusFilter = $('filter-status').value;
  const sortBy = $('sort-by').value;
  let filtered = statusFilter === 'all' ? sessions : sessions.filter(s => (s.review?.status || 'pending') === statusFilter);
  filtered = [...filtered];
  if (sortBy === 'recent') {
    filtered.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  } else if (sortBy === 'risk') {
    filtered.sort((a, b) => computeRisk(b).score - computeRisk(a).score);
  } else if (sortBy === 'score') {
    filtered.sort((a, b) => (a.score ? a.score.percent : -1) - (b.score ? b.score.percent : -1));
  }
  return filtered;
}

function renderReports() {
  if (!lastData) return;
  const filtered = applyFiltersAndSort(lastData.sessions);
  $('reports').innerHTML = filtered.map(sessionCard).join('') || '<p>No sessions match this filter.</p>';
  attachReviewFormHandlers();
}

function attachReviewFormHandlers() {
  document.querySelectorAll('.review-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const sessionId = form.dataset.session;
      const body = Object.fromEntries(new FormData(form).entries());
      const status = form.querySelector('.save-status');
      status.textContent = 'Saving...';
      try {
        const saveResponse = await fetch(`/api/admin/sessions/${sessionId}/review`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${$('token').value}` },
          body: JSON.stringify(body)
        });
        status.textContent = saveResponse.ok ? 'Saved.' : 'Failed to save.';
        if (saveResponse.ok && lastData) {
          const session = lastData.sessions.find(s => s.id === sessionId);
          if (session) session.review = (await saveResponse.json()).review;
        }
      } catch {
        status.textContent = 'Failed to save.';
      }
    });
  });
}

async function loadSessions() {
  const response = await fetch('/api/admin/sessions', {
    headers: { authorization: `Bearer ${$('token').value}` }
  });
  const data = await response.json();

  if (!response.ok) {
    $('reports').innerHTML = `<p class="flag">${escapeHtml(data.error || 'Unable to load')}</p>`;
    return;
  }
  lastData = data;

  const totalSessions = data.sessions.length;
  const submittedCount = data.sessions.filter(s => s.score).length;
  const autoFlaggedCount = data.sessions.filter(s => s.integrity.autoFlagged).length;
  const highRiskCount = data.sessions.filter(s => computeRisk(s).level === 'high').length;
  $('overview').innerHTML = totalSessions ? `
    <div class="overview-grid">
      <div class="overview-stat"><span class="stat-value">${totalSessions}</span><span class="stat-label">Session(s) total</span></div>
      <div class="overview-stat"><span class="stat-value">${submittedCount}</span><span class="stat-label">Submitted</span></div>
      <div class="overview-stat"><span class="stat-value ${autoFlaggedCount ? 'flag' : ''}">${autoFlaggedCount}</span><span class="stat-label">Auto-flagged</span></div>
      <div class="overview-stat"><span class="stat-value ${highRiskCount ? 'flag' : ''}">${highRiskCount}</span><span class="stat-label">Review required</span></div>
    </div>` : '';

  $('legend').classList.toggle('hidden', !totalSessions);
  $('filters').classList.toggle('hidden', !totalSessions);
  renderReports();
}

$('load').onclick = loadSessions;
$('sort-by').addEventListener('change', renderReports);
$('filter-status').addEventListener('change', renderReports);
$('legend-toggle').addEventListener('click', () => {
  $('legend-body').classList.toggle('hidden');
  $('legend-toggle').classList.toggle('open');
});
renderLegend();
