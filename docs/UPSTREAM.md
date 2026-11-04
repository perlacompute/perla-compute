# Credits and upstream provenance

Perla is an independent project. Its native proof interface, mathematical verifier and Hopper model integration use open-source components from Pearl Research Labs. The pinned upstream revision is `82e6eee7076aafe10123e08db78f100d270c0582`:

https://github.com/pearl-research-labs/pearl/tree/82e6eee7076aafe10123e08db78f100d270c0582

The source also informs the declining reference reward curve. Perla supplies its application coordinator, wallet authorization, worker bridge, contribution ledger, reward accounting and Robinhood integration. Its RTX worker adds a portable INT8 matrix backend.

Copyright and license information is retained with the [adapter](../services/pearl-adapter/NOTICE.md), [RTX worker](../services/rtx-worker/NOTICE.md), [UI stylesheet](../vendor/shadcn-tailwind-4.13.0.LICENSE.md), [DM Sans](../public/fonts/dm-sans-OFL.txt) and [Instrument Serif](../public/fonts/instrument-serif-OFL.txt). Upstream subprojects, dependencies, fonts and model weights retain their own licenses. Names identify their respective owners and do not establish affiliation or endorsement.

## Compatibility identifiers

The `perla-pearl-plain-v4` protocol, the `pearl_mining` Python module, package paths and original model IDs are compatibility identifiers. Renaming them for cosmetic branding would break proof verification, model loading or existing worker deployments. Historical verification records also retain the exact source revision tested.

Product copy uses Perla branding. Required attribution, technical identifiers, source links and historical validation records remain explicit. Published worker tags, binaries, checksums and assets are not rewritten by a documentation cleanup.

[Website credits](https://perlacompute.xyz/docs#sources) · [Worker installer](../WORKER_INSTALLER.md)
