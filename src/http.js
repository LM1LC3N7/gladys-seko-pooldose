// -----------------------------------------------------------------------------
// The only network access: HTTP(S) requests to the PoolDose on the local
// network, and the errors they end with. The body read is bounded, the JSON
// parse drops the keys that could pollute a prototype and bounds the depth
// without recursion; the messages never hold the address of the device.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed call. `kind`:
 * - `no_host`: no address configured (never sent);
 * - `refused`: 401 or 403 (a proxy or a locked device in front);
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: not the expected answer;
 * - `not_found`: 404 (not a PoolDose, or another API version);
 * - `http`: any other status.
 */
export class PoolDoseError extends Error {
  constructor(kind, message, { status, retryAfter, code } = {}) {
    super(message);
    this.name = 'PoolDoseError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed certificate',
  SELF_SIGNED_CERT_IN_CHAIN: 'self-signed certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificate not verified',
  CERT_HAS_EXPIRED: 'certificate expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'certificate for another name',
  EPROTO: 'TLS error',
};

/** A socket error -> PoolDoseError (the message of Node may hold the address: dropped). */
export function networkError(err) {
  if (err instanceof PoolDoseError) {
    return err;
  }
  const code = typeof err?.code === 'string' && /^[A-Z_]{1,40}$/.test(err.code) ? err.code : '';
  return new PoolDoseError('network', NETWORK_REASONS[code] ?? 'network error', {
    code: code || undefined,
  });
}

/** A short reason for a log, without the address of the device. */
export function errorReason(err) {
  if (err instanceof PoolDoseError) {
    const details = [err.code, err.status ? `HTTP ${err.status}` : undefined].filter(Boolean);
    return details.length > 0 ? `${err.message} (${details.join(', ')})` : err.message;
  }
  return 'internal error';
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status. The
 * promise settles once; the body read is bounded. `insecure`: a self-signed
 * certificate is accepted (HTTPS only, the user's choice).
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
    insecure = false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const tls = target.protocol === 'https:';
    const lib = tls ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const options = { method, headers, ...(tls ? { rejectUnauthorized: !insecure } : {}) };
    const req = lib.request(target, options, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new PoolDoseError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new PoolDoseError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Keys never kept from an answer: they could reach a prototype through a later merge. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Too deep: a bounded walk, never a recursion on hostile input. */
function tooDeep(value, maxDepth) {
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    if (node && typeof node === 'object') {
      if (depth >= maxDepth) {
        return true;
      }
      for (const child of Object.values(node)) {
        stack.push([child, depth + 1]);
      }
    }
  }
  return false;
}

/** The JSON of a body (unsafe keys dropped, depth bounded); `undefined` for an empty body. */
export function parseJson(body) {
  if (body === undefined || body === null || String(body).trim() === '') {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(body, (key, item) => (UNSAFE_KEYS.has(key) ? undefined : item));
  } catch {
    throw new PoolDoseError('bad_response', 'the answer is not JSON');
  }
  if (tooDeep(value, LIMITS.depth)) {
    throw new PoolDoseError('bad_response', 'the answer is nested too deep');
  }
  return value;
}

/** An own property of a plain object, never one of its prototype. */
export const own = (object, key) =>
  object && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined;
