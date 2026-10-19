# License notices

## En Croissant

Chess Reviewer is adapted from En Croissant `0.15.1` at commit `a91f32b1c57eb93acad92f9778205eac7b4345d9`. The upstream project is licensed under GPL-3.0-only. See [`../LICENSE`](../LICENSE) and retain the upstream copyright/license notices when redistributing this fork.

## Patzer-derived tactics

The selected TypeScript tactics in `../src/commentary/vendor/patzer-tactics.ts` are adapted from Patzer `7.18.1`, commit `f21b32c81189c10a318397076cbd015f5b458973`, licensed under MIT. The upstream notice and license text are retained in [`../../upstream/patzer/LICENSE`](../../upstream/patzer/LICENSE). No Patzer server, web bundle, model, or Docker runtime is included in Chess Reviewer.

The MIT license text is included here so it can be shipped with the desktop bundle:

```text
MIT License

Copyright (c) 2026 the Patzer contributors

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

## Stockfish

The Windows installer bundles Stockfish 19 from the official Stockfish release. Stockfish is licensed under GPL-3.0-or-later. Its source and license information are available from the [official Stockfish repository](https://github.com/official-stockfish/Stockfish). Redistribution of this application must continue to satisfy the GPL obligations that apply to both En Croissant and Stockfish.

## chess.js

Chess Reviewer pins `chess.js` `1.4.0`, a BSD-2-Clause chess rules library. Its license text is reproduced below for packaged distributions:

```text
Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## Other dependencies

En Croissant's existing dependencies retain their own license terms and notices. Consult the package manifests/lockfiles and upstream notices before redistribution. This file is a convenience inventory, not legal advice or a replacement for the complete license texts.
