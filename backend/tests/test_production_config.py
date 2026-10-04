import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.core.config import Settings
from backend.app.middleware.cors import WidgetAwareCORSMiddleware


def production(**overrides):
    values = dict(app_env="production", app_secret_key="a" * 48, encryption_key="b" * 48,
                  widget_identity_secret="c" * 48, cors_origins="https://support.example.com")
    return Settings(_env_file=None, **(values | overrides))


def test_valid_production_config():
    assert production().allowed_origins == ["https://support.example.com"]


@pytest.mark.parametrize("origins", ["", "*", "http://localhost:3000", "https://*.example.com", "https://example.com/path"])
def test_production_rejects_unsafe_admin_origins(origins):
    with pytest.raises(ValidationError):
        production(cors_origins=origins)


def test_production_rejects_reused_secret():
    with pytest.raises(ValidationError):
        production(encryption_key="a" * 48)


def test_configuration_failures_do_not_render_credentials():
    with pytest.raises(ValidationError) as failure:
        production(encryption_key="a" * 48, llm_api_key="private-provider-value")
    assert "private-provider-value" not in str(failure.value)
    assert "a" * 48 not in str(failure.value)


def test_admin_cors_is_restricted_without_blocking_host_validated_widget_routes():
    app = FastAPI()
    app.add_middleware(WidgetAwareCORSMiddleware, admin_origins=["https://support.example.com"])
    with TestClient(app) as client:
        headers = {"Origin": "https://other.example", "Access-Control-Request-Method": "POST"}
        assert client.options("/api/projects", headers=headers).status_code == 400
        headers["Origin"] = "https://support.example.com"
        response = client.options("/api/projects", headers=headers)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == headers["Origin"]
        headers["Origin"] = "https://shop.example"
        assert client.options("/api/widget/project/conversations", headers=headers).status_code == 200
