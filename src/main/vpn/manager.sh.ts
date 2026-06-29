// The privileged "manager" script, embedded as a string so it ships with the
// bundle and is written to disk at runtime. It runs once as root (one password
// prompt) and stays alive for the whole VPN session:
//
//   1. starts trusttunnel_client in the background, redirecting output to a log
//   2. writes the client PID to a pidfile
//   3. blocks reading a control FIFO; a background watcher unblocks it if the
//      client dies on its own
//   4. on any FIFO message (or client death) it terminates the client cleanly
//      and exits — which fires the sudo-prompt completion callback
//
// Args: $1=BIN $2=CONFIG $3=LOG $4=FIFO $5=PIDFILE
export const MANAGER_SCRIPT = `#!/bin/sh
BIN="$1"
CFG="$2"
LOG="$3"
FIFO="$4"
PIDFILE="$5"

: > "$LOG" 2>/dev/null || true

"$BIN" -c "$CFG" >> "$LOG" 2>&1 &
CHILD=$!
echo "$CHILD" > "$PIDFILE"

# Watcher: if the client exits on its own, unblock the read below.
( while kill -0 "$CHILD" 2>/dev/null; do sleep 1; done; echo exited > "$FIFO" 2>/dev/null ) &
WATCHER=$!

# Block here until the UI sends a stop command, or the watcher reports exit.
read CMD < "$FIFO"

kill "$WATCHER" 2>/dev/null || true
kill -TERM "$CHILD" 2>/dev/null || true
i=0
while kill -0 "$CHILD" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -ge 16 ] && { kill -KILL "$CHILD" 2>/dev/null || true; break; }
  sleep 0.25
done
rm -f "$PIDFILE"
exit 0
`
