let sessionId;
let questions = [];
let flagCount = 0;
let started = 0;
let lastSize = { w: innerWidth, h: innerHeight };

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[char]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function answerControl(question) {
  if (question.type === 'mcq') {
    return `<select name="${escapeHtml(question.id)}" required><option value="">Choose one answer</option>${question.choices.map(choice => `<option>${escapeHtml(choice)}</option>`).join('')}</select>`;
  }
  const label = question.type === 'code' ? 'Code answer' : 'Written answer';
  const className = question.type === 'code' ? 'code-box' : 'written-box';
  return `<label class="answer-label">${label}<textarea class="${className}" name="${escapeHtml(question.id)}" spellcheck="false" placeholder="Write your complete answer here" required></textarea></label>`;
}

function updateProgress() {
  const data = new FormData($('questions'));
  const answered = [...data.values()].filter(value => String(value).trim()).length;
  $('progress').textContent = `${answered} of ${questions.length} answered`;
}

function render() {
  $('questions').innerHTML = questions.map((question, index) => `
    <article class="question">
      <div class="meta">
        <span>${escapeHtml(question.area)}</span>
        <span>${escapeHtml(question.type)}</span>
      </div>
      <h3>${index + 1}. ${escapeHtml(question.prompt)}</h3>
      ${answerControl(question)}
    </article>
  `).join('');
  $('questions').addEventListener('input', updateProgress);
  updateProgress();
}

async function flag(type, detail, severity = 'low') {
  if (!sessionId) return;
  flagCount += 1;
  $('flags').textContent = `Integrity signals: ${flagCount}`;
  await api(`/api/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type, detail, severity })
  }).catch(() => {});
}

function tick() {
  if (started) {
    const seconds = Math.floor((Date.now() - started) / 1000);
    $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  requestAnimationFrame(tick);
}

api('/api/config').then(config => {
  questions = config.questions;
  $('notice').textContent = config.notice;
  $('question-count').textContent = `${config.questionCount} total questions.`;
});

$('begin').onclick = async () => {
  const result = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name: $('name').value, email: $('email').value, role: $('role').value })
  });
  sessionId = result.id;
  questions = result.questions;
  $('candidate').textContent = `${$('name').value} | ${$('role').value || 'Candidate'}`;
  $('question-count').textContent = `${result.questionCount} total questions.`;
  $('start').classList.add('hidden');
  $('exam').classList.remove('hidden');
  started = Date.now();
  render();
  flag('session-start', 'Candidate began interview', 'low');
};

$('submit').onclick = async () => {
  const data = new FormData($('questions'));
  const answers = Object.fromEntries(data.entries());
  const result = await api(`/api/sessions/${sessionId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers })
  });
  $('result').textContent = JSON.stringify(result, null, 2);
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flag('visibility-hidden', 'Candidate left the interview tab', 'high');
});
window.addEventListener('blur', () => flag('window-blur', 'Interview window lost focus', 'medium'));
window.addEventListener('resize', () => {
  const deltaWidth = Math.abs(innerWidth - lastSize.w);
  const deltaHeight = Math.abs(innerHeight - lastSize.h);
  if (deltaWidth > 180 || deltaHeight > 180) {
    flag('major-resize', `Window changed from ${lastSize.w}x${lastSize.h} to ${innerWidth}x${innerHeight}`, 'medium');
  }
  lastSize = { w: innerWidth, h: innerHeight };
});
document.addEventListener('paste', event => flag('paste', `Pasted ${String(event.clipboardData?.getData('text') || '').length} characters`, 'medium'));
document.addEventListener('copy', () => flag('copy', 'Copied content from interview page', 'low'));

tick();
