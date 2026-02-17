const VALID_KEYS = require('./keys-store');

const getCurrentTime = () => process.hrtime.bigint();
const formatDuration = (startNs, endNs = process.hrtime.bigint()) => {
  const durationNs = Number(endNs - startNs);
  const durationSec = durationNs / 1_000_000_000;
  return `${durationSec.toFixed(2)}s`;
};

const CONFIG = {
  SUPPORTED_METHODS: ['GET', 'POST'],
  RATE_LIMIT_WINDOW_MS: 60000,
  MAX_REQUESTS_PER_WINDOW: 15
};

const ABYSM_API = {
  BASE: 'https://api.abysm.lat/v2/bypass',
  KEY: 'ABYSM-185EF369-E519-4670-969E-137F07BB52B8'
};

const HOST_RULES = {
  'auth.platorelay.com': true,
  'auth.platoboost.me': true,
  'auth.platoboost.app': true
};

const USER_RATE_LIMIT = new Map();

const validateKey = (key) => {
  const data = VALID_KEYS.get(key);
  if (!data) return { valid: false };
  if (data.expiresAt && Date.now() > data.expiresAt) {
    VALID_KEYS.delete(key);
    return { valid: false };
  }
  if (data.type === 'requests' && data.remaining <= 0) {
    VALID_KEYS.delete(key);
    return { valid: false };
  }
  return { valid: true, data };
};

const consumeRequest = (key) => {
  const data = VALID_KEYS.get(key);
  if (!data) return;
  if (data.type === 'requests') {
    data.remaining -= 1;
    if (data.remaining <= 0) {
      VALID_KEYS.delete(key);
    } else {
      VALID_KEYS.set(key, data);
    }
  }
};

const extractHostname = (url) => {
  try {
    let u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const sanitizeUrl = (url) => {
  if (typeof url !== 'string') return url;
  return url.trim().replace(/[\r\n\t]/g, '');
};

const sendError = (res, statusCode, message, startTime) =>
  res.status(statusCode).json({
    status: 'error',
    result: message,
    time_taken: formatDuration(startTime)
  });

const sendSuccess = (res, result, startTime) =>
  res.json({
    status: 'success',
    result,
    time_taken: formatDuration(startTime)
  });

let axiosInstance = null;

module.exports = async (req, res) => {
  const handlerStart = getCurrentTime();

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!CONFIG.SUPPORTED_METHODS.includes(req.method)) {
    return sendError(res, 405, 'Method not allowed', handlerStart);
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return sendError(res, 401, 'Missing x-api-key', handlerStart);

  const keyCheck = validateKey(apiKey);
  if (!keyCheck.valid) return sendError(res, 403, 'Invalid or expired api key', handlerStart);

  let url = req.method === 'GET' ? req.query.url : req.body?.url;

  if (!url || typeof url !== 'string') {
    return sendError(res, 400, 'Missing url parameter', handlerStart);
  }

  url = sanitizeUrl(url);

  if (!/^https?:\/\//i.test(url)) {
    return sendError(res, 400, 'URL must start with http:// or https://', handlerStart);
  }

  if (!axiosInstance) {
    axiosInstance = require('axios').create({
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
  }

  const axios = axiosInstance;
  const hostname = extractHostname(url);

  if (!hostname || !HOST_RULES[hostname]) {
    return sendError(res, 400, 'Unsupported host', handlerStart);
  }

  const userKey = req.ip || 'anon';
  const now = Date.now();

  if (!USER_RATE_LIMIT.has(userKey)) USER_RATE_LIMIT.set(userKey, []);

  let times = USER_RATE_LIMIT.get(userKey);
  times = times.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW_MS);
  times.push(now);
  USER_RATE_LIMIT.set(userKey, times);

  if (times.length > CONFIG.MAX_REQUESTS_PER_WINDOW) {
    return sendError(res, 429, 'Rate limit exceeded', handlerStart);
  }

  try {
    const response = await axios.get(ABYSM_API.BASE, {
      params: { url },
      headers: { 'x-api-key': ABYSM_API.KEY }
    });

    const d = response.data;

    if (!d || d.status === 'failed' || d.status === 'error') {
      return sendError(res, 500, 'Failed', handlerStart);
    }

    let resultValue = d?.data?.result || d?.result || '';

    if (
      typeof resultValue === 'string' &&
      (
        resultValue.includes('This session is invalid, please copy a valid link from the application.') ||
        resultValue.includes('This URL is already being processed. Please wait or check back shortly.')
      )
    ) {
      return sendError(res, 500, 'Failed', handlerStart);
    }

    if (d?.status === 'success' && resultValue) {
      consumeRequest(apiKey);
      return sendSuccess(res, resultValue, handlerStart);
    }

    return sendError(res, 500, 'Failed', handlerStart);

  } catch (e) {
    return sendError(res, 500, e?.message || 'Request failed', handlerStart);
  }
};
