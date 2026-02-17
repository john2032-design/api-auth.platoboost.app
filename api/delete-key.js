// api/delete-key.js
const utils = require('./lib/utils');

const handleDeleteKey = async (req, res, startTime) => {
  if (!utils.isAdmin(req)) return utils.sendError(res, 403, 'Forbidden', startTime);
  if (req.method !== 'POST') return utils.sendError(res, 405, 'Method not allowed', startTime);
  const { apiKey } = req.body;
  if (!apiKey) return utils.sendError(res, 400, 'Missing apiKey', startTime);
  const { kv } = require('@vercel/kv');
  await kv.del(`key:${apiKey}`);
  await utils.removeFromAllKeys(apiKey);
  res.json({ status: 'success' });
};

module.exports = async (req, res) => {
  const handlerStart = utils.getCurrentTime();
  utils.setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  await handleDeleteKey(req, res, handlerStart);
};