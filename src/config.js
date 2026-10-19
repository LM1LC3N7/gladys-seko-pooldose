// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized. No secret:
// the local API of the PoolDose has no account nor password.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  port: 0,
  use_ssl: false,
  ssl_verify: true,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A checkbox may arrive as a boolean or as a string from a form; absent = its default. */
const flag = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
};

const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*\.?$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The host as typed, a scheme, a trailing slash or IPv6 brackets dropped;
 * undefined when it is not a host name nor an IP address (a path, a port, a
 * user: never sent).
 */
export function parseHost(raw) {
  let host = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === '' || host.length > 253) {
    return undefined;
  }
  if (host.includes(':')) {
    // At least two colons: "192.168.1.50:80" is an address and a port, not IPv6.
    return IPV6.test(host) && host.split(':').length >= 3 ? host.toLowerCase() : undefined;
  }
  return HOSTNAME.test(host) ? host.toLowerCase() : undefined;
}

/** The key of a device address in /data: a hash, only to know whether what is kept is its. */
export const targetKey = ({ host, port, useSsl }) =>
  host
    ? createHash('sha256')
        .update(`pooldose:${host}:${port}:${useSsl}`, 'utf8')
        .digest('hex')
        .slice(0, 32)
    : '';

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

export function normalizeConfig(raw = {}) {
  const typed = String(raw?.host ?? '').trim();
  const host = parseHost(typed);
  const port = number(raw?.port);
  const interval = number(raw?.poll_interval);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const useSsl = flag(raw?.use_ssl, DEFAULTS.use_ssl);
  const config = {
    host,
    /** An address was typed but is not valid. */
    badHost: typed !== '' && host === undefined,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0,
    useSsl,
    sslVerify: flag(raw?.ssl_verify, DEFAULTS.ssl_verify),
    pollInterval: Number.isFinite(interval)
      ? Math.round(Math.max(POLL_INTERVAL.min, Math.min(POLL_INTERVAL.max, interval)))
      : DEFAULTS.poll_interval,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
  config.target = targetKey(config);
  return config;
}

/** What the client needs, or undefined without a valid address. */
export const targetOf = (config) =>
  config.host
    ? { host: config.host, port: config.port, useSsl: config.useSsl, sslVerify: config.sslVerify }
    : undefined;
