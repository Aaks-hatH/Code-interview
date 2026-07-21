const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[char]));

function breakdownRow(item) {
  const auto = item.auto
    ? `${item.auto.passed}/${item.auto.total} tests passed`
    : (item.type === 'code' ? 'no auto-grader for this question, review manually' : `${Math.round(item.points * 100)}%`);
  const cls = item.points >= 0.999 ? '' : item.points === 0 ? 'flag' : 'partial';
  const difficulty = item.difficulty ? ` &middot; <span class="badge-${item.difficulty}">${escapeHtml(item.difficulty)}</span> (weight ${item.weight})` : '';
  return `<li class="${cls}"><strong>${escapeHtml(item.id)}</strong> (${escapeHtml(item.area)}, ${escapeHtml(item.type)})${difficulty} &mdash; ${escapeHtml(auto)}</li>`;
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

  $('reports').innerHTML = data.sessions.map(session => `
    <article class="card">
      <h2>${escapeHtml(session.candidate.name)}</h2>
      <p>${escapeHtml(session.candidate.email)} | ${escapeHtml(session.candidate.role)} | <span class="badge">${escapeHtml(trackLabel(session.track))}</span></p>
      <p><strong>Score:</strong> ${session.score ? `${session.score.percent}% (${session.score.earned.toFixed(2)}/${session.score.possible} weighted points)` : 'Not submitted'}</p>
      <p><strong>Integrity signals:</strong> ${session.integrity.total} total, <span class="flag">${session.integrity.high} high severity</span>
        ${session.integrity.autoFlagged ? '<span class="flag"> &mdash; AUTO-FLAGGED for mandatory review</span>' : ''}</p>
      <p><strong>Review status:</strong> ${escapeHtml(session.review?.status || 'pending')}</p>
      ${session.breakdown ? `<details open><summary>Auto-grading breakdown</summary><ul class="breakdown">${session.breakdown.map(breakdownRow).join('')}</ul></details>` : '<p><em>Not yet submitted.</em></p>'}
      <details><summary>Events</summary><pre>${escapeHtml(JSON.stringify(session.events, null, 2))}</pre></details>
      <details><summary>Answers</summary><pre>${escapeHtml(JSON.stringify(session.answers, null, 2))}</pre></details>
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
