const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sessions = new Map();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(18).toString('hex');

const mcqQuestions = [
  ['html-1', 'HTML', 'Which element represents the main heading of a page?', ['<h1>', '<head>', '<title>', '<section>'], '<h1>'],
  ['html-2', 'HTML', 'Which attribute connects a label to a form input?', ['for', 'name', 'target', 'rel'], 'for'],
  ['html-3', 'HTML', 'Which element should contain site navigation links?', ['<nav>', '<aside>', '<main>', '<figure>'], '<nav>'],
  ['html-4', 'HTML', 'Which input type is most appropriate for an email address?', ['email', 'text', 'search', 'url-list'], 'email'],
  ['html-5', 'HTML', 'Which attribute is required to make an image accessible when the image conveys meaning?', ['alt', 'title', 'role', 'data-name'], 'alt'],
  ['html-6', 'HTML', 'Which element contains independent self-contained content?', ['<article>', '<span>', '<b>', '<br>'], '<article>'],
  ['html-7', 'HTML', 'Which element is used for a row in a table?', ['<tr>', '<td>', '<th>', '<tbody>'], '<tr>'],
  ['html-8', 'HTML', 'Which attribute prevents a form field from being submitted when empty?', ['required', 'checked', 'selected', 'readonly'], 'required'],
  ['html-9', 'HTML', 'Which element is best for the unique central content of a document?', ['<main>', '<header>', '<footer>', '<aside>'], '<main>'],
  ['html-10', 'HTML', 'Which attribute should be used for safe external links opened in a new tab?', ['rel="noopener noreferrer"', 'download', 'crossorigin="use"', 'aria-hidden="true"'], 'rel="noopener noreferrer"'],
  ['css-1', 'CSS', 'Which layout method is designed for one-dimensional alignment?', ['Flexbox', 'Canvas', 'Cookies', 'Local storage'], 'Flexbox'],
  ['css-2', 'CSS', 'Which property controls the space inside an element border?', ['padding', 'margin', 'outline', 'gap'], 'padding'],
  ['css-3', 'CSS', 'Which selector targets an element with id login?', ['#login', '.login', 'login', '*login'], '#login'],
  ['css-4', 'CSS', 'Which property creates a two-dimensional grid layout?', ['display: grid', 'position: grid', 'layout: grid', 'float: grid'], 'display: grid'],
  ['css-5', 'CSS', 'Which unit is relative to the root element font size?', ['rem', 'px', 'vh', 'cm'], 'rem'],
  ['css-6', 'CSS', 'Which property controls stacking order for positioned elements?', ['z-index', 'order', 'stack', 'layer'], 'z-index'],
  ['css-7', 'CSS', 'Which pseudo-class matches keyboard focus?', [':focus', ':hover', ':active', ':visited'], ':focus'],
  ['css-8', 'CSS', 'Which property can hide overflowing content?', ['overflow', 'display', 'visibility-mode', 'contain-text'], 'overflow'],
  ['css-9', 'CSS', 'Which rule starts a media query?', ['@media', '@screen', '@query', '@viewport-only'], '@media'],
  ['css-10', 'CSS', 'Which value makes an element not render and not occupy layout space?', ['display: none', 'visibility: hidden', 'opacity: 0', 'pointer-events: none'], 'display: none'],
  ['js-1', 'JavaScript', 'What does const prevent?', ['Reassignment of the binding', 'Mutation of object contents', 'Network requests', 'Runtime errors'], 'Reassignment of the binding'],
  ['js-2', 'JavaScript', 'Which method converts a JSON string into an object?', ['JSON.parse', 'JSON.stringify', 'Object.fromEntries', 'String.raw'], 'JSON.parse'],
  ['js-3', 'JavaScript', 'Which array method returns a new array with transformed values?', ['map', 'forEach', 'push', 'splice'], 'map'],
  ['js-4', 'JavaScript', 'Which keyword waits for a Promise inside an async function?', ['await', 'yield', 'defer', 'pause'], 'await'],
  ['js-5', 'JavaScript', 'Which comparison avoids type coercion?', ['===', '==', '=', '!='], '==='],
  ['js-6', 'JavaScript', 'Which Web API sends HTTP requests from the browser?', ['fetch', 'querySelector', 'setTimeout', 'matchMedia'], 'fetch'],
  ['js-7', 'JavaScript', 'Which method selects the first matching element?', ['document.querySelector', 'document.querySelectorAll', 'document.createElement', 'document.write'], 'document.querySelector'],
  ['js-8', 'JavaScript', 'Which event fires when a form is submitted?', ['submit', 'change', 'input', 'keydown'], 'submit'],
  ['js-9', 'JavaScript', 'Which value is returned by typeof []?', ['object', 'array', 'list', 'undefined'], 'object'],
  ['js-10', 'JavaScript', 'Which syntax catches rejected Promises with async functions?', ['try and catch around await', 'if and else around import', 'switch on Promise', 'while await returns false'], 'try and catch around await'],
  ['sec-1', 'Cybersecurity', 'What does Content Security Policy primarily reduce?', ['Cross-site scripting impact', 'Password length', 'Disk usage', 'DNS latency'], 'Cross-site scripting impact'],
  ['sec-2', 'Cybersecurity', 'Where should server-side session secrets be stored?', ['Server memory or server database', 'localStorage', 'URL query string', 'HTML comments'], 'Server memory or server database'],
  ['sec-3', 'Cybersecurity', 'Which control helps slow credential stuffing?', ['Rate limiting', 'Inline styles', 'Larger images', 'Client-side sorting'], 'Rate limiting'],
  ['sec-4', 'Cybersecurity', 'Which password storage method is appropriate?', ['Slow salted password hashing', 'Plain text', 'Base64 encoding', 'Reversible encryption with a hardcoded key'], 'Slow salted password hashing'],
  ['sec-5', 'Cybersecurity', 'Which cookie flag prevents JavaScript from reading a cookie?', ['HttpOnly', 'Secure', 'SameSite', 'Path'], 'HttpOnly'],
  ['sec-6', 'Cybersecurity', 'Which cookie flag requires HTTPS transport?', ['Secure', 'HttpOnly', 'Expires', 'Domain'], 'Secure'],
  ['sec-7', 'Cybersecurity', 'Which attack uses a victim browser to submit an unwanted authenticated request?', ['CSRF', 'SQL indexing', 'Cache warming', 'DNS prefetching'], 'CSRF'],
  ['sec-8', 'Cybersecurity', 'Which validation should be trusted for security decisions?', ['Server-side validation', 'Client-side validation only', 'HTML placeholder text', 'CSS constraints only'], 'Server-side validation'],
  ['sec-9', 'Cybersecurity', 'Which principle grants only the access required for a task?', ['Least privilege', 'Open access', 'Security by obscurity', 'Global admin'], 'Least privilege'],
  ['sec-10', 'Cybersecurity', 'Which response is safest for login failures?', ['Generic failure message', 'Email exists message', 'Password is close message', 'Account role message'], 'Generic failure message'],
  ['sec-11', 'Cybersecurity', 'Which vulnerability is caused by placing untrusted input in SQL strings?', ['SQL injection', 'Clickjacking', 'Race condition', 'Path compression'], 'SQL injection'],
  ['sec-12', 'Cybersecurity', 'Which header helps prevent MIME sniffing?', ['X-Content-Type-Options: nosniff', 'Accept-Language', 'Server-Timing', 'Content-Length'], 'X-Content-Type-Options: nosniff'],
  ['sec-13', 'Cybersecurity', 'Which practice protects sensitive logs?', ['Do not log secrets', 'Log full passwords', 'Log session tokens', 'Log private keys for debugging'], 'Do not log secrets'],
  ['sec-14', 'Cybersecurity', 'Which action is part of incident response?', ['Containment', 'Ignoring alerts', 'Deleting all logs first', 'Sharing tokens in chat'], 'Containment'],
  ['sec-15', 'Cybersecurity', 'Which control helps protect admin portals?', ['Strong authentication and authorization', 'Hidden URL only', 'No audit logs', 'Client-side password check'], 'Strong authentication and authorization']
];

const writtenQuestions = [
  ['scenario-1', 'text', 'Cybersecurity Scenario', 'A login form has no rate limit and reveals whether an email exists. Explain two risks and two fixes.'],
  ['scenario-2', 'text', 'Cybersecurity Scenario', 'A file upload feature accepts any file type. Describe a secure validation and storage design.'],
  ['scenario-3', 'text', 'Cybersecurity Scenario', 'An API returns another user\'s profile when the id is changed in the URL. Explain the vulnerability and the fix.'],
  ['scenario-4', 'text', 'Cybersecurity Scenario', 'A site stores a JWT in localStorage. Describe the risks and safer alternatives.'],
  ['scenario-5', 'text', 'Cybersecurity Scenario', 'A production error page displays stack traces and environment variables. Explain the impact and remediation.'],
  ['design-1', 'text', 'Secure Design', 'Design a secure admissions-results endpoint. Include authentication, authorization, validation, and audit logging.'],
  ['design-2', 'text', 'Secure Design', 'Design account recovery for a student portal without leaking whether an email address exists.'],
  ['design-3', 'text', 'Secure Design', 'Design role-based access control for candidates, graders, and administrators.'],
  ['design-4', 'text', 'Secure Design', 'Describe how you would protect API keys in a Node.js application.'],
  ['design-5', 'text', 'Secure Design', 'Describe a secure logging plan for integrity events and final interview reports.']
];

const codeQuestions = [
  ['code-1', 'Self Coding', 'Write a JavaScript function escapeHtml(input) that replaces &, <, >, ", and \' with HTML entities.'],
  ['code-2', 'Self Coding', 'Write a function isStrongPassword(pw) that requires at least 12 characters, uppercase, lowercase, digit, and symbol.'],
  ['code-3', 'Self Coding', 'Write a function uniqueSortedNumbers(values) that returns unique numbers sorted from lowest to highest.'],
  ['code-4', 'Self Coding', 'Write a function countWords(text) that returns an object where each lowercase word maps to its count.'],
  ['code-5', 'Self Coding', 'Write a function debounce(fn, delay) that delays calls until the user stops triggering it.'],
  ['code-6', 'Self Coding', 'Write a function validateEmail(email) that performs practical email validation without accepting spaces.'],
  ['code-7', 'Self Coding', 'Write a function groupByRole(users) that groups user objects by their role property.'],
  ['code-8', 'Self Coding', 'Write a function safeJsonParse(text, fallback) that returns fallback when parsing fails.'],
  ['code-9', 'Self Coding', 'Write a function redactSecrets(text) that replaces likely API keys or tokens with [REDACTED].'],
  ['code-10', 'Self Coding', 'Write a function formatDuration(seconds) that returns HH:MM:SS with leading zeroes.'],
  ['debug-1', 'Debugging', 'Fix the bug: function sum(nums){ let total; for (const n of nums) total += n; return total; }'],
  ['debug-2', 'Debugging', 'Fix the bug: const doubled = nums.forEach(n => n * 2);'],
  ['debug-3', 'Debugging', 'Fix the bug: if (user.role = "admin") { grantAccess(); }'],
  ['debug-4', 'Debugging', 'Fix the bug: fetch("/api/data").then(res => res.json).then(show);'],
  ['debug-5', 'Debugging', 'Fix the bug: document.querySelectorAll("button").addEventListener("click", handler);'],
  ['assist-1', 'Assisted Coding', 'Complete this function using the helper. const has = (re, s) => re.test(s); function hasDigit(value) { }'],
  ['assist-2', 'Assisted Coding', 'Complete this function. function clamp(value, min, max) { }'],
  ['assist-3', 'Assisted Coding', 'Complete this function. function csrfTokenFromMeta() { }'],
  ['assist-4', 'Assisted Coding', 'Complete this function. function normalizeName(name) { }'],
  ['assist-5', 'Assisted Coding', 'Complete this function. function buildQuery(params) { }']
];

const questions = [
  ...mcqQuestions.map(([id, area, prompt, choices, answer]) => ({ id, type: 'mcq', area, prompt, choices, answer })),
  ...writtenQuestions.map(([id, type, area, prompt]) => ({ id, type, area, prompt })),
  ...codeQuestions.map(([id, area, prompt]) => ({ id, type: 'code', area, prompt }))
];

function now() { return new Date().toISOString(); }
function publicQuestions() { return questions.map(({ answer, ...question }) => question); }
function scoreAnswer(question, value = '') {
  if (question.type === 'mcq') return value === question.answer ? 1 : 0;
  const text = String(value).toLowerCase();
  if (!text.trim()) return 0;
  const keywords = ['function', 'return', 'const', 'let', 'if', 'map', 'filter', 'reduce', 'replace', 'test', 'length', 'auth', 'valid', 'log', 'rate', 'least', 'generic', 'hash', 'token', 'cookie', 'csrf', 'sanitize'];
  return Math.min(1, keywords.filter(keyword => text.includes(keyword)).length / 4);
}
function send(res, code, payload, type = 'application/json') {
  res.writeHead(code, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  res.end(type === 'application/json' ? JSON.stringify(payload) : payload);
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { questionCount: questions.length, questions: publicQuestions(), notice: 'This is a timed technical interview. Integrity signals such as tab focus, visibility changes, paste events, and major window resizing are recorded for reviewer analysis.' });
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readBody(req);
    if (!body.name || !body.email) return send(res, 400, { error: 'name and email required' });
    const id = crypto.randomUUID();
    const session = { id, candidate: { name: String(body.name).slice(0, 80), email: String(body.email).slice(0, 120), role: String(body.role || '').slice(0, 80) }, startedAt: now(), submittedAt: null, answers: {}, events: [], score: null };
    sessions.set(id, session);
    return send(res, 200, { id, questionCount: questions.length, questions: publicQuestions() });
  }
  let match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (req.method === 'POST' && match) {
    const session = sessions.get(match[1]);
    if (!session) return send(res, 404, { error: 'not found' });
    const event = await readBody(req);
    session.events.push({ at: now(), type: String(event.type || 'unknown').slice(0, 50), detail: String(event.detail || '').slice(0, 300), severity: ['low', 'medium', 'high'].includes(event.severity) ? event.severity : 'low' });
    return send(res, 200, { ok: true });
  }
  match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/submit$/);
  if (req.method === 'POST' && match) {
    const session = sessions.get(match[1]);
    if (!session) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    session.answers = body.answers || {};
    const earned = questions.reduce((sum, question) => sum + scoreAnswer(question, session.answers[question.id]), 0);
    session.score = { earned, possible: questions.length, percent: Math.round((earned / questions.length) * 100) };
    session.submittedAt = now();
    return send(res, 200, { ok: true, score: session.score, message: 'Submission received. A reviewer will evaluate written answers, code answers, and integrity notes.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
    if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { sessions: [...sessions.values()].map(session => ({ ...session, integrity: { total: session.events.length, high: session.events.filter(event => event.severity === 'high').length } })) });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/token-hint') return send(res, 200, { message: 'Set ADMIN_TOKEN in the server environment. Development token is printed in the server console.' });
  const filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    const ext = path.extname(filePath);
    send(res, 200, data, ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html');
  });
}
function createServer() { return http.createServer(handler); }
if (require.main === module) createServer().listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Interview server ready. Admin bearer token: ${ADMIN_TOKEN}`));
module.exports = { createServer, questions, sessions, ADMIN_TOKEN };
