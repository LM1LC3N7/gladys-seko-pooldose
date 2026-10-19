// -----------------------------------------------------------------------------
// The integration: one SEKO PoolDose on the local network (its address), read
// every 60 s by default through its own HTTP API: its identity (model,
// firmware, mapping) now and then, its instant values at each cycle. The
// Gladys device, its states, the transport badge, and the alarm scene
// triggers (raised, cleared), under these rules:
//
// - read only in v1: no request ever writes to the device; the dosing pumps,
//   the pH/ORP/chlorine setpoints and the pause of the dosing are shown,
//   never commanded (TODO.md, v2);
// - a refusal (401/403) stops the reads, kept in /data, with one new try
//   after 1 h, 6 h, then every 24 h (or the test button); a 429 pauses every
//   path for 60 s to 6 h; no answer or a 5xx backs off (1 to 15 min, never
//   faster than the interval); the pauses survive a restart;
// - a reconnection to Gladys resends the status, the Discovery list and the
//   badge, and keeps the pauses and the stop.
//
// index.js only wires the SDK handlers to this class.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { PoolDoseClient } from './client.js';
import { normalizeConfig, targetOf } from './config.js';
import { API, LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import {
  alarmName,
  alarmsOf,
  buildDevice,
  deviceIds,
  deviceName,
  parseFeatureId,
  statesOf,
  valuesOf,
} from './devices.js';
import { PoolDoseError, errorReason } from './http.js';
import { T, age, join, reasonOf, word } from './i18n.js';
import { decode, mappingFor } from './pooldose.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors after which the identity is read again (another device, another firmware). */
const IDENTIFY_AGAIN = new Set(['not_found', 'bad_response']);

export class PoolDoseApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'pooldose' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new PoolDoseClient({ transport, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    this.started = false;
    this.generation = 0;
    this.timer = undefined;
    this.running = undefined;
    this.lastStatus = undefined;
    /** [connected, message] last asked, before the /data warning is added. */
    this.rawStatus = undefined;
    /** The last write of /data failed. */
    this.storeFailed = false;
    this.lastTestAt = -Infinity;
    this.reset();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Forgets the device and the failures: a new address, or a restart. */
  reset() {
    this.identity = undefined;
    this.identifiedAt = -Infinity;
    this.mapping = undefined;
    this.loggedModel = undefined;
    this.decoded = undefined;
    this.values = new Map();
    this.seen = new Set();
    this.readAt = undefined;
    this.published = undefined;
    this.badge = undefined;
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    this.failures = 0;
    this.offline = false;
  }

  /** `fresh`: the user changed the address, the stop is lifted. */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    this.client.configure(targetOf(this.config));
    this.publisher.start();
    if (!this.client.configured) {
      await this.setStatus(false, this.config.badHost ? T.badHost : T.noHost);
      return;
    }
    if (this.memory.target !== this.config.target) {
      // Another address: its pause and its stop are not this one's. The alarms
      // and the device id stay: they are keyed by the DID, and a PoolDose given
      // a new IP address (DHCP) is the same device, its transitions go on.
      const { alarms, deviceId } = this.memory;
      this.memory = normalizeMemory(
        { target: this.config.target, alarms: { ...alarms }, deviceId },
        this.now(),
      );
    }
    if (fresh) {
      this.memory.block = null;
    }
    const { pause, block } = this.memory;
    if (pause && pause.until > this.now()) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
      this.failures = pause.failures;
    }
    if (block) {
      this.blocked = true;
      this.retries = block.retries;
      this.retryAt = block.retryAt;
    }
    await this.saveMemory();
    if (this.blocked) {
      await this.setStatus(false, T.refused(age(Math.max(0, this.retryAt - this.now()))));
      this.scheduleNext();
      return;
    }
    await this.setStatus(false, this.pauseMessage({ backoff: true }) ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badge). The pauses and the stop stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    if (this.rawStatus) {
      await this.setStatus(...this.rawStatus);
    }
    await this.publishDevices();
    await this.publishBadge();
  }

  /** A new address restarts (and lifts the stop); the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.target !== previous.target || next.sslVerify !== previous.sslVerify) {
      return this.start(raw, { fresh: true });
    }
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      if (this.decoded) {
        this.values = valuesOf(this.decoded, next.language);
      }
      this.published = undefined;
      await this.publishDevices();
      this.queue();
      await this.flush();
    }
  }

  /** The status, with a warning while /data cannot be written. */
  async setStatus(connected, message) {
    this.rawStatus = [connected, message];
    const shown = this.storeFailed
      ? message
        ? join(message, T.storeFailed)
        : T.storeFailed
      : message;
    const key = JSON.stringify([connected, shown ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, shown)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The message of the last status (multi-language), or undefined. */
  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  /**
   * Writes /data. A failure is said in the status (the pauses, the stop and
   * the alarms would not survive a restart: an alarm could be announced
   * twice), and cleared by the next successful write.
   */
  async saveMemory() {
    let failed = false;
    try {
      await this.store.save(this.memory);
    } catch (err) {
      failed = true;
      this.logger.warn(`Saving the state to /data failed: ${err.message}`);
    }
    if (failed !== this.storeFailed) {
      this.storeFailed = failed;
      if (this.rawStatus) {
        await this.setStatus(...this.rawStatus);
      }
    }
  }

  /** The pause and the stop, with the address they belong to. */
  async persist() {
    this.memory.target = this.config.target;
    this.memory.pause =
      this.pauseKind && this.now() < this.pausedUntil
        ? { kind: this.pauseKind, until: this.pausedUntil, failures: this.failures }
        : null;
    this.memory.block = this.blocked
      ? { kind: 'refused', retries: this.retries, retryAt: this.retryAt }
      : null;
    await this.saveMemory();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** The next read: after the pause or the spaced retry, else the interval. */
  scheduleNext() {
    this.clearTimer();
    if (!this.client.configured) {
      return;
    }
    const now = this.now();
    const interval = this.config.pollInterval * 1000;
    let delay = interval;
    if (this.blocked) {
      delay = Math.max(this.retryAt, this.pausedUntil) - now;
    } else if (now < this.pausedUntil) {
      // Never read again faster than the interval, a pause included.
      delay = Math.max(this.pausedUntil - now, interval);
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`PoolDose refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for a button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    if (!this.client.configured) {
      return;
    }
    if (this.blocked && this.now() >= this.retryAt) {
      // The spaced new try after a refusal: one read.
      this.logger.info('PoolDose: trying again after a refusal');
      this.blocked = false;
    }
    if (this.blocked || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    this.client.setTimeoutMs(quick ? TIMINGS.quickTimeout : undefined);
    try {
      await this.read(generation);
      if (generation !== this.generation) {
        return;
      }
      const hadStop = this.retries > 0 || this.pauseKind !== undefined;
      this.failures = 0;
      this.retries = 0;
      this.retryAt = 0;
      this.offline = false;
      this.pauseKind = undefined;
      this.pausedUntil = 0;
      if (hadStop || this.memory.block || this.memory.pause || this.storeFailed) {
        await this.persist();
      }
      await this.setStatus(
        true,
        this.mapping
          ? T.connected(deviceName(this.identity), this.identity.model)
          : T.unsupported(this.identity.productCode, this.identity.fwCode),
      );
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    } finally {
      this.client.setTimeoutMs(undefined);
    }
    await this.publishBadge();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /** The identity now and then, the instant values each time. */
  async read(generation) {
    if (!this.identity || this.now() - this.identifiedAt >= TIMINGS.identifyEvery) {
      await this.identify();
    }
    if (generation !== this.generation || !this.mapping) {
      // A model without mapping: found, nothing to read.
      this.readAt = this.now();
      return;
    }
    const raw = await this.client.instantValues(this.identity.deviceId);
    if (generation !== this.generation) {
      return;
    }
    this.readAt = this.now();
    this.decoded = decode(raw, this.mapping);
    this.values = valuesOf(this.decoded, this.config.language);
    for (const role of this.values.keys()) {
      this.seen.add(role);
    }
    await this.publishDevices();
    this.queue();
    await this.announce();
  }

  /** params.js (the API version) and the debug config (model, firmware, ids). */
  async identify() {
    const { apiVersion, softwareVersion } = await this.client.params();
    const identity = await this.client.identity();
    identity.softwareVersion = softwareVersion;
    if (this.identity && this.identity.deviceId !== identity.deviceId) {
      // Another PoolDose answers at this address: a new device, new features.
      this.seen.clear();
      this.values = new Map();
      this.decoded = undefined;
      this.published = undefined;
    }
    this.identity = identity;
    this.identifiedAt = this.now();
    if (this.memory.deviceId !== identity.deviceId) {
      // Kept for the badge of a restart while the device does not answer.
      this.memory.deviceId = identity.deviceId;
      await this.saveMemory();
    }
    this.mapping = mappingFor(identity.productCode, identity.fwCode);
    const model = `${identity.productCode ?? '?'}/${identity.fwCode ?? '?'}/${apiVersion ?? '?'}`;
    if (this.loggedModel !== model) {
      this.loggedModel = model;
      this.logger.info(
        `PoolDose: model ${identity.productCode ?? '?'}, firmware code ${identity.fwCode ?? '?'}, API ${apiVersion ?? '?'}: ${this.mapping ? 'mapping found' : 'no mapping for this model yet'}`,
      );
      if (apiVersion && apiVersion !== API.version) {
        this.logger.warn(`PoolDose: API version ${apiVersion}, ${API.version} expected`);
      }
    }
  }

  /** A failure: a stop, a pause, or a backoff. Never a dead integration. */
  async failed(err) {
    const reason = errorReason(err);
    if (err.kind === 'no_host') {
      await this.setStatus(false, T.noHost);
      return;
    }
    if (IDENTIFY_AGAIN.has(err.kind)) {
      this.identifiedAt = -Infinity;
    }
    if (err.kind === 'refused') {
      const wait = TIMINGS.refusedRetry[Math.min(this.retries, TIMINGS.refusedRetry.length - 1)];
      this.retries += 1;
      this.blocked = true;
      this.retryAt = this.now() + wait;
      this.offline = true;
      this.logger.warn(
        `PoolDose stopped: ${reason}; one new try in ${Math.round(wait / 60_000)} min`,
      );
      await this.persist();
      await this.setStatus(false, T.refused(age(wait)));
      return;
    }
    let wait;
    let message;
    if (err.kind === 'rate_limited') {
      wait = this.pause(err);
      message = T.rateLimited(age(wait));
    } else {
      // Never read again faster than the poll interval.
      wait = Math.max(
        this.config.pollInterval * 1000,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.offline = true;
      message = T.unreachable(reasonOf(err), age(wait));
    }
    this.failures += 1;
    await this.persist();
    await this.setStatus(err.kind === 'rate_limited' && this.readAt !== undefined, message);
    this.logger.warn(`PoolDose: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  /** 429: a pause of Retry-After, between 60 s and 6 h, for every path (kept in /data). */
  pause(err) {
    const asked = err.retryAfter ?? TIMINGS.rateLimitDefault;
    const wait = Math.max(TIMINGS.rateLimitMin, Math.min(TIMINGS.rateLimitMax, asked));
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.pauseKind = 'rate';
    return wait;
  }

  // --- Alarms ----------------------------------------------------------------

  /**
   * The scene triggers of the alarms: one event per transition. The first
   * read of a device is the baseline (an alarm already there is not news);
   * the alarms are kept in /data before the events go, so a restart never
   * fires one again. An alarm not read this time keeps its last state.
   */
  async announce() {
    const id = this.identity.deviceId;
    const read = alarmsOf(this.values);
    const known = this.memory.alarms[id];
    const active = [...read].filter(([, on]) => on).map(([role]) => role);
    if (known === undefined) {
      this.memory.alarms[id] = active;
      await this.saveMemory();
      return;
    }
    const raised = active.filter((role) => !known.includes(role));
    const cleared = known.filter((role) => read.get(role) === false);
    if (raised.length === 0 && cleared.length === 0) {
      return;
    }
    this.memory.alarms[id] = [...known.filter((role) => !cleared.includes(role)), ...raised];
    await this.saveMemory();
    const events = [
      ...raised.map((role) => [SCENE_TRIGGERS.ALARM_RAISED, role]),
      ...cleared.map((role) => [SCENE_TRIGGERS.ALARM_CLEARED, role]),
    ].slice(0, LIMITS.eventsPerRead);
    const device = deviceIds(this.gladys, id).device;
    for (const [key, role] of events) {
      this.logger.info(
        `PoolDose: ${role} ${key === SCENE_TRIGGERS.ALARM_RAISED ? 'raised' : 'cleared'}`,
      );
      await this.gladys
        .publishSceneEvent(key, {
          device,
          alarm: role,
          alarm_name: alarmName(role, this.config.language),
          device_name: deviceName(this.identity),
        })
        .catch((err) => this.logger.warn(`Scene event ${key} failed: ${err.message}`));
    }
  }

  // --- Gladys ----------------------------------------------------------------

  /**
   * The device created in Gladys: by the DID read this session, else the one
   * kept in /data (a restart while the device does not answer), else the only
   * PoolDose device of this integration.
   */
  createdDevice() {
    const devices = this.gladys.devices ?? [];
    const id = this.identity?.deviceId ?? this.memory.deviceId;
    if (id) {
      const externalId = deviceIds(this.gladys, id).device;
      return devices.find((d) => d.external_id === externalId);
    }
    const prefix = this.gladys.externalId('pooldose:');
    const ours = devices.filter((d) => String(d.external_id).startsWith(prefix));
    return ours.length === 1 ? ours[0] : undefined;
  }

  /** The roles of the device already created in Gladys. */
  createdRoles() {
    return new Set(
      (this.createdDevice()?.features ?? [])
        .map((f) => parseFeatureId(this.gladys, f.external_id)?.role)
        .filter((role) => role !== undefined),
    );
  }

  async publishDevices() {
    if (!this.identity || !this.mapping) {
      return;
    }
    const device = buildDevice(
      this.gladys,
      { identity: this.identity, seen: this.seen, created: this.createdRoles() },
      this.config.language,
    );
    const devices = device.features.length > 0 ? [device] : [];
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** Queues the states of the device (the features created in Gladys only). */
  queue(created = this.createdFeatures()) {
    if (!this.identity) {
      return;
    }
    const ids = deviceIds(this.gladys, this.identity.deviceId);
    for (const { role, ...value } of statesOf(this.values)) {
      const id = ids.feature(role);
      if (created.has(id)) {
        this.publisher.push(id, value);
      }
    }
  }

  async publishBadge() {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    const entry = {
      external_id: created.external_id,
      ...(this.offline || this.blocked
        ? { transport: DEVICE_TRANSPORTS.UNREACHABLE }
        : { transport: DEVICE_TRANSPORTS.LOCAL }),
    };
    const json = JSON.stringify(entry);
    if (json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports([entry]);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queue(created);
    await this.flush();
    await this.publishBadge();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: a fresh read if the last one is old enough. */
  async scan() {
    if (
      this.client.configured &&
      !this.blocked &&
      this.now() >= this.pausedUntil &&
      (this.readAt === undefined || this.now() - this.readAt >= TIMINGS.testCooldown)
    ) {
      await this.tick({ quick: true });
      return;
    }
    await this.publishDevices();
  }

  /** Read only in v1: every feature is read only, a command is refused. */
  async setValue() {
    throw new PoolDoseError('read_only', word(T.readOnly, this.config.language));
  }

  // --- Configuration button --------------------------------------------------

  /** A 429 pause holds every path, the button included; `backoff`: the message after a restart. */
  pauseMessage({ backoff = false } = {}) {
    const left = this.pausedUntil - this.now();
    if (left <= 0) {
      return undefined;
    }
    if (this.pauseKind === 'rate') {
      return T.rateLimited(age(left));
    }
    return backoff && this.pauseKind === 'backoff' ? T.backoffKept(age(left)) : undefined;
  }

  async testConnection() {
    if (!this.client.configured) {
      return this.config.badHost ? T.badHost : T.noHost;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    // At most one read per 30 s from this button.
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last ? join(T.cooldown, last) : T.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // The button is how a stopped device is retried at once.
    this.blocked = false;
    this.retryAt = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    // The identity too: a firmware update may bring a mapping.
    this.identifiedAt = -Infinity;
    await this.tick({ quick: true });
    return this.lastMessage ?? T.noHost;
  }
}
