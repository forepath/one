# Agenstra Desktop (native agent console)

Agenstra Desktop (`apps/agenstra/native-agent-console`) is the Electron shell around the agent console. It is a secondary channel next to the web console and is released with every Agenstra version through the shared ForePath desktop release pipeline (`tools/desktop-release` in the repository).

## Downloads

All files are published at [downloads.agenstra.com](https://downloads.agenstra.com/) under `releases/<version>/desktop/`:

| Platform              | File                                                              | Signed with                          |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| macOS (Apple silicon) | `native-agent-console-darwin-arm64-<version>.zip`                 | Apple Developer ID, notarized        |
| macOS (Intel)         | `native-agent-console-darwin-x64-<version>.zip`                   | Apple Developer ID, notarized        |
| Windows (x64)         | `agenstra_<version>_amd64.exe` (installer)                        | Authenticode                         |
| Windows (x64)         | `native-agent-console-win32-x64-<version>.zip`                    | Authenticode (binaries)              |
| Linux (x64)           | `agenstra_<version>_amd64.deb`, `agenstra-<version>-1.x86_64.rpm` | ForePath GPG key (rpm, repositories) |
| Linux (x64)           | `native-agent-console-linux-x64-<version>.zip`                    | checksums only                       |

Every file is also listed with its SHA-256 in `SHA256SUMS` and in the signed release manifest; see [Desktop release integrity](../security/vulnerability-reporting-and-artifacts.md#desktop-release-integrity). Operating-system signatures are applied once ForePath's signing certificates are configured in the release pipeline; releases built before that are unsigned (see [AR-001](../security/accepted-risks.md#ar-001-desktop-app-no-os-trusted-code-signing--no-in-app-auto-update)).

## Install on Linux from the package repository

The apt and rpm repositories are signed with the ForePath desktop GPG key (`https://downloads.agenstra.com/forepath-desktop.asc`). Updates then arrive through the package manager.

**Debian / Ubuntu**

```bash
curl -fsSL https://downloads.agenstra.com/forepath-desktop.asc | sudo gpg --dearmor -o /usr/share/keyrings/forepath-desktop.gpg
sudo curl -fsSL -o /etc/apt/sources.list.d/agenstra.sources https://downloads.agenstra.com/apt/agenstra-stable.sources
sudo apt update && sudo apt install agenstra
```

**Fedora / RHEL / openSUSE (dnf / zypper)**

```bash
sudo rpm --import https://downloads.agenstra.com/forepath-desktop.asc
sudo curl -fsSL -o /etc/yum.repos.d/agenstra.repo https://downloads.agenstra.com/rpm/stable/agenstra.repo
sudo dnf install agenstra
```

For the beta channel use `agenstra-beta.sources` / `rpm/beta/agenstra.repo` instead. Compare the key's fingerprint (`gpg --show-keys forepath-desktop.asc`) with the one published by ForePath before trusting it.

## In-app updates

The app checks for updates a minute after start and every six hours, or on demand via **Settings (⚙) → Check for updates** (macOS: application menu **Settings → Check for Updates...**).

- **Channels**: **Stable** (default) or **Beta**, selectable in the same settings dialog / menu. A beta install receives beta and stable releases; a stable install only stable releases. Switching from beta back to stable keeps the installed beta until a newer stable release exists — the app never installs an older version.
- **Verification before install**: the update feed only points at the release; the app downloads the **signed Agenstra release manifest**, verifies its ECDSA signature against the public keys compiled into the app, checks product, version, channel and that it is newer than the installed version, then downloads the platform file and checks its SHA-256 and size against the manifest. Anything that does not match is refused.
- **macOS**: the verified zip is applied through Electron's Squirrel.Mac updater, which additionally requires the update to carry the same Developer ID signature; the app restarts into the new version.
- **Windows** (installer installs): the verified installer runs silently and restarts the app. When the installed app is Authenticode-signed, the installer must be signed by the same publisher. Zip installs show a download link instead.
- **Linux**: deb / rpm installs are told to update with `sudo apt update && sudo apt install --only-upgrade agenstra` or `sudo dnf upgrade agenstra`; zip installs get a download link.
- Development builds (`0.0.0`, not packaged) never check for updates.

Settings are stored in `config.json` in the app's user-data directory (`updateChannel`, next to `configUrl`); update downloads go to `updates/` there and are replaced by the next download. Update activity is logged to `logs/main.log`.

## Related documentation

- **[Frontend Agent Console](./frontend-agent-console.md)** The console the desktop app hosts
- **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)** Checksums, signed manifests, signature verification
- **[Accepted risks](../security/accepted-risks.md)** AR-001 (desktop signing and updates)
