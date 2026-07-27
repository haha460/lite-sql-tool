#!/usr/bin/env python3
"""Run `opencode serve` in the foreground and stream its output to a
daily-rotating log file under ``log/opencode/``.

This is a thin wrapper that reuses the .env loading / provider-check logic in
``start_opencode.py``. It is meant to be launched (usually in the background)
by ``start_opencode.sh``, which manages the PID / port files. Running it
directly works too and behaves like a foreground ``opencode serve`` whose logs
are also persisted and rotated.
"""
from __future__ import annotations

import argparse
import logging
import os
import shutil
import signal
import subprocess
import sys
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from start_opencode import ENV_FILE, ROOT_DIR, ensure_required_env, load_env  # noqa: E402


def build_logger(log_file: Path, backup_days: int) -> logging.Logger:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    handler = TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",
        interval=1,
        backupCount=backup_days,
        encoding="utf-8",
        delay=True,
    )
    # opencode already prints its own timestamps with --print-logs, so keep the
    # persisted line raw to avoid double timestamps.
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler.suffix = "%Y-%m-%d"
    logger = logging.getLogger("opencode")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    for existing in list(logger.handlers):
        logger.removeHandler(existing)
    logger.addHandler(handler)
    return logger


def main() -> int:
    load_env(ENV_FILE)
    ensure_required_env()

    parser = argparse.ArgumentParser(
        description="Run opencode serve with rotating file logs."
    )
    parser.add_argument("--hostname", default=os.getenv("OPENCODE_HOST", "127.0.0.1"))
    parser.add_argument("--port", default=os.getenv("OPENCODE_PORT", "4096"))
    parser.add_argument(
        "--log-dir",
        default=str(ROOT_DIR / "log" / "opencode"),
        help="Directory for opencode log files (default: log/opencode).",
    )
    parser.add_argument(
        "--backup-days",
        type=int,
        default=int(os.getenv("OPENCODE_LOG_BACKUP_DAYS", "14")),
        help="How many rotated daily log files to keep (default: 14).",
    )
    parser.add_argument(
        "--port-file",
        default=None,
        help="Optional path to write the resolved HOST:PORT to.",
    )
    parser.add_argument("extra_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    opencode_bin = shutil.which(os.getenv("OPENCODE_BIN", "opencode"))
    if not opencode_bin:
        raise SystemExit(
            "Cannot find opencode. Install it first, for example: "
            "npm install -g opencode-ai"
        )

    log_dir = Path(args.log_dir)
    log_file = log_dir / "opencode.log"
    logger = build_logger(log_file, args.backup_days)

    if args.port_file:
        port_path = Path(args.port_file)
        port_path.parent.mkdir(parents=True, exist_ok=True)
        port_path.write_text(f"{args.hostname}:{args.port}\n", encoding="utf-8")

    command = [
        opencode_bin,
        "serve",
        "--hostname",
        args.hostname,
        "--port",
        str(args.port),
        "--print-logs",
    ]
    extra = args.extra_args
    if extra and extra[0] == "--":
        extra = extra[1:]
    command.extend(extra)

    start_line = (
        f"==> OpenCode Server starting at http://{args.hostname}:{args.port} "
        f"(logs: {log_file}, keep {args.backup_days} days)"
    )
    print(start_line, flush=True)
    logger.info(start_line)

    os.chdir(ROOT_DIR)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
        bufsize=1,
        universal_newlines=True,
    )

    stopping = {"flag": False}

    def handle_signal(signum, _frame):
        if stopping["flag"]:
            return
        stopping["flag"] = True
        logger.info("==> Received signal %s, stopping opencode", signum)
        try:
            process.terminate()
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        assert process.stdout is not None
        for line in process.stdout:
            logger.info(line.rstrip("\n"))
    except KeyboardInterrupt:
        handle_signal(signal.SIGINT, None)

    process.wait()
    if not stopping["flag"] and process.returncode:
        # Give the last KILL fallback a chance if terminate was too soft.
        try:
            process.kill()
        except ProcessLookupError:
            pass
    logger.info("==> opencode exited with code %s", process.returncode)
    return process.returncode or 0


if __name__ == "__main__":
    sys.exit(main())
