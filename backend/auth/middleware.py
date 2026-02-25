"""Authentication middleware for JWT token validation"""

from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.auth.service import decode_access_token


class JWTMiddleware(BaseHTTPMiddleware):
    """Middleware that validates JWT Bearer tokens on protected routes"""
    
    # Public endpoints that don't require authentication
    PUBLIC_PATHS = {
        "/api/auth/login",
        "/api/health",
        "/docs",
        "/openapi.json",
        "/redoc",
    }
    
    async def dispatch(self, request: Request, call_next):
        # Allow OPTIONS requests (CORS preflight)
        if request.method == "OPTIONS":
            return await call_next(request)
        
        # Check if path is public
        if request.url.path in self.PUBLIC_PATHS or request.url.path.startswith("/api/setup/"):
            return await call_next(request)
        
        # Check if path requires auth (starts with /api/)
        if request.url.path.startswith("/api/"):
            auth_header = request.headers.get("authorization")
            
            if not auth_header or not auth_header.startswith("Bearer "):
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Missing or invalid authorization header"},
                    headers={"WWW-Authenticate": "Bearer"},
                )
            
            token = auth_header[7:]  # Remove "Bearer " prefix
            payload = decode_access_token(token)
            
            if payload is None:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Invalid or expired token"},
                    headers={"WWW-Authenticate": "Bearer"},
                )
        
        return await call_next(request)
