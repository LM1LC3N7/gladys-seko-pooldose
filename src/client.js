// -----------------------------------------------------------------------------
// The PoolDose local API (ported from python-pooldose 0.9.15 request_handler
// and client, MIT): the versions of params.js, the identity of the debug
// config, the instant values. Read only: no write endpoint is ever called in
// v1, nor the Wi-Fi endpoints (they answer with the Wi-Fi keys).
// -----------------------------------------------------------------------------

import { API, LIMITS, TIMINGS } from './constants.js';
import {
  PoolDoseError,
  httpRequest,
  networkError,
  own,
  parseJson,
  parseRetryAfter,
} from './http.js';

/** A string the device gave, bounded, without control characters; undefined otherwise. */
export function text(value, max = LIMITS.textLength) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u001f\u007f]/g;
  const clean = String(value).replace(CONTROL, '').trim();
  return clean === '' ? undefined : clean.slice(0, max);
}

/** An id the device gave: letters, digits, `_`, `-`, `.` only (used in keys and external ids). */
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const safeId = (value) => {
  const id = text(value, 64);
  return id && ID.test(id) && !RESERVED.has(id) ? id : undefined;
};

/** The base URL of the device: `http://host[:port]`, an IPv6 address in brackets. */
export function baseUrl({ host, port, useSsl }) {
  const scheme = useSsl ? 'https' : 'http';
  const name = host.includes(':') ? `[${host}]` : host;
  const standard = useSsl ? 443 : 80;
  return port && port !== standard ? `${scheme}://${name}:${port}` : `${scheme}://${name}`;
}

/** The status of an answer -> nothing for a 2xx, else the error it means. */
function statusError(response, now) {
  const { status } = response;
  if (status >= 200 && status < 300) {
    return undefined;
  }
  if (status === 401 || status === 403) {
    return new PoolDoseError('refused', 'access refused', { status });
  }
  if (status === 404) {
    return new PoolDoseError('not_found', 'not found', { status });
  }
  if (status === 429) {
    const header = own(response.headers ?? {}, 'retry-after');
    return new PoolDoseError('rate_limited', 'too many requests', {
      status,
      retryAfter: parseRetryAfter(header, now),
    });
  }
  if (status >= 500) {
    return new PoolDoseError('unavailable', 'device error', { status });
  }
  return new PoolDoseError('http', 'unexpected answer', { status });
}

export class PoolDoseClient {
  constructor({ transport = httpRequest, now = Date.now } = {}) {
    this.transport = transport;
    this.now = now;
    this.target = undefined;
    this.timeoutMs = undefined;
  }

  /** `{ host, port, useSsl, sslVerify }`, or undefined without an address. */
  configure(target) {
    this.target = target?.host ? target : undefined;
  }

  get configured() {
    return this.target !== undefined;
  }

  /** A shorter timeout for the button and the scan (undefined: the default). */
  setTimeoutMs(ms) {
    this.timeoutMs = ms;
  }

  async request(path, { method = 'GET', maxBytes = LIMITS.responseBytes } = {}) {
    if (!this.target) {
      throw new PoolDoseError('no_host', 'no address');
    }
    const headers = {
      Accept: 'application/json, text/javascript, */*',
      'User-Agent': API.userAgent,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    };
    let response;
    try {
      response = await this.transport(`${baseUrl(this.target)}${path}`, {
        method,
        headers,
        body: method === 'POST' ? '{}' : undefined,
        timeout: this.timeoutMs ?? TIMINGS.requestTimeout,
        maxBytes,
        insecure: this.target.useSsl && !this.target.sslVerify,
      });
    } catch (err) {
      // Never the message of Node: it may hold the address.
      throw networkError(err);
    }
    const error = statusError(response, this.now());
    if (error) {
      throw error;
    }
    return response.body ?? '';
  }

  /** The software and API versions of params.js (python-pooldose _get_core_params). */
  async params() {
    const script = await this.request(API.params, { maxBytes: LIMITS.scriptBytes });
    const pick = (key) => {
      // Linear: a fixed key, a bounded value without quotes nor line breaks.
      const match = new RegExp(`${key}\\s{0,8}:\\s{0,8}["']([^"'\\r\\n]{1,64})["']`).exec(script);
      return match ? text(match[1]) : undefined;
    };
    return { softwareVersion: pick('softwareVersion'), apiVersion: pick('apiversion') };
  }

  /**
   * The identity of the device (python-pooldose _load_device_info): the
   * gateway, and its first device (DID, PRODUCT_CODE, FW_CODE), which keys
   * the mapping and the instant values.
   */
  async identity() {
    const config = parseJson(await this.request(API.debugConfig));
    const gateway = own(config, 'GATEWAY');
    const devices = own(config, 'DEVICES');
    const device = Array.isArray(devices) ? devices[0] : undefined;
    const deviceId = safeId(own(device, 'DID'));
    if (!deviceId) {
      throw new PoolDoseError('bad_response', 'no device in the debug config');
    }
    return {
      deviceId,
      gatewayId: safeId(own(gateway, 'DID')),
      name: text(own(gateway, 'NAME')),
      gatewayFirmware: text(own(gateway, 'FW_REL')),
      model: text(own(device, 'NAME')),
      productCode: safeId(own(device, 'PRODUCT_CODE')),
      firmware: text(own(device, 'FW_REL')),
      fwCode: safeId(own(device, 'FW_CODE')),
    };
  }

  /** The raw instant values of one device: `{ "<prefix><key>": { current, magnitude, ... } }`. */
  async instantValues(deviceId) {
    const answer = parseJson(await this.request(API.instantValues, { method: 'POST' }));
    const values = own(own(answer, 'devicedata'), deviceId);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new PoolDoseError('bad_response', 'no instant values for the device');
    }
    return values;
  }
}
