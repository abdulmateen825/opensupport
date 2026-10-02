import pytest
from pydantic import ValidationError

from backend.app.schemas import ProjectCreate, ProjectUpdate, WebhookCreate


def test_project_domains_normalize_hostnames_and_remove_duplicates():
    project = ProjectCreate(
        name="Store",
        allowed_domains=[" Shop.Example.com ", "shop.example.com", "localhost:5173"],
    )

    assert project.allowed_domains == ["shop.example.com", "localhost:5173"]


def test_project_domains_reject_paths():
    with pytest.raises(ValidationError):
        ProjectUpdate(allowed_domains=["example.com/account"])


def test_webhook_requires_at_least_one_event():
    with pytest.raises(ValidationError):
        WebhookCreate(url="https://hooks.example.com/open-support", events=[])
