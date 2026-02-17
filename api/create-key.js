const VALID_KEYS = require('./keys-store');

const createKey = (type, requests = 0, expiresAt = null) => {
  const key = 'VW-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  VALID_KEYS.set(key, {
    type,
    remaining: requests,
    expiresAt
  });
  return key;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, count } = req.body || {};

  if (type === 'requests') {
    const key = createKey('requests', Number(count) || 1, null);
    return res.json({ key });
  }

  if (type === 'monthly') {
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const key = createKey('monthly', 0, expires);
    return res.json({ key });
  }

  res.status(400).json({ error: 'Invalid type' });
};
