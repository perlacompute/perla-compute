# Third-party notices

The root MIT license applies to Perla-authored material. It does not replace the licenses or copyright notices of third-party code, assets or dependencies.

## Pearl integration

The adapter fetches the pinned upstream checkout:

`https://github.com/pearl-research-labs/pearl/tree/82e6eee7076aafe10123e08db78f100d270c0582`

That checkout supplies the CUDA kernels, vLLM integration, proof construction and native Rust/PyO3 verifier. The upstream checkout is fetched during builds rather than vendored in this source tree. Build scripts retain its source notices, and the native-verifier setup image retains the upstream root license. Subprojects and dependencies retain their individual licenses. See [services/pearl-adapter/NOTICE.md](services/pearl-adapter/NOTICE.md).

## UI and fonts

- The bundled shadcn Tailwind stylesheet retains its MIT notice at `vendor/shadcn-tailwind-4.13.0.LICENSE.md`.
- DM Sans retains its OFL notice at `public/fonts/dm-sans-OFL.txt`.
- Instrument Serif retains its OFL notice at `public/fonts/instrument-serif-OFL.txt`.
- Package dependencies retain their own licenses. The npm lockfile records the installed dependency graph.

Project names, model names and marks identify their respective owners and do not establish affiliation. Model weights are not included in this repository and have their own access requirements and licenses.

## Share-image font instance

`public/fonts/dm-sans-og.ttf` is a static weight-400/default-optical-size instance of the existing DM Sans variable font, generated for the PNG share renderer. It retains the font's copyright metadata and the existing SIL Open Font License in `public/fonts/dm-sans-OFL.txt`. The regular website font remains the original variable font.
