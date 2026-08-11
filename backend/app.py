"""FastAPI application and delta-only WebSocket broadcaster."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .settings import load_dotenv

load_dotenv()

from .city_data import CityDataEngine
from .road_state import RoadStateEngine


class Connections:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def add(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.clients.add(websocket)

    def remove(self, websocket: WebSocket) -> None:
        self.clients.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        stale = []
        for client in tuple(self.clients):
            try:
                await client.send_json(message)
            except Exception:
                stale.append(client)
        for client in stale:
            self.remove(client)


road_state = RoadStateEngine()
city_data = CityDataEngine(
    road_state.map_layout,
    road_state.road_graph,
    road_state.config,
    road_pixels=road_state.road_pixels,
    pixel_resolution=road_state.resolution,
)
connections = Connections()


async def road_state_loop() -> None:
    update_hz = max(1, int(road_state.config["animation"]["update_hz"]))
    interval = 1 / update_hz
    last = time.perf_counter()
    statistics_clock = 0.0
    while True:
        await asyncio.sleep(interval)
        now = time.perf_counter()
        delta = now - last
        last = now
        road_delta = road_state.update(delta)
        if road_delta["changes"] or road_delta["removed"]:
            await connections.broadcast(
                {"type": "road_state_update", "payload": road_delta}
            )
        for incident_id in road_delta["expired_incidents"]:
            await connections.broadcast(
                {"type": "incident_expired", "payload": {"id": incident_id}}
            )
        for incident in road_state.pending_events:
            await connections.broadcast(
                {"type": "new_incident", "payload": incident}
            )
        road_state.pending_events.clear()
        statistics_clock += delta
        if statistics_clock >= 1.0:
            statistics_clock = 0.0
            await connections.broadcast(
                {"type": "statistics_update", "payload": road_state.statistics()}
            )


async def city_data_loop() -> None:
    last_polled = {
        source: float("-inf")
        for source in (
            "buses",
            "rainfall",
            "lightning",
            "roadworks",
            "traffic_speed_bands",
            "wind",
        )
    }
    while True:
        now = time.monotonic()
        tasks: list[tuple[str, asyncio.Task]] = []

        def poll_due(source: str, interval_key: str) -> bool:
            if now - last_polled[source] < city_data.config[interval_key]:
                return False
            last_polled[source] = now
            return True

        if (
            city_data.source_modes.get("buses") == "live"
            and poll_due("buses", "bus_arrival_poll_seconds")
        ):
            city_data.mark_api_call("buses")
            tasks.append(("bus_update", asyncio.create_task(city_data.refresh_buses())))
        if (
            city_data.source_modes.get("rainfall") != "off"
            and poll_due("rainfall", "rainfall_poll_seconds")
        ):
            if city_data.source_modes.get("rainfall") == "live":
                city_data.mark_api_call("rainfall")
            tasks.append(
                ("rainfall_update", asyncio.create_task(city_data.refresh_rainfall()))
            )
        if (
            city_data.source_modes.get("lightning") == "live"
            and poll_due("lightning", "lightning_poll_seconds")
        ):
            city_data.mark_api_call("lightning")
            tasks.append(
                (
                    "lightning_batch",
                    asyncio.create_task(city_data.refresh_lightning()),
                )
            )
        if (
            city_data.source_modes.get("roadworks") == "live"
            and poll_due("roadworks", "roadworks_poll_seconds")
        ):
            city_data.mark_api_call("roadworks")
            tasks.append(
                (
                    "roadworks_update",
                    asyncio.create_task(city_data.refresh_roadworks()),
                )
            )
        if (
            city_data.source_modes.get("traffic_speed_bands") == "live"
            and poll_due(
                "traffic_speed_bands",
                "traffic_speed_bands_poll_seconds",
            )
        ):
            city_data.mark_api_call("traffic_speed_bands")
            tasks.append(
                (
                    "city_data_update",
                    asyncio.create_task(city_data.refresh_traffic_speed_bands()),
                )
            )
        if (
            city_data.source_modes.get("rainfall") == "live"
            and poll_due("wind", "wind_poll_seconds")
        ):
            city_data.mark_api_call("wind_direction")
            city_data.mark_api_call("wind_speed")
            tasks.append(
                (
                    "city_data_update",
                    asyncio.create_task(city_data.refresh_wind()),
                )
            )
        if tasks:
            payloads = await asyncio.gather(*(task for _, task in tasks))
            full_snapshot = any(
                event_type == "city_data_update" for event_type, _ in tasks
            )
            snapshot = city_data.snapshot()
            if full_snapshot:
                await connections.broadcast(
                    {"type": "city_data_update", "payload": snapshot}
                )
            else:
                for (event_type, _), payload in zip(tasks, payloads):
                    if payload:
                        await connections.broadcast(
                            {"type": event_type, "payload": payload}
                        )
                # Clocks and health still change when a successful provider
                # returns no events, so publish each once per poll batch.
                await connections.broadcast(
                    {
                        "type": "api_clocks_update",
                        "payload": snapshot["api_calls"],
                    }
                )
                await connections.broadcast(
                    {
                        "type": "source_status_update",
                        "payload": snapshot["source_status"],
                    }
                )
        simulated = (
            city_data.simulated_lightning(now)
            if city_data.source_modes.get("lightning") == "simulated"
            or city_data.source_status.get("lightning") == "simulated"
            else None
        )
        if simulated:
            await connections.broadcast(
                {"type": "lightning_event", "payload": simulated}
            )
        await asyncio.sleep(1.0)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    road_state_task = asyncio.create_task(road_state_loop())
    city_data_task = asyncio.create_task(city_data_loop())
    try:
        yield
    finally:
        road_state_task.cancel()
        city_data_task.cancel()


app = FastAPI(title="Mini Singapore API", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "clients": len(connections.clients)}


@app.get("/api/network")
async def network() -> dict[str, Any]:
    return road_state.network_payload()


@app.get("/api/state")
async def state() -> dict[str, Any]:
    road_state.update(0.0)
    return {
        **road_state.state_payload(),
        "city_data": city_data.snapshot(),
    }


@app.get("/api/city-data")
async def city_data_state() -> dict[str, Any]:
    return city_data.snapshot()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await connections.add(websocket)
    await websocket.send_json(
        {
            "type": "state_snapshot",
            "payload": {
                **road_state.state_payload(),
                "city_data": city_data.snapshot(),
            },
        }
    )
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "payload": {"client_time": message.get("payload", {}).get("client_time")},
                    }
                )
            else:
                if message.get("type") == "source_mode":
                    payload = message.get("payload") or {}
                    source = str(payload.get("source") or "")
                    mode = str(payload.get("mode") or "live")
                    if source == "incidents":
                        road_state.set_incident_mode(mode)
                        city_data.set_incident_mode(mode)
                        snapshot = city_data.snapshot()
                    else:
                        snapshot = await city_data.set_source_mode(source, mode)
                    await connections.broadcast(
                        {"type": "city_data_update", "payload": snapshot}
                    )
                else:
                    road_state.apply_command(message)
                    await connections.broadcast(
                        {
                            "type": "config_update",
                            "payload": road_state.state_payload()["config"],
                        }
                    )
    except WebSocketDisconnect:
        connections.remove(websocket)


frontend_dist = Path("frontend/dist")
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{path:path}")
    async def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        candidate = frontend_dist / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html")
