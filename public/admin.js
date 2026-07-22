const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[char]));

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

function severityRank(sev) { return sev === 'high' ? 0 : sev === 'medium' ? 1 : 2; }

// Full, exact event timeline for a session: absolute timestamp, time elapsed
// since the session started, event type, detail, and severity. This is the
// admin's ground truth for "exactly when a flag happened and what it was".
function eventsTable(session) {
  if (!session.events.length) return '<p><em>No integrity events recorded.</em></p>';
  const rows = [...session.events]
    .map((event, index) => ({ ...event, index }))
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map(event => `
      <tr class="sev-${escapeHtml(event.severity)}">
        <td>${event.index + 1}</td>
        <td>${escapeHtml(new Date(event.at).toLocaleString())}</td>
        <td>${escapeHtml(elapsedLabel(session.startedAtMs, event.at))}</td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.detail)}</td>
        <td><span class="badge-${escapeHtml(event.severity)}">${escapeHtml(event.severity)}</span></td>
      </tr>`).join('');
  return `
    <table class="events-table">
      <thead><tr><th>#</th><th>Timestamp</th><th>Elapsed</th><th>Type</th><th>Detail</th><th>Severity</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function eventTypeSummary(counts) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<em>None</em>';
  return entries.map(([type, count]) => `<span class="badge muted">${escapeHtml(type)} &times; ${count}</span>`).join(' ');
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
  return `<li class="${cls}">
      <div><strong>${escapeHtml(item.id)}</strong> (${escapeHtml(item.area)}, ${escapeHtml(item.type)})${difficulty} &mdash; ${escapeHtml(auto)}</div>
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

async function loadSessions() {
  const response = await fetch('/api/admin/sessions', {
    headers: { authorization: `Bearer ${$('token').value}` }
  });
  const data = await response.json();

  if (!response.ok) {
    $('reports').innerHTML = `<p class="flag">${escapeHtml(data.error || 'Unable to load')}</p>`;
    return;
  }

  const totalSessions = data.sessions.length;
  const submittedCount = data.sessions.filter(s => s.score).length;
  const autoFlaggedCount = data.sessions.filter(s => s.integrity.autoFlagged).length;
  $('overview').innerHTML = totalSessions ? `
    <p><strong>${totalSessions}</strong> session(s) total &middot; <strong>${submittedCount}</strong> submitted &middot;
    <strong class="${autoFlaggedCount ? 'flag' : ''}">${autoFlaggedCount}</strong> auto-flagged for mandatory review</p>` : '';

  $('reports').innerHTML = [...data.sessions].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map(session => `
    <article class="card">
      <h2>${escapeHtml(session.candidate.name)}</h2>
      <p>${escapeHtml(session.candidate.email)} | ${escapeHtml(session.candidate.role || 'no role given')} | <span class="badge">${escapeHtml(trackLabel(session.track))}</span></p>
      <p><strong>Score:</strong> ${session.score ? `${session.score.percent}% (${session.score.earned.toFixed(2)}/${session.score.possible} weighted points)` : 'Not submitted yet'}</p>
      <p><strong>Timing:</strong> started ${escapeHtml(new Date(session.startedAt).toLocaleString())}
        ${session.submittedAt ? `&middot; submitted ${escapeHtml(new Date(session.submittedAt).toLocaleString())}` : '&middot; in progress'}
        ${session.timing ? `&middot; ${session.timing.elapsedSeconds}s total &middot; ${session.timing.secondsPerQuestion}s/question avg` : ''}</p>
      <p><strong>Integrity signals:</strong> ${session.integrity.total} total
        (<span class="${session.integrity.high ? 'flag' : ''}">${session.integrity.high} high</span>,
        ${session.integrity.medium} medium, ${session.integrity.low} low)
        ${session.integrity.autoFlagged ? '<span class="flag"> &mdash; AUTO-FLAGGED for mandatory review</span>' : ''}</p>
      <p><strong>Event types:</strong> ${eventTypeSummary(session.integrity.eventTypeCounts)}</p>
      <p><strong>Session metadata:</strong> user-agent: <code>${escapeHtml(session.userAgent || 'unknown')}</code></p>
      <p><strong>Review status:</strong> ${escapeHtml(session.review?.status || 'pending')}</p>
      ${session.breakdown ? `<details open><summary>Question-by-question breakdown (prompt, candidate answer, correct answer)</summary><ul class="breakdown">${session.breakdown.map(breakdownRow).join('')}</ul></details>` : '<p><em>Not yet submitted.</em></p>'}
      <details><summary>Exact integrity event timeline (${session.events.length})</summary>${eventsTable(session)}</details>
      <details><summary>Raw session data (JSON)</summary><pre>${escapeHtml(JSON.stringify(session, null, 2))}</pre></details>
      ${reviewForm(session)}
    </article>
  `).join('') || '<p>No sessions yet.</p>';

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
      } catch {
        status.textContent = 'Failed to save.';
      }
    });
  });
}

$('load').onclick = loadSessions;
