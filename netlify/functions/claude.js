// Secure Anthropic API proxy — never expose API key to the browser
'use strict';

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
]);

const MAX_BODY_BYTES   = 52_000;  // 50 KB hard cap on request size
const MAX_PROMPT_CHARS = 12_000;  // cap prompt length fed to Claude
const MAX_TOKENS_CAP   = 5_000;   // never allow client to request more than this

// Simple in-process rate limiter (resets on cold start — good enough for free tier abuse prevention)
const ipBucket = new Map();
const WINDOW_MS   = 60_000; // 1-minute window
const MAX_PER_WIN = 40;     // max 40 requests per IP per minute

function checkRate(ip) {
  const now = Date.now();
  let entry = ipBucket.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    entry = { start: now, count: 0 };
    ipBucket.set(ip, entry);
  }
  entry.count++;
  return entry.count <= MAX_PER_WIN;
}

exports.handler = async (event) => {
  // ── Method guard
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Origin guard — allow own domain + localhost dev
  const origin = (event.headers['origin'] || event.headers['Origin'] || '').toLowerCase();
  const host   = (event.headers['host']   || event.headers['Host']   || '').toLowerCase();
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
  const isDev  = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('netlify.app');
  const isOwn  = allowedOrigin && origin.startsWith(allowedOrigin.toLowerCase());
  if (!isDev && !isOwn) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  // ── Rate limit by source IP
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRate(ip)) {
    return {
      statusCode: 429,
      headers: { 'Retry-After': '60', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { type: 'rate_limit', message: 'Too many requests. Please wait 60 seconds.' } }),
    };
  }

  // ── Body size guard
  const rawBody = event.body || '';
  if (rawBody.length > MAX_BODY_BYTES) {
    return { statusCode: 413, body: 'Request entity too large' };
  }

  // ── Parse + validate body
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!body || typeof body !== 'object') {
    return { statusCode: 400, body: 'Bad request' };
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, MAX_PROMPT_CHARS) : '';
  if (!prompt) {
    return { statusCode: 400, body: 'Missing prompt' };
  }

  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'claude-haiku-4-5-20251001';
  const maxTokens = Math.min(Math.max(100, parseInt(body.max_tokens) || 3000), MAX_TOKENS_CAP);
  const system = typeof body.system === 'string' ? body.system.slice(0, 8000) : undefined;

  // ── Ensure API key is present
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { type: 'config_error', message: 'ANTHROPIC_API_KEY not configured' } }),
    };
  }

  // ── Forward to Anthropic
  try {
    const payload = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (system) payload.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    const corsOrigin = isDev ? origin : (allowedOrigin || origin);
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
        'Vary': 'Origin',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { type: 'upstream_error', message: 'Failed to reach AI service' } }),
    };
  }
};
