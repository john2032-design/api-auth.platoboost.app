// api/bypass.js
const axios = require('axios');
const utils = require('./lib/utils');

let axiosInstance = null;

module.exports = async (req, res) => {
  const handlerStart = utils.getCurrentTime();
  utils.setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!utils.CONFIG.SUPPORTED_METHODS.includes(req.method)) {
    return utils.sendError(res, 405, 'Method not allowed', handlerStart);
  }

  const apiKeyHeader = req.headers['x-api-key'];
  if (!apiKeyHeader) {
    return utils.sendError(res, 401, 'Missing x-api-key header', handlerStart);
  }

  const { kv } = require('@vercel/kv');
  let keyData = await kv.get(`key:${apiKeyHeader}`);
  if (!keyData) {
    return utils.sendError(res, 401, 'Invalid API key', handlerStart);
  }

  const now = Date.now();
  let isExpired = false;
  if (keyData.type === 'request' && keyData.remaining <= 0) isExpired = true;
  if (keyData.type === 'monthly' && now > keyData.expiration) isExpired = true;
  if (isExpired) {
    await kv.del(`key:${apiKeyHeader}`);
    await utils.removeFromAllKeys(apiKeyHeader);
    return utils.sendError(res, 401, 'API key expired', handlerStart);
  }

  let url = req.method === 'GET' ? req.query.url : req.body?.url;
  if (!url || typeof url !== 'string') {
    return utils.sendError(res, 400, 'Missing url parameter', handlerStart);
  }
  url = utils.sanitizeUrl(url);
  if (!/^https?:\/\//i.test(url)) {
    return utils.sendError(res, 400, 'URL must start with http:// or https://', handlerStart);
  }

  if (!axiosInstance) {
    axiosInstance = axios.create({
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BypassBot/2.0)' }
    });
  }

  const hostname = utils.extractHostname(url);
  if (!hostname) {
    return utils.sendError(res, 400, 'Invalid URL', handlerStart);
  }

  const incomingUserId = utils.getUserId(req);
  const userKey = incomingUserId || req.headers['x-forwarded-for'] || req.ip || 'anonymous';
  if (!utils.USER_RATE_LIMIT.has(userKey)) utils.USER_RATE_LIMIT.set(userKey, []);
  let times = utils.USER_RATE_LIMIT.get(userKey);
  times = times.filter(t => now - t < utils.CONFIG.RATE_LIMIT_WINDOW_MS);
  times.push(now);
  utils.USER_RATE_LIMIT.set(userKey, times);
  if (times.length > utils.CONFIG.MAX_REQUESTS_PER_WINDOW) {
    return utils.sendError(res, 429, 'Rate limit exceeded', handlerStart);
  }

  const apiChain = utils.getApiChain(hostname);
  if (!apiChain || apiChain.length === 0) {
    return utils.sendError(res, 400, 'No bypass method for host', handlerStart);
  }

  const result = await utils.executeApiChain(axiosInstance, url, apiChain);

  keyData.usage += 1;
  if (result.success) {
    if (keyData.type === 'request') {
      keyData.remaining -= 1;
      if (keyData.remaining <= 0) {
        await kv.del(`key:${apiKeyHeader}`);
        await utils.removeFromAllKeys(apiKeyHeader);
      } else {
        await kv.set(`key:${apiKeyHeader}`, keyData);
      }
    } else {
      await kv.set(`key:${apiKeyHeader}`, keyData);
    }
    return utils.sendSuccess(res, result.result, incomingUserId, handlerStart);
  } else {
    await kv.set(`key:${apiKeyHeader}`, keyData);
    const upstreamMsg = result.error || result.message || result.result || 'Bypass failed';
    return utils.sendError(res, 500, upstreamMsg, handlerStart);
  }
};