const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[char]));

$('load').onclick = async () => {
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
      <p>${escapeHtml(session.candidate.email)} | ${escapeHtml(session.candidate.role)}</p>
      <p><strong>Score:</strong> ${session.score ? `${session.score.percent}% (${session.score.earned}/${session.score.possible})` : 'Not submitted'}</p>
      <p><strong>Integrity:</strong> ${session.integrity.total} signals, <span class="flag">${session.integrity.high} high</span></p>
      <details><summary>Events</summary><pre>${escapeHtml(JSON.stringify(session.events, null, 2))}</pre></details>
      <details><summary>Answers</summary><pre>${escapeHtml(JSON.stringify(session.answers, null, 2))}</pre></details>
    </article>
  `).join('') || '<p>No sessions yet.</p>';
};
