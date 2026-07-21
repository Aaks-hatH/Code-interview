const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, questions } = require('./server');

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

test('question bank is large and public questions do not expose answers', async () => {
  const server = createServer().listen(0);
  try {
    const config = await request(server, 'GET', '/api/config');
    assert.equal(config.statusCode, 200);
    const payload = config.json();
    assert.equal(payload.questionCount, questions.length);
    assert.ok(payload.questions.length >= 75);
    assert.ok(payload.questions.some(question => question.type === 'code'));
    assert.ok(payload.questions.some(question => question.type === 'text'));
    for (const question of payload.questions) {
      assert.equal(question.answer, undefined);
      assert.equal(question.rubric, undefined);
    }
  } finally {
    server.close();
  }
});

test('session lifecycle scores and records integrity events', async () => {
  const server = createServer().listen(0);
  try {
    const create = await request(server, 'POST', '/api/sessions', { name: 'Ada', email: 'ada@example.com', role: 'Security Engineer' });
    assert.equal(create.statusCode, 200);
    const { id, questions: publicQuestions } = create.json();
    assert.ok(id);
    assert.ok(publicQuestions.length >= 75);
    assert.equal(publicQuestions[0].answer, undefined);
    const event = await request(server, 'POST', `/api/sessions/${id}/events`, { type: 'window-blur', detail: 'lost focus', severity: 'high' });
    assert.equal(event.statusCode, 200);
    const answers = {
      'html-1': '<h1>',
      'css-1': 'Flexbox',
      'js-1': 'Reassignment of the binding',
      'sec-1': 'Cross-site scripting impact',
      'sec-2': 'Server memory or server database',
      'code-1': 'function escapeHtml(input) { return String(input).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }'
    };
    const submit = await request(server, 'POST', `/api/sessions/${id}/submit`, { answers });
    assert.equal(submit.statusCode, 200);
    assert.ok(submit.json().score.earned >= 5);
  } finally {
    server.close();
  }
});
