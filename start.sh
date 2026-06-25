#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
FORCE_INSTALL="${FORCE_INSTALL:-0}"
REQ_STAMP="$VENV_DIR/.requirements.sha256"

echo "==> SQL Redis Visual Tool"
echo "==> Project: $ROOT_DIR"

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

PYTHON_BIN="$(pick_python)"
echo "==> Python: $PYTHON_BIN"

if [ -d "$VENV_DIR" ] && { [ ! -x "$VENV_DIR/bin/python" ] || [ ! -x "$VENV_DIR/bin/pip" ]; }; then
  echo "==> Removing incomplete virtual environment: $VENV_DIR"
  rm -rf "$VENV_DIR"
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating virtual environment: $VENV_DIR"
  if ! "$PYTHON_BIN" -m venv "$VENV_DIR"; then
    echo "Failed to create virtual environment with: $PYTHON_BIN" >&2
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

requirements_hash() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 requirements.txt | awk '{print $1}'
    return
  fi

  python - <<'PY'
from hashlib import sha256
from pathlib import Path
print(sha256(Path("requirements.txt").read_bytes()).hexdigest())
PY
}

CURRENT_REQ_HASH="$(requirements_hash)"
INSTALLED_REQ_HASH=""
if [ -f "$REQ_STAMP" ]; then
  INSTALLED_REQ_HASH="$(cat "$REQ_STAMP")"
fi

if [ "$FORCE_INSTALL" = "1" ] || [ "$CURRENT_REQ_HASH" != "$INSTALLED_REQ_HASH" ]; then
  echo "==> Installing dependencies"
  "$PY" -m pip install -r requirements.txt
  printf '%s\n' "$CURRENT_REQ_HASH" > "$REQ_STAMP"
else
  echo "==> Dependencies unchanged, skipping install"
fi

if [ ! -f "app.db" ]; then
  echo "==> Creating demo database: app.db"
  "$PY" scripts/create_demo_db.py
else
  echo "==> Demo database exists: app.db"
fi

echo "==> Starting server"
echo "==> Open http://$HOST:$PORT"
exec "$VENV_DIR/bin/uvicorn" app.main:app \
  --host "$HOST" \
  --port "$PORT" \
  --reload \
  --reload-dir app \
  --reload-dir static \
  --reload-exclude "$VENV_DIR/*"
