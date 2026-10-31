'use strict';
const requestHandler = require('../server');

function extractOriginalUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  let incoming;
  try {
    incoming = new URL(req.url, `http://${host}`);
  } catch {
    incoming = new URL('/', `http://${host}`);
  }

  const params = new URLSearchParams(incoming.search);
  let targetPath = null;

  // 1. Check __path query parameter passed by vercel.json rewrite
  if (params.has('__path')) {
    const raw = params.get('__path');
    params.delete('__path');
    if (raw && typeof raw === 'string' && !['$1', '/$1', ':path*', '/:path*'].includes(raw)) {
      targetPath = raw.startsWith('/') ? raw : '/' + raw;
    }
  }

  // 2. Check x-now-route-matches header set by Vercel's routing engine
  if (!targetPath && req.headers['x-now-route-matches']) {
    try {
      const rm = new URLSearchParams(req.headers['x-now-route-matches']);
      const m = rm.get('path') || rm.get('match') || rm.get('1') || rm.get('0');
      if (m && !['$1', '/$1', ':path*', '/:path*'].includes(m)) {
        targetPath = m.startsWith('/') ? m : '/' + m;
      }
    } catch {}
  }

  // 3. Check x-matched-path header set by Vercel
  if (!targetPath && req.headers['x-matched-path']) {
    const mp = req.headers['x-matched-path'];
    if (mp && typeof mp === 'string' && !['/api/index.js', '/api/index', '/api'].includes(mp)) {
      targetPath = mp;
    }
  }

  // 4. Check x-forwarded-uri or x-original-url headers
  if (!targetPath && req.headers['x-forwarded-uri']) {
    try {
      const u = new URL(req.headers['x-forwarded-uri'], `http://${host}`);
      if (u.pathname && !['/api/index.js', '/api/index', '/api'].includes(u.pathname)) {
        targetPath = u.pathname;
      }
    } catch {}
  }

  // 5. Fallback: if incoming pathname is already a real route (not /api/index.js)
  if (!targetPath) {
    if (!['/api/index.js', '/api/index', '/api'].includes(incoming.pathname)) {
      targetPath = incoming.pathname;
    } else {
      targetPath = '/';
    }
  }

  // Ensure single leading slash
  if (!targetPath.startsWith('/')) {
    targetPath = '/' + targetPath;
  }
  targetPath = targetPath.replace(/\/+/g, '/');

  // Strip trailing slash unless root
  if (targetPath.length > 1 && targetPath.endsWith('/')) {
    targetPath = targetPath.slice(0, -1);
  }

  // Reconstruct query string
  const remainingQuery = params.toString();
  return remainingQuery ? `${targetPath}?${remainingQuery}` : targetPath;
}

module.exports = async (req, res) => {
  const resolvedUrl = extractOriginalUrl(req);
  req.url = resolvedUrl;
  return requestHandler(req, res);
};

module.exports.extractOriginalUrl = extractOriginalUrl;
