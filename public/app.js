let sessionId;
let questions = [];
let flagCount = 0;
let started = 0;
let lastSize = { w: innerWidth, h: innerHeight };
let devtoolsWarned = false;

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
  if (question.type === 'mcq' || question.type === 'true-false') {
    return `<select name="${escapeHtml(question.id)}" required><option value="">Choose one answer</option>${question.choices.map(choice => `<option>${escapeHtml(choice)}</option>`).join('')}</select>`;
  }
  if (question.type === 'multi-select') {
    return `<div class="checkbox-group">${question.choices.map((choice, index) => `
      <label class="checkbox-option"><input type="checkbox" name="${escapeHtml(question.id)}" value="${escapeHtml(choice)}" id="${escapeHtml(question.id)}-${index}"> ${escapeHtml(choice)}</label>
    `).join('')}</div>`;
  }
  const label = question.type === 'code' ? `Code answer${question.language ? ` (${question.language})` : ''}` : 'Written answer';
  const className = question.type === 'code' ? 'code-box' : 'written-box';
  return `<label class="answer-label">${label}<textarea class="${className}" name="${escapeHtml(question.id)}" spellcheck="false" placeholder="Write your complete answer here" required></textarea></label>`;
}

function difficultyBadgeClass(difficulty) {
  return difficulty === 'hard' ? 'badge-hard' : difficulty === 'medium' ? 'badge-medium' : 'badge-easy';
}

function updateProgress() {
  const data = new FormData($('questions'));
  const answeredNames = new Set();
  for (const [name, value] of data.entries()) {
    if (String(value).trim()) answeredNames.add(name);
  }
  $('progress').textContent = `${answeredNames.size} of ${questions.length} answered`;
}

function render() {
  $('questions').innerHTML = questions.map((question, index) => `
    <article class="question">
      <div class="meta">
        <span>${escapeHtml(question.area)}</span>
        <span>${escapeHtml(question.type)}</span>
        ${question.difficulty ? `<span class="${difficultyBadgeClass(question.difficulty)}">${escapeHtml(question.difficulty)}</span>` : ''}
      </div>
      <h3>${index + 1}. ${escapeHtml(question.prompt)}</h3>
      ${answerControl(question)}
    </article>
  `).join('');
  $('questions').addEventListener('input', updateProgress);
  updateProgress();
}

// Note: integrity events are still tracked and sent to the server exactly as
// before (see sendEvent below) -- they are simply never surfaced to the
// candidate. flagCount is kept only in case something elsewhere wants an
// in-memory tally; it is intentionally never rendered to the page or
// returned by the submit response. Only a reviewer, via the admin console,
// ever sees flag counts or details.
function updateIntegrityCounter() {
  // Intentionally a no-op for the candidate-facing UI. The badge in the
  // topbar shows a static "Session monitored" label (set in index.html)
  // rather than a live count, so candidates can never infer how many
  // integrity events they've triggered.
}

// Sends an integrity event to the server. Every event (routine or not) is
// logged server-side for the admin review console; none of it is ever
// exposed back to the candidate in this UI.
async function sendEvent(type, detail, severity = 'low', silent = false) {
  if (!sessionId) return;
  if (!silent) flagCount += 1;
  await api(`/api/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type, detail, severity })
  }).catch(() => {});
}
function flag(type, detail, severity = 'low') { return sendEvent(type, detail, severity, false); }
function ping(type, detail, severity = 'low') { return sendEvent(type, detail, severity, true); }

function tick() {
  if (started) {
    const seconds = Math.floor((Date.now() - started) / 1000);
    $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  requestAnimationFrame(tick);
}

function requestLockdownFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (request) request.call(el).catch(() => {});
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

api('/api/config').then(config => {
  $('notice').textContent = config.notice;
  $('question-count').textContent = `Drawn from a pool of ${config.questionPoolSize} questions across topics.`;
});

$('begin').onclick = async () => {
  const trackInput = document.querySelector('input[name="track"]:checked');
  if (!trackInput) {
    $('start-error').textContent = 'Please choose a track before beginning.';
    return;
  }
  $('start-error').textContent = '';
  const result = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      name: $('name').value,
      email: $('email').value,
      role: $('role').value,
      track: trackInput.value,
      website: $('website').value // honeypot, always empty for real candidates
    })
  });
  sessionId = result.id;
  questions = result.questions;
  $('candidate').textContent = `${$('name').value} | ${$('role').value || 'Candidate'}`;
  $('track-badge').textContent = trackInput.value === 'coding' ? 'Software Coding' : 'Cybersecurity';
  $('question-count').textContent = `${result.questionCount} total questions.`;
  $('start').classList.add('hidden');
  $('exam').classList.remove('hidden');
  started = Date.now();
  render();
  updateIntegrityCounter();
  requestLockdownFullscreen();
  ping('session-start', `Candidate began interview (${trackInput.value})`, 'low');
};

$('resume-fullscreen').onclick = () => {
  requestLockdownFullscreen();
};

$('submit').onclick = async () => {
  const data = new FormData($('questions'));
  const answers = {};
  for (const [name, value] of data.entries()) {
    if (name in answers) {
      answers[name] = Array.isArray(answers[name]) ? [...answers[name], value] : [answers[name], value];
    } else {
      answers[name] = value;
    }
  }
  $('submit').disabled = true;
  $('submit').textContent = 'Submitting...';
  try {
    await api(`/api/sessions/${sessionId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers, website: $('website') ? $('website').value : '' })
    });
    $('result').textContent = 'Your submission has been received. Thank you for completing the assessment -- a reviewer will follow up with next steps. You may now close this tab.';
    $('result').classList.remove('hidden');
    $('submit').textContent = 'Submitted';
    Array.from($('questions').elements).forEach(el => (el.disabled = true));
  } catch {
    $('submit').disabled = false;
    $('submit').textContent = 'Submit final test';
    $('result').textContent = 'Something went wrong submitting your test. Please try again.';
    $('result').classList.remove('hidden');
    $('result').classList.add('warn');
  }
};

// --- Anti-cheat instrumentation -------------------------------------------

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
  // Heuristic devtools-open detector: a large, sudden gap between outer and
  // inner window dimensions commonly appears when a docked devtools panel
  // opens. This is a signal, not a certainty, so it is logged as medium.
  const widthGap = outerWidth - innerWidth;
  const heightGap = outerHeight - innerHeight;
  if ((widthGap > 250 || heightGap > 250) && !devtoolsWarned) {
    devtoolsWarned = true;
    flag('devtools-suspected', `outer/inner gap ${widthGap}x${heightGap}`, 'high');
  }
  lastSize = { w: innerWidth, h: innerHeight };
});
document.addEventListener('paste', event => {
  flag('paste-blocked', `Blocked paste of ${String(event.clipboardData?.getData('text') || '').length} characters`, 'high');
  event.preventDefault();
});
document.addEventListener('copy', event => {
  flag('copy-blocked', 'Blocked attempt to copy content from the interview page', 'medium');
  event.preventDefault();
});
document.addEventListener('cut', event => {
  flag('cut-blocked', 'Blocked attempt to cut content from the interview page', 'medium');
  event.preventDefault();
});
document.addEventListener('contextmenu', event => {
  flag('context-menu-blocked', 'Blocked right-click context menu', 'low');
  event.preventDefault();
});
document.addEventListener('keydown', event => {
  const key = event.key ? event.key.toLowerCase() : '';
  const blockedCombo = (event.ctrlKey || event.metaKey) && ['c', 'v', 'x', 'u', 's', 'p'].includes(key);
  const devtoolsCombo = key === 'f12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j', 'c'].includes(key));
  if (devtoolsCombo) {
    flag('devtools-shortcut-blocked', `Blocked devtools shortcut (${key})`, 'high');
    event.preventDefault();
  } else if (blockedCombo) {
    flag('shortcut-blocked', `Blocked clipboard/view-source shortcut (Ctrl/Cmd+${key})`, 'medium');
    event.preventDefault();
  }
});
['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(eventName => {
  document.addEventListener(eventName, () => {
    if (!sessionId) return;
    if (!isFullscreenActive()) {
      flag('fullscreen-exit', 'Candidate exited full-screen lockdown mode', 'high');
      $('fullscreen-warning').classList.remove('hidden');
    } else {
      $('fullscreen-warning').classList.add('hidden');
    }
  });
});
window.addEventListener('beforeprint', () => flag('print-attempt', 'Candidate triggered browser print', 'medium'));

// Heartbeat: a steady pulse while the exam is open. Large gaps between
// heartbeats (tab suspended, device switched, long unexplained pause) are
// something a reviewer can correlate against the timestamped event log.
setInterval(() => {
  if (sessionId && started) ping('heartbeat', `Elapsed ${Math.floor((Date.now() - started) / 1000)}s`, 'low');
}, 20000);

tick();
