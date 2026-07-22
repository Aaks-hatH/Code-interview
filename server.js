const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const sessions = new Map();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(18).toString('hex');

const TRACKS = ['coding', 'cybersecurity'];
const DIFFICULTY_WEIGHT = { easy: 1, medium: 2, hard: 3 };

// How many high-severity integrity events a candidate can accumulate before
// their session is auto-flagged for mandatory human review. This does not
// block submission (a reviewer should always make the final call), it just
// guarantees a flagged session can never silently slip through as "approved".
const HIGH_SEVERITY_LOCK_THRESHOLD = 5;
// If the average time spent per question is below this, the submission is
// tagged as suspicious (near-instant completion is a strong signal of
// pre-written/copy-pasted answers rather than genuine work).
const MIN_SECONDS_PER_QUESTION = 20;
// A session left open far longer than a timed test should be is also logged.
const MAX_REASONABLE_SESSION_SECONDS = 3 * 60 * 60;

// ---------------------------------------------------------------------------
// Coding track question bank
// ---------------------------------------------------------------------------

const codingMcq = [
  ['c-mcq-html-1', 'HTML', 'easy', 'Which element represents the main heading of a page?', ['<h1>', '<head>', '<title>', '<section>'], '<h1>'],
  ['c-mcq-css-1', 'CSS', 'easy', 'Which property controls the space inside an element, between its content and its border?', ['padding', 'margin', 'outline', 'gap'], 'padding'],
  ['c-mcq-js-1', 'JavaScript', 'easy', 'Which method converts a JSON string into a JavaScript object?', ['JSON.parse', 'JSON.stringify', 'Object.fromEntries', 'String.raw'], 'JSON.parse'],
  ['c-mcq-py-1', 'Python', 'easy', 'Which keyword defines a function in Python?', ['def', 'func', 'function', 'lambda-only'], 'def'],
  ['c-mcq-css-2', 'CSS', 'medium', 'Given equal specificity, which of two conflicting rules wins?', ['The one declared last in source order', 'The one with the shorter selector', 'The one written in a <style> tag', 'The one using a class instead of an id'], 'The one declared last in source order'],
  ['c-mcq-js-2', 'JavaScript', 'medium', 'What does console.log(typeof NaN) print?', ['number', 'NaN', 'undefined', 'object'], 'number'],
  ['c-mcq-js-eq', 'JavaScript', 'medium', 'What is the key difference between == and === in JavaScript?', ['== allows type coercion before comparing; === requires both value and type to match', '=== only works on numbers, == works on any type', 'They behave identically in modern JavaScript', '== compares object references, === compares values'], '== allows type coercion before comparing; === requires both value and type to match'],
  ['c-mcq-py-2', 'Python', 'medium', 'What does `list(range(5))[-2:]` evaluate to?', ['[3, 4]', '[4]', '[2, 3]', '[3]'], '[3, 4]'],
  ['c-mcq-js-3', 'JavaScript', 'medium', 'Inside a for-loop written with `let`, what happens to the loop variable captured by a closure created each iteration?', ['Each iteration gets its own binding, so each closure remembers the value from its own iteration', 'All closures share one binding, so they all see the final value', 'let behaves identically to var inside loops', 'let cannot be used in a for-loop header'], 'Each iteration gets its own binding, so each closure remembers the value from its own iteration'],
  ['c-mcq-algo-1', 'Algorithms', 'medium', 'What is the average-case time complexity of looking up a key in a well-implemented hash map?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 'O(1)'],
  ['c-mcq-algo-2', 'Algorithms', 'medium', 'Merge sort repeatedly splits a list in half, sorts each half, then combines the results. What is this general technique called?', ['Divide and conquer', 'Dynamic programming', 'Greedy selection', 'Backtracking'], 'Divide and conquer'],
  ['c-mcq-js-4', 'JavaScript', 'hard', 'What does `this` refer to inside an arrow function, regardless of how that arrow function is later called?', ['Whatever `this` was in the surrounding scope where the arrow function was defined', 'The object the arrow function happens to be called on', 'undefined in all cases', 'The global object, always'], 'Whatever `this` was in the surrounding scope where the arrow function was defined'],
  ['c-mcq-js-5', 'JavaScript', 'hard', 'After the current script finishes, which runs first: a resolved Promise\'s .then callback, or a setTimeout(fn, 0) callback?', ['The Promise callback, because it is a microtask', 'The setTimeout callback, because it was scheduled first', 'They always run in the order they were written in the source', 'It is unspecified and differs between browsers'], 'The Promise callback, because it is a microtask'],
  ['c-mcq-py-3', 'Python', 'hard', 'Why does `def f(x, cache=[]):` surprise people the first time they see it?', ['The default list is created once, so it is silently shared and mutated across every call that relies on it', 'Python raises a SyntaxError for mutable default arguments', 'Lists are not allowed as default arguments at all', 'It causes a memory leak that eventually crashes the program'], 'The default list is created once, so it is silently shared and mutated across every call that relies on it'],
  ['c-mcq-js-6', 'JavaScript', 'hard', 'What does `[10, 2, 1].sort()` return by default in JavaScript?', ['[1, 10, 2], because sort() converts elements to strings and compares them lexicographically', '[1, 2, 10], because sort() compares numbers numerically by default', 'A TypeError, because no comparator function was provided', 'The array is left unchanged'], '[1, 10, 2], because sort() converts elements to strings and compares them lexicographically'],
  ['c-mcq-css-3', 'CSS', 'hard', 'Which selector wins: `#nav .item` or `.container .container .item`?', ['#nav .item, because a single id outweighs any number of class selectors', '.container .container .item, because it has more class selectors overall', 'They are exactly equal in specificity', 'Specificity cannot be compared across different selectors'], '#nav .item, because a single id outweighs any number of class selectors']
];

const codingTrueFalse = [
  ['c-tf-1', 'JavaScript', 'easy', 'True or false: Array.prototype.map mutates the original array.', false],
  ['c-tf-2', 'Python', 'medium', 'True or false: Python lists and tuples are both mutable.', false],
  ['c-tf-3', 'JavaScript', 'medium', 'True or false: Declaring an object with `const` prevents its properties from being changed.', false],
  ['c-tf-4', 'Python', 'hard', 'True or false: A shallow copy of a list containing nested lists still shares references to those nested lists with the original.', true],
  ['c-tf-5', 'Algorithms', 'medium', 'True or false: Quicksort has a worst-case time complexity of O(n log n).', false]
];

const codingMultiSelect = [
  ['c-ms-1', 'JavaScript', 'medium', 'Select all array methods that return a new array without mutating the original.', ['map', 'filter', 'sort', 'slice'], ['map', 'filter', 'slice']],
  ['c-ms-2', 'CSS', 'medium', 'Select all valid ways to center a block element horizontally.', ['margin: 0 auto with a set width', 'display: flex with justify-content: center', 'float: center', 'display: grid with place-items: center'], ['margin: 0 auto with a set width', 'display: flex with justify-content: center', 'display: grid with place-items: center']],
  ['c-ms-3', 'Python', 'hard', 'Select all statements that are true about Python generators.', ['They produce values lazily, one at a time', 'They store all values in memory up front like a list', 'They can be iterated only once (fully) without re-creating them', 'Using `yield` inside a function turns it into a generator function'], ['They produce values lazily, one at a time', 'They can be iterated only once (fully) without re-creating them', 'Using `yield` inside a function turns it into a generator function']]
];

const codingWritten = [
  ['c-design-1', 'text', 'System Design', 'hard', 'Design a rate limiter for a public API used by many different clients. Explain the algorithm you would use, what data it needs to track per client, and how it behaves when traffic suddenly bursts.'],
  ['c-design-2', 'text', 'System Design', 'medium', 'You need to paginate through 50 million rows efficiently. Compare offset-based pagination to keyset (cursor) pagination, and explain which you would choose and why.'],
  ['c-design-5', 'text', 'Debugging', 'medium', 'Describe your process for tracking down a bug that only shows up in production and will not reproduce locally.']
];

// Self-contained JavaScript functions, auto-graded against hidden test cases.
const codingCodeJS = [
  ['code-js-1', 'Self Coding (JS)', 'easy', 'Write a JavaScript function escapeHtml(input) that replaces &, <, >, ", and \' with HTML entities.'],
  ['code-js-2', 'Self Coding (JS)', 'medium', 'Write a function isStrongPassword(pw) that requires at least 12 characters, uppercase, lowercase, digit, and symbol.'],
  ['code-js-3', 'Self Coding (JS)', 'medium', 'Write a function groupByRole(users) that groups user objects by their role property.'],
  ['code-js-4', 'Algorithms (JS)', 'hard', 'Write a function twoSum(nums, target) that returns the indices of the two numbers in nums that add up to target, in O(n) time.'],
  ['code-js-5', 'Algorithms (JS)', 'hard', 'Write a function longestUniqueSubstring(s) that returns the length of the longest substring of s without repeating characters.'],
  ['code-js-6', 'Algorithms (JS)', 'hard', 'Write a function isValidParentheses(s) that returns true if every bracket in s ( (), [], {} ) is properly opened and closed in the correct order.'],
  ['code-js-7', 'Algorithms (JS)', 'hard', 'Write a function mergeIntervals(intervals) that merges all overlapping intervals and returns them sorted by start time. Each interval is [start, end].'],
  ['debug-js-1', 'Debugging (JS)', 'medium', 'Fix the bug: function sum(nums){ let total; for (const n of nums) total += n; return total; }'],
  ['debug-js-2', 'Debugging (JS)', 'medium', 'Fix the bug: if (user.role = "admin") { grantAccess(); }'],
  ['debug-js-3', 'Debugging (JS)', 'hard', 'Fix the bug: for (var i = 0; i < 3; i++) { setTimeout(() => console.log(i), 0); } // intended to log 0, 1, 2 but logs 3, 3, 3'],
  ['assist-js-1', 'Assisted Coding (JS)', 'easy', 'Complete this function using the helper. const has = (re, s) => re.test(s); function hasDigit(value) { }'],
  ['assist-js-2', 'Assisted Coding (JS)', 'medium', 'Complete this function. function clamp(value, min, max) { }']
];

// Self-contained Python functions, auto-graded by actually executing them
// with python3 when it is available on the host, with a heuristic fallback
// otherwise (see runPythonTests below).
const codingCodePython = [
  ['code-py-1', 'Self Coding (Python)', 'easy', 'Write a Python function is_palindrome(s) that returns True if s reads the same forwards and backwards, ignoring case and spaces.'],
  ['code-py-2', 'Self Coding (Python)', 'medium', 'Write a Python function flatten(nested) that flattens an arbitrarily nested list of lists into a single flat list.'],
  ['code-py-3', 'Self Coding (Python)', 'medium', 'Write a Python function most_common_word(text) that returns the most frequent lowercase word in text (ignore punctuation).'],
  ['code-py-4', 'Algorithms (Python)', 'hard', 'Write a Python function is_prime(n) that returns True if n is a prime number, and works efficiently for n up to 1,000,000.'],
  ['code-py-5', 'Algorithms (Python)', 'hard', 'Write a Python function anagram_groups(words) that groups words that are anagrams of each other, returning a list of lists (order of groups and words within a group does not matter for grading, but grading compares sorted output).']
];

// ---------------------------------------------------------------------------
// Cybersecurity track question bank. This track is entirely objective
// (multiple choice / true-false / select-all) -- no free-response written
// questions -- so it can be graded consistently and instantly. Questions
// favor real, practical judgment over obscure trivia.
// ---------------------------------------------------------------------------

const cyberMcq = [
  ['s-mcq-1', 'Cybersecurity', 'easy', 'Which cookie flag prevents JavaScript from reading a cookie\'s value?', ['HttpOnly', 'Secure', 'SameSite', 'Path'], 'HttpOnly'],
  ['s-mcq-2', 'Cybersecurity', 'easy', 'Which attack tricks a logged-in victim\'s browser into submitting an unwanted request to a site they\'re authenticated with?', ['CSRF', 'SQL indexing', 'Cache warming', 'DNS prefetching'], 'CSRF'],
  ['s-mcq-enum', 'Cybersecurity', 'easy', 'A password reset form always replies "If that email exists, we\'ve sent a link," no matter what. What is this design meant to prevent?', ['An attacker discovering which email addresses have accounts (user enumeration)', 'Cross-site scripting', 'SQL injection', 'Session fixation'], 'An attacker discovering which email addresses have accounts (user enumeration)'],
  ['s-mcq-3', 'Cybersecurity', 'medium', 'Which principle means giving a user or service only the access it actually needs, nothing more?', ['Least privilege', 'Open access', 'Security by obscurity', 'Global admin'], 'Least privilege'],
  ['s-mcq-4', 'Cybersecurity', 'medium', 'Which vulnerability results from placing untrusted input directly into a SQL string instead of using parameters?', ['SQL injection', 'Clickjacking', 'Race condition', 'Path compression'], 'SQL injection'],
  ['s-mcq-idor', 'Cybersecurity', 'medium', 'An API returns another user\'s private data when you change /profile?id=101 to /profile?id=102, with no check that the requester actually owns that record. What is this called?', ['Insecure Direct Object Reference (IDOR)', 'Cross-site scripting', 'Cross-site request forgery', 'DNS cache poisoning'], 'Insecure Direct Object Reference (IDOR)'],
  ['s-mcq-upload', 'Cybersecurity', 'medium', 'A feature lets users upload profile pictures. Which practice matters most for keeping it safe?', ['Validate the actual file content server-side and store uploads outside the web root with generated names, not user-supplied ones', 'Trust the file extension the browser reports', 'Rely on client-side JavaScript to check the file type', 'Only limit uploads to files under 50MB'], 'Validate the actual file content server-side and store uploads outside the web root with generated names, not user-supplied ones'],
  ['s-mcq-hsts', 'Cybersecurity', 'medium', 'What is the main purpose of HSTS (HTTP Strict Transport Security)?', ['It tells browsers to only ever use HTTPS for a domain, closing the window for SSL-stripping/downgrade attacks', 'It encrypts cookies at rest on the server', 'It prevents SQL injection', 'It replaces the need for a valid TLS certificate'], 'It tells browsers to only ever use HTTPS for a domain, closing the window for SSL-stripping/downgrade attacks'],
  ['s-mcq-zt', 'Cybersecurity', 'medium', 'What does the "Zero Trust" security model assume?', ['No user, device, or network location should be trusted automatically; every request is verified on its own merits', 'Traffic inside the corporate network is always safe', 'A VPN connection is enough authorization for internal resources', 'Trust should persist permanently once a user logs in once'], 'No user, device, or network location should be trusted automatically; every request is verified on its own merits'],
  ['s-mcq-stride', 'Cybersecurity', 'medium', 'STRIDE is a common threat-modeling framework. Which of these is NOT one of its six categories?', ['Obfuscation', 'Spoofing', 'Repudiation', 'Elevation of Privilege'], 'Obfuscation'],
  ['s-mcq-mass', 'Cybersecurity', 'medium', 'A signup endpoint binds every field from the incoming JSON body directly onto the User model, including one the client should never control. What is this vulnerability called?', ['Mass assignment', 'Clickjacking', 'A cross-site scripting payload', 'Excessive database connections'], 'Mass assignment'],
  ['s-mcq-argon', 'Cybersecurity', 'medium', 'Why is Argon2 preferred over a fast general-purpose hash like unsalted SHA-256 for storing passwords?', ['It is deliberately slow and memory-hard, making large-scale offline cracking far more expensive', 'It produces a shorter output, saving database space', 'It is reversible with a secret key', 'It removes the need for per-user salts entirely'], 'It is deliberately slow and memory-hard, making large-scale offline cracking far more expensive'],
  ['s-mcq-5', 'Cybersecurity', 'hard', 'A JWT verifier reads the "alg" field from the token itself and uses whatever it says to pick the verification method, including "none". What does this let an attacker do?', ['Forge a token that declares itself unsigned and have the server accept it as valid anyway', 'Cause excessive token size and a denial of service', 'Read cookies that lack the Secure flag', 'Force the token to expire early'], 'Forge a token that declares itself unsigned and have the server accept it as valid anyway'],
  ['s-mcq-6', 'Cybersecurity', 'hard', 'A server accepts a user-supplied URL and fetches it server-side to build a link preview, with no restriction on where that URL can point. What is the primary risk?', ['Server-Side Request Forgery (SSRF) reaching internal-only services, like a cloud metadata endpoint', 'Cross-site scripting in the response body', 'Clickjacking of the preview widget', 'CSRF against the preview endpoint'], 'Server-Side Request Forgery (SSRF) reaching internal-only services, like a cloud metadata endpoint'],
  ['s-mcq-7', 'Cybersecurity', 'hard', 'An XML parser has external entity resolution turned on and parses XML supplied by users. What attack does this open the door to?', ['XML External Entity (XXE) injection, which can leak local files or trigger SSRF', 'Cross-site request forgery', 'Clickjacking', 'Session fixation'], 'XML External Entity (XXE) injection, which can leak local files or trigger SSRF'],
  ['s-mcq-8', 'Cybersecurity', 'hard', 'What is the real danger of deserializing attacker-controlled data using a language-native format like Java serialization or Python pickle?', ['It can lead to arbitrary code execution during deserialization, not just corrupted data', 'It only risks type confusion, never code execution', 'It is safe as long as the connection uses TLS', 'It only affects performance, not security'], 'It can lead to arbitrary code execution during deserialization, not just corrupted data'],
  ['s-mcq-9', 'Cybersecurity', 'hard', 'Code checks that a file does not exist, then creates it a moment later, and an attacker manages to act in between those two steps. What is this vulnerability class called?', ['A time-of-check to time-of-use (TOCTOU) race condition', 'Cross-site scripting', 'Clickjacking', 'A man-in-the-middle downgrade'], 'A time-of-check to time-of-use (TOCTOU) race condition'],
  ['s-mcq-10', 'Cybersecurity', 'hard', 'Which block cipher mode is classically vulnerable to padding oracle attacks, when error messages reveal whether padding was valid?', ['CBC, when a verbose error message distinguishes padding failures from other failures', 'CTR mode', 'GCM, when authentication is checked before decryption', 'ECB with no padding scheme at all'], 'CBC, when a verbose error message distinguishes padding failures from other failures'],
  ['s-mcq-11', 'Cybersecurity', 'hard', 'What happens if the same nonce is reused with the same key in AES-GCM across two different messages?', ['Both confidentiality and the authentication guarantee for those messages can be broken', 'Confidentiality weakens slightly but authentication is unaffected', 'Nothing, as long as the key itself is strong', 'It only matters for CBC mode, never for GCM'], 'Both confidentiality and the authentication guarantee for those messages can be broken'],
  ['s-mcq-12', 'Cybersecurity', 'hard', 'What is the key difference between an HMAC and a digital signature?', ['HMAC uses one shared secret, so anyone who can verify it can also forge it; a signature uses a private/public keypair, so verifiers cannot forge it', 'HMAC is always cryptographically weaker than a signature', 'A signature can only provide confidentiality, not integrity', 'They are cryptographically identical constructs'], 'HMAC uses one shared secret, so anyone who can verify it can also forge it; a signature uses a private/public keypair, so verifiers cannot forge it'],
  ['s-mcq-15', 'Cybersecurity', 'hard', 'Server-Side Template Injection (SSTI) most often happens when...', ['Untrusted user input is concatenated directly into a template string that the template engine then renders or evaluates', 'A CSS file references an external font', 'A cookie is missing the Secure flag', 'An HTML comment contains a version number'], 'Untrusted user input is concatenated directly into a template string that the template engine then renders or evaluates'],
  ['s-mcq-timing', 'Cybersecurity', 'hard', 'A login check compares a supplied token to the real one byte-by-byte and stops as soon as it finds a mismatch. Why is this risky?', ['An attacker can measure tiny response-time differences to infer the correct token one byte at a time', 'It uses too much CPU per request', 'It leaks the token directly in the HTTP response', 'It is only a problem for GET requests, never POST'], 'An attacker can measure tiny response-time differences to infer the correct token one byte at a time'],
  ['s-mcq-ir', 'Cybersecurity', 'hard', 'Monitoring shows mass file renames and ransom notes appearing across a file server in the last few minutes. What should happen first?', ['Contain the incident by isolating the affected systems from the network before anything else', 'Immediately restore all files from the most recent backup', 'Email every employee a detailed description of the attack', 'Wait for the next scheduled maintenance window to investigate'], 'Contain the incident by isolating the affected systems from the network before anything else']
];

const cyberTrueFalse = [
  ['s-tf-1', 'Cybersecurity', 'easy', 'True or false: Client-side validation alone is enough to protect an API endpoint.', false],
  ['s-tf-2', 'Cybersecurity', 'easy', 'True or false: Storing a session token in an HttpOnly cookie prevents it from being read by JavaScript.', true],
  ['s-tf-3', 'Cybersecurity', 'medium', 'True or false: bcrypt has a well-known effective input limit of around 72 bytes, after which extra characters are ignored.', true],
  ['s-tf-4', 'Cybersecurity', 'medium', 'True or false: A cookie set with SameSite=Strict is still sent when a user clicks a link on another site that navigates to yours.', false],
  ['s-tf-5', 'Cybersecurity', 'medium', 'True or false: A Web Application Firewall (WAF) alone is a complete defense against every form of injection attack.', false],
  ['s-tf-6', 'Cybersecurity', 'medium', 'True or false: Mutual TLS (mTLS) authenticates both the client and the server to each other using certificates.', true],
  ['s-tf-7', 'Cybersecurity', 'hard', 'True or false: Certificate Transparency logs make it possible to publicly detect certificates that were mis-issued for a domain.', true]
];

const cyberMultiSelect = [
  ['s-ms-1', 'Cybersecurity', 'medium', 'Select all practices that help prevent SQL injection.', ['Parameterized queries', 'Least-privilege database accounts', 'Storing passwords as plain text', 'Input validation'], ['Parameterized queries', 'Least-privilege database accounts', 'Input validation']],
  ['s-ms-2', 'Cybersecurity', 'medium', 'Select all mitigations that meaningfully reduce SSRF risk.', ['Allowlisting permitted outbound destinations', 'Blocking the app from reaching internal metadata/link-local addresses', 'Trusting any URL the client supplies', 'Resolving and validating DNS/IP before making the request'], ['Allowlisting permitted outbound destinations', 'Blocking the app from reaching internal metadata/link-local addresses', 'Resolving and validating DNS/IP before making the request']],
  ['s-ms-3', 'Cybersecurity', 'medium', 'Select all properties a secure password hashing scheme should have.', ['Deliberately slow / computationally expensive', 'Uses a unique per-user random salt', 'Reversible with a secret key so the plaintext can be recovered', 'Memory-hard, to resist GPU/ASIC cracking'], ['Deliberately slow / computationally expensive', 'Uses a unique per-user random salt', 'Memory-hard, to resist GPU/ASIC cracking']],
  ['s-ms-4', 'Cybersecurity', 'hard', 'Select all indicators consistent with an active ransomware incident.', ['Mass renaming of files with a new, unfamiliar extension', 'Ransom note files suddenly appearing in many folders', 'A single employee\u2019s badge photo being slightly blurry', 'Shadow copy / backup deletion commands in recent process history'], ['Mass renaming of files with a new, unfamiliar extension', 'Ransom note files suddenly appearing in many folders', 'Shadow copy / backup deletion commands in recent process history']]
];

// ---------------------------------------------------------------------------
// Assemble the full question set
// ---------------------------------------------------------------------------

const questions = [
  ...codingMcq.map(([id, area, difficulty, prompt, choices, answer]) => ({ id, type: 'mcq', track: 'coding', area, difficulty, prompt, choices, answer })),
  ...codingTrueFalse.map(([id, area, difficulty, prompt, answer]) => ({ id, type: 'true-false', track: 'coding', area, difficulty, prompt, choices: ['True', 'False'], answer: answer ? 'True' : 'False' })),
  ...codingMultiSelect.map(([id, area, difficulty, prompt, choices, answer]) => ({ id, type: 'multi-select', track: 'coding', area, difficulty, prompt, choices, answer })),
  ...codingWritten.map(([id, type, area, difficulty, prompt]) => ({ id, type, track: 'coding', area, difficulty, prompt })),
  ...codingCodeJS.map(([id, area, difficulty, prompt]) => ({ id, type: 'code', track: 'coding', area, difficulty, prompt, language: 'javascript' })),
  ...codingCodePython.map(([id, area, difficulty, prompt]) => ({ id, type: 'code', track: 'coding', area, difficulty, prompt, language: 'python' })),

  ...cyberMcq.map(([id, area, difficulty, prompt, choices, answer]) => ({ id, type: 'mcq', track: 'cybersecurity', area, difficulty, prompt, choices, answer })),
  ...cyberTrueFalse.map(([id, area, difficulty, prompt, answer]) => ({ id, type: 'true-false', track: 'cybersecurity', area, difficulty, prompt, choices: ['True', 'False'], answer: answer ? 'True' : 'False' })),
  ...cyberMultiSelect.map(([id, area, difficulty, prompt, choices, answer]) => ({ id, type: 'multi-select', track: 'cybersecurity', area, difficulty, prompt, choices, answer }))
];
const questionsById = new Map(questions.map(question => [question.id, question]));

// ---------------------------------------------------------------------------
// Hidden auto-grading test cases
// ---------------------------------------------------------------------------

const codeTestCasesJS = {
  'code-js-1': { fn: 'escapeHtml', cases: [
    { args: ['<b>"hi" & \'bye\'</b>'], expected: '&lt;b&gt;&quot;hi&quot; &amp; &#39;bye&#39;&lt;/b&gt;' },
    { args: ['plain text'], expected: 'plain text' }
  ]},
  'code-js-2': { fn: 'isStrongPassword', cases: [
    { args: ['Sup3r$ecureNow'], expected: true },
    { args: ['weakpass'], expected: false }
  ]},
  'code-js-3': { fn: 'groupByRole', cases: [
    { args: [[{ role: 'admin', id: 1 }, { role: 'user', id: 2 }, { role: 'admin', id: 3 }]], expected: { admin: [{ role: 'admin', id: 1 }, { role: 'admin', id: 3 }], user: [{ role: 'user', id: 2 }] } }
  ]},
  'code-js-4': { fn: 'twoSum', cases: [
    { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { args: [[3, 2, 4], 6], expected: [1, 2] }
  ]},
  'code-js-5': { fn: 'longestUniqueSubstring', cases: [
    { args: ['abcabcbb'], expected: 3 },
    { args: ['bbbbb'], expected: 1 },
    { args: ['pwwkew'], expected: 3 }
  ]},
  'code-js-6': { fn: 'isValidParentheses', cases: [
    { args: ['()[]{}'], expected: true },
    { args: ['(]'], expected: false },
    { args: ['([)]'], expected: false }
  ]},
  'code-js-7': { fn: 'mergeIntervals', cases: [
    { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
    { args: [[[1, 4], [4, 5]]], expected: [[1, 5]] }
  ]}
};

const codeTestCasesPython = {
  'code-py-1': { fn: 'is_palindrome', cases: [
    { args: ['Never Odd Or Even'], expected: true },
    { args: ['hello'], expected: false }
  ]},
  'code-py-2': { fn: 'flatten', cases: [
    { args: [[1, [2, 3, [4, [5]]], 6]], expected: [1, 2, 3, 4, 5, 6] },
    { args: [[[1], [2], [3]]], expected: [1, 2, 3] }
  ]},
  'code-py-3': { fn: 'most_common_word', cases: [
    { args: ['the cat sat on the mat. The mat was flat.'], expected: 'the' }
  ]},
  'code-py-4': { fn: 'is_prime', cases: [
    { args: [97], expected: true },
    { args: [100], expected: false },
    { args: [999983], expected: true }
  ]},
  'code-py-5': { fn: 'anagram_groups', cases: [
    { args: [['eat', 'tea', 'tan', 'ate', 'nat', 'bat']], expectedSortedGroups: [['ate', 'eat', 'tea'], ['bat'], ['nat', 'tan']] }
  ]}
};

// Detect once at startup whether python3 is on PATH. If it is not, Python
// code answers fall back to the same keyword heuristic used for written
// answers (see scoreAnswer) rather than silently awarding zero credit.
let pythonAvailable = false;
try {
  const probe = spawnSync('python3', ['--version'], { timeout: 2000 });
  pythonAvailable = !probe.error && probe.status === 0;
} catch {
  pythonAvailable = false;
}

// NOTE: node:vm is not a hard security sandbox (it shares the process and
// can still reach globals via constructor tricks). It's fine here because
// the grader only ever runs it against candidate answers for scoring on a
// trusted server, with a short timeout. Don't reuse this for arbitrary
// untrusted code execution without a real sandbox (container/isolate/worker
// with resource limits).
function runJavaScriptTests(id, code) {
  const suite = codeTestCasesJS[id];
  if (!suite) return null;
  const results = suite.cases.map(testCase => {
    try {
      const context = {};
      vm.createContext(context);
      const script = `${code}\n;(typeof ${suite.fn} === 'function') ? ${suite.fn} : undefined;`;
      const fn = vm.runInContext(script, context, { timeout: 300 });
      if (typeof fn !== 'function') return { args: testCase.args, expected: testCase.expected, pass: false, error: `Function "${suite.fn}" was not found` };
      const actual = fn(...testCase.args.map(arg => JSON.parse(JSON.stringify(arg))));
      return { args: testCase.args, expected: testCase.expected, actual, pass: JSON.stringify(actual) === JSON.stringify(testCase.expected) };
    } catch (err) {
      return { args: testCase.args, expected: testCase.expected, pass: false, error: String(err && err.message || err) };
    }
  });
  return { fn: suite.fn, passed: results.filter(r => r.pass).length, total: results.length, results };
}

// Runs candidate Python source in a short-lived python3 subprocess per test
// case (process isolation, hard timeout, no shared state between cases).
// This still assumes python3 itself is a trusted local interpreter, exactly
// like the vm caveat above for JS -- it is a grading convenience, not a
// hardened untrusted-code sandbox.
function runPythonTests(id, code) {
  const suite = codeTestCasesPython[id];
  if (!suite || !pythonAvailable) return null;
  const results = suite.cases.map(testCase => {
    const argsJson = JSON.stringify(testCase.args).replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    const harness = [
      'import json, sys',
      code,
      `_args = json.loads(${JSON.stringify(JSON.stringify(testCase.args))})`,
      `_result = ${suite.fn}(*_args)`,
      'print(json.dumps(_result))'
    ].join('\n');
    try {
      const proc = spawnSync('python3', ['-c', harness], { timeout: 3000, encoding: 'utf8' });
      if (proc.error) return { args: testCase.args, expected: testCase.expected, pass: false, error: String(proc.error.message || proc.error) };
      if (proc.status !== 0) return { args: testCase.args, expected: testCase.expected, pass: false, error: (proc.stderr || 'python process exited non-zero').trim().split('\n').slice(-1)[0] };
      let actual;
      try { actual = JSON.parse((proc.stdout || '').trim()); } catch { return { args: testCase.args, expected: testCase.expected, pass: false, error: 'output was not valid JSON' }; }
      if (testCase.expectedSortedGroups) {
        const normalize = groups => (Array.isArray(groups) ? groups.map(g => [...g].sort()).sort((a, b) => a.join(',').localeCompare(b.join(','))) : groups);
        const pass = JSON.stringify(normalize(actual)) === JSON.stringify(normalize(testCase.expectedSortedGroups));
        return { args: testCase.args, expected: testCase.expectedSortedGroups, actual, pass };
      }
      return { args: testCase.args, expected: testCase.expected, actual, pass: JSON.stringify(actual) === JSON.stringify(testCase.expected) };
    } catch (err) {
      return { args: testCase.args, expected: testCase.expected, pass: false, error: String(err && err.message || err) };
    }
  });
  return { fn: suite.fn, passed: results.filter(r => r.pass).length, total: results.length, results };
}

function runCodeTests(id, code, language) {
  const question = questionsById.get(id);
  const lang = language || (question && question.language);
  if (lang === 'python') return runPythonTests(id, code);
  return runJavaScriptTests(id, code);
}

function now() { return new Date().toISOString(); }
function stripAnswer({ answer, ...question }) { return question; }
function publicQuestions(list = questions) { return list.map(stripAnswer); }

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Picks up to `counts.easy` / `counts.medium` / `counts.hard` items from
// `list`, at random within each difficulty tier, and returns them combined
// and shuffled. This is how the test is deliberately weighted toward hard
// questions while still including a handful of easy ones.
function pickByDifficultyMix(list, counts) {
  const byDifficulty = { easy: [], medium: [], hard: [] };
  for (const item of list) (byDifficulty[item.difficulty] ||= []).push(item);
  const picked = [];
  for (const tier of ['easy', 'medium', 'hard']) {
    const want = counts[tier] || 0;
    picked.push(...shuffle(byDifficulty[tier]).slice(0, Math.min(want, byDifficulty[tier].length)));
  }
  return picked;
}

// Builds a fresh, randomized, track-specific question set per candidate so
// different sessions get a varied mix instead of the exact same fixed test,
// and so a "coding" candidate never sees cybersecurity-only content or
// vice versa.
function buildSessionQuestionSet(track) {
  const pool = questions.filter(question => question.track === track);

  if (track === 'coding') {
    // Most of the test is multiple-choice / true-false. A small remainder is
    // free response: a couple of short written prompts, plus a handful of
    // actual code-writing exercises (the "written" part of a coding test).
    const mcq = pickByDifficultyMix(pool.filter(q => q.type === 'mcq'), { easy: 2, medium: 3, hard: 4 });
    const trueFalse = pickByDifficultyMix(pool.filter(q => q.type === 'true-false'), { easy: 1, medium: 2, hard: 1 });
    const multiSelect = pickByDifficultyMix(pool.filter(q => q.type === 'multi-select'), { easy: 0, medium: 1, hard: 1 });
    const written = pickByDifficultyMix(pool.filter(q => q.type === 'text'), { easy: 0, medium: 1, hard: 1 });
    const jsCode = pool.filter(q => q.type === 'code' && q.language === 'javascript');
    const pyCode = pool.filter(q => q.type === 'code' && q.language === 'python');
    const codePicks = [
      ...pickByDifficultyMix(jsCode.filter(q => q.area.startsWith('Self Coding')), { easy: 1, medium: 0, hard: 0 }),
      ...pickByDifficultyMix(jsCode.filter(q => q.area.startsWith('Algorithms')), { easy: 0, medium: 0, hard: 1 }),
      ...pickByDifficultyMix(jsCode.filter(q => q.area.startsWith('Debugging')), { easy: 0, medium: 1, hard: 1 }),
      ...pickByDifficultyMix(pyCode, { easy: 1, medium: 1, hard: 0 })
    ];
    return shuffle([...mcq, ...trueFalse, ...multiSelect, ...written, ...codePicks]);
  }

  // Cybersecurity track: entirely multiple-choice / true-false / select-all,
  // no free-response questions at all, so every answer is graded instantly
  // and consistently.
  const mcq = pickByDifficultyMix(pool.filter(q => q.type === 'mcq'), { easy: 3, medium: 5, hard: 6 });
  const trueFalse = pickByDifficultyMix(pool.filter(q => q.type === 'true-false'), { easy: 2, medium: 3, hard: 1 });
  const multiSelect = pickByDifficultyMix(pool.filter(q => q.type === 'multi-select'), { easy: 0, medium: 2, hard: 1 });
  return shuffle([...mcq, ...trueFalse, ...multiSelect]);
}

// Only coding's handful of written prompts (rate limiter design, pagination,
// production debugging) still fall back to this heuristic -- cybersecurity
// has no free-response questions left, so it never needs it.
const KEYWORD_HEURISTIC = ['function', 'def ', 'return', 'const', 'let', 'if', 'map', 'filter', 'reduce', 'replace', 'test', 'length',
  'rate limit', 'token bucket', 'sliding window', 'burst', 'cursor', 'pagination', 'offset', 'index',
  'log', 'monitor', 'reproduce', 'staging', 'debug'];

function scoreAnswer(question, value = '') {
  if (question.type === 'mcq' || question.type === 'true-false') return value === question.answer ? 1 : 0;
  if (question.type === 'multi-select') {
    const chosen = new Set(Array.isArray(value) ? value : String(value || '').split(',').map(v => v.trim()).filter(Boolean));
    const correct = new Set(question.answer);
    if (chosen.size !== correct.size) return 0;
    for (const item of chosen) if (!correct.has(item)) return 0;
    return 1;
  }
  if (question.type === 'code') {
    const auto = runCodeTests(question.id, String(value || ''), question.language);
    if (auto) return auto.total ? auto.passed / auto.total : 0;
    // No auto-grader available (e.g. python3 missing on host) -- fall through
    // to the same keyword heuristic used for written answers below.
  }
  const text = String(value).toLowerCase();
  if (!text.trim()) return 0;
  return Math.min(1, KEYWORD_HEURISTIC.filter(keyword => text.includes(keyword)).length / 4);
}

function weightFor(question) { return DIFFICULTY_WEIGHT[question.difficulty] || 1; }

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

function recordEvent(session, event) {
  const entry = { at: now(), type: String(event.type || 'unknown').slice(0, 50), detail: String(event.detail || '').slice(0, 300), severity: ['low', 'medium', 'high'].includes(event.severity) ? event.severity : 'low' };
  session.events.push(entry);
  if (entry.severity === 'high' && session.events.filter(e => e.severity === 'high').length >= HIGH_SEVERITY_LOCK_THRESHOLD) {
    session.autoFlagged = true;
  }
  return entry;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return send(res, 200, {
      questionPoolSize: questions.length,
      tracks: TRACKS.map(track => ({
        id: track,
        label: track === 'coding' ? 'Software Coding' : 'Cybersecurity',
        poolSize: questions.filter(q => q.track === track).length
      })),
      notice: 'This is a timed, proctored technical interview. Choose one track below. Please complete it yourself, without outside assistance, and answer honestly. This session is monitored for tab switches, window focus loss, copy/paste, fullscreen exits, and other integrity signals, and is reviewed by a human before any result is finalized.'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readBody(req);
    if (!body.name || !body.email) return send(res, 400, { error: 'name and email required' });
    if (!TRACKS.includes(body.track)) return send(res, 400, { error: `track must be one of: ${TRACKS.join(', ')}` });
    // Honeypot: a hidden field the real UI never fills. If populated, this
    // is either an automated script or a candidate poking at hidden form
    // internals -- either way it is a strong integrity signal.
    const honeypotTriggeredAtStart = Boolean(body.website);
    const id = crypto.randomUUID();
    const sessionQuestions = buildSessionQuestionSet(body.track);
    const session = {
      id,
      track: body.track,
      candidate: { name: String(body.name).slice(0, 80), email: String(body.email).slice(0, 120), role: String(body.role || '').slice(0, 80) },
      startedAt: now(),
      startedAtMs: Date.now(),
      submittedAt: null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      questionIds: sessionQuestions.map(question => question.id),
      answers: {},
      events: [],
      autoFlagged: false,
      score: null,
      breakdown: null,
      timing: null,
      review: { status: 'pending', notes: '', reviewer: null, updatedAt: null }
    };
    if (honeypotTriggeredAtStart) recordEvent(session, { type: 'honeypot-triggered', detail: 'Hidden field populated at session start', severity: 'high' });
    sessions.set(id, session);
    return send(res, 200, { id, track: session.track, questionCount: sessionQuestions.length, questions: publicQuestions(sessionQuestions) });
  }

  let match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (req.method === 'POST' && match) {
    const session = sessions.get(match[1]);
    if (!session) return send(res, 404, { error: 'not found' });
    const event = await readBody(req);
    const currentUA = String(req.headers['user-agent'] || '').slice(0, 300);
    if (session.userAgent && currentUA && currentUA !== session.userAgent && !session.uaMismatchLogged) {
      session.uaMismatchLogged = true;
      recordEvent(session, { type: 'user-agent-mismatch', detail: 'Requests arrived from a different user agent than session start', severity: 'high' });
    }
    recordEvent(session, event);
    return send(res, 200, { ok: true, locked: session.autoFlagged });
  }

  match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/submit$/);
  if (req.method === 'POST' && match) {
    const session = sessions.get(match[1]);
    if (!session) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (body.website) recordEvent(session, { type: 'honeypot-triggered', detail: 'Hidden field populated at submission', severity: 'high' });
    session.answers = body.answers || {};
    const sessionQuestions = session.questionIds.map(id => questionsById.get(id)).filter(Boolean);

    const elapsedSeconds = (Date.now() - session.startedAtMs) / 1000;
    const secondsPerQuestion = sessionQuestions.length ? elapsedSeconds / sessionQuestions.length : elapsedSeconds;
    if (secondsPerQuestion < MIN_SECONDS_PER_QUESTION) {
      recordEvent(session, { type: 'suspiciously-fast-completion', detail: `Averaged ${secondsPerQuestion.toFixed(1)}s per question`, severity: 'high' });
    }
    if (elapsedSeconds > MAX_REASONABLE_SESSION_SECONDS) {
      recordEvent(session, { type: 'excessive-duration', detail: `Session open for ${Math.round(elapsedSeconds / 60)} minutes`, severity: 'medium' });
    }

    // Admin-facing breakdown: includes the question prompt, the candidate's
    // raw answer, and the correct answer (where one exists) so a reviewer
    // never has to cross-reference the question bank by hand.
    session.breakdown = sessionQuestions.map(question => {
      const value = session.answers[question.id];
      const points = scoreAnswer(question, value);
      const auto = question.type === 'code' ? runCodeTests(question.id, String(value || ''), question.language) : null;
      return {
        id: question.id,
        type: question.type,
        area: question.area,
        difficulty: question.difficulty,
        weight: weightFor(question),
        points,
        auto,
        prompt: question.prompt,
        answerGiven: value === undefined ? null : value,
        correctAnswer: question.answer === undefined ? null : question.answer
      };
    });
    const earned = session.breakdown.reduce((sum, item) => sum + item.points * item.weight, 0);
    const possible = session.breakdown.reduce((sum, item) => sum + item.weight, 0);
    session.score = { earned: Math.round(earned * 100) / 100, possible, percent: possible ? Math.round((earned / possible) * 100) : 0 };
    session.submittedAt = now();
    // Timing analytics kept for the admin dashboard only -- never sent to
    // the candidate.
    session.timing = {
      elapsedSeconds: Math.round(elapsedSeconds),
      secondsPerQuestion: Math.round(secondsPerQuestion * 10) / 10,
      questionCount: sessionQuestions.length
    };
    session.review = { status: session.autoFlagged ? 'flagged' : 'pending', notes: session.autoFlagged ? 'Auto-flagged: repeated high-severity integrity events during the session.' : '', reviewer: null, updatedAt: now() };

    // Intentionally minimal candidate-facing response: no score, no
    // integrity/flag counts, no breakdown, no events. Candidates only ever
    // learn that their submission was received; everything else is for the
    // admin/reviewer view only.
    return send(res, 200, {
      ok: true,
      submitted: true,
      submittedAt: session.submittedAt,
      message: 'Submission received. Thank you for completing the assessment -- a reviewer will follow up with next steps.'
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
    if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, {
      sessions: [...sessions.values()].map(session => {
        const severityCounts = { low: 0, medium: 0, high: 0 };
        const eventTypeCounts = {};
        for (const event of session.events) {
          severityCounts[event.severity] = (severityCounts[event.severity] || 0) + 1;
          eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
        }
        return {
          ...session,
          integrity: {
            total: session.events.length,
            high: severityCounts.high,
            medium: severityCounts.medium,
            low: severityCounts.low,
            autoFlagged: session.autoFlagged,
            eventTypeCounts
          }
        };
      })
    });
  }

  match = url.pathname.match(/^\/api\/admin\/sessions\/([^/]+)\/review$/);
  if (req.method === 'POST' && match) {
    if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    const session = sessions.get(match[1]);
    if (!session) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const status = ['pending', 'approved', 'flagged', 'rejected'].includes(body.status) ? body.status : session.review.status;
    session.review = { status, notes: String(body.notes || '').slice(0, 2000), reviewer: String(body.reviewer || '').slice(0, 80), updatedAt: now() };
    return send(res, 200, { ok: true, review: session.review });
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
module.exports = { createServer, questions, sessions, ADMIN_TOKEN, TRACKS, buildSessionQuestionSet, runCodeTests, scoreAnswer, pythonAvailable };
