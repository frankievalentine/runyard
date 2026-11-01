# Machines

A machine is any computer Runyard reaches over SSH: a Mac, a Linux server, VM or container, or a
Windows PC. Runyard checks each one every minute, read-only, and installs runners on it only
through a review you run.

## Add a machine

Click **+** beside **Machines** in the sidebar. Pick one of your tailnet's desktops and servers,
or enter any SSH target: `user@host`, or a `Host` alias from `~/.ssh/config`. Only machines you
add are checked.

Every minute Runyard reads CPU, memory, load, disks, uptime, and some power and Tailscale
settings, with at most four SSH sessions at a time.

## Connect it

Until Runyard reaches a machine, its page shows **Connect Runyard to &lt;machine&gt;**: the steps
in the order SSH meets them (SSH server on, host key trusted, Runyard's key authorized,
connected), where the last check stopped, and the commands for each step on that machine's
system.

### The setup command

The quickest way through. Click **Show setup command** and run the command for the machine's
system on it, as the account Runyard should sign in as:

```sh
curl -fsSL https://<runyard>/api/machine-setup/script.sh | sh -s -- <code>               # macOS, Linux
& ([scriptblock]::Create((irm https://<runyard>/api/machine-setup/script.ps1))) <code>   # Windows
```

It checks that the SSH server is on, and says how to turn it on if not. It then adds Runyard's
key to the account's `authorized_keys` (with forwarding off) and reports the account, system and
host keys back. Runyard trusts exactly those host keys and checks the machine. It installs
nothing.

- The code works once, for 15 minutes. Click **Show new command** for another.
- The command is offered only on the dashboard's HTTPS address, so nothing can change it on the
  way.
- On Windows, an administrator account's key goes in `administrators_authorized_keys`, so run it
  in an administrator PowerShell.

**A fresh Linux machine** (a new container or VPS with only `root`) has its own version on the
same page: the command with `--prepare`, run as root. It also installs the SSH server and `sudo`,
creates a `runyard` account that signs in with Runyard's key only, keeps that account's processes
running after it signs out, and adds it to the `docker` group when Docker is there. It asks
whether to give the account passwordless sudo (`--sudo` skips the question); otherwise you set a
password, which each review asks for. The plain command refuses to run as root on Linux, because
runners can't be installed as root.

### By hand

The steps give the commands to copy. **Read host key** shows the machine's host key fingerprint
and the command that prints it on the machine, to compare; **Trust this key** trusts only that
key. When Tailscale publishes the machine's host keys, the page says whether they match. A host
key that changed is never replaced without **Replace trusted key**.

### How Runyard signs in

Runyard has its own SSH key and `known_hosts`, in its data directory. It offers that key and
checks those host keys alongside your own, so machines you already reach with `ssh` need nothing
new: your keys, agent and `~/.ssh/config` keep working. Machines with Tailscale SSH are reached
with `tailscale ssh`, and your tailnet's SSH rules must allow the account.

Runyard learns a machine's system from Tailscale, or from its first check. A Windows machine that
isn't on your tailnet needs **Operating system** set to Windows when you add it.

## Recipes

What each kind of machine needs before you add it.

### Proxmox LXC

1. On the Proxmox host, download the Debian template (**local ▸ CT Templates**, or
   `pveam download local debian-13-standard_<version>_amd64.tar.zst`) and create an
   unprivileged container from it with the CPU, memory and disk your jobs need.
2. If jobs will use Docker (Forgejo's Docker mode, or GitHub `container:` and `services:` jobs),
   turn on **Options ▸ Features ▸ nesting** and **keyctl**.
3. To put it on your tailnet, add these lines to `/etc/pve/lxc/<id>.conf`, restart the container
   and install Tailscale inside it:

   ```
   lxc.cgroup2.devices.allow: c 10:200 rwm
   lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
   ```

   Without Tailscale, add it to Runyard by its LAN address.

4. `pct enter <id>`, then `apt update && apt full-upgrade -y` (templates lag behind on security
   updates) and install `curl` if it's missing.
5. Run the fresh-machine setup command as root.

### Linux VPS

1. Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`, then
   `sudo tailscale up`. Runyard then reaches it privately, and the setup command can report back.
2. Run the fresh-machine setup command as root.

A VPS reached over public SSH works with the by-hand steps too, but keep its SSH port firewalled
to the machines that need it.

### Mac

1. Turn on **System Settings ▸ General ▸ Sharing ▸ Remote Login**.
2. Run the setup command as the account the runners should use.
3. Runners on a Mac run only while that account is signed in. Turn on automatic login for it
   under **System Settings ▸ Users & Groups** (not available while FileVault is on).
4. Stop it sleeping: `sudo pmset -a sleep 0`, and keep a laptop on power.

Runyard flags a Mac in a pool when automatic login is off or is for another account, and when it
sleeps.

### Windows

Windows 10 or 11. Runners run as Windows services, as `NETWORK SERVICE`.

1. **An account with a plain name.** Runyard signs in as the account you run the setup command
   from, and its name must use only letters, digits, `.`, `_` and `-`. An account tied to a
   Microsoft account sometimes has another name; check with `$env:USERNAME`.
2. **Tailscale, running unattended.** Install it and sign in. Then right-click the Tailscale
   icon and turn on **Run unattended**, or run `tailscale up --unattended` in an administrator
   PowerShell. Without it, the machine leaves your tailnet when you sign out.
3. **OpenSSH Server**, in an administrator PowerShell:

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service -Name sshd -StartupType Automatic
   ```

4. **No sleep:**

   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```

5. **Run the Windows setup command,** in an administrator PowerShell for an administrator
   account.
6. **Allow local PowerShell scripts,** if Runner readiness shows **PowerShell scripts** as
   Restricted: `Set-ExecutionPolicy RemoteSigned -Scope LocalMachine`. The runner runs every
   PowerShell step and its job hooks as script files.

Tools jobs need must be installed for every account, because the runner's service can't use
anything installed for you alone. A pool installs them that way for you; see
[Tools](pools.md#tools).

## Runner readiness

Each check also reads whether the machine has what CI jobs commonly need, under **Runner
readiness** on its page:

- **Required:** git, curl and tar; the Command Line Tools on a Mac; Node.js where a Forgejo pool
  runs jobs on the machine itself; a clock within a minute of Runyard's; and the forges reachable
  over HTTPS. On Windows, also a PowerShell policy that allows local scripts.
- **Its pools' labels:** `docker` needs a Docker the runner's account can use, `xcode` or
  `xcode-16` needs that Xcode, and `gpu`, `cuda` or `nvidia` need an NVIDIA GPU with
  `nvidia-smi`. Other labels aren't checked.
- **Recommended:** unzip, zip, xz, zstd, jq, gpg, a C compiler and make, Python 3, and Docker.

Readiness warns when Node.js is older than 20, which current actions such as
`actions/checkout@v4` need; use a newer Node.js, or Forgejo's Docker mode.

Each missing item says how to install it, and a pool can install it for you (see
[Tools](pools.md#tools)). A machine in a pool that's missing something required or promised
shows under **Needs attention** and on the pool's page. The check only reads.

On Windows, a tool counts only when the runner can use it:

| Readiness shows           | Meaning                                                                                | What to do                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Not found**             | Not on the machine's PATH                                                              | Let a pool install it, or install it for every account                                   |
| **Only for this account** | Installed for the account Runyard signs in as, which the runner's service can't see    | Install it for every account                                                             |
| **Runner can't run it**   | Installed for every account, but only the account that installed it can read the files | The review fixes it when a pool wants the tool; otherwise run the `icacls` command shown |

Folders inside user profiles don't count, even on the machine's PATH.

## Alerts and history

A machine alerts when it's been offline on your tailnet for three minutes, or when a disk has
less than 10% free on readings a minute apart (clearing at 12%). **Pause alerts for 1 hour**
pauses them.

Each machine's history, and the overview's **Recent activity**, records reboots, SSH failures,
alerts, and each run of its changes: what each step did, where it stopped, and who ran it.
One-job runners starting and ending are recorded; persistent runners' jobs are under **Jobs**
instead. History is kept for 30 days, up to 5,000 events.

## Remove a machine

**Remove** on a machine's page takes it out of Runyard, after one confirmation. While Runyard
still has runners there, it removes them first: it takes the machine out of every pool and runs
the review that deregisters them, showing each step as it goes. On Linux, enter the sudo
password if the account needs one. The machine has to be connected for this.

When the machine is connected, **Also clean up** (on by default) first deletes Runyard's runner
folder there, then Runyard's key, over SSH. Tools a pool installed stay. If the cleanup fails,
the machine stays and the dialog says why, with **Try again** and **Remove without cleaning
up**. On a machine set up with the fresh-machine command, the `runyard` account stays; the page
then shows the root command that deletes it.

For a machine Runyard can't reach, or one removed without cleaning up, the dialog shows teardown
commands to run on the machine instead; see [Uninstalling](operating.md#uninstalling).
