// api/keys.js
const utils = require('./lib/utils');

const handleListKeys = async (req, res, startTime) => {
  if (!utils.isAdmin(req)) return utils.sendError(res, 403, 'Forbidden', startTime);
  const now = Date.now();
  const keys = await utils.getAllKeys();
  const enrichedKeys = keys.map(k => {
    let status = 'active';
    if (k.type === 'request' && k.remaining <= 0) status = 'expired';
    if (k.type === 'monthly' && now > k.expiration) status = 'expired';
    return { ...k, status };
  });
  res.json({ status: 'success', keys: enrichedKeys });
};

module.exports = async (req, res) => {
  const handlerStart = utils.getCurrentTime();
  utils.setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  await handleListKeys(req, res, handlerStart);
};