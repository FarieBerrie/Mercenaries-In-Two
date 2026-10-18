# Third-party notices

MERCENARIES IN TWO uses the third-party work below. Everything else (code, guns, buildings,
foliage, effects, sound and music) is made for this game.

Every build of the game includes a copy of this file (`vite.config.js` copies it into `dist/`).

| What | Used for | Licence |
| --- | --- | --- |
| [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) | People (`public/assets/characters/`) and motion capture (`public/assets/anims/male.json`) | MIT, below |
| [three.js](https://threejs.org) | The renderer, bundled into the built game | MIT, below |
| [Poly Haven](https://polyhaven.com) | Surfaces (`public/assets/textures/`), skies (`public/assets/sky/`) and props (`public/assets/props/`) | [CC0 1.0](https://polyhaven.com/license) |
| [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani) | Interface type, loaded from Google Fonts (not included here) | [SIL Open Font License 1.1](https://openfontlicense.org) |

The Rocketbox characters were re-materialled and re-coloured for this game, and props were
decimated and their textures resized. `npm run assets` (`tools/assets/`) downloads and
converts both; see `public/assets/CREDITS.md`.

Poly Haven's assets are in the public domain (CC0), so no notice is required; they're credited
here anyway.

---

## Microsoft Rocketbox

MIT License

Copyright (c) 2020 Microsoft

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

---

## three.js

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
