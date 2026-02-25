"""WebSocket endpoint for real-time sync progress events.

Clients connect to ``/api/ws/sync?token=<JWT>`` and receive JSON
messages from the ``sync:progress`` Redis pub/sub channel.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from backend.auth.service import decode_access_token
from backend.core.config import settings
from backend.ws.manager import manager
from backend.ws.publisher import CHANNEL

logger = logging.getLogger(__name__)

ws_router = APIRouter()


@ws_router.websocket("/ws/sync")
async def websocket_sync(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
) -> None:
    """WebSocket endpoint that relays sync progress events.

    Authentication is via the ``token`` query parameter (JWT).
    On connect, subscribes to the Redis ``sync:progress`` channel and
    forwards every message to the client.
    """
    # --- JWT Authentication ---
    if token is None:
        await websocket.accept()
        await websocket.send_json({"error": "unauthorized"})
        await websocket.close(code=1008)
        return

    payload = decode_access_token(token)
    if payload is None or payload.get("sub") is None:
        await websocket.accept()
        await websocket.send_json({"error": "unauthorized"})
        await websocket.close(code=1008)
        return

    # --- Accept and register connection ---
    await manager.connect(websocket)

    # --- Subscribe to Redis pub/sub ---
    redis_client: Optional[aioredis.Redis] = None
    pubsub = None
    try:
        redis_client = aioredis.from_url(
            settings.redis_url, decode_responses=True
        )
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(CHANNEL)

        # Run two concurrent loops:
        # 1. Listen for Redis messages and broadcast to WS clients
        # 2. Listen for WS messages (keep-alive / detect disconnect)
        async def _redis_listener() -> None:
            """Forward Redis pub/sub messages to all connected WebSocket clients."""
            assert pubsub is not None
            async for raw_message in pubsub.listen():
                if raw_message["type"] == "message":
                    data = raw_message["data"]
                    try:
                        parsed = json.loads(data) if isinstance(data, str) else data
                        await manager.broadcast_json(parsed)
                    except (json.JSONDecodeError, TypeError):
                        await manager.broadcast(str(data))

        async def _ws_receiver() -> None:
            """Keep reading from WebSocket to detect disconnects."""
            assert websocket is not None
            while True:
                await websocket.receive_text()

        # Run both tasks; when one finishes the other is cancelled
        redis_task = asyncio.create_task(_redis_listener())
        ws_task = asyncio.create_task(_ws_receiver())

        done, pending = await asyncio.wait(
            {redis_task, ws_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected normally")
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        manager.disconnect(websocket)
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(CHANNEL)
                await pubsub.close()
            except Exception:
                pass
        if redis_client is not None:
            try:
                await redis_client.close()
            except Exception:
                pass
