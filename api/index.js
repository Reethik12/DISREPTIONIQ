'use strict';

module.exports = async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    url: req.url,
    headers: req.headers
  }, null, 2));
};
