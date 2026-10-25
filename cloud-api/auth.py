import os
from typing import Optional
from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session
from database import get_cloud_db
from models import Cafe, User

def get_token_from_header(authorization: Optional[str] = None, custom_header: Optional[str] = None) -> Optional[str]:
    """Helper to extract token from standard Bearer or custom headers."""
    if custom_header:
        return custom_header.strip()
    if authorization:
        parts = authorization.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
        return authorization.strip()
    return None

def get_authenticated_cafe(
    cafe_id: str,
    x_cafe_api_key: Optional[str] = Header(None, alias="X-Cafe-API-Key"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_cloud_db)
) -> Cafe:
    """
    Authenticates the local edge server requesting on behalf of a specific café.
    Verifies that the provided API key matches the registered café's shared secret.
    """
    api_key = get_token_from_header(authorization, x_cafe_api_key)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing café API key. Provide 'X-Cafe-API-Key' or 'Authorization: Bearer <api_key>'."
        )

    # Allow query by UUID or human-readable cafe_code (e.g. CAFE-BLR-01)
    cafe = db.query(Cafe).filter(
        (Cafe.id == cafe_id) | (Cafe.cafe_code == cafe_id)
    ).first()

    if not cafe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Café '{cafe_id}' not found."
        )

    if not cafe.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Café '{cafe.name}' is inactive."
        )

    if cafe.api_key != api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid café API key."
        )

    return cafe

def get_authenticated_owner(
    authorization: Optional[str] = Header(None),
    x_owner_token: Optional[str] = Header(None, alias="X-Owner-Token"),
    db: Session = Depends(get_cloud_db)
) -> User:
    """
    Authenticates a café owner or administrator accessing the cloud dashboard.
    Verifies the owner's bearer token and role.
    """
    token = get_token_from_header(authorization, x_owner_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide 'Authorization: Bearer <token>' or 'X-Owner-Token'."
        )

    user = db.query(User).filter(User.auth_token == token).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid owner authentication token."
        )

    if user.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to café owners and administrators."
        )

    return user

def verify_cafe_ownership(cafe: Cafe, user: User) -> None:
    """
    Validates that the authenticated owner owns the target café.
    Admins bypass the ownership check.
    """
    if user.role == "admin":
        return
    if cafe.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: You do not own café '{cafe.name}'."
        )
