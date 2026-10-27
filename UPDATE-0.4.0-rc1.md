# Update from Perla 0.3.0 to the RTX validation preview

Use `perla-rtx-0.4.0-rc1.zip` and its `apply.sh` for an existing 0.3.0 VPS.
The archive's README documents the exact command and rollback behavior.

This source adds an RTX30/40/50 standalone matrix worker, GPU self-tests,
package checksums and installation guides. The setup page defaults to RTX and
retains the H100/H200 inference guide as a separate option. Native CUDA targets
sm86/sm89/sm120 are included; physical-host GPU validation is still required.

The source patch updates web files and downloadable packages only. It preserves
`.env`, persistent data, contracts, Nginx, verifier and admission settings. It
sends no chain transaction and funds no epoch. The GPU image is built on a
separate GPU host, from the downloadable `perla-rtx-worker.tar.gz` package.

Read `services/rtx-worker/README.md` before testing. Build the image, run its
offline self-test with a physical device, then conduct a supervised one-share
trial. Do not open public admission based only on a successful website update.

See `docs/validation-0.4.0-rc1.md` for exact evidence, the missing hardware and
Docker validation, the easy-difficulty limitation, and the distinction between
standalone matrix mining and AI inference. This is an RC validation package,
not a declaration of full production GPU support.
