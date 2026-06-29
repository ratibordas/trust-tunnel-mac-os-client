# TrustTunnel Desktop

A macOS GUI wrapper around the [TrustTunnel](https://github.com/TrustTunnel/TrustTunnel)
VPN CLI client (`trusttunnel_client`). It lets you manage configurations, connect
and disconnect with one click, watch live throughput and logs, and keep the
underlying CLI binary up to date — without touching the terminal.

Built with **Electron + TypeScript + React**. No Xcode required for development;
only the Apple Command Line Tools are needed (and only for signing a release).

---

## For users

### What it does

- **Manage configurations** — import an existing `trusttunnel_client.toml`, paste
  TOML directly, or fill in a guided form. Everything is validated against the
  upstream configuration reference before it is saved.
- **One-click connect / disconnect** with a clear status indicator
  (disconnected / connecting / connected / error).
- **Live stats** — download/upload speed and totals, the tunnel interface, the
  active server, and connection uptime.
- **Live client log** streamed straight from `trusttunnel_client`.
- **Built-in binary updater** — downloads the correct macOS universal build of
  `trusttunnel_client` from the official GitHub releases and keeps it current.

### Requirements

- macOS (Apple Silicon or Intel — the upstream build is universal).
- An administrator account. TrustTunnel needs root to create the TUN interface
  and edit routes, so **macOS will prompt for your password each time you
  connect.** The password goes to the system authorization dialog, never to this
  app.

### First run

1. Open the app.
2. Click the client status pill in the title bar → **Download & install**. This
   fetches `trusttunnel_client` from GitHub into the app's data folder.
3. Add a configuration (**+ New configuration**): import a `.toml`, paste TOML,
   or use the form. Fill in at least the **Endpoint** section
   (hostname, addresses, username, password).
4. Select the configuration and press **Connect**. Enter your macOS password
   when prompted.

### Where your data lives

Everything is stored under your user library, never inside the app bundle:

```
~/Library/Application Support/TrustTunnel Desktop/
├── configs/        # your saved *.toml configs + index.json
├── bin/            # the downloaded trusttunnel_client + version.json
└── runtime/        # per-session log, pidfile, control pipe, active config
```

### A note on passwords

Connecting and disconnecting are handled by a small privileged "manager" process
that is started **once per session** via the standard macOS authorization
dialog. That means **one password prompt per connection**, not one for connect
and another for disconnect. Disconnect is signalled to the already-running
manager over a local control pipe, so it needs no second prompt.

---

## For developers

### Stack & layout

```
src/
├── shared/          # types + zod validation schema (used by main AND renderer)
│   ├── schema.ts    # the trusttunnel_client.toml schema + validateConfig()
│   └── types.ts     # IPC channel names + shared interfaces
├── main/            # Electron main process (Node)
│   ├── index.ts     # app lifecycle / window
│   ├── ipc.ts       # ipcMain handlers + event broadcasting
│   ├── paths.ts     # all on-disk locations
│   ├── config/      # TOML parse/serialize + config store
│   ├── vpn/         # privileged runner, manager shell script, log tailer
│   ├── stats/       # netstat-based throughput poller
│   └── updater/     # GitHub releases check + download + extract
├── preload/         # contextBridge API (window.api)
└── renderer/        # React UI
```

### Prerequisites

- Node.js 20+ (uses the global `fetch` and web streams).
- npm.

### Develop

```bash
npm install
npm run dev        # electron-vite dev server with HMR
```

### Build & typecheck

```bash
npm run typecheck  # tsc for main/preload and renderer projects
npm run build      # typecheck + produce out/
npm run start      # preview the production build
```

### Package a macOS app

```bash
npm run dist       # builds and produces a .dmg + .zip in release/
npm run dist:dir   # unpacked .app only (faster, for local testing)
```

Packaging uses [electron-builder](https://www.electron.build/) and **does not
require Xcode** — only the Command Line Tools (`xcode-select --install`).
Code signing and notarization are optional; configure `CSC_LINK`,
`CSC_KEY_PASSWORD`, and the Apple notarization environment variables to enable
them (see the electron-builder docs). The config lives in `electron-builder.yml`.

### How the privileged runner works

The core problem: `trusttunnel_client` is a long-lived process that needs root,
must be monitored (logs/state), and must be stopped cleanly — but a plain
`sudo-prompt` exec gives you no live output and no handle to kill.

The solution is a small shell **manager** (`src/main/vpn/manager.sh.ts`) launched
**once** through [`@vscode/sudo-prompt`](https://github.com/vscode/sudo-prompt):

1. It starts `trusttunnel_client` in the background, redirecting output to a log
   file, and writes the client PID.
2. It blocks reading a control **FIFO**; a background watcher unblocks it if the
   client exits on its own.
3. The UI tails the log file (`tailer.ts`) for live output and derives the
   connection state heuristically, and polls `netstat -ibn` (`netstats.ts`) for
   throughput on the newly-created `utun` interface.
4. To disconnect, the UI writes one line into the FIFO; the root manager
   terminates the client and exits, which fires the `sudo-prompt` completion
   callback. → **one password prompt for the whole session.**

> **Heuristics worth knowing.** The upstream CLI does not document its exact
> stdout format, so connection-state detection (`RE_CONNECTED` / `RE_ERROR` in
> `runner.ts`) and the 6-second "still alive ⇒ connected" fallback are
> best-effort and easy to tune. Throughput is read from the OS interface
> counters, not from the client, so it reflects real `utun` traffic.

### Binary updater

`src/main/updater/binary.ts` queries
`https://api.github.com/repos/TrustTunnel/TrustTunnel/releases/latest`, picks the
`trusttunnel-vX.Y.Z-macos-universal.tar.gz` asset, downloads it with progress,
extracts `trusttunnel_client` with the system `tar`, installs it into
`bin/`, strips the Gatekeeper quarantine flag, and records the version. To pin a
specific release, change `REPO` / `ASSET_RE` there.

### Adapting the config schema

If the upstream config reference changes, edit `src/shared/schema.ts`. Because
the schema is shared, the main-process validation, the form's field errors, and
the TypeScript types all update together.

---

## License

Apache-2.0, matching upstream TrustTunnel.
This wrapper is independent and not affiliated with AdGuard or the TrustTunnel
maintainers.
