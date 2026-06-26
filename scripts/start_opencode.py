#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shlex
import shutil
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT_DIR / ".env"
SECRET_MARKERS = ("KEY", "TOKEN", "SECRET", "PASSWORD")


def main() -> None:
    load_env(ENV_FILE)
    ensure_required_env()

    parser = argparse.ArgumentParser(description="Start OpenCode with project .env variables loaded.")
    parser.add_argument("--hostname", default=os.getenv("OPENCODE_HOST", "127.0.0.1"))
    parser.add_argument("--port", default=os.getenv("OPENCODE_PORT", "4096"))
    parser.add_argument("--no-print-logs", action="store_true")
    parser.add_argument("extra_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    opencode_bin = shutil.which(os.getenv("OPENCODE_BIN", "opencode"))
    if not opencode_bin:
        raise SystemExit("Cannot find opencode. Install it first, for example: npm install -g opencode-ai")

    command = [
        opencode_bin,
        "serve",
        "--hostname",
        args.hostname,
        "--port",
        str(args.port),
    ]
    if not args.no_print_logs:
        command.append("--print-logs")
    if args.extra_args:
        command.extend(args.extra_args[1:] if args.extra_args[0] == "--" else args.extra_args)

    print("==> OpenCode Server")
    print(f"==> Project: {ROOT_DIR}")
    print(f"==> Endpoint: http://{args.hostname}:{args.port}")
    print_env_status(("HUAYAN_API_BASE", "HUAYAN_API_KEY", "APP_API_BASE", "OPENCODE_AGENT", "OPENCODE_PROVIDER"))
    os.chdir(ROOT_DIR)
    os.execvpe(opencode_bin, command, os.environ.copy())


def load_env(path: Path) -> None:
    if not path.exists():
        return

    values = load_with_dotenv(path)
    if values is None:
        values = load_simple_env(path)

    for key, value in values.items():
        if not key or value is None:
            continue
        if not os.environ.get(key):
            os.environ[key] = value


def load_with_dotenv(path: Path) -> dict[str, str] | None:
    try:
        from dotenv import dotenv_values
    except ImportError:
        return None
    parsed = dotenv_values(path)
    return {str(key): str(value) for key, value in parsed.items() if value is not None}


def load_simple_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            try:
                value = shlex.split(value)[0]
            except ValueError:
                value = value[1:-1]
        values[key] = value
    return values


def ensure_required_env() -> None:
    missing = [key for key in ("HUAYAN_API_BASE", "HUAYAN_API_KEY") if not os.environ.get(key)]
    if missing:
        joined = ", ".join(missing)
        raise SystemExit(f"Missing required OpenCode provider env: {joined}. Add them to .env or export them first.")


def print_env_status(keys: tuple[str, ...]) -> None:
    for key in keys:
        value = os.environ.get(key, "")
        if any(marker in key for marker in SECRET_MARKERS):
            status = "set" if value else "missing"
        else:
            status = value or "missing"
        print(f"==> {key}: {status}")


if __name__ == "__main__":
    main()
