# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- SEKO PoolDose pool controllers through their local HTTP API (ported from
  python-pooldose 0.9.15): `params.js`, the debug config (model, firmware,
  ids), the instant values decoded with the mapping files of python-pooldose
  (8 models, aliases included). Read only: no write endpoint is ever called,
  nor the Wi-Fi endpoints (they answer with the Wi-Fi key).
- Water temperature (°C, converted from °F), pH, ORP, free chlorine (generic
  sensor in ppm), the pH, ORP and chlorine setpoints, the mode and the
  direction of the dosing pumps (text), the pause of the dosing, the
  circulation pump signal, 21 alarms as binary features.
- Scene triggers "PoolDose alarm raised" and "PoolDose alarm cleared", one
  event per transition, filtered by device and alarm; the first read is a
  baseline and the alarms are kept in `/data`, so a restart never fires one
  again.
- Read every 60 s (30 to 900); the identity again every 6 h. A refusal
  (401/403) stops the reads with a new try after 1 h, 6 h, then every 24 h;
  a 429 pauses every path for 60 s to 6 h; no answer or a 5xx backs off (1 to
  15 min, never faster than the interval); all kept across restarts.
- "Test the connection" button; the status, the Discovery list and the badge
  are sent again at each reconnection to Gladys; a republished device keeps
  its features.
- HTTP by default; HTTPS, another port and a self-signed certificate on
  request. Feature names, dosing modes and alarm names in French or English.

### Fixed

- A temperature without a magnitude follows the unit setting of the device
  (°F converted); "ºF" and "˚F" are read as "°F".
- An alarm answer other than O/F, a boolean or 0/1 keeps the alarm as it was
  (no false "cleared").
- A failed write of `/data` is said in the status.
- A new address keeps the alarm memory of the device (keyed by its id): only
  the pause and the stop are reset.
- The badge turns unreachable after a restart while the device does not
  answer (its id is kept in `/data`).
- Dosing labels: `on_off` added; "low" / "high" shown as "Low" / "High".
- getInstantValues is sent without a body (`Content-Length: 0`).

[Unreleased]: https://github.com/LM1LC3N7/gladys-seko-pooldose/commits/main
