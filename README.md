# Mini Singapore

Mini Singapore is an ambient, pixel-art view of a living island. Roads,
transport, weather, infrastructure, and simulated movement become small,
contribution-graph-style cells on a stylized map of Singapore.

This is an art piece, not a navigation system, safety service, or authoritative
traffic monitor.

## Features

- A 992×992 logical pixel world with Singapore's approximate 50 km × 27 km
  proportions.
- Roads from motorways through residential and service streets.
- Live or simulated buses, incidents, roadworks, rainfall, lightning, wind, and
  congestion-responsive background traffic.
- Simulated MRT/LRT trains, aircraft, runway lights, and land-use night lights.
- Day/night colour transitions based on Singapore time.
- Cursor-centred zoom, drag-to-pan, contextual hover details, and event focus.
- One Canvas 2D renderer with a fixed layer hierarchy.

All user-controlled data sources start in live mode and fall back to their
simulation when live data is unavailable. The selected source mode remains
separate from the effective source status, so a live selection can accurately
report that it is currently using simulated fallback data.

## Quick Start with Docker

### Requirements

- Docker Desktop with Compose.
- Git LFS for the large source and generated map files.

After cloning:

```powershell
git lfs install
git lfs pull
Copy-Item .env.example .env
docker compose up --build -d
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

Useful commands:

```powershell
docker compose ps
docker compose logs -f mini-singapore
docker compose down
```

The container deliberately runs one Uvicorn worker. Application state and
WebSocket clients are process-local, so multiple workers would create separate
versions of the city.

## Manual Setup

### Requirements

- Python 3.10 or newer.
- Node.js 20.19–20.x, or 22.12 or newer.
- npm with lockfile support.
- A modern browser with Canvas 2D, `Path2D`, `ResizeObserver`, and WebSocket
  support.

From the repository root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Set-Location frontend
npm.cmd ci
npm.cmd run build
Set-Location ..

Copy-Item .env.example .env
.\.venv\Scripts\python.exe run_web.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

### Development servers

Run FastAPI from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --reload
```

Run Vite from another terminal:

```powershell
Set-Location frontend
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The development client
connects directly to FastAPI on port 8000 by default; Vite also provides
`/api` and `/ws` proxies for relative configurations.

## API Credentials

The application works without credentials by falling back to simulations.
Populate these values in the root `.env` for live providers:

```dotenv
LTA_DATAMALL_ACCOUNT_KEY=
DATA_GOV_SG_API_KEY=
```

- `LTA_DATAMALL_ACCOUNT_KEY` enables live LTA buses, roadworks, and traffic
  speed bands.
- `DATA_GOV_SG_API_KEY` raises data.gov.sg weather API rate limits.
- Shell environment variables override `.env` values.
- Restart the backend after changing credentials.
- Never commit `.env`; only `.env.example` belongs in the repository.

## Data Layers

| Layer              | Live source                     | Fallback                      |
| ------------------ | ------------------------------- | ----------------------------- |
| Incidents          | `data/TrafficIncidents.json`    | Road-matched simulated events |
| Buses              | LTA DataMall Bus Arrival        | Simulated road routes         |
| Rainfall           | data.gov.sg rainfall readings   | Evolving simulated coverage   |
| Wind               | data.gov.sg direction and speed | Simulated calm vector         |
| Lightning          | data.gov.sg observations        | Timed simulated strikes       |
| Roadworks          | LTA DataMall RoadWorks          | Simulated road-matched works  |
| Background traffic | LTA Traffic Speed Bands v4      | Neutral fictional density     |

Static roads, rail, stations, land use, greenery, and airports come only from
the supplied GeoJSON files. Runtime code does not download map geometry.

## Controls

- Drag to pan.
- Use the mouse wheel to zoom around the cursor.
- Double-click to reset the camera.
- Click the event monitor to focus its current event.
- Hover major roads, MRT lines and stations, airports, vehicles, incidents, and
  roadworks for contextual information.
- Click a source control to cycle through `LIVE`, `SIM`, and `OFF`.
- Use `LAND USE` to toggle the translucent sector overlay.
- Use `DEBUG` to inspect time remaining until each live API poll.

## Rebuilding the Map

The runtime uses the generated JSON in `output/`. Rebuild it only after source
GeoJSON, preprocessing logic, or raster resolution changes:

```powershell
.\.venv\Scripts\python.exe -m preprocess.pipeline
```

Default inputs:

- `data/map.geojson`
- `data/mrtlines.geojson`
- `data/mrtstations.geojson`
- `data/landuse.geojson`
- `data/greenery.geojson`
- `data/airports.geojson`

Useful options:

```powershell
.\.venv\Scripts\python.exe -m preprocess.pipeline `
  --resolution 992 `
  --simplify-tolerance 0.00018 `
  --output output
```

Supported resolutions are `32`, `64`, `96`, `128`, `248`, `496`, and `992`.
The pipeline writes five runtime JSON artifacts:

- `road_graph.json`
- `map_layout.json`
- `road_pixels.json`
- `rail_pixels.json`
- `environment_pixels.json`

It also writes five diagnostic PNG previews. Preview images are generated
locally and ignored by Git.

## Testing

Backend and preprocessing:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Frontend:

```powershell
Set-Location frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Manual checks against a running backend:

```powershell
.\.venv\Scripts\python.exe tests\integration_ws_check.py
.\.venv\Scripts\python.exe tests\live_city_data_check.py
```

The live-provider check makes real external requests and may consume API quota.

## Project Layout

- `backend/` — FastAPI, incidents, providers, buses, spatial indexing, and road
  routing.
- `frontend/` — React UI, realtime state, interactions, and Canvas layers.
- `preprocess/` — road graph, map layout, rasterization, rail, land use,
  greenery, airports, and preview generation.
- `config/` — rendering, simulation, source-mode, endpoint, and polling values.
- `data/` — source GeoJSON and the local incident feed.
- `output/` — generated runtime JSON; diagnostic PNGs remain untracked.
- `tests/` — Python tests and manual integration helpers.

Large GeoJSON and generated JSON files use Git LFS. Run `git lfs pull` after
cloning before starting or rebuilding the application.
