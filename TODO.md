# TODO — SEKO PoolDose v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`, then update README, `docs/en.md`,
  `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — read only** (2026-10-19): local API of python-pooldose
      0.9.15 (params.js, debug config, instant values), the 8 mapping files
      and the aliases, decoding, one Gladys device with temperature, pH, ORP,
      free chlorine, the three setpoints, the dosing pump modes and
      directions, the pause of the dosing, the circulation pump signal and 21
      alarms; scene triggers `alarm_raised` / `alarm_cleared`; stops and
      pauses kept in `/data`; test button; en/fr; docs. Tested against a fake
      PoolDose only. The store validator was not run by the agent (it cannot
      run it).
- [ ] **Milestone 2 — real device**: a user with a PoolDose compares the
      values with the device's web page: the units of `magnitude` (°C/°F,
      mV, CL2/ppm), the meaning of `alarm_ofa2_*`, `relay_alarm`, the
      `circulation_pump_status` labels; the meaning of `alarm-pump` on R1V0/HC
      (PDPR1H1HAR1V0, PDHC1H1HAR1V0/V1: their mapping turns an ON/OFF label
      into O/F, and ON may mean "the pump runs" rather than "alarm"; the
      mapping files stay untouched until a user confirms); the answer when the device is busy
      (HTTP status, delays); the Discovery name.
- [ ] **Milestone 3 — more readings**: probe calibrations (offset, slope,
      type), overfeed thresholds (`ofa_*_lower/upper`, `ofa_*_time`), water
      flow and meter (`flow_rate`, `water_meter_total_*`, with their unit
      select), auxiliary relays, delays; Wi-Fi RSSI and cloud status
      (WebSocket port 1334 of python-pooldose).
- [ ] **v2 — commands, off by default** (TODO, not in v1): pause of the
      dosing, pH/ORP/chlorine setpoints, dosing methods
      (`/api/v1/DWI/setInstantValues`, python-pooldose `set_value`). Rules
      to follow then: an option off by default, never a switch/binary (a
      "turn everything off" must not reach a dosing pump), a button or a
      list; a fresh read of the device just before acting, refused when it
      fails or lacks the value; the option checked again right before
      sending; setpoints bounded by `absMin`/`absMax`/`resolution` and by a
      tighter safety range; one command at a time; refused after ~3.5 s; an
      answer lost after sending is "sent, without confirmation"; the ack
      independent of the state publication.
- [ ] **First release**: cover image checked, Docker image build,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-seko-pooldose:0.1.0`):
  the first patch release gives 0.1.1.
- **Read only in v1** (Louis, lot 9 brief): chemical dosing is a sensitive
  command. No write endpoint is called, every feature is `read_only`,
  `onSetValue` refuses with a message. No `allow_commands` option yet: an
  option that does nothing would mislead.
- **Free chlorine and chlorine setpoint in ppm, the Ondilo exception**: the
  core lists `ppm` only for the CO/CO2 categories in
  `DEVICE_FEATURE_UNITS_BY_CATEGORY` and has no chlorine category; following
  the decision of gladys-ondilo for the salt (2026-10-17, Louis), they are
  `unknown`/`unknown` features in `ppm` (mg/L in water). CO/CO2 would be
  wrong (a gas in the air). Category, unit and external id key are fixed at
  creation: never change them. A `chlorine-sensor` category in the core
  would only apply to newly created devices.
- **Temperature always in °C**: the device may show °F (`magnitude`); the
  value is converted, the feature is created in `celsius` once and for all.
- **pH, ORP setpoints in the pH and ORP categories**: read-only sensors of
  the same unit as the measure (a scene can compare them); the chlorine
  setpoint in ppm like the measure.
- **Alarms as `unknown`/`binary` features** (as gladys-fluidra-pool), plus
  the two scene triggers; the first read of a device is a baseline (an alarm
  already on is not news), the active alarms are written to `/data` before
  the events are sent, an alarm not read this time keeps its state.
- **Device id = the `DID` of the first device of the debug config**
  ("0123456789_DEVICE"), as python-pooldose keys the instant values; never
  the IP address (it may change).
- **Mappings copied as they are** from python-pooldose (`src/mappings/`,
  excluded from Prettier): a new model is a new file, nothing else.
- **Never the Wi-Fi endpoints** (`getStation`, `getAccessPoint`): they answer
  with the Wi-Fi keys; python-pooldose only keeps them on request.
- **No WebSocket** (RSSI, cloud status of python-pooldose on port 1334): not
  needed for v1.
- **401/403 as a refusal**: the PoolDose has no authentication, but a proxy
  or a locked firmware in front may refuse; never a loop, spaced new tries.
- **No `should_poll`**: the integration drives its own timer (30 s minimum,
  60 s by default), the identity every 6 h.
- **The address is a host name or an IP only**: a path, a port, a user or a
  space is refused before any request; the port is its own field.
