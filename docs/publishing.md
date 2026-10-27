# GitHub setup and first publication

The owner has created the dedicated GitHub account **perlacompute**. The target repository is **perlacompute/perla-compute**. The remote repository is not created by this source archive.

Use the perlacompute account as the repository owner. Keep its login email under the account owner's control. Add a domain email as a public contact only after its inbox exists. Do not invent a security contact or a CODEOWNERS identity.

## Suggested project settings

| Field | Value |
| --- | --- |
| Profile display name | Perla |
| Profile bio | Building GPU mining infrastructure for AI compute on Robinhood Chain. |
| Website | https://perlacompute.xyz |
| Repository | perla-compute |
| Description | Testnet GPU mining infrastructure on Robinhood Chain with native proof verification and funded reward epochs. |
| Topics | gpu-mining, verifiable-compute, robinhood-chain, testnet, ai-infrastructure |
| Initial branch | main |
| Initial visibility | Private until the owner chooses public publication |

The account username was supplied by the owner; authenticated access and remote repository creation still need verification. [Profile copy](github-profile.md) is included for an optional public profile repository named perlacompute. That profile is not displayed merely by adding the draft to this project.

## Prepare a clean checkout

Extract the reviewed source archive into a separate directory. Do not initialize Git directly in the live VPS folder; runtime configuration, databases and installer state belong outside the published checkout.

```bash
git init -b main
git add .
node scripts/checks/source-audit.mjs
git diff --cached --stat
```

Set the account owner's chosen Git name and verified or GitHub-provided noreply email locally before the first commit. This archive does not invent the owner's identity or contain GitHub credentials.

```bash
git commit -m "Initial Perla Compute testnet source"
```

## Create the remote after authentication

Authenticate with GitHub or an already connected integration, verify access to the perlacompute account, and inspect a conflicting repository rather than replacing it. The example below targets the account's repository:

```bash
gh auth status
gh repo create perlacompute/perla-compute --private --source=. --remote=origin --push \
  --description "Testnet GPU mining infrastructure on Robinhood Chain with native proof verification and funded reward epochs." \
  --homepage "https://perlacompute.xyz"
```

The command creates a private repository and pushes the reviewed commit. Change visibility to public only when the owner explicitly chooses publication. Do not force-push an existing remote. A repository URL, account permission, or successful CI result must be verified from GitHub before being reported as established.

## Complete repository settings

Set the default branch to main, enable Issues, and review Actions permissions. The checked-in issue forms and PR template are ready. Run the software workflow and inspect its real result before adding status badges. Enable available dependency/security features and a private vulnerability reporting channel when supported by the repository's visibility and plan. Apply branch protection or rulesets only after the actual CI check names and maintainer access are known.

The release workflow creates draft release artifacts for matching version tags after checks pass. Do not push a release tag just to make an empty repository appear active. The workflows do not deploy the VPS, sign blockchain transactions, fund rewards or activate mining.

Official references: [creating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository), [repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/setting-repository-visibility), [GitHub CLI repo create](https://cli.github.com/manual/gh_repo_create).
