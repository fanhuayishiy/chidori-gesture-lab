# Public MediaPipe hand fixtures

These unmodified photographs are used only for deterministic local inference tests.
They are not user camera captures and are not sent to a remote inference service.

Retrieved 2026-10-04 from the Google-hosted public MediaPipe asset bucket:

- `fist.jpg`: https://storage.googleapis.com/mediapipe-assets/fist.jpg
- `right_hands.jpg`: https://storage.googleapis.com/mediapipe-assets/right_hands.jpg

SHA-256 of the downloaded originals:

| File | SHA-256 |
| --- | --- |
| `fist.jpg` | `43fa1cabf3f90d574accc9a56986e2ee48638ce59fc65af1846487f73bb2ef24` |
| `right_hands.jpg` | `4b5134daa4cb60465535239535f9f74c2842aba3aa5fd30bf04ef5678f93d87f` |

Both filenames are listed in the official MediaPipe test-data BUILD file:
https://github.com/google-ai-edge/mediapipe/blob/8317ba78778738ba90a521e7e4580a2ba0129c81/mediapipe/tasks/testdata/vision/BUILD

The BUILD package declares `licenses = ["notice"]` (Apache 2.0) and credits
Copyright 2022 The MediaPipe Authors. The upstream license is available at
https://github.com/google-ai-edge/mediapipe/blob/8317ba78778738ba90a521e7e4580a2ba0129c81/LICENSE.
The full upstream license is also included locally at
[public/licenses/mediapipe-LICENSE.txt](../../public/licenses/mediapipe-LICENSE.txt).

Pinned upstream asset definitions and checksums:
https://github.com/google-ai-edge/mediapipe/blob/8317ba78778738ba90a521e7e4580a2ba0129c81/third_party/external_files.bzl

The official HandLandmarker test identifies `right_hands.jpg` as its two-hand fixture:
https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/python/test/vision/hand_landmarker_test.py

`inference-landmarks.png` is generated (not committed) by `tests/model.spec.ts`, with local
landmarks and numerical readings overlaid. It validates still-image inference,
not live camera permission, camera frame delivery, or the complete camera UX.

Verified on 2026-10-04 using Edge, MediaPipe Tasks Vision 0.10.32, the locally
installed `hand_landmarker.task`, and the CPU delegate:

- Fist: one hand, 21 landmarks, openness 0.000, expansion 0.000.
- Two open palms: two hands, 21 landmarks each, individual openness 1.000 each.
- Two-hand distance expansion: 0.863.
- No external HTTP(S) requests during browser inference.

Run with the local model/WASM assets installed:

```sh
npx playwright test tests/model.spec.ts
```
