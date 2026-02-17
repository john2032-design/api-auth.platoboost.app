// api/expire-key.js
const utils = require('./lib/utils');

const handleExpireKey = async (req, res, startTime) => {
  if (!utils.isAdmin(req)) return utils.sendError(res, 403, 'Forbidden', startTime);
  if (req.method !== 'POST') return utils.sendError(res, 405, 'Method not allowed', startTime);
  const { apiKey } = req.body;
  if (!apiKey) return utils.sendError(res, 400, 'Missing apiKey', startTime);
  const { kv } = require('@vercel/kv');
  const keyData = await kv.get(`key:${apiKey}`);
  if (!keyData) return utils.sendError(res, 404, 'Key not found', startTime);
  if (keyData.type === 'request') {
    keyData.remaining = 0;
  } else if (keyData.type === 'monthly') {
    keyData.expiration = Date.now();
  }
  await kv.set(`key:${apiKey}`, keyData);
  res.json({ status: 'success' });
};

module.exports = async (req, res) => {
  const handlerStart = utils.getCurrentTime();
  utils.setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  await handleExpireKey(req, res, handlerStart);
};