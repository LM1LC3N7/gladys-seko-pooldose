# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, and its mapping files. The
ported logic was rewritten in JavaScript; it is changed from the original
(another language, another structure, only what this integration needs). The
mapping files are copied as they are.

## python-pooldose

- Project: [lmaertin/python-pooldose](https://github.com/lmaertin/python-pooldose),
  the Python client of the SEKO PoolDose local API used by Home Assistant, by
  Lukas Maertin (lmaertin), version 0.9.15 (tag `0.9.15`, commit `bdff250`).
- What is ported (in `src/client.js` and `src/pooldose.js`): the endpoints of
  the local API (`/js_libs/params.js`, `/api/v1/debug/config`,
  `/api/v1/DWI/getInstantValues`), the reading of the software and API
  versions in `params.js`, the identity of the device in the debug config
  (gateway and device ids, product code, firmware code), the model aliases,
  the key prefix of the raw values, and the decoding of the values with a
  mapping (sensors, binary sensors, switches, numbers, selects, their
  conversions and units).
- What is copied (in `src/mappings/`): the mapping files
  `model_<PRODUCT_CODE>_FW<FW_CODE>.json` of `src/pooldose/mappings/`,
  unchanged.
- Licence: MIT. Its full notice:

```text
MIT License

Copyright (c) 2025 Lukas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
