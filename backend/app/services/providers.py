"""Small provider boundary for chat completion backends.

Third party packages can expose a factory in the ``opensupport.providers``
entry point group. A factory receives this settings object and returns an
object implementing ``complete(system_prompt, user_prompt)``.
"""

from importlib.metadata import entry_points
from typing import Protocol

import httpx

from backend.app.core.config import settings


class ChatProvider(Protocol):
    async def complete(self, system_prompt: str, user_prompt: str) -> str: ...


class OpenAICompatibleProvider:
    def __init__(self, api_key: str, model: str, base_url: str):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json={"model": self.model, "temperature": 0.2, "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ]},
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("The language model returned an empty response")
            return content.strip()


def get_chat_provider() -> ChatProvider | None:
    if not settings.llm_api_key or not settings.llm_model:
        return None
    if settings.llm_provider == "openai-compatible":
        return OpenAICompatibleProvider(settings.llm_api_key, settings.llm_model, settings.llm_base_url)
    for entry_point in entry_points(group="opensupport.providers"):
        if entry_point.name == settings.llm_provider:
            factory = entry_point.load()
            return factory(settings)
    raise ValueError(f"Unknown chat provider: {settings.llm_provider}")
