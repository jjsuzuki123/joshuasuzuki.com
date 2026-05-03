const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const ALLOWED_ORIGINS = new Set([
  'https://joshuasuzuki.com',
  'https://www.joshuasuzuki.com',
]);
const DEFAULT_ORIGIN = 'https://www.joshuasuzuki.com';

const MAX_PASSWORD_LENGTH = 256;

exports.handler = async (event) => {
  try {
    if (!ADMIN_PASSWORD || !JWT_SECRET) {
      console.error('ADMIN_PASSWORD or JWT_SECRET not set');
      return respond(event, 500, { message: 'Server misconfigured' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(event, 400, { message: 'Invalid JSON' });
    }

    const password = typeof body?.password === 'string' ? body.password : '';

    if (!password || password.length > MAX_PASSWORD_LENGTH) {
      return respond(event, 401, { message: 'Unauthorized' });
    }

    if (!constantTimeEqual(password, ADMIN_PASSWORD)) {
      return respond(event, 401, { message: 'Unauthorized' });
    }

    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, {
      expiresIn: TOKEN_TTL_SECONDS,
    });

    return respond(event, 200, { token });
  } catch (err) {
    console.error('admin-login error', err.name);
    return respond(event, 500, { message: 'Server error' });
  }
};

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) {
    // Still run a fixed-time compare against bufB to reduce length-based timing.
    crypto.timingSafeEqual(bufB, bufB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function respond(event, statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(event),
    body: JSON.stringify(body),
  };
}

function corsHeaders(event) {
  const requestOrigin =
    event?.headers?.origin || event?.headers?.Origin || '';
  const allow = ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : DEFAULT_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    Vary: 'Origin',
  };
}
