# Run ACOS on Windows 11

The local AI runtime runs in **Ubuntu 24.04 on WSL2**, and the dashboard opens in your regular Windows browser. The reference installer supports Intel/AMD x64 PCs. An ARM/Snapdragon PC needs a different engine build and is not supported by this installer.

Allow about 2 GB of free disk space, at least 8 GB of Windows RAM, and Internet access for installation. Model execution is offline after installation. Your computer must remain awake and the launcher must remain running to use ACOS.

## 1. Install WSL2

Open **PowerShell as administrator**, paste this command, and restart Windows if asked:

```powershell
wsl --install -d Ubuntu-24.04
```

Open **Ubuntu 24.04** from the Start menu and create the Linux username/password when prompted. Use a normal user account. This Ubuntu password is used for `sudo`; it is separate from the ACOS administrator key.

In PowerShell, confirm Ubuntu is using **VERSION 2**:

```powershell
wsl --list --verbose
```

If it shows version 1:

```powershell
wsl --set-version Ubuntu-24.04 2
```

If installation fails or WSL is old, run `wsl --update`, restart, and retry. Firmware virtualization must be enabled. See [Microsoft’s WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install).

## 2. Install ACOS inside Ubuntu

Run these commands in the **Ubuntu terminal**, not PowerShell. The implementation is currently published on the task branch, so these commands deliberately select it while the merge to `main` is pending.

```bash
cd ~
sudo apt-get update
sudo apt-get install -y git
git clone --branch coderabbit/finish-acos-dashboard/a1c71758 https://github.com/corenetworkadmin-gif/acos-dashboard.git acos-dashboard
cd ~/acos-dashboard
bash src/host/setup-wsl.sh
```

If GitHub asks for authentication, use your own GitHub access for this repository. If `~/acos-dashboard` already exists, do not delete it: enter it, commit/stash your work if needed, fetch, switch to the task branch, and use `git pull --ff-only` before running setup.

The setup script:

- Checks WSL2, Ubuntu 24.04, x64 architecture, and the Linux filesystem.
- Installs Ubuntu prerequisites using `sudo`.
- Installs checksum-pinned Node.js 24.14.1 and pnpm 10.34.5 in your Linux home without changing your shell profile.
- Installs locked application dependencies and verifies required isolation namespaces.
- Installs the checksum-pinned llama.cpp engine and Qwen model (about 510 MB download).
- Keeps an existing `.env.local` and companion database; builds the dashboard.

Keep the repository and host data in the **Linux home**, not `C:\`, OneDrive, or `/mnt/c`. This preserves Linux permissions and avoids cross-filesystem behavior. See [Microsoft’s filesystem guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems).

## 3. Launch

In Ubuntu:

```bash
cd ~/acos-dashboard
bash src/host/start-local.sh
```

When the terminal says **ACOS is ready**, open **http://localhost:8080** in Edge, Chrome, or Firefox on Windows. WSL2 supports accessing Linux web apps through Windows localhost; see [Microsoft’s networking guidance](https://learn.microsoft.com/en-us/windows/wsl/networking).

The launcher starts both the private host API and the built dashboard, checks readiness, and binds them to loopback. Keep the terminal open. **Ctrl-C stops both services**; closing WSL or shutting down Windows also stops ACOS. This release does not install an automatic background service or Windows startup task.

For later launches, copy `src/windows/Start-ACOS.cmd` to your Windows desktop and double-click it. It uses the default `Ubuntu-24.04` distribution and `~/acos-dashboard` install path. For a custom distribution or path, edit that short launcher to match. You still need to complete setup first.

## 4. Unlock and load the model

Open a second Ubuntu terminal and read the key **locally**:

```bash
cat ~/.local/share/acos/admin.key
```

Paste it into the dashboard’s Administrator key field. Do not send this key in chat or commit it to GitHub.

1. Open **Local engine** → **Open administrator session** → **Verify & load model**.
2. Optionally enable **Read companion Home** and **Write companion Home** under Capabilities.
3. **Close administrator session**. If Overview says Paused, choose **Resume companion**.
4. Open **Companion** and send a message.

## If startup fails

- **Port already in use:** close the earlier ACOS launcher. The launcher refuses to overwrite or kill another service. For intentional custom ports, set `ACOS_PORT` and `ACOS_DASHBOARD_PORT` in `.env.local`; use the URL printed by the launcher.
- **Isolation/preflight failed:** run `wsl --update` in Windows, and rerun setup in Ubuntu 24.04. Do not disable AppArmor or namespace protections system-wide. Copy the non-secret error message for diagnosis; the host must remain unable to run inference when isolation is unavailable.
- **Not enough memory:** close other applications or increase WSL’s memory allowance using [Microsoft’s `.wslconfig` documentation](https://learn.microsoft.com/en-us/windows/wsl/wsl-config#configuration-settings-for-wslconfig). `wsl --shutdown` applies WSL configuration changes and stops all running WSL work, including ACOS; save work first.
- **Windows browser cannot connect:** first confirm the launcher printed its readiness URL and remains open. Try `http://127.0.0.1:8080`. Check VPN/firewall policy and Microsoft’s networking guide; do not expose the API to the LAN to work around localhost trouble.
- **Model not ready after restarting:** verify/load again in Local engine. Identity, saved memories, and conversation data remain in the host database.

## Verification scope

The Linux host, sandbox, combined launcher, HTTP proxy, shutdown behavior, and build are tested in the development sandbox. Actual WSL installation, Windows browser forwarding, and the `.cmd` launcher require verification on your Windows computer; this repository cannot remotely configure that machine.
