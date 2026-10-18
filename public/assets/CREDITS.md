# Third-party assets

Everything in this folder is built from the sources below by `npm run assets`
(`tools/assets/`), which downloads them, converts and compresses them.

| What | Source | Licence |
| --- | --- | --- |
| People (`characters/`) and motion capture (`anims/male.json`) | [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) | [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md), Copyright (c) 2020 Microsoft |
| Surfaces (`textures/`), skies (`sky/`) and props (`props/`) | [Poly Haven](https://polyhaven.com) | [CC0 1.0](https://polyhaven.com/license) |

The full licence texts are in `THIRD_PARTY_NOTICES.md`, at the top of the repository and next
to `index.html` in every build.

Characters were re-materialled and re-coloured for this game (camouflage, uniforms); their
masks, bandanas and caps are fitted to them in code. Props were decimated and their textures
resized. Guns, buildings, foliage, effects, sound and music are made in code for this game.
