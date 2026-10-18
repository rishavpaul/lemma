"""Shared-token auth for remote access (phone over Tailscale).

Requests that reach the server directly on 127.0.0.1 (desktop app, `./run.sh`) are trusted. Requests that arrive through
a reverse proxy such as `tailscale serve` carry forwarding headers, and those must present the token, as a cookie
(set by POST /api/auth/login) or an `Authorization: Bearer` header.
"""
import hmac
import secrets

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import config

COOKIE = "sdc_token"
PROXY_HEADERS = ("x-forwarded-for", "x-forwarded-host", "tailscale-user-login", "forwarded")
OPEN_PATHS = ("/api/auth/",)
router = APIRouter()


def token_path():
    return config.DATA_DIR / "auth_token"


def get_token() -> str:
    """The shared token, created (mode 0600) on first use."""
    p = token_path()
    if p.exists():
        t = p.read_text().strip()
        if t:
            return t
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    t = secrets.token_urlsafe(24)
    p.write_text(t + "\n")
    p.chmod(0o600)
    return t


def is_remote(request: Request) -> bool:
    return any(h in request.headers for h in PROXY_HEADERS)


def _presented(request: Request) -> str:
    bearer = request.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        return bearer[7:].strip()
    return request.cookies.get(COOKIE, "")


def is_authed(request: Request) -> bool:
    return not is_remote(request) or hmac.compare_digest(_presented(request), get_token())


async def middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not path.startswith(OPEN_PATHS) and not is_authed(request):
        return JSONResponse({"detail": "Sign in required."}, status_code=401)
    return await call_next(request)


class Login(BaseModel):
    token: str


@router.get("/api/auth/status")
async def status(request: Request):
    return {"required": is_remote(request), "authed": is_authed(request)}


@router.post("/api/auth/login")
async def login(body: Login, request: Request, response: Response):
    if not hmac.compare_digest(body.token.strip(), get_token()):
        raise HTTPException(401, "That token is not right.")
    response.set_cookie(COOKIE, get_token(), max_age=365 * 24 * 3600, httponly=True, samesite="strict",
                        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https")
    return {"ok": True}


@router.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}
