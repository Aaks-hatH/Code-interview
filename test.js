const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, questions, TRACKS } = require('./server');

function request(server, method, path, payload, headers = {}) {
  return new Promise(resolve => {
    const addr = server.address();
    const req = require('node:http').request({
      method,
      port: addr.port,
      path,
      headers: { 'content-type': 'application/json', ...headers }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, json: () => JSON.parse(data) }));
    });
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function fillAnswers(sessionQuestions) {
  const answers = {};
  for (const question of sessionQuestions) {
    if (question.type === 'mcq' || question.type === 'true-false') answers[question.id] = question.choices[0];
    else if (question.type === 'multi-select') answers[question.id] = [question.choices[0]];
    else if (question.type === 'code' && question.language === 'javascript' && question.id === 'code-js-1') {
      answers[question.id] = 'function escapeHtml(input) { return String(input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }';
    } else if (question.type === 'code' && question.language === 'python' && question.id === 'code-py-1') {
      answers[question.id] = 'def is_palindrome(s):\n    t = s.lower().replace(" ", "")\n    return t == t[::-1]';
    } else answers[question.id] = 'a plausible written answer with return const auth valid least privilege hash token';
  }
  return answers;
}

test('session creation rejects fake, malformed, or disposable emails and accepts real-looking ones', async () => {
  const server = createServer().listen(0);
  try {
    const badEmails = ['not-an-email', 'missing-domain@', '@no-local-part.com', 'ada@test.com', 'ada@mailinator.com', 'aaaaaa@gmail.com', 'ada@nodothere'];
    for (const email of badEmails) {
      const res = await request(server, 'POST', '/api/sessions', { name: 'Ada', email, track: 'coding' });
      assert.equal(res.statusCode, 400, `expected ${email} to be rejected`);
    }
    const goodEmails = ['ada.lovelace@gmail.com', 'a@b.co.uk', 'first.last+tag@company-name.io'];
    for (const email of goodEmails) {
      const res = await request(server, 'POST', '/api/sessions', { name: 'Ada', email, track: 'coding' });
      assert.equal(res.statusCode, 200, `expected ${email} to be accepted`);
    }
  } finally {
    server.close();
  }
});

test('config exposes both selectable tracks without leaking answers', async () => {
  const server = createServer().listen(0);
  try {
    const config = await request(server, 'GET', '/api/config');
    assert.equal(config.statusCode, 200);
    const payload = config.json();
    assert.equal(payload.questionPoolSize, questions.length);
    assert.deepEqual(payload.tracks.map(t => t.id).sort(), ['coding', 'cybersecurity']);
    assert.equal(payload.questions, undefined);
  } finally {
    server.close();
  }
});

test('creating a session requires a valid track and returns only that track\'s questions', async () => {
  const server = createServer().listen(0);
  try {
    const missingTrack = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com' });
    assert.equal(missingTrack.statusCode, 400);

    const badTrack = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track: 'not-a-real-track' });
    assert.equal(badTrack.statusCode, 400);

    for (const track of TRACKS) {
      const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track });
      assert.equal(create.statusCode, 200);
      const { id, questions: sessionQuestions } = create.json();
      assert.ok(id);
      assert.ok(sessionQuestions.length > 0);
      assert.ok(sessionQuestions.length < questions.filter(q => q.track === track).length + 5);
      for (const question of sessionQuestions) {
        assert.equal(question.answer, undefined);
        assert.notEqual(question.track, track === 'coding' ? 'cybersecurity' : 'coding');
      }
    }
  } finally {
    server.close();
  }
});

test('coding sessions include JavaScript and Python code questions, and skew toward harder difficulty', async () => {
  const server = createServer().listen(0);
  try {
    const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track: 'coding' });
    const { questions: sessionQuestions } = create.json();
    assert.ok(sessionQuestions.some(q => q.type === 'code' && q.language === 'javascript'));
    assert.ok(sessionQuestions.some(q => q.type === 'code' && q.language === 'python'));
    const hardCount = sessionQuestions.filter(q => q.difficulty === 'hard').length;
    const easyCount = sessionQuestions.filter(q => q.difficulty === 'easy').length;
    assert.ok(hardCount > easyCount, 'hard questions should outnumber easy ones');
  } finally {
    server.close();
  }
});

test('JavaScript and Python code answers are both auto-graded against hidden test cases', async () => {
  const { runCodeTests } = require('./server');
  const goodJS = runCodeTests('code-js-1', 'function escapeHtml(input) { return String(input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }');
  assert.ok(goodJS.passed >= 1);
  const badJS = runCodeTests('code-js-1', 'function escapeHtml(input) { return input; }');
  assert.ok(badJS.passed < goodJS.passed);

  const goodPy = runCodeTests('code-py-1', 'def is_palindrome(s):\n    t = s.lower().replace(" ", "")\n    return t == t[::-1]');
  assert.ok(goodPy && goodPy.passed >= 1, 'python3 should be available in the test environment');
  const badPy = runCodeTests('code-py-1', 'def is_palindrome(s):\n    return False');
  assert.ok(badPy.passed < goodPy.passed);
});

test('harder questions are worth more than easy questions when scoring', async () => {
  const server = createServer().listen(0);
  try {
    const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track: 'cybersecurity' });
    const { id, questions: sessionQuestions } = create.json();
    const answers = fillAnswers(sessionQuestions);
    const submit = await request(server, 'POST', `/api/sessions/${id}/submit`, { answers });
    assert.equal(submit.statusCode, 200);
    const admin = await request(server, 'GET', '/api/admin/sessions', null, { authorization: `Bearer ${require('./server').ADMIN_TOKEN}` });
    const found = admin.json().sessions.find(s => s.id === id);
    const weights = new Set(found.breakdown.map(item => item.weight));
    assert.ok(weights.has(3), 'hard questions should carry weight 3');
    assert.equal(found.score.possible, found.breakdown.reduce((sum, item) => sum + item.weight, 0));
  } finally {
    server.close();
  }
});

test('a burst of high-severity integrity events auto-flags the session for mandatory review', async () => {
  const server = createServer().listen(0);
  try {
    const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track: 'coding' });
    const { id, questions: sessionQuestions } = create.json();
    for (let i = 0; i < 5; i++) {
      await request(server, 'POST', `/api/sessions/${id}/events`, { type: 'window-blur', detail: 'lost focus', severity: 'high' });
    }
    const answers = fillAnswers(sessionQuestions);
    const submit = await request(server, 'POST', `/api/sessions/${id}/submit`, { answers });
    assert.equal(submit.statusCode, 200);
    const admin = await request(server, 'GET', '/api/admin/sessions', null, { authorization: `Bearer ${require('./server').ADMIN_TOKEN}` });
    const found = admin.json().sessions.find(s => s.id === id);
    assert.equal(found.review.status, 'flagged');
    assert.ok(found.integrity.autoFlagged);
  } finally {
    server.close();
  }
});

test('a populated honeypot field is recorded as a high-severity integrity event', async () => {
  const server = createServer().listen(0);
  try {
    const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track: 'coding', website: 'http://spam.example' });
    const { id } = create.json();
    const admin = await request(server, 'GET', '/api/admin/sessions', null, { authorization: `Bearer ${require('./server').ADMIN_TOKEN}` });
    const found = admin.json().sessions.find(s => s.id === id);
    assert.ok(found.events.some(e => e.type === 'honeypot-triggered'));
  } finally {
    server.close();
  }
});

test('session lifecycle scores and records integrity events without exposing them to the candidate response', async () => {
  const server = createServer().listen(0);
  try {
    const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada.lovelace@gmail.com', track: 'cybersecurity' });
    const { id, questions: sessionQuestions } = create.json();
    const event = await request(server, 'POST', `/api/sessions/${id}/events`, { type: 'window-blur', detail: 'lost focus', severity: 'high' });
    assert.equal(event.statusCode, 200);
    const answers = fillAnswers(sessionQuestions);
    const submit = await request(server, 'POST', `/api/sessions/${id}/submit`, { answers });
    assert.equal(submit.statusCode, 200);
    const submitPayload = submit.json();
    // Candidates must never see their score, flag/integrity counts, or any
    // breakdown/event detail -- only a generic confirmation.
    assert.equal(submitPayload.score, undefined);
    assert.equal(submitPayload.events, undefined);
    assert.equal(submitPayload.breakdown, undefined);
    assert.equal(submitPayload.integrity, undefined);
    assert.equal(submitPayload.ok, true);
    assert.equal(submitPayload.submitted, true);
    assert.ok(submitPayload.message);

    const unauthorized = await request(server, 'GET', '/api/admin/sessions');
    assert.equal(unauthorized.statusCode, 401);

    const admin = await request(server, 'GET', '/api/admin/sessions', null, { authorization: `Bearer ${require('./server').ADMIN_TOKEN}` });
    assert.equal(admin.statusCode, 200);
    const found = admin.json().sessions.find(s => s.id === id);
    assert.ok(found);
    // At least the one manually-fired window-blur event; the automated test
    // also completes the whole flow in well under MIN_SECONDS_PER_QUESTION,
    // so a "suspiciously-fast-completion" high-severity event is expected too.
    assert.ok(found.integrity.high >= 1);
    assert.ok(found.breakdown.length === sessionQuestions.length);
    // Admin view must be exhaustive: exact score, full event log with
    // timestamps/types/details/severities, per-question prompt/answer/
    // correct-answer, and timing analytics.
    assert.ok(found.score);
    assert.ok(found.events.every(event => event.at && event.type && event.severity));
    assert.ok(found.breakdown.every(item => 'prompt' in item && 'answerGiven' in item && 'correctAnswer' in item));
    assert.ok(found.timing && typeof found.timing.elapsedSeconds === 'number');
    assert.ok(found.integrity.eventTypeCounts && found.integrity.eventTypeCounts['window-blur'] >= 1);

    const review = await request(server, 'POST', `/api/admin/sessions/${id}/review`, { status: 'approved', reviewer: 'Grace', notes: 'Looks solid.' }, { authorization: `Bearer ${require('./server').ADMIN_TOKEN}` });
    assert.equal(review.statusCode, 200);
    assert.equal(review.json().review.status, 'approved');
  } finally {
    server.close();
  }
});
