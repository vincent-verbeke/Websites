#!/usr/bin/env python3
import os
import sys
import subprocess
import argparse

# Ensure src is on Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "src")))


def main():
    parser = argparse.ArgumentParser(description="Kubotics Backend Runner")
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Run FastAPI locally in development mode with live reload",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind server (default: 8000)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host address to bind server (default: 127.0.0.1)",
    )
    args = parser.parse_args()

    # Determine Python executable inside .venv
    venv_python = os.path.abspath(os.path.join(os.path.dirname(__file__), ".venv", "bin", "python"))
    if not os.path.exists(venv_python):
        venv_python = sys.executable

    if args.dev:
        print(f"🚀 Starting Kubotics FastAPI in DEV mode with auto-reload on http://{args.host}:{args.port}")
        cmd = [
            venv_python,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            args.host,
            "--port",
            str(args.port),
            "--reload",
            "--app-dir",
            "src",
        ]
    else:
        print(f"📦 Starting Kubotics FastAPI in PRODUCTION mode on http://{args.host}:{args.port}")
        cmd = [
            venv_python,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            args.host,
            "--port",
            str(args.port),
            "--app-dir",
            "src",
        ]

    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("\n🛑 Stopped Kubotics Backend.")


if __name__ == "__main__":
    main()
