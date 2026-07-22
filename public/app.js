let sessionId;
let questions = [];
let flagCount = 0;
let started = 0;
let lastSize = { w: innerWidth, h: innerHeight };
let devtoolsWarned = false;
let currentIndex = 0;
let answers = {};
let questionEnteredAt = 0;
let hiddenAt = null; // timestamp when the tab/window was last hidden or lost focus

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
  if (!response.ok) {
    let message = 'Request failed';
    try { message = (await response.json()).error || message; } catch {}
    const error = new Error(message);
    error.serverMessage = message;
    throw error;
  }
  return response.json();
}

// --- Email validation (client-side, mirrors server rules for instant feedback) ---
const EMAIL_FORMAT = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'fakeinbox.com', 'sharklasers.com',
  'maildrop.cc', 'dispostable.com', 'mintemail.com', 'mailnesia.com', 'moakt.com',
  'test.com', 'example.com', 'domain.com', 'fake.com', 'notreal.com'
]);
function checkEmail(rawEmail) {
  const email = String(rawEmail || '').trim();
  if (!email) return 'Email is required.';
  if (!EMAIL_FORMAT.test(email)) return 'Enter a valid email address (e.g. name@company.com).';
  const domain = email.split('@')[1].toLowerCase();
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return 'Please use your real, permanent email address, not a disposable or placeholder one.';
  if (!domain.includes('.')) return 'Enter a valid email address (e.g. name@company.com).';
  const tld = domain.split('.').pop();
  if (tld.length < 2 || /\d/.test(tld)) return 'Enter a valid email address (e.g. name@company.com).';
  const local = email.split('@')[0];
  if (/^(.)\1{5,}$/.test(local)) return 'Enter a valid email address (e.g. name@company.com).';
  return '';
}
function validateEmailField() {
  const message = checkEmail($('email').value);
  $('email-error').textContent = message;
  $('email').setAttribute('aria-invalid', message ? 'true' : 'false');
  return !message;
}
$('email').addEventListener('blur', validateEmailField);
$('email').addEventListener('input', () => {
  // Once an error is showing, re-validate on every keystroke so it clears
  // as soon as the address becomes valid rather than waiting for blur again.
  if ($('email-error').textContent) validateEmailField();
});

function answerControl(question, savedValue) {
  if (question.type === 'mcq' || question.type === 'true-false') {
    return `<select name="${escapeHtml(question.id)}" required>
      <option value="">Choose one answer</option>
      ${question.choices.map(choice => `<option ${savedValue === choice ? 'selected' : ''}>${escapeHtml(choice)}</option>`).join('')}
    </select>`;
  }
  if (question.type === 'multi-select') {
    const savedArr = Array.isArray(savedValue) ? savedValue : (savedValue ? [savedValue] : []);
    return `<div class="checkbox-group">${question.choices.map((choice, index) => `
      <label class="checkbox-option"><input type="checkbox" name="${escapeHtml(question.id)}" value="${escapeHtml(choice)}" id="${escapeHtml(question.id)}-${index}" ${savedArr.includes(choice) ? 'checked' : ''}> ${escapeHtml(choice)}</label>
    `).join('')}</div>`;
  }
  const label = question.type === 'code' ? `Code answer${question.language ? ` (${question.language})` : ''}` : 'Written answer';
  const className = question.type === 'code' ? 'code-box' : 'written-box';
  return `<label class="answer-label">${label}<textarea class="${className}" name="${escapeHtml(question.id)}" spellcheck="false" placeholder="Write your complete answer here" required>${escapeHtml(savedValue || '')}</textarea></label>`;
}

function difficultyBadgeClass(difficulty) {
  return difficulty === 'hard' ? 'badge-hard' : difficulty === 'medium' ? 'badge-medium' : 'badge-easy';
}

function isQuestionAnswered(question) {
  const value = answers[question.id];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && String(value).trim());
}

function updateProgress() {
  const answeredCount = questions.filter(isQuestionAnswered).length;
  $('progress').textContent = `${answeredCount} of ${questions.length} answered`;
}

function renderDots() {
  $('qnav-dots').innerHTML = questions.map((question, index) => {
    const state = index === currentIndex ? 'current' : isQuestionAnswered(question) ? 'done' : 'todo';
    return `<button type="button" class="qdot qdot-${state}" data-index="${index}" title="Question ${index + 1}${isQuestionAnswered(question) ? ' (answered)' : ''}">${index + 1}</button>`;
  }).join('');
  $('qnav-dots').querySelectorAll('.qdot').forEach(button => {
    button.addEventListener('click', () => goToQuestion(Number(button.dataset.index)));
  });
}

// Reads whatever is currently in the form for the on-screen question and
// stores it in the answers map, keyed by question id.
function captureCurrentAnswer() {
  const question = questions[currentIndex];
  if (!question) return;
  const form = $('questions');
  if (question.type === 'multi-select') {
    answers[question.id] = Array.from(form.querySelectorAll(`input[name="${CSS.escape(question.id)}"]:checked`)).map(el => el.value);
  } else if (question.type === 'mcq' || question.type === 'true-false') {
    const select = form.querySelector(`select[name="${CSS.escape(question.id)}"]`);
    answers[question.id] = select ? select.value : '';
  } else {
    const textarea = form.querySelector(`textarea[name="${CSS.escape(question.id)}"]`);
    answers[question.id] = textarea ? textarea.value : '';
  }
}

// Sends how long the candidate spent looking at the question they are
// leaving. Fire-and-forget; timing is analytics for the reviewer, not
// something that should ever block navigation.
function reportTimeOnQuestion(index) {
  const question = questions[index];
  if (!question || !sessionId || !questionEnteredAt) return;
  const seconds = (Date.now() - questionEnteredAt) / 1000;
  api(`/api/sessions/${sessionId}/question-time`, {
    method: 'POST',
    body: JSON.stringify({ questionId: question.id, seconds })
  }).catch(() => {});
}

function renderQuestion() {
  const question = questions[currentIndex];
  $('questions').innerHTML = `
    <article class="question">
      <div class="meta">
        <span>${escapeHtml(question.area)}</span>
        <span>${escapeHtml(question.type)}</span>
        ${question.difficulty ? `<span class="${difficultyBadgeClass(question.difficulty)}">${escapeHtml(question.difficulty)}</span>` : ''}
      </div>
      <h3>${currentIndex + 1}. ${escapeHtml(question.prompt)}</h3>
      ${answerControl(question, answers[question.id])}
    </article>
  `;
  $('questions').addEventListener('input', () => { captureCurrentAnswer(); updateProgress(); renderDots(); });
  $('qnav-label').textContent = `Question ${currentIndex + 1} of ${questions.length}`;
  $('prev-question').disabled = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;
  $('next-question').classList.toggle('hidden', isLast);
  $('submit').classList.toggle('hidden', !isLast);
  updateProgress();
  renderDots();
  questionEnteredAt = Date.now();
}

function goToQuestion(index) {
  if (index === currentIndex) return;
  captureCurrentAnswer();
  reportTimeOnQuestion(currentIndex);
  currentIndex = Math.max(0, Math.min(questions.length - 1, index));
  renderQuestion();
}

$('prev-question').onclick = () => goToQuestion(currentIndex - 1);
$('next-question').onclick = () => goToQuestion(currentIndex + 1);

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
  if (!validateEmailField()) {
    $('start-error').textContent = 'Please fix the email address above before beginning.';
    return;
  }
  if (!$('name').value.trim()) {
    $('start-error').textContent = 'Please enter your full name.';
    return;
  }
  if (!trackInput) {
    $('start-error').textContent = 'Please choose a track before beginning.';
    return;
  }
  $('start-error').textContent = '';
  $('begin').disabled = true;
  let result;
  try {
    result = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: $('name').value,
        email: $('email').value,
        role: $('role').value,
        track: trackInput.value,
        website: $('website').value // honeypot, always empty for real candidates
      })
    });
  } catch (err) {
    $('start-error').textContent = err.serverMessage || 'Something went wrong starting the test. Please try again.';
    $('begin').disabled = false;
    return;
  }
  sessionId = result.id;
  questions = result.questions;
  answers = {};
  currentIndex = 0;
  $('candidate').textContent = `${$('name').value} | ${$('role').value || 'Candidate'}`;
  $('track-badge').textContent = trackInput.value === 'coding' ? 'Software Coding' : 'Cybersecurity';
  $('question-count').textContent = `${result.questionCount} total questions.`;
  $('start').classList.add('hidden');
  $('exam').classList.remove('hidden');
  started = Date.now();
  renderQuestion();
  updateIntegrityCounter();
  requestLockdownFullscreen();
  ping('session-start', `Candidate began interview (${trackInput.value})`, 'low');
};

$('resume-fullscreen').onclick = () => {
  requestLockdownFullscreen();
};

$('submit').onclick = async () => {
  captureCurrentAnswer();
  reportTimeOnQuestion(currentIndex);
  const unanswered = questions.filter(q => !isQuestionAnswered(q));
  if (unanswered.length) {
    const proceed = confirm(`You have ${unanswered.length} unanswered question(s). Submit anyway?`);
    if (!proceed) return;
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
    $('prev-question').disabled = true;
    $('next-question').disabled = true;
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
  if (document.hidden) {
    hiddenAt = Date.now();
    flag('visibility-hidden', 'Candidate left the interview tab', 'high');
  } else if (hiddenAt) {
    const awaySeconds = Math.round((Date.now() - hiddenAt) / 1000);
    flag('visibility-restored', `Candidate returned to the interview tab after ${awaySeconds}s away`, awaySeconds > 30 ? 'high' : 'medium');
    hiddenAt = null;
  }
});
window.addEventListener('blur', () => flag('window-blur', 'Interview window lost focus', 'medium'));
window.addEventListener('focus', () => {
  // A blur without a matching visibilitychange (e.g. clicking a different
  // app on the same desktop rather than switching tabs) is only observable
  // via this focus event, so it gets its own "came back" signal too.
  if (!document.hidden) flag('focus-restored', 'Interview window regained focus', 'low');
});
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
      flag('fullscreen-restored', 'Candidate returned to full-screen lockdown mode', 'low');
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
