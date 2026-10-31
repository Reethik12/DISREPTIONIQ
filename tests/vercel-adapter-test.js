'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const handler = require('../api/index');
const { extractOriginalUrl } = require('../api/index');

function createMockReq({ method = 'GET', url = '/', headers = {}, body = null }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'disreptioniq.vercel.app', ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.destroy = () => {};
  
  process.nextTick(() => {
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.emit('data', Buffer.from(payload));
    }
    req.emit('end');
  });

  return req;
}

function createMockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.headersSent = false;
  let bodyChunks = [];

  res.writeHead = (status, headers = {}) => {
    res.statusCode = status;
    res.headers = { ...res.headers, ...headers };
    res.headersSent = true;
    return res;
  };

  res.setHeader = (key, val) => {
    res.headers[key.toLowerCase()] = val;
  };

  res.getHeader = (key) => res.headers[key.toLowerCase()];

  res.write = (chunk) => {
    if (chunk) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };

  res.end = (chunk) => {
    if (chunk) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    res.body = Buffer.concat(bodyChunks).toString('utf8');
    res.emit('finish');
    return res;
  };

  res.destroy = () => {};

  return res;
}

async function invoke(options) {
  return new Promise((resolve, reject) => {
    const req = createMockReq(options);
    const res = createMockRes();
    res.on('finish', () => resolve(res));
    res.on('error', reject);
    handler(req, res).catch(reject);
  });
}

(async () => {
  console.log('--- Testing Vercel URL Resolution ---');

  // Test 1: extractOriginalUrl with :path* rewrite parameter
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/login', headers: {} }), '/login');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/', headers: {} }), '/');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/health', headers: {} }), '/health');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/css/styles.css', headers: {} }), '/css/styles.css');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/api/v1/hubs&page=2&limit=10', headers: {} }), '/api/v1/hubs?page=2&limit=10');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/login/', headers: {} }), '/login');

  // Test 2: Fallback when __path is unreplaced $1 or :path*
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=$1', headers: { 'x-matched-path': '/login' } }), '/login');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?__path=/:path*', headers: { 'x-now-route-matches': 'path=login' } }), '/login');
  assert.equal(extractOriginalUrl({ url: '/api/index.js', headers: { 'x-now-route-matches': '1=health' } }), '/health');
  assert.equal(extractOriginalUrl({ url: '/api/index.js?days=7', headers: { 'x-matched-path': '/api/v1/dashboard' } }), '/api/v1/dashboard?days=7');
  console.log('PASS URL resolution tests');

  console.log('--- Testing Vercel Handler Endpoints ---');

  // Test 3: GET /login via Vercel rewrite
  let res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/login',
    headers: { 'x-matched-path': '/login' }
  });
  assert.equal(res.statusCode, 200, 'GET /login must return 200 OK');
  assert.match(res.headers['Content-Type'], /text\/html/, 'Must return HTML content');
  assert.match(res.body, /Sign in to/i, 'Must contain login text');
  assert.doesNotMatch(res.body, /Authentication required/i, 'Must not require authentication');
  assert.notEqual(res.headers['Location'], '/login', 'Must not redirect to itself');
  console.log('PASS GET /login serves HTML login page without authentication');

  // Test 4: GET / via Vercel rewrite -> redirect to /login
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/',
    headers: { 'x-matched-path': '/' }
  });
  assert.equal(res.statusCode, 302, 'GET / must redirect');
  assert.equal(res.headers['Location'], '/login', 'GET / must redirect to /login');
  console.log('PASS GET / redirects to /login');

  // Test 5: GET /health via Vercel rewrite
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/health',
    headers: { 'x-matched-path': '/health' }
  });
  assert.equal(res.statusCode, 200, 'GET /health must return 200 OK');
  const healthJson = JSON.parse(res.body);
  assert.equal(healthJson.ok, true, 'Health check ok must be true');
  assert.equal(healthJson.service, 'DisruptionIQ Node API');
  console.log('PASS GET /health returns HTTP 200 JSON');

  // Test 6: GET /css/styles.css
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/css/styles.css',
    headers: { 'x-matched-path': '/css/styles.css' }
  });
  assert.equal(res.statusCode, 200, 'GET /css/styles.css must return 200 OK');
  assert.match(res.headers['Content-Type'], /text\/css/, 'Must return CSS content type');
  assert.ok(res.body.length > 50, 'CSS content must be non-empty');
  console.log('PASS GET /css/styles.css returns CSS content');

  // Test 7: GET /js/login.js
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/js/login.js',
    headers: { 'x-matched-path': '/js/login.js' }
  });
  assert.equal(res.statusCode, 200, 'GET /js/login.js must return 200 OK');
  assert.match(res.headers['Content-Type'], /text\/javascript/, 'Must return JS content type');
  assert.match(res.body, /loginForm/, 'Must contain loginForm JS');
  console.log('PASS GET /js/login.js returns JavaScript content');

  // Test 8: POST /api/auth/login invalid credentials
  res = await invoke({
    method: 'POST',
    url: '/api/index.js?__path=/api/auth/login',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://disreptioniq.vercel.app',
      'host': 'disreptioniq.vercel.app',
      'x-matched-path': '/api/auth/login'
    },
    body: { email: 'bad@disruptioniq.local', password: 'wrong' }
  });
  assert.equal(res.statusCode, 401, 'Invalid login should return 401');
  const loginErr = JSON.parse(res.body);
  assert.equal(loginErr.error, 'Email or password did not match a DisruptionIQ account.');
  console.log('PASS POST /api/auth/login reaches actual authentication handler');

  // Test 9: POST /api/auth/login valid demo credentials
  res = await invoke({
    method: 'POST',
    url: '/api/index.js?__path=/api/auth/login',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://disreptioniq.vercel.app',
      'host': 'disreptioniq.vercel.app',
      'x-matched-path': '/api/auth/login'
    },
    body: { email: 'hub@disruptioniq.local', password: 'Hub@DIQ2026!' }
  });
  assert.equal(res.statusCode, 200, 'Valid login must return 200');
  const loginOk = JSON.parse(res.body);
  assert.equal(loginOk.success, true);
  assert.equal(loginOk.user.role, 'HUB_INCHARGE');
  assert.equal(loginOk.redirect_to, '/app/overview');
  console.log('PASS POST /api/auth/login successfully authenticates demo user');

  // Test 10: GET /app/overview without session -> redirect to /login
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/app/overview',
    headers: { 'x-matched-path': '/app/overview' }
  });
  assert.equal(res.statusCode, 302, 'Unauthenticated /app/overview must redirect');
  assert.equal(res.headers['Location'], '/login');
  console.log('PASS GET /app/overview redirects unauthenticated user to /login');

  // Test 11: GET /customer/portal without session -> redirect to /login
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/customer/portal',
    headers: { 'x-matched-path': '/customer/portal' }
  });
  assert.equal(res.statusCode, 302, 'Unauthenticated /customer/portal must redirect');
  assert.equal(res.headers['Location'], '/login');
  console.log('PASS GET /customer/portal redirects unauthenticated user to /login');

  // Test 12: GET /api/auth/me without session -> HTTP 401
  res = await invoke({
    method: 'GET',
    url: '/api/index.js?__path=/api/auth/me',
    headers: { 'x-matched-path': '/api/auth/me' }
  });
  assert.equal(res.statusCode, 401);
  const meErr = JSON.parse(res.body);
  assert.equal(meErr.error, 'Authentication required.');
  console.log('PASS GET /api/auth/me remains protected');

  console.log('\nALL VERCEL ADAPTER ROUTING TESTS PASSED!');
})();
