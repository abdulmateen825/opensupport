"""Fill missing local settings without printing or replacing existing credentials."""
from pathlib import Path
import secrets

ROOT = Path(__file__).resolve().parents[1]


def entries(text: str) -> dict[str, str]:
    return {
        key.strip(): value.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
        for key, value in [line.split("=", 1)]
    }


def fill(path: Path, template: Path, overrides: dict[str, str] | None = None) -> None:
    original = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    present = entries(original)
    defaults = entries(template.read_text(encoding="utf-8"))
    additions = []
    for key, value in defaults.items():
        if key not in present:
            if overrides and key in overrides:
                value = overrides[key]
            elif key in {"ENCRYPTION_KEY", "WIDGET_IDENTITY_SECRET"} and present.get("APP_SECRET_KEY"):
                # Legacy runtime falls back to APP_SECRET_KEY. Preserve that key, not rotate it.
                value = present["APP_SECRET_KEY"]
            elif key in {"APP_SECRET_KEY", "ENCRYPTION_KEY", "WIDGET_IDENTITY_SECRET"}:
                value = secrets.token_urlsafe(48)
            additions.append(f"{key}={value}")
    if additions:
        path.write_text(original.rstrip() + "\n\n# Missing settings added by configure_env.py\n" + "\n".join(additions) + "\n", encoding="utf-8")
    print(f"{path.relative_to(ROOT)}: added {len(additions)} missing settings; existing values preserved")


if __name__ == "__main__":
    fill(ROOT / ".env", ROOT / ".env.example")
    public = entries((ROOT / ".env").read_text(encoding="utf-8-sig"))
    for app in ("dashboard", "demo-store"):
        fill(ROOT / "apps" / app / ".env.local", ROOT / "apps" / app / ".env.local.example", public)
