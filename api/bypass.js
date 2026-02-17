const getCurrentTime = () => process.hrtime.bigint();
const formatDuration = (startNs, endNs = process.hrtime.bigint()) => {
  const durationNs = Number(endNs - startNs);
  const durationSec = durationNs / 1_000_000_000;
  return `${durationSec.toFixed(2)}s`;
};

const CONFIG = {
  SUPPORTED_METHODS: ['GET'],
  RATE_LIMIT_WINDOW_MS: 60000,
  MAX_REQUESTS_PER_WINDOW: 15
};

const ABYSM_PAID_CONFIG = {
  BASE: 'https://api.abysm.lat/v2/bypass',
  API_KEY: 'ABYSM-185EF369-E519-4670-969E-137F07BB52B8'
};

const SUPPORTED_HOSTS = ['auth.platorelay.com', 'auth.platoboost.me', 'auth.platoboost.app'];

const USER_RATE_LIMIT = new Map();

const matchesHostList = (hostname, list) =>
  list.some(h => hostname === h || hostname.endsWith('.' + h));

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

const getUserId = (req) => {
  return req.headers?.['x-user-id'] || req.headers?.['x_user_id'] || req.headers?.['x-userid'] || '';
};

const sendError = (res, statusCode, message, startTime) =>
  res.status(statusCode).json({
    status: 'error',
    result: message,
    time_taken: formatDuration(startTime)
  });

const sendSuccess = (res, result, userId, startTime) =>
  res.json({
    status: 'success',
    result,
    x_user_id: userId || '',
    time_taken: formatDuration(startTime)
  });

const tryAbysmPaid = async (axios, url) => {
  try {
    const res = await axios.get(ABYSM_PAID_CONFIG.BASE, {
      params: { url },
      headers: { 'x-api-key': ABYSM_PAID_CONFIG.API_KEY }
    });
    const d = res.data;
    if (d?.status === 'success' && d?.data?.result) {
      return { success: true, result: d.data.result };
    }
    if (d?.status === 'failed') {
      return { success: false, error: "Failed" };
    }
    if (d?.result) {
      const errorMessages = [
        "This session is invalid, please copy a valid link from the application.",
        "This URL is already being processed. Please wait or check back shortly."
      ];
      if (errorMessages.some(msg => d.result.includes(msg))) {
        return { success: false, error: d.result };
      } else {
        return { success: true, result: d.result };
      }
    }
    return { success: false, error: d?.error || d?.message || null };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
};

const setCorsHeaders = (req, res) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id,x_user_id,x-userid,x-api-key');
};

let axiosInstance = null;

module.exports = async (req, res) => {
  const handlerStart = getCurrentTime();
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!CONFIG.SUPPORTED_METHODS.includes(req.method)) {
    return sendError(res, 405, 'Method not allowed', handlerStart);
  }
  let url = req.query.url;
  if (!url || typeof url !== 'string') {
    return sendError(res, 400, 'Missing url parameter', handlerStart);
  }
  url = sanitizeUrl(url);
  if (!/^https?:\/\//i.test(url)) {
    return sendError(res, 400, 'URL must start with http:// or https://', handlerStart);
  }
  if (!axiosInstance) {
    axiosInstance = require('axios').create({
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BypassBot/2.0)' }
    });
  }
  const axios = axiosInstance;
  const hostname = extractHostname(url);
  if (!hostname) {
    return sendError(res, 400, 'Invalid URL', handlerStart);
  }
  const incomingUserId = getUserId(req);
  const userKey = incomingUserId || req.headers['x-forwarded-for'] || req.ip || 'anonymous';
  const now = Date.now();
  if (!USER_RATE_LIMIT.has(userKey)) USER_RATE_LIMIT.set(userKey, []);
  let times = USER_RATE_LIMIT.get(userKey);
  times = times.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW_MS);
  times.push(now);
  USER_RATE_LIMIT.set(userKey, times);
  if (times.length > CONFIG.MAX_REQUESTS_PER_WINDOW) {
    return sendError(res, 429, 'Rate limit exceeded', handlerStart);
  }
  if (!SUPPORTED_HOSTS.some(h => matchesHostList(hostname, [h]))) {
    return sendError(res, 400, 'No bypass method for host', handlerStart);
  }
  const apiResult = await tryAbysmPaid(axios, url);
  if (apiResult.success) {
    return sendSuccess(res, apiResult.result, incomingUserId, handlerStart);
  }
  const upstreamMsg = apiResult.error || 'Bypass failed';
  return sendError(res, 500, upstreamMsg, handlerStart);
};