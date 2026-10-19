// -----------------------------------------------------------------------------
// Constants of the SEKO PoolDose local API and of the integration.
//
// The endpoints are those python-pooldose 0.9.15 (MIT, lmaertin, see
// THIRD_PARTY_NOTICES.md) uses on the device itself: no cloud, no account.
// -----------------------------------------------------------------------------

/** The manifest action keys. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The manifest scene trigger keys (stored by the scenes: never rename them). */
export const SCENE_TRIGGERS = {
  ALARM_RAISED: 'alarm_raised',
  ALARM_CLEARED: 'alarm_cleared',
};

/**
 * The local HTTP API of the device. Only what a read-only v1 needs: the Wi-Fi
 * endpoints (getStation, getAccessPoint) are never called, they answer with
 * the Wi-Fi keys.
 */
export const API = {
  params: '/js_libs/params.js',
  debugConfig: '/api/v1/debug/config',
  instantValues: '/api/v1/DWI/getInstantValues',
  /** The API version python-pooldose supports. */
  version: 'v1/',
  /** Who we are; never another client's User-Agent. */
  userAgent: 'gladys-seko-pooldose/0.1',
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = { default: 60, min: 30, max: 900 };

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of a read (an embedded device on Wi-Fi). */
  requestTimeout: 10_000,
  /** The test button and the Discovery scan wait for Gladys: shorter requests. */
  quickTimeout: 8_000,
  /** Pauses after failures, never shorter than the poll interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** After a refusal (401/403): one new try after 1 h, 6 h, then every 24 h. */
  refusedRetry: [HOUR, 6 * HOUR, 24 * HOUR],
  /** 429: a pause between 60 s and 6 h, Retry-After when given. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** The model, firmware and ids are read again this often (a firmware update). */
  identifyEvery: 6 * HOUR,
  /** The test button and the Discovery scan read the device at most every 30 s. */
  testCooldown: 30_000,
  /** States flushed to Gladys every second; unchanged ones again every 30 min. */
  flushInterval: 1_000,
  stateHeartbeat: 30 * MINUTE,
};

export const LIMITS = {
  /** Gladys accepts 300 states per minute. */
  statesPerMinute: 280,
  statesPerRequest: 100,
  /** The biggest answer read (the instant values: tens of KB). */
  responseBytes: 512 * 1024,
  /** params.js is a small script. */
  scriptBytes: 128 * 1024,
  /** Nesting kept in a parsed answer. */
  depth: 10,
  /** Strings kept from the device (names, ids, modes). */
  textLength: 80,
  /** Scene events sent in one read at most (a device has about 25 alarms). */
  eventsPerRead: 40,
};
