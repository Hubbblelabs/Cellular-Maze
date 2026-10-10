"""Enterprise middleware for Cellular Maze API.

Provides:
  - Request ID injection (X-Request-ID header)
  - Structured request/response logging
  - Global error handling with structured error responses
  - CORS configuration
  - Request timing
"""

import time
import uuid

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from backend.core.logging import logger


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Inject a unique request ID into every request for tracing.

    Passes through an existing X-Request-ID header if present,
    otherwise generates a new UUID.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id", str(uuid.uuid4())[:12])
        # Store on request state for downstream use
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every request with method, path, status, and timing."""

    SKIP_PATHS = frozenset(["/health", "/docs", "/openapi.json", "/redoc", "/favicon.ico"])

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        start = time.time()
        request_id = getattr(request.state, "request_id", "---")

        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = (time.time() - start) * 1000
            logger.error(
                f"[{request_id}] {request.method} {request.url.path} "
                f"FAILED ({duration_ms:.1f}ms): {exc}"
            )
            raise

        duration_ms = (time.time() - start) * 1000
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} "
            f"-> {response.status_code} ({duration_ms:.1f}ms)"
        )

        response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
        return response


class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """Catch unhandled exceptions and return structured JSON errors."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            from fastapi.responses import JSONResponse

            request_id = getattr(request.state, "request_id", "unknown")
            logger.error(f"[{request_id}] Unhandled error: {type(exc).__name__}: {exc}")

            return JSONResponse(
                status_code=500,
                content={
                    "error": "Internal Server Error",
                    "message": str(exc),
                    "request_id": request_id,
                    "path": str(request.url.path),
                },
            )
