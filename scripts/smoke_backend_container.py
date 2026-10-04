"""Exercise a built backend against temporary private PostgreSQL/Redis containers."""
import argparse
import secrets
import subprocess
import time
from uuid import uuid4


def docker(*args: str, input_text: str | None = None) -> str:
    result = subprocess.run(["docker", *args], input=input_text, capture_output=True,
                            text=True, check=True)
    return result.stdout.strip()


def wait_for(action, seconds: int = 90):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            return action()
        except subprocess.CalledProcessError:
            time.sleep(1)
    raise RuntimeError("Temporary container did not become ready")


def main(image: str) -> None:
    docker("image", "inspect", image)  # Fail before creating resources if not built.
    network = f"opensupport-smoke-{uuid4().hex[:12]}"
    containers = []
    docker("network", "create", "--internal", network)
    password = secrets.token_urlsafe(24)
    try:
        postgres = docker("run", "--rm", "-d", "--name", f"{network}-db", "--network", network,
                          "--network-alias", "postgres", "-e", f"POSTGRES_PASSWORD={password}",
                          "-e", "POSTGRES_USER=opensupport", "-e", "POSTGRES_DB=opensupport",
                          "postgres:17-alpine")
        containers.append(postgres)
        redis = docker("run", "--rm", "-d", "--network", network, "--network-alias", "redis",
                       "redis:7-alpine")
        containers.append(redis)
        wait_for(lambda: docker("exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "opensupport", "-d", "opensupport"))
        wait_for(lambda: docker("exec", redis, "redis-cli", "ping"))
        environment = {
            "APP_ENV": "production", "CORS_ORIGINS": "https://support.example.com",
            "APP_SECRET_KEY": secrets.token_urlsafe(48), "ENCRYPTION_KEY": secrets.token_urlsafe(48),
            "WIDGET_IDENTITY_SECRET": secrets.token_urlsafe(48),
            "DATABASE_URL": f"postgresql+asyncpg://opensupport:{password}@postgres:5432/opensupport",
            "REDIS_URL": "redis://redis:6379/0", "LLM_API_KEY": "", "RESEND_API_KEY": "",
        }
        env_args = [part for key, value in environment.items() for part in ("-e", f"{key}={value}")]
        docker("run", "--rm", "--network", network, *env_args, image, "alembic", "upgrade", "head")
        api = docker("run", "--rm", "-d", "--network", network, *env_args, image)
        containers.append(api)
        wait_for(lambda: docker("exec", "-i", api, "python", "-", input_text=
                                "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"))
        checks = '''
import json
import os
import urllib.request
import urllib.error
assert os.getuid() == 10001
assert not os.path.exists('/app/.env')
assert os.path.exists('/app/LICENSE')
assert not os.access('/app/backend/app/main.py', os.W_OK)
assert os.access('/app/beat', os.W_OK)
def request(path, body=None, token=None, method=None, origin=None):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if origin: headers['Origin'] = origin
    req = urllib.request.Request('http://127.0.0.1:8000' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response: return json.load(response)
def account(email):
    return request('/api/auth/register', {'email': email, 'password': 'test-only-password-123',
        'organization_name': 'Isolated smoke organization', 'display_name': 'Smoke Test'})['access_token']
assert request('/health')['status'] == 'ok'
first = account('first@example.com')
second = account('second@example.com')
project = request('/api/projects', {'name': 'Isolated smoke project', 'allowed_domains': ['shop.example.com']}, first)
assert request('/api/projects', token=second) == []
try:
    request('/api/projects/' + project['id'], {'name': 'Forbidden'}, second, 'PATCH')
    raise AssertionError('Cross-tenant mutation unexpectedly succeeded')
except urllib.error.HTTPError as error: assert error.code == 404
result = request('/api/widget/' + project['id'] + '/shopping/intent',
    {'query': 'Show me bottles under $40', 'categories': ['drinkware']}, origin='https://shop.example.com')
assert result['mode'] == 'keyword'
assert result['intent']['max_price'] == 40
print('Container smoke passed: fresh production migration, health, non-root, registration, projects, tenant isolation, shopping fallback.')
'''
        print(docker("exec", "-i", api, "python", "-", input_text=checks))
    finally:
        # Only IDs returned by this run are stopped; --rm removes their temporary volumes.
        for container in reversed(containers):
            subprocess.run(["docker", "stop", "--time", "2", container], capture_output=True)
        subprocess.run(["docker", "network", "rm", network], capture_output=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="opensupport-verification-backend:local")
    main(parser.parse_args().image)
