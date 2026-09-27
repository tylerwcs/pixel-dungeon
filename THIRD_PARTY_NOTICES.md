# Browser dependencies

The build copies these libraries from the pinned npm dependency tree into `dist/vendor/`:

- `qrcode-generator`: MIT, Kazuhiko Arase. Source and license: https://github.com/kazuhikoarase/qrcode-generator
- `jsqr`: Apache-2.0, Cozmo. Source and license: https://github.com/cozmo/jsQR
- `h264-mp4-encoder`: MIT, Trevor Sundberg. Source and license: https://github.com/TrevorSundberg/h264-mp4-encoder

The MP4 encoder's prebuilt WebAssembly bundle includes the public-domain minih264 encoder and an MPL-1.1 libmp4v2 fork. The unmodified corresponding source is linked through the upstream repository's submodules: https://github.com/TrevorSundberg/h264-mp4-encoder. The build copies the npm library's license alongside the browser bundle. No local changes are made to that encoder.

`@vercel/functions` runs on the server only; it keeps an accepted generation task alive after returning its progress QR.
