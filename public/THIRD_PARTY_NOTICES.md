# Third-party notices

The repository's root MIT license applies to original project code and documentation.
An identical copy is included for built distributions: [Project MIT license](licenses/chidori-MIT.txt).
Third-party software, model files and test photographs retain their upstream licenses;
they are not relicensed under MIT. This project is an unofficial fan-made technical
experiment, not affiliated with or endorsed by any anime rights holder.

## MediaPipe

- MediaPipe Tasks Vision: `@mediapipe/tasks-vision` 0.10.32, Apache-2.0.
- Upstream: https://github.com/google-ai-edge/mediapipe
- Pinned source: `8317ba78778738ba90a521e7e4580a2ba0129c81` (v0.10.32).
- Copyright The MediaPipe Authors; the test-data BUILD credits Copyright 2022
  The MediaPipe Authors.
- Complete upstream license, including its scoped supplement: [MediaPipe LICENSE](licenses/mediapipe-LICENSE.txt).
- Unmodified test photographs `tests/fixtures/fist.jpg` and `right_hands.jpg`
  are official MediaPipe test assets. Their pinned sources, hashes and attribution
  are documented in `tests/fixtures/PROVENANCE.md` in the source repository.
- The hand-landmarker model and JS/WASM runtime are downloaded/copied by
  `npm run setup:models`; these generated files are not checked into Git.
  The model is the official MediaPipe hand-landmarker float16 revision 1:
  https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker#models

## Lucide

- Package: `lucide` 0.468.0, ISC.
- Upstream: https://github.com/lucide-icons/lucide
- Copyright (c) Lucide Contributors 2022.
- Portions originate from Feather (MIT): Copyright (c) Cole Bemis 2013-2022.
- Complete upstream license and Feather notice: [Lucide LICENSE](licenses/lucide-LICENSE.txt).

## Distribution

Keep the relevant license texts and notices with copies or distributions.
Vite copies this file and `public/licenses/` into production builds automatically.
Development tools and transitive packages remain under their own licenses listed
in their packages and the dependency lockfile.
