from typing import Annotated

from fastapi import Depends, Header, Request


def bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    return authorization[len(prefix) :] if authorization.startswith(prefix) else authorization


def current_user(request: Request, token: Annotated[str | None, Depends(bearer_token)]) -> dict:
    return request.app.state.auth_service.me(token)
