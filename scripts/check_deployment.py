"""Validate production Compose topology using fake settings, without reading real env files."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    env = os.environ | {
        "POSTGRES_PASSWORD": "validation-only-password",
        "S3_ACCESS_KEY_ID": "validation-only-key",
        "S3_SECRET_ACCESS_KEY": "validation-only-secret",
        "QDRANT_IMAGE": "qdrant/qdrant:validation-only",
        "RUSTFS_IMAGE": "rustfs/rustfs:validation-only",
        "API_DOMAIN": "api.example.com",
        "DASHBOARD_DOMAIN": "support.example.com",
        "ACME_EMAIL": "admin@example.com",
        "NEXT_PUBLIC_API_URL": "https://api.example.com",
    }
    # --no-env-resolution prevents reading the real service .env.production.
    result = subprocess.run(
        ["docker", "compose", "--env-file", ".env.production.example", "-f",
         "compose.production.yml", "config", "--no-env-resolution", "--format", "json"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=True,
    )
    services = json.loads(result.stdout)["services"]
    for name, service in services.items():
        if name != "proxy" and service.get("ports"):
            raise ValueError(f"Unexpected public ports on {name}")
    if set(services) != {"postgres", "redis", "qdrant", "rustfs", "api", "worker", "beat", "dashboard", "proxy"}:
        raise ValueError("Incomplete deployment topology")
    if "--workers" in services["api"]["command"]:
        raise ValueError("The current socket hub requires a single API process")
    if "--beat" in services["worker"]["command"]:
        raise ValueError("Use the separate beat service only")
    print("Production Compose validated: private infrastructure, one API process, separate scheduler; no real secrets read.")


if __name__ == "__main__":
    main()
