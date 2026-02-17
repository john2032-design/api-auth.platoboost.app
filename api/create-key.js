// api/create-key.js
const utils = require('./lib/utils');

const handleCreateKey = async (req, res, startTime) => {
  if (!utils.isAdmin(req)) return utils.sendError(res, 403, 'Forbidden', startTime);
  if (req.method !== 'POST') return utils.sendError(res, 405, 'Method not allowed', startTime);
  const { type, value } = req.body;
  if (!type || (type !== 'request' && type !== 'monthly')) return utils.sendError(res, 400, 'Invalid type', startTime);
  if (!value || isNaN(value) || value < 1) return utils.sendError(res, 400, 'Invalid value', startTime);
  const apiKey = utils.generateApiKey();
  const now = Date.now();
  let keyData;
  if (type === 'request') {
    keyData = {
      type: 'request',
      remaining: parseInt(value),
      expiration: null,
      created: now,
      usage: 0
    };
  } else {
    const months = parseInt(value);
    if (months > 12) return utils.sendError(res, 400, 'Max 12 months', startTime);
    const msPerMonth = 30 * 24 * 60 * 60 * 1000;
    keyData = {
      type: 'monthly',
      remaining: null,
      expiration: now + months * msPerMonth,
      created: now,
      usage: 0
    };
  }
  const { kv } = require('@vercel/kv');
  await kv.set(`key:${apiKey}`, keyData);
  await utils.addToAllKeys(apiKey);
  res.json({ status: 'success', apiKey });
};

module.exports = async (req, res) => {
  const handlerStart = utils.getCurrentTime();
  utils.setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  await handleCreateKey(req, res, handlerStart);
};