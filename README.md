# gladys-seko-pooldose

[Gladys Assistant](https://gladysassistant.com) external integration for the
**SEKO PoolDose** pool controllers (and the VÁGNER POOL, BWT and KEMI DOSE
models built on them), read through the HTTP API of the device on the local
network: water temperature, pH, ORP, free chlorine, the setpoints, the mode of
the dosing pumps and the alarms, each alarm also as a scene trigger. **Read
only**: Gladys never doses nor changes a setpoint. Unofficial, not affiliated
with SEKO.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Tested against a fake PoolDose only,
> never with a real device.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (PoolDoseApp) ⇄ src/client.js ⇄ http://<PoolDose>/
                                   ├─ src/pooldose.js   mappings (src/mappings/*.json) and decoding (pure)
                                   ├─ src/devices.js    -> Gladys device, states, alarms (pure)
                                   ├─ src/store.js      /data: pauses, stop, alarms
                                   └─ src/publisher.js  300 states/min
```

- **Identity** (as python-pooldose `connect()`): `GET /js_libs/params.js`
  (software and API versions), `GET /api/v1/debug/config` (gateway, first
  device: `DID`, `PRODUCT_CODE`, `FW_CODE`). The mapping is
  `src/mappings/model_<PRODUCT_CODE>_FW<FW_CODE>.json`, or the one of its
  alias (`MODEL_ALIASES`); the raw keys are prefixed with
  `<alias or PRODUCT_CODE>_FW<FW_CODE>_`. Read again every 6 h, after a 404 or
  a bad answer, and by the button. The Wi-Fi endpoints (`getStation`,
  `getAccessPoint`: they hold the Wi-Fi keys) are never called.
- **Reading**, every 60 s (30 to 900): `POST /api/v1/DWI/getInstantValues`,
  `devicedata[DID]`, decoded with the mapping (sensor, binary_sensor, switch,
  number, select, their conversions and units, as `instant_values.py`).
  Answers bounded (512 KB, 128 KB for `params.js`), JSON without prototype
  keys and depth bounded, values range-checked. 401/403: a stop kept in
  `/data`, new tries after 1 h, 6 h, 24 h. 429: a pause of Retry-After between
  60 s and 6 h. No answer and 5xx: 1, 2, 5, 10, 15 min, never under the
  interval. Everything kept in `/data/pooldose-state.json` (0600) with a hash
  of the address. User-Agent `gladys-seko-pooldose/0.1`.
- **Device**: `ext:<selector>:pooldose:<DID>`. Features by role:
  `temperature`, `ph`, `orp`, `free-chlorine` (unknown, ppm),
  `ph-target`, `orp-target`, `chlorine-target`, `*-dosing-method` and
  `*-dosing-type` (text), `dosing-paused`, `circulation-pump`, and 21
  `alarm-*` (binary). All read only. A republished device keeps the
  features it was created with.
- **Scene triggers** `alarm_raised` and `alarm_cleared`: one event per
  transition of an `alarm-*` role, data `{ device, alarm, alarm_name,
device_name }`; the first read of a device is the baseline, the active
  alarms are persisted before the events go.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/helpers/fakePoolDose.js` is a fake PoolDose Double (PDPR1H1HAW100,
firmware code 539187) behind the transport. `node scripts/cover.mjs
cover.png` draws the store cover.

## Credits

- [lmaertin/python-pooldose](https://github.com/lmaertin/python-pooldose)
  0.9.15 (MIT): the API, the identification and the decoding are ported to
  JavaScript; the mapping files are copied unchanged.
- Notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic and the mapping files
are MIT (python-pooldose), see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
SEKO and PoolDose are trademarks of their owners; this project is not
affiliated with SEKO.
