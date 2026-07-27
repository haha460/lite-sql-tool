#!/usr/bin/env bash
# Background service manager for the OpenCode Server.
#
# Usage:
#   ./start_opencode.sh            # 等价于 start，后台启动 opencode serve
#   ./start_opencode.sh start
#   ./start_opencode.sh stop
#   ./start_opencode.sh restart
#   ./start_opencode.sh status
#
# 日志切分到 log/opencode/opencode.log，每天零点切分为 opencode.log.YYYY-MM-DD，
# 默认保留最近 14 天（由 OPENCODE_LOG_BACKUP_DAYS 控制）。
#
# 环境变量：
#   OPENCODE_HOST / OPENCODE_PORT     监听地址和端口（默认 127.0.0.1:4096）
#   OPENCODE_LOG_BACKUP_DAYS          日志保留天数（默认 14）
#   FOREGROUND=1                      前台运行（本地调试用）
#   PYTHON_BIN / VENV_DIR             指定 Python 解释器 / 虚拟环境
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
HOST="${OPENCODE_HOST:-127.0.0.1}"
PORT="${OPENCODE_PORT:-4096}"
FOREGROUND="${FOREGROUND:-0}"
LOG_BACKUP_DAYS="${OPENCODE_LOG_BACKUP_DAYS:-14}"

LOG_DIR="$ROOT_DIR/log/opencode"
PID_FILE="$LOG_DIR/opencode.pid"
PORT_FILE="$LOG_DIR/opencode.port"
LOG_FILE="$LOG_DIR/opencode.log"
STARTUP_LOG="$LOG_DIR/startup.log"
SERVE_SCRIPT="$ROOT_DIR/scripts/opencode_serve.py"

mkdir -p "$LOG_DIR"

pick_python() {
  if [ -n "${PYTHON_BIN:-}" ]; then
    command -v "$PYTHON_BIN"
    return
  fi
  if [ -x "$VENV_DIR/bin/python" ]; then
    printf '%s\n' "$VENV_DIR/bin/python"
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

port_in_use() {
  local host="$1"
  local port="$2"
  local py="$3"
  "$py" - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.3)
    try:
        sock.bind((host, port))
    except OSError:
        raise SystemExit(1)  # in use
raise SystemExit(0)  # free
PY
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
    echo "==> Already running (PID $(app_pid)). Use ./start_opencode.sh restart to reload."
    exit 0
  fi

  local py
  py="$(pick_python)"
  if [ -z "$py" ]; then
    echo "Cannot find a Python interpreter. Set PYTHON_BIN=/path/to/python." >&2
    exit 1
  fi

  if ! port_in_use "$HOST" "$PORT" "$py"; then
    echo "端口 $HOST:$PORT 已被占用，OpenCode serve 会因此报 ServeError 并退出。" >&2
    echo "  - 可能已经有一个 OpenCode Server 在运行：lsof -i :$PORT 查看占用进程" >&2
    echo "  - 停掉旧进程后重试，或换一个端口：OPENCODE_PORT=4097 ./start_opencode.sh" >&2
    exit 1
  fi

  echo "==> OpenCode Server"
  echo "==> Project: $ROOT_DIR"
  echo "==> Python:  $py"
  echo "==> URL:     http://$HOST:$PORT"
  echo "==> Logs:    $LOG_FILE (每天零点切分为 opencode.log.YYYY-MM-DD，保留 $LOG_BACKUP_DAYS 天)"

  local serve_args=(
    "$SERVE_SCRIPT"
    --hostname "$HOST"
    --port "$PORT"
    --log-dir "$LOG_DIR"
    --backup-days "$LOG_BACKUP_DAYS"
    --port-file "$PORT_FILE"
  )

  if [ "$FOREGROUND" = "1" ]; then
    echo "==> Starting server (foreground)"
    exec "$py" "${serve_args[@]}"
  fi

  echo "==> Starting server (background)"
  nohup "$py" "${serve_args[@]}" >> "$STARTUP_LOG" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"

  # Readiness probe: a healthy opencode binds HOST:PORT. Wait up to ~6s for it
  # to either start listening or die.
  local ok=0 i
  for i in $(seq 1 12); do
    kill -0 "$pid" 2>/dev/null || break
    if ! port_in_use "$HOST" "$PORT" "$py"; then
      ok=1
      break
    fi
    sleep 0.5
  done

  if [ "$ok" != "1" ]; then
    echo "OpenCode failed to start (未在 $HOST:$PORT 监听)。Last lines of $LOG_FILE:" >&2
    tail -n 20 "$LOG_FILE" 2>/dev/null >&2 || true
    echo "--- $STARTUP_LOG ---" >&2
    tail -n 10 "$STARTUP_LOG" 2>/dev/null >&2 || true
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
  echo "==> Started (PID $pid)"
  echo "==> Stop with: ./start_opencode.sh stop"
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
    local pid endpoint
    pid="$(app_pid)"
    endpoint="$(cat "$PORT_FILE" 2>/dev/null || echo "$HOST:$PORT")"
    echo "==> Running (PID $pid), http://$endpoint"
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
    echo "  环境变量：OPENCODE_HOST OPENCODE_PORT OPENCODE_LOG_BACKUP_DAYS FOREGROUND" >&2
    exit 1
    ;;
esac
