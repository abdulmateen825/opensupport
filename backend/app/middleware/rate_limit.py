from fastapi import Request
from redis.asyncio import Redis
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.app.core.config import settings

rate_limit_redis = Redis.from_url(settings.redis_url)


class TenantRateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed coarse limits for public widget traffic and credential endpoints."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/widget/"):
            limit, bucket = settings.public_rate_limit, "public"
        elif path in {"/api/auth/login", "/api/auth/register", "/api/auth/refresh"}:
            limit, bucket = settings.auth_rate_limit, "auth"
        else:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        key = f"opensupport:limit:{bucket}:{client_ip}"
        try:
            count = await rate_limit_redis.incr(key)
            if count == 1:
                await rate_limit_redis.expire(key, 60)
        except Exception:
            if settings.app_env.lower() in {"production", "prod"}:
                return JSONResponse({"detail": "Rate-limit service is unavailable"}, status_code=503)
            return await call_next(request)
        finally:
            pass

        if count > limit:
            return JSONResponse(
                {"detail": "Too many requests. Try again shortly."},
                status_code=429,
                headers={"Retry-After": "60"},
            )
        return await call_next(request)
