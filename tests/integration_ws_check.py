"""Manual WebSocket smoke check used against a running local server."""

from __future__ import annotations

import json

from websockets.sync.client import connect


with connect("ws://127.0.0.1:8000/ws", max_size=20_000_000) as websocket:
    first = json.loads(websocket.recv())
    city_data = first["payload"]["city_data"]
    assert "source_modes" in city_data
    assert "source_status" in city_data
    assert "modes" not in city_data
    print("websocket", first["type"], len(first["payload"]["road_state"]))
    websocket.send(json.dumps({"type": "ping", "payload": {"client_time": 123}}))
    while True:
        reply = json.loads(websocket.recv())
        if reply["type"] == "pong":
            break
    print("reply", reply["type"])
