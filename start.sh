#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
AUTO_PORT="${AUTO_PORT:-1}"
FORCE_INSTALL="${FORCE_INSTALL:-0}"
FOREGROUND="${FOREGROUND:-0}"
LOG_LEVEL="${LOG_LEVEL:-info}"
LOG_BACKUP_DAYS="${LOG_BACKUP_DAYS:-14}"
REQ_STAMP="$VENV_DIR/.requirements.sha256"

LOG_DIR="$ROOT_DIR/log"
PID_FILE="$LOG_DIR/app.pid"
PORT_FILE="$LOG_DIR/app.port"
LOG_FILE="$LOG_DIR/app.log"
STARTUP_LOG="$LOG_DIR/startup.log"
LOG_CONFIG="$LOG_DIR/uvicorn-log.json"

mkdir -p "$LOG_DIR"

PY=""

pick_python() {
  if [ -n "${PYTHON_BIN:-}" ]; then
    command -v "$PYTHON_BIN"
    return
  fi

  if [ -n "${CONDA_PREFIX:-}" ] && [ -x "$CONDA_PREFIX/bin/python" ]; then
    printf '%s\n' "$CONDA_PREFIX/bin/python"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  command -v python
}

requirements_hash() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 requirements.txt | awk '{print $1}'
    return
  fi

  "$PY" - <<'PY'
from hashlib import sha256
from pathlib import Path
print(sha256(Path("requirements.txt").read_bytes()).hexdigest())
PY
}

port_is_free() {
  local host="$1"
  local port="$2"
  "$PY" - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.2)
    try:
        sock.bind((host, port))
    except OSError:
        raise SystemExit(1)
PY
}

pick_port() {
  local host="$1"
  local requested_port="$2"
  local port="$requested_port"
  local max_port=$((requested_port + 20))

  if port_is_free "$host" "$port"; then
    printf '%s\n' "$port"
    return
  fi

  if [ "$AUTO_PORT" != "1" ]; then
    echo "Port $host:$requested_port is already in use. Set PORT=... or AUTO_PORT=1." >&2
    exit 1
  fi

  echo "==> Port $host:$requested_port is in use, looking for a free port" >&2
  port=$((requested_port + 1))
  while [ "$port" -le "$max_port" ]; do
    if port_is_free "$host" "$port"; then
      printf '%s\n' "$port"
      return
    fi
    port=$((port + 1))
  done

  echo "Cannot find a free port in range $requested_port-$max_port" >&2
  exit 1
}

ensure_env() {
  echo "==> SQL Redis Visual Tool"
  echo "==> Project: $ROOT_DIR"

  local python_bin
  python_bin="$(pick_python)"
  echo "==> Python: $python_bin"

  if [ -d "$VENV_DIR" ] && { [ ! -x "$VENV_DIR/bin/python" ] || [ ! -x "$VENV_DIR/bin/pip" ]; }; then
    echo "==> Removing incomplete virtual environment: $VENV_DIR"
    rm -rf "$VENV_DIR"
  fi

  if [ ! -d "$VENV_DIR" ]; then
    echo "==> Creating virtual environment: $VENV_DIR"
    if ! "$python_bin" -m venv "$VENV_DIR"; then
      echo "Failed to create virtual environment with: $python_bin" >&2
      echo "Try: PYTHON_BIN=/path/to/python ./start.sh" >&2
      exit 1
    fi
  fi

  if [ -x "$VENV_DIR/bin/python" ]; then
    PY="$VENV_DIR/bin/python"
  else
    echo "Cannot find Python inside $VENV_DIR" >&2
    exit 1
  fi

  if ! "$PY" -m pip --version >/dev/null 2>&1; then
    echo "==> Installing pip in virtual environment"
    "$PY" -m ensurepip --upgrade
  fi

  local current_hash installed_hash=""
  current_hash="$(requirements_hash)"
  if [ -f "$REQ_STAMP" ]; then
    installed_hash="$(cat "$REQ_STAMP")"
  fi

  if [ "$FORCE_INSTALL" = "1" ] || [ "$current_hash" != "$installed_hash" ]; then
    echo "==> Installing dependencies"
    "$PY" -m pip install -r requirements.txt
    printf '%s\n' "$current_hash" > "$REQ_STAMP"
  else
    echo "==> Dependencies unchanged, skipping install"
  fi

  if [ ! -f "app.db" ]; then
    echo "==> Creating demo database: app.db"
    "$PY" scripts/create_demo_db.py
  else
    echo "==> Demo database exists: app.db"
  fi
}

write_log_config() {
  local level_upper
  level_upper="$(printf '%s' "$LOG_LEVEL" | tr '[:lower:]' '[:upper:]')"
  cat > "$LOG_CONFIG" <<JSON
{
  "version": 1,
  "disable_existing_loggers": false,
  "formatters": {
    "default": {
      "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
      "datefmt": "%Y-%m-%d %H:%M:%S"
    }
  },
  "handlers": {
    "file": {
      "class": "logging.handlers.TimedRotatingFileHandler",
      "formatter": "default",
      "filename": "$LOG_FILE",
      "when": "midnight",
      "interval": 1,
      "backupCount": $LOG_BACKUP_DAYS,
      "encoding": "utf-8",
      "delay": true
    }
  },
  "loggers": {
    "uvicorn": {"handlers": ["file"], "level": "$level_upper", "propagate": false},
    "uvicorn.error": {"handlers": ["file"], "level": "$level_upper", "propagate": false},
    "uvicorn.access": {"handlers": ["file"], "level": "$level_upper", "propagate": false}
  },
  "root": {"handlers": ["file"], "level": "$level_upper"}
}
JSON
}

app_pid() {
  [ -f "$PID_FILE" ] && cat "$PID_FILE" || true
}

is_running() {
  local pid
  pid="$(app_pid)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_app() {
  if is_running; then
    echo "==> Already running (PID $(app_pid)). Use ./start.sh restart to reload."
    exit 0
  fi

  ensure_env
  PORT="$(pick_port "$HOST" "$PORT")"
  write_log_config
  printf '%s\n' "$PORT" > "$PORT_FILE"

  echo "==> URL:  http://$HOST:$PORT"
  echo "==> Logs: $LOG_FILE (每天零点切分为 app.log.YYYY-MM-DD，保留 $LOG_BACKUP_DAYS 天)"

  local uv_args=(
    app.main:app
    --host "$HOST"
    --port "$PORT"
    --log-config "$LOG_CONFIG"
    --log-level "$LOG_LEVEL"
  )

  if [ "$FOREGROUND" = "1" ]; then
    echo "==> Starting server (foreground)"
    exec "$VENV_DIR/bin/uvicorn" "${uv_args[@]}"
  fi

  echo "==> Starting server (background)"
  nohup "$VENV_DIR/bin/uvicorn" "${uv_args[@]}" >> "$STARTUP_LOG" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"

  sleep 1.5
  if kill -0 "$pid" 2>/dev/null; then
    echo "==> Started (PID $pid)"
    echo "==> Stop with: ./start.sh stop"
  else
    echo "Server failed to start. Last lines of $STARTUP_LOG:" >&2
    tail -n 20 "$STARTUP_LOG" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop_app() {
  local pid
  pid="$(app_pid)"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    echo "==> Not running (no live PID)"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "==> Stopping PID $pid"
  kill "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "==> Process did not exit, force killing PID $pid"
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "==> Stopped"
}

status_app() {
  if is_running; then
    local pid port
    pid="$(app_pid)"
    port="$(cat "$PORT_FILE" 2>/dev/null || echo '?')"
    echo "==> Running (PID $pid), http://$HOST:$port"
    echo "==> Logs: $LOG_FILE"
  else
    echo "==> Not running"
    return 1
  fi
}

COMMAND="${1:-start}"
case "$COMMAND" in
  start)
    start_app
    ;;
  stop)
    stop_app
    ;;
  restart)
    stop_app
    start_app
    ;;
  status)
    status_app
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    echo "  环境变量：HOST PORT AUTO_PORT FORCE_INSTALL FOREGROUND LOG_LEVEL LOG_BACKUP_DAYS" >&2
    exit 1
    ;;
esac
