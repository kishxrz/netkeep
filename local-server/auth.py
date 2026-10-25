from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from config import settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)

def verify_lan_client(
    api_key: Optional[str] = Security(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme)
) -> str:
    """
    Validates that requests coming over the LAN possess the configured trusted API key.
    Accepts either 'X-API-Key: <key>' or 'Authorization: Bearer <key>'.
    """
    provided_key = None
    if api_key:
        provided_key = api_key
    elif bearer and bearer.credentials:
        provided_key = bearer.credentials

    if not provided_key or provided_key != settings.LAN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing LAN API authentication key. Configure X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"}
        )

    return provided_key
