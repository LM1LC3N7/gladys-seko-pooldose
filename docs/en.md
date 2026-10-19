# SEKO PoolDose

Unofficial integration, not affiliated with SEKO. It brings a **SEKO
PoolDose** pool controller into Gladys (and the models built on it: VÁGNER
POOL VA DOS, BWT MEDO CONNECT, KEMI DOSE AQUAVIVA), read through **its own
HTTP API on the local network**, without an account nor the cloud.

> **Warning: this integration has never been tested with a real device.** It was written from the python-pooldose library (the one of Home Assistant) and tested against a fake PoolDose only. Feedback is welcome.

**Read only.** Gladys never commands the PoolDose: no dosing, no dosing pump,
no pH, ORP or chlorine setpoint, no pause of the dosing. A wrong chemical
dosing puts the swimmers at risk; these values are only shown. Commands are
planned for a later version, off by default.

## What you get

A "PoolDose" device with, depending on your model:

| Feature                               | Type in Gladys                                   |
| ------------------------------------- | ------------------------------------------------ |
| Water temperature                     | Temperature (°C)                                 |
| pH, pH setpoint                       | pH                                               |
| ORP (redox), ORP setpoint             | ORP (mV)                                         |
| Free chlorine, chlorine setpoint      | Generic sensor in ppm (= mg/L)                   |
| Mode of the pH, ORP, chlorine pumps   | Text (off, proportional, on / off, timed, cycle) |
| Dosing direction of pH, ORP, chlorine | Text (acid pH−, alkaline pH+…)                   |
| Dosing paused, circulation pump       | Binary (0/1)                                     |
| Alarms                                | Binary (0/1), and scene triggers                 |

Gladys has no "chlorine" category: free chlorine is a generic sensor in ppm,
like the salt of the Ondilo integration. A temperature the device shows in °F
reaches Gladys in °C. A value your model does not have creates no feature.

The **alarms**: dosing pump, tank levels (pH, ORP, chlorine), water flow,
alarm relay, overfeed (pH, ORP, chlorine), water too cold or too hot, pH too
low or too high, chlorine too low or too high (ORP or direct measure), system
on standby. Each one is a binary feature and feeds the two **scene
triggers**:

- **PoolDose alarm raised**: an alarm turns to 1;
- **PoolDose alarm cleared**: an alarm turns back to 0.

In the scene, pick the PoolDose and the alarms you want (none = all). The
variables `alarm_name` (name of the alarm) and `device_name` (name of the
device) are available to the actions, for a message for instance. An alarm
already on at the very first read is not announced (its feature shows it);
the alarms are kept in `/data`, so a restart never repeats an alarm and
announces one raised while it was stopped.

## Supported models

The models of python-pooldose 0.9.15: PoolDose Double (PDPR1H1HAW100, and
PDPR1H1HAW102), PoolDose Double Spa (PDPR1H04AW100), PoolDose pH
(PDPH1H1HAW100), BWT MEDO CONNECT (PDPH1H1HAW1B0), VÁGNER POOL VA DOS BASIC
and EXACT (PDHC1H1HAR1V0, PDHC1H1HAR1V1), KEMI DOSE AQUAVIVA (KDPR5050AWH00,
KDHC5050AWH01), with their known firmware. Another model is found, but
nothing is read: the status of the integration gives its product code and
firmware. To have it added, follow the procedure of python-pooldose (its
`docs/device-support.md`) and report it here.

## Installation

1. The PoolDose must be on your Wi-Fi (SEKO app or the web page of the
   device). Give it a **fixed address** in your router (DHCP reservation).
2. In Gladys, install the SEKO PoolDose integration, enter the **IP address**
   of the device (for instance `192.168.1.50`), then save.
3. Add the device from the **Discovery** tab.

The port (0 = standard), HTTPS and the check of its certificate only matter
when your device answers otherwise than HTTP on port 80.

## Privacy and security

- No account, no password: the local API of the PoolDose asks for none.
  Nothing leaves your network.
- Only three paths of the device are read: `/js_libs/params.js` (versions),
  `/api/v1/debug/config` (model, firmware, ids) and
  `/api/v1/DWI/getInstantValues` (values). The Wi-Fi endpoints of the device,
  which answer with the Wi-Fi key, are never called. No write endpoint is
  called.
- The integration introduces itself as "gladys-seko-pooldose".
- The logs never hold the address of the device.

## Refresh

The device is read every 60 seconds by default (30 to 900): one request for
the values. The model and the firmware are read again every 6 hours (a
firmware update), and by the **Test the connection** button.

## Errors

- **No answer** (device off, Wi-Fi down, wrong address) or a 5xx: a new try
  after 1, 2, 5, 10 then every 15 minutes, never faster than the interval;
  the badge turns "unreachable". This wait is kept across a restart; the
  **Test the connection** button tries at once.
- **Access refused** (HTTP 401 or 403, a proxy in front of the device for
  instance): the integration stops, without a loop; one new try after 1 h,
  6 h then every 24 h, or at once with the button or a new address. The stop
  is kept across a restart.
- **The device asks to slow down** (429): a pause of at least 1 minute
  (Retry-After when given, 6 h at most), kept across a restart.
- **Unexpected answer** (404, not JSON): the model is read again at the next
  try.

## Limits

- Never tested with a real device: the mappings come from python-pooldose,
  checked by its users.
- On the VÁGNER POOL VA DOS (PDPR1H1HAR1V0, PDHC1H1HAR1V0/V1), the meaning
  of the **dosing pump alarm** is not confirmed: the device gives an ON/OFF
  label that may mean "the pump runs" rather than "alarm". Check it on the
  device before using it in a scene.
- The "Low" / "High" values of the ORP or chlorine dosing direction are
  given as the device names them.
- Read only: no command of the dosing pumps, the setpoints, the pause of the
  dosing nor the relays (planned later, off by default).
- Not read yet: probe calibrations, overfeed thresholds, water flow and
  meter, auxiliary relays, delays.

## Credits

- [python-pooldose](https://github.com/lmaertin/python-pooldose) by lmaertin
  (MIT): the local API, the identification of the model and the decoding of
  the values are ported to JavaScript; the mapping files are taken as they
  are.
- See `THIRD_PARTY_NOTICES.md`.

SEKO and PoolDose are trademarks of their owners; this project is not
affiliated with SEKO.
