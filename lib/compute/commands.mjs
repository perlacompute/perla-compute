const installer =
  "https://github.com/perlacompute/perla-compute/releases/download/mainnet-worker-v1.2.0/install.sh";
export function workerCommand(release, address, name, device) {
  if (
    !release?.verified ||
    release.installerUrl !== installer ||
    !/^[a-f0-9]{64}$/.test(release.installerSha256 || "") ||
    !/^0x[0-9a-fA-F]{40}$/.test(address || "") ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(name || "") ||
    !Number.isInteger(Number(device)) ||
    Number(device) < 0 ||
    Number(device) > 63
  )
    return "";
  return [
    `curl --fail --show-error --location --proto '=https' --proto-redir '=https' '${installer}' -o install-perla-mainnet.sh`,
    `printf '%s  %s\\n' '${release.installerSha256}' install-perla-mainnet.sh | sha256sum -c -`,
    "bash install-perla-mainnet.sh",
    `"$HOME/.local/bin/perla-mainnet" start --wallet ${address} --worker ${name} --device ${Number(device)}`,
  ].join("\n");
}
