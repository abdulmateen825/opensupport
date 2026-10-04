import scripts.configure_env as setup


def test_env_fill_preserves_existing_credentials_and_does_not_print_them(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(setup, "ROOT", tmp_path)
    target = tmp_path / ".env"
    existing_secret = "legacy-private-key-" + "q" * 40
    target.write_text(f"LLM_API_KEY=private-existing-value\nAPP_SECRET_KEY={existing_secret}\n", encoding="utf-8")
    template = tmp_path / ".env.example"
    template.write_text("LLM_API_KEY=\nAPP_SECRET_KEY=change-me\nENCRYPTION_KEY=\nWIDGET_IDENTITY_SECRET=\nPUBLIC_RATE_LIMIT=90\n", encoding="utf-8")
    setup.fill(target, template)
    values = setup.entries(target.read_text(encoding="utf-8"))
    assert values["LLM_API_KEY"] == "private-existing-value"
    assert values["APP_SECRET_KEY"] == existing_secret
    assert len(values["ENCRYPTION_KEY"]) >= 32
    assert len(values["WIDGET_IDENTITY_SECRET"]) >= 32
    assert values["ENCRYPTION_KEY"] == values["WIDGET_IDENTITY_SECRET"] == existing_secret
    output = capsys.readouterr().out
    assert "private-existing-value" not in output
    assert values["ENCRYPTION_KEY"] not in output
    original = target.read_text(encoding="utf-8")
    setup.fill(target, template)
    assert target.read_text(encoding="utf-8") == original


def test_fresh_setup_generates_distinct_signing_and_encryption_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(setup, "ROOT", tmp_path)
    template = tmp_path / ".env.example"
    template.write_text("APP_SECRET_KEY=\nENCRYPTION_KEY=\nWIDGET_IDENTITY_SECRET=\n", encoding="utf-8")
    target = tmp_path / ".env"
    setup.fill(target, template)
    values = setup.entries(target.read_text(encoding="utf-8"))
    assert len(set(values.values())) == 3
    assert all(len(value) >= 32 for value in values.values())
