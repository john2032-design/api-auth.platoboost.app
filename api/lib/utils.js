// api/lib/utils.js
const crypto = require('crypto');
const { kv } = require('@vercel/kv');
const getCurrentTime = () => process.hrtime.bigint();
const formatDuration = (startNs, endNs = process.hrtime.bigint()) => {
  const durationNs = Number(endNs - startNs);
  const durationSec = durationNs / 1_000_000_000;
  return `${durationSec.toFixed(2)}s`;
};

const CONFIG = {
  SUPPORTED_METHODS: ['GET', 'POST'],
  RATE_LIMIT_WINDOW_MS: 60000,
  MAX_REQUESTS_PER_WINDOW: 15,
  ADMIN_IP: '168.91.23.165'
};

const ABYSM_PAID_CONFIG = {
  BASE: 'https://api.abysm.lat/v2/bypass',
  API_KEY: 'ABYSM-185EF369-E519-4670-969E-137F07BB52B8'
};

const HOST_RULES = {
  'auth.platorelay.com': ['abysmPaid'],
  'auth.platoboost.me': ['abysmPaid'],
  'auth.platoboost.app': ['abysmPaid']
};

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
  if (req.method === 'POST') {
    return req.body?.['x_user_id'] || req.body?.['x-user-id'] || req.body?.xUserId || '';
  }
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

const postProcessResult = (result) => {
  if (typeof result === 'string' && /^https?:\/\/ads\.luarmor\.net\//i.test(result)) {
    return `https://vortixworld-luarmor.vercel.app/redirect?to=${result}`;
  }
  return result;
};

const tryAbysmPaid = async (axios, url) => {
  try {
    const res = await axios.get(ABYSM_PAID_CONFIG.BASE, {
      params: { url },
      headers: { 'x-api-key': ABYSM_PAID_CONFIG.API_KEY }
    });
    const d = res.data;
    if (d?.status === 'failed') {
      return { success: false, error: 'Failed' };
    }
    let potentialResult;
    if (d?.status === 'success' && d?.data?.result) {
      potentialResult = d.data.result;
    } else if (d?.result) {
      potentialResult = d.result;
    }
    if (potentialResult && typeof potentialResult === 'string' &&
        (potentialResult.includes('This session is invalid, please copy a valid link from the application.') ||
         potentialResult.includes('This URL is already being processed. Please wait or check back shortly.'))) {
      return { success: false, error: potentialResult };
    }
    if (potentialResult) {
      return { success: true, result: potentialResult };
    }
    return { success: false, error: d?.error || d?.message || null };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
};

const API_REGISTRY = {
  abysmPaid: tryAbysmPaid
};

const getApiChain = (hostname) => {
  for (const [host, apis] of Object.entries(HOST_RULES)) {
    if (matchesHostList(hostname, [host])) {
      return [...apis];
    }
  }
  return [];
};

const executeApiChain = async (axios, url, apiChain) => {
  let lastError = null;
  for (let i = 0; i < apiChain.length; i++) {
    const name = apiChain[i];
    const fn = API_REGISTRY[name];
    if (!fn) continue;
    try {
      const result = await fn(axios, url);
      if (result && result.success) {
        let final = postProcessResult(result.result);
        return { success: true, result: final };
      } else {
        lastError = (result && (result.error || result.message || result.result)) || lastError || 'Unknown error from upstream API';
      }
    } catch (e) {
      lastError = e?.message || String(e);
    }
  }
  return { success: false, error: lastError };
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id,x_user_id,x-userid,x-api-key');
};

const generateApiKey = () => crypto.randomUUID();

const isAdmin = (req) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  return ip === CONFIG.ADMIN_IP;
};

const getAllKeys = async () => {
  const keysList = await kv.get('all_keys') || [];
  const keysData = [];
  for (const key of keysList) {
    const data = await kv.get(`key:${key}`);
    if (data) {
      keysData.push({ key, ...data });
    }
  }
  return keysData;
};

const addToAllKeys = async (key) => {
  let keysList = await kv.get('all_keys') || [];
  if (!keysList.includes(key)) {
    keysList.push(key);
    await kv.set('all_keys', keysList);
  }
};

const removeFromAllKeys = async (key) => {
  let keysList = await kv.get('all_keys') || [];
  keysList = keysList.filter(k => k !== key);
  await kv.set('all_keys', keysList);
};

module.exports = {
  getCurrentTime,
  formatDuration,
  CONFIG,
  ABYSM_PAID_CONFIG,
  HOST_RULES,
  USER_RATE_LIMIT,
  matchesHostList,
  extractHostname,
  sanitizeUrl,
  getUserId,
  sendError,
  sendSuccess,
  postProcessResult,
  tryAbysmPaid,
  API_REGISTRY,
  getApiChain,
  executeApiChain,
  setCorsHeaders,
  generateApiKey,
  isAdmin,
  getAllKeys,
  addToAllKeys,
  removeFromAllKeys
};