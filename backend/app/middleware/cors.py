from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send


class WidgetAwareCORSMiddleware:
    """Admin origins are explicit; public widget routes enforce project origins themselves."""

    def __init__(self, app: ASGIApp, admin_origins: list[str]):
        options = {
            "allow_credentials": False,
            "allow_methods": ["GET", "POST", "PATCH", "DELETE"],
            "allow_headers": ["Authorization", "Content-Type"],
        }
        self.admin = CORSMiddleware(app, allow_origins=admin_origins, **options)
        self.widget = CORSMiddleware(app, allow_origins=["*"], **options)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        middleware = self.widget if scope.get("path", "").startswith("/api/widget/") else self.admin
        await middleware(scope, receive, send)
