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

  // 1. Check __path query parameter explicitly passed by vercel.json rewrite
  if (params.has('__path')) {
    const p = params.get('__path');
    params.delete('__path');
    if (typeof p === 'string' && p.length > 0) {
      targetPath = p.startsWith('/') ? p : '/' + p;
    } else {
      targetPath = '/';
    }
  }

  // 2. Check x-matched-path header set by Vercel's routing layer
  if (!targetPath || targetPath === '/') {
    const matched = req.headers['x-matched-path'];
    if (matched && typeof matched === 'string' && matched !== '/api/index' && matched !== '/api/index.js') {
      targetPath = matched;
    }
  }

  // 3. Check other standard proxy rewrite headers
  if (!targetPath || targetPath === '/') {
    const rawForwarded = req.headers['x-forwarded-uri'] || req.headers['x-original-url'] || req.headers['x-rewrite-url'];
    if (rawForwarded && typeof rawForwarded === 'string') {
      try {
        targetPath = new URL(rawForwarded, `http://${host}`).pathname;
      } catch {
        targetPath = rawForwarded.split('?')[0];
      }
    }
  }

  // 4. Fallback: if incoming pathname is already a real route (not /api/index.js)
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
