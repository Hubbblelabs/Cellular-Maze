"""Authentication endpoints for Cellular Maze.

Users are stored in MongoDB when it is connected (MONGO_URI), otherwise in
an in-memory dict that is lost on restart. The demo account always exists.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from backend.core.logging import logger
from backend.db.base import MongoClient

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
        "hashed_password": _pwd.hash("demo123"),
        "email": "demo@cellularmaze.ai",
        "created_at": "2026-01-01T00:00:00Z",
    }
}


async def _find_user(username: str) -> Optional[dict]:
    """Look a user up in MongoDB first, then the in-memory store."""
    if MongoClient.is_connected():
        try:
            doc = await MongoClient.get_db()["users"].find_one({"username": username}, {"_id": 0})
            if doc:
                return doc
        except Exception as exc:
            logger.warning("User lookup in MongoDB failed: %s", type(exc).__name__)
    return _users.get(username)


async def _save_user(user: dict) -> None:
    """Persist a new user to MongoDB when available, else keep it in memory."""
    if MongoClient.is_connected():
        try:
            await MongoClient.get_db()["users"].insert_one(dict(user))
            return
        except Exception as exc:
            logger.warning("Saving user to MongoDB failed, keeping in memory: %s", type(exc).__name__)
    _users[user["username"]] = user


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
    user = await _find_user(form_data.username)
    if not user or not _pwd.verify(form_data.password, user.get("hashed_password", "")):
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
    if await _find_user(req.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists",
        )

    user_id = f"usr_{req.username}_{int(datetime.now(timezone.utc).timestamp())}"
    await _save_user({
        "user_id": user_id,
        "username": req.username,
        "hashed_password": _pwd.hash(req.password),
        "email": req.email,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

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
    user = await _find_user(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserProfile(
        user_id=user["user_id"],
        username=user["username"],
        email=user["email"],
        created_at=str(user["created_at"]),
    )
