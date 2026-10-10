"""Authentication endpoints for Cellular Maze.

Provides JWT-based auth with mock user storage for hackathon demo.
In production, this would integrate with MongoDB via Motor.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["Authentication"])

# JWT Configuration -- set SECRET_KEY in production; the fallback is for local dev only
SECRET_KEY = os.environ.get("SECRET_KEY") or "cellularmaze-dev-only-secret"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/login")

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


# ── Schemas ──────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.\-]+$")
    password: str = Field(min_length=6, max_length=128)
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str


class UserProfile(BaseModel):
    user_id: str
    username: str
    email: str
    created_at: str


# ── In-memory user store (demo) ─────────────────────────────────────────

_users: dict[str, dict] = {
    "demo": {
        "user_id": "usr_demo",
        "username": "demo",
        "password_hash": _pwd.hash("demo123"),
        "email": "demo@cellularmaze.ai",
        "created_at": "2026-01-01T00:00:00Z",
    }
}


def _create_token(data: dict) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _verify_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Authenticate user and return JWT token.

    Accepts application/x-www-form-urlencoded with username and password fields.
    """
    user = _users.get(form_data.username)
    if not user or not _pwd.verify(form_data.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = _create_token({
        "sub": user["user_id"],
        "username": user["username"],
    })

    return TokenResponse(
        access_token=token,
        user_id=user["user_id"],
        username=user["username"],
    )


@router.post("/register", response_model=TokenResponse)
async def register(req: UserRegister):
    """Register a new user and return JWT token."""
    if req.username in _users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists",
        )

    user_id = f"usr_{req.username}_{int(datetime.now(timezone.utc).timestamp())}"
    _users[req.username] = {
        "user_id": user_id,
        "username": req.username,
        "password_hash": _pwd.hash(req.password),
        "email": req.email,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    token = _create_token({
        "sub": user_id,
        "username": req.username,
    })

    return TokenResponse(
        access_token=token,
        user_id=user_id,
        username=req.username,
    )


@router.get("/me", response_model=UserProfile)
async def get_me(token: str = Depends(oauth2_scheme)):
    """Get current user profile from JWT token."""
    payload = _verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub", "")
    username = payload.get("username", "")

    # Find user
    user = _users.get(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserProfile(
        user_id=user["user_id"],
        username=user["username"],
        email=user["email"],
        created_at=user["created_at"],
    )
