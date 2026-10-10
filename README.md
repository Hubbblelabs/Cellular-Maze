# Cellular Maze -- Cellular Network-Aware Routing System

An ML-powered navigation platform that recommends routes based on **predicted cellular signal quality** alongside ETA and distance. Traditional routing engines (Google Maps, Waze) optimize purely for time -- Cellular Maze adds network awareness to prevent dropped calls, lost connectivity, and dead zone interruptions.

**Problems solved:**
- Calls dropping mid-route through dead zones
- Ride-hailing apps disconnecting in weak coverage areas
- Fleet tracking going offline on certain highways
- Emergency SOS failing to send in tunnels or underpasses
- Navigation updates stopping in areas with no signal
- Video/music buffering on routes through low-density zones

## How It Works

```
User enters source + destination
         |
   TomTom (live traffic) or OSRM (keyless) generates up to 7 road-snapped alternatives
         |
   Each route path sampled at 500m intervals
         |
   ResidualSignalNet (PyTorch) predicts signal strength + drop probability per point
         |
   Physics validation via COST-231 Hata + Ericsson 9999 propagation ensemble
         |
   Routes scored: weighted_score = preference * signal_norm + (1-preference) * eta_norm
         |
   Dead zone detection identifies contiguous weak segments per carrier
         |
   RL (Thompson Sampling) personalizes weights per user over time
         |
   Ranked results displayed on Mapbox GL JS map with signal heatmap overlay
```

## Architecture Overview

```
[Browser / Vehicle]
       |
       | HTTP (localhost:3000)
       v
[Next.js 16 Frontend]     <--- React 19, Mapbox GL JS, TanStack Query
       |
       | Axios (localhost:8000)
       v
[FastAPI Backend Server]   <--- 39 endpoints across /api/*, /model/*, /api/v1/*
       |
       |--- TomTom Routing API       (road-snapped geometry, live traffic)
       |--- OpenCelliD               (real cell tower lat/lng, 601 towers)
       |--- OpenWeather API          (real-time weather impact factor)
       |--- TomTom Traffic Flow API  (live congestion + incidents)
       |--- Nominatim                (forward/reverse geocoding)
       |
       v
[ML Model Layer]
       |--- ResidualSignalNet        (PyTorch, 560K params, multi-task)
       |--- COST-231 Hata + Ericsson 9999 (physics validation)
       |--- Thompson Sampling RL     (per-user preference learning)
       |--- Dead Zone Predictor      (multi-carrier dead zone detection)
```

## Demo

**Bangalore Demo Route: MG Road to Electronic City**

| Route | ETA | Signal | Behavior |
|-------|-----|--------|----------|
| Fastest Route | 28 min | Medium (48) | Direct via Hosur Road -- enters weak signal zone |
| Balanced Route | 36 min | Medium (50) | Via HSR Layout -- avoids worst dead zones |
| Best Signal Route | 47 min | Medium (45) | Detours through Koramangala, Jayanagar -- strong coverage |

The user adjusts a preference slider (0 = pure speed, 100 = pure signal) and the ranking updates in real-time.

## Features

### Core Navigation
- **Multi-route comparison** -- Up to 7 TomTom road-snapped alternatives with ETA/distance/signal scores
- **Two-phase route loading** -- Fast routes appear in 1-2s (heuristic scores), full ML scoring follows in 15-60s
- **Preference slider** -- Dynamic weight adjustment between speed and connectivity (0-100)
- **Carrier filter** -- Route scoring per telecom provider (Jio, Airtel, Vi, BSNL) or multi-SIM mode
- **Signal heatmap** -- Color-coded zone overlay on the map (signal strength, traffic congestion)
- **Dead zone alerts** -- Toast notifications when approaching weak signal areas across all carriers
- **Live rerouting** -- Periodic re-evaluation during navigation with automatic reroute if conditions change
- **Real GPS tracking** -- Live position tracking via browser geolocation API with route progress estimation
- **Simulated drive** -- When GPS is denied or you are not on the route (e.g. demoing from outside Bengaluru), navigation drives the route in ~90 s so every alert can be seen
- **Weak-zone countdown** -- During navigation the sidebar counts down to the next weak/no-coverage stretch and warns 1.5 km ahead ("finish calls, cache content now")
- **Per-carrier comparison** -- Route detail shows average signal for Jio / Airtel / Vi / BSNL on that exact route
- **Keyless real roads** -- Without a TomTom key, routes come from OSRM (direct + via-zone alternatives), de-duplicated and traffic-adjusted by time of day

### Signal Intelligence
- **Multi-SIM scoring** -- Scores every route across all carriers independently, picks best per segment, returns per-carrier breakdown and combined best-of-all score
- **Signal stability metrics** -- Continuity score (signal standard deviation), longest stable window (consecutive strong segments), and combined stability score
- **Hard ETA constraints** -- Configurable max ETA ratio (default 1.5x fastest). Routes exceeding the cap are marked rejected with a "Too Slow" badge
- **Predictive bad zone warnings** -- Detects upcoming dead zones with estimated time-to-zone, zone duration, and minimum signal. Displayed in sidebar with edge zone names (tunnels, underpasses)
- **Offline bundle** -- Full route data, bad zones, segment signals, and heatmap snapshot saved for offline access
- **Call-drop avoidance** -- Counts segments with drop probability > 0.5 and compares recommended route against worst alternative

### ML / AI
- **Signal prediction model** -- ResidualSignalNet (PyTorch, 560K params) with 22-feature input, multi-task output (signal strength, drop probability, handoff risk)
- **Physics validation** -- COST-231 Hata + Ericsson 9999 propagation ensemble cross-checks ML predictions
- **MC Dropout uncertainty** -- 8 forward passes estimate prediction confidence per segment
- **Thompson Sampling RL** -- Per-user contextual bandit learns signal vs speed preference over time. Converges in 3-5 trips
- **Smart intent resolution** -- 10 intents (meeting, call, navigation, streaming, etc.) mapped to preference values with fuzzy matching
- **Weather-aware scoring** -- OpenWeather API provides real-time weather factor that degrades signal predictions in rain/storms

### Map and UX
- **Mapbox GL JS** -- WebGL-accelerated map with layered route rendering (glow + casing + main line), smooth camera transitions, pitch/bearing 3D support
- **Real cell tower overlay** -- 601 towers from OpenCelliD rendered at actual coordinates, color-coded by operator
- **Draggable A/B pins** -- Drag source/destination markers to re-run the search from the dropped point
- **Mapbox Search Box** -- Autocomplete restricted to the Bengaluru metro area for source/destination
- **Max detour control** -- Cap how much slower than the fastest route a candidate may be (1.25x / 1.5x / 2x / any)
- **Route detail view** -- Sidebar toggles between route list and selected route detail with signal bars, ETA, distance, and start/stop navigation
- **Conversational route finder** -- Step-by-step chatbot for route setup (source, destination, network priority, road quality, ISP)
- **Browser GPS** -- "Use my location" with reverse geocoding to populate source field
- **Network auto-detect** -- Detects carrier via Navigator.connection API + backend IP lookup
- **Onboarding tour** -- 5-step guided tour for new users
- **JWT authentication** -- Login/register with in-memory demo store or MongoDB-backed persistence

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.2.4 | React framework (Turbopack dev server) |
| React | 19 | UI component library |
| Mapbox GL JS | 3.x | WebGL map rendering, route layers, tower overlay |
| Mapbox Search JS | 1.x | Autocomplete search box with Bangalore viewbox bias |
| TanStack Query | 5.x | Async data fetching with caching and retry |
| Tailwind CSS | 4.x | Utility-first styling |
| Axios | 1.x | HTTP client for backend API calls |
| Lucide React | - | Icon library |
| TypeScript | 5.x | Type safety |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| FastAPI | 0.115 | Async Python API framework |
| Uvicorn | 0.30 | ASGI server |
| Motor | 3.6 | Async MongoDB driver |
| httpx | 0.26 | Async HTTP client (TomTom, OpenCelliD, OpenWeather, Nominatim) |
| NumPy | 1.26 | RL sampling (Beta distribution) |
| PyTorch | 2.x | Signal prediction model |
| Pydantic | 2.5 | Schema validation |
| pandas | - | Data processing |
| scikit-learn | - | Feature preprocessing |
| python-jose | - | JWT token encoding/decoding |
| passlib | - | Password hashing (bcrypt) |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Database | MongoDB (Motor async driver) with in-memory fallback |
| Routing Engine | TomTom Routing API (real road geometry) with OSRM/mock fallback |
| Geocoding | Nominatim (forward/reverse, cached in-memory) |
| Map Tiles | Mapbox GL JS (WebGL, 3D support) |
| ML Model | PyTorch ResidualSignalNet (560K params) |
| Tower Data | OpenCelliD API (601 real towers) + synthetic fallback |
| Weather | OpenWeather API (real-time conditions) |
| Traffic | TomTom Traffic Flow + Incidents API |
| Auth | JWT with dual store (in-memory demo + MongoDB) |
| Containerization | Docker + Docker Compose |

## Project Structure

```
cellular-maze/
|-- README.md
|-- analysis.md
|-- docker-compose.yml
|-- requirements.txt
|
|-- backend/                    # FastAPI backend (1,481 lines in main.py)
|   |-- main.py                 # Monolithic server with 20 endpoints
|   |-- weather.py              # OpenWeather API integration
|   |-- crowd_tracker.py        # Crowd density tracking
|   |-- dead_zone_predictor.py  # Dead zone detection logic
|   |-- requirements.txt
|   |-- Dockerfile
|   |-- docker-compose.yml      # Backend + MongoDB
|   |-- .env.example
|   |-- api/                    # Route group endpoints
|   |   |-- auth.py             # JWT login/register/me (3 endpoints)
|   |   |-- health.py           # Health check (1 endpoint)
|   |   |-- routes.py           # Route generation (5 endpoints)
|   |   |-- network.py          # Network detection (2 endpoints)
|   |-- app/                    # Application factory
|   |   |-- main.py             # Clean architecture entry point
|   |   |-- lifecycle.py        # Startup/shutdown hooks (Mongo connect)
|   |-- core/                   # Cross-cutting concerns
|   |   |-- config.py           # Pydantic settings (env-based)
|   |   |-- logging.py          # Structured logging
|   |   |-- security.py         # Input validation + JWT utilities
|   |   |-- grpc_bus.py         # gRPC event bus (demo/partial)
|   |-- db/                     # Database layer (MongoDB + Motor)
|   |   |-- base.py             # Async client singleton + index creation
|   |   |-- session.py          # Database accessor
|   |   |-- models/
|   |   |   |-- rl_profile.py   # RL profile document model
|   |   |   |-- user.py         # User document model
|   |   |-- repository/
|   |       |-- rl_repo.py      # Repository pattern for rl_profiles
|   |-- dependencies/           # FastAPI dependency injection
|   |   |-- auth.py             # Service factories (Depends)
|   |   |-- db.py               # Database dependency
|   |-- routing/                # External routing integration
|   |   |-- tomtom_client.py    # TomTom Routing API client
|   |   |-- osrm_client.py      # OSRM HTTP client + mock fallback
|   |   |-- geocode.py          # Nominatim geocoding client
|   |   |-- polyline.py         # Google polyline encode/decode
|   |   |-- route_generator.py  # Convenience wrapper
|   |-- schemas/                # Pydantic request/response models
|   |   |-- route_schema.py     # RouteRequest, RouteResult, RouteResponse
|   |   |-- signal_schema.py    # SignalPoint, SignalPrediction
|   |   |-- rl_schema.py        # RLUpdateRequest, RLUpdateResponse
|   |-- services/               # Business logic (no HTTP concerns)
|   |   |-- route_service.py    # Main orchestrator: TomTom -> ML -> score -> rank
|   |   |-- signal_client.py    # Async ML client with retry + cache + fallback
|   |   |-- scoring_service.py  # Normalize ETA, compute signal/final scores
|   |   |-- rl_service.py       # Thompson Sampling (Beta-Bernoulli bandit)
|   |-- utils/
|   |   |-- geo.py              # Haversine, route point sampling
|   |   |-- time_encoding.py    # Cyclic hour encoding for ML features
|   |-- scripts/
|   |   |-- seed_db.py          # Database seeding script
|   |-- tests/
|       |-- test_routes.py      # 43 tests (scoring, stability, signal, RL, API, utils)
|
|-- model/                      # ML signal prediction model
|   |-- main.py                 # FastAPI app with 12 /model/* endpoints
|   |-- run.py                  # CLI entry point (--train / --serve / --evaluate)
|   |-- config.py               # 20 zones, 12 edge zones, model hyperparams
|   |-- architecture.py         # ResidualSignalNet (PyTorch, 560K params)
|   |-- inference.py            # Signal prediction on route segments
|   |-- scoring.py              # Route scoring logic
|   |-- propagation.py          # COST-231 Hata + Ericsson 9999 path loss
|   |-- rl_learning.py          # Thompson Sampling bandit implementation
|   |-- bad_zones.py            # Dead zone detection + task feasibility
|   |-- explainability.py       # Route comparison summaries
|   |-- smart_preference.py     # Context-aware preference learning (10 intents)
|   |-- opencellid.py           # Real tower data from OpenCelliD API (601 towers)
|   |-- generate_data.py        # Synthetic training data generation (100K samples)
|   |-- train.py                # Training pipeline (cosine warmup, mixed precision)
|   |-- evaluate.py             # Model evaluation + quality gates
|   |-- eval_routes.py          # Route-level evaluation
|   |-- utils.py                # Haversine, 22-dim feature extraction
|   |-- schemas.py              # Pydantic models for model endpoints
|   |-- data/                   # Training data + tower CSVs
|   |-- weights/                # Saved model checkpoints (.pt)
|
|-- frontend/                   # Next.js 16 frontend (14 components, 5 hooks)
|   |-- package.json
|   |-- next.config.ts
|   |-- tsconfig.json
|   |-- src/
|   |   |-- app/
|   |   |   |-- page.tsx        # Main SPA page (state management, route orchestration)
|   |   |   |-- login/page.tsx  # Login page
|   |   |   |-- register/page.tsx # Registration page
|   |   |   |-- layout.tsx      # Root layout (fonts, QueryProvider, AuthProvider)
|   |   |   |-- globals.css     # Tailwind + custom styles
|   |   |-- components/
|   |   |   |-- search/
|   |   |   |   |-- SearchBar.tsx       # Mapbox autocomplete search
|   |   |   |-- map/
|   |   |   |   |-- MapView.tsx         # Mapbox GL JS map (routes, towers, heatmap)
|   |   |   |   |-- MapContainer.tsx    # Dynamic import wrapper (no SSR)
|   |   |   |-- sidebar/
|   |   |   |   |-- RouteSidebar.tsx    # Route list + detail view with signal bars
|   |   |   |-- filters/
|   |   |   |   |-- FilterPanel.tsx     # Signal/traffic heatmap + telecom filter
|   |   |   |-- chat/
|   |   |   |   |-- ChatBot.tsx         # 5-step conversational route finder
|   |   |   |-- actions/
|   |   |   |   |-- ActionButtons.tsx   # Locate, track, reroute buttons
|   |   |   |-- common/
|   |   |   |   |-- Toast.tsx           # Alert notifications
|   |   |   |   |-- HeatmapLegend.tsx   # Signal/traffic legend
|   |   |   |   |-- WeatherBadge.tsx    # Weather condition display
|   |   |   |-- auth/
|   |   |   |   |-- AuthProvider.tsx    # JWT auth context + token management
|   |   |   |-- providers/
|   |   |   |   |-- QueryProvider.tsx   # TanStack Query wrapper
|   |   |   |-- onboarding/
|   |   |       |-- OnboardingTour.tsx  # 5-step guided tour
|   |   |-- hooks/
|   |   |   |-- useMapData.ts           # React Query hooks (routes, heatmap, towers)
|   |   |   |-- useGeolocation.ts       # Browser GPS integration
|   |   |   |-- useNetworkDetect.ts     # Carrier auto-detection
|   |   |   |-- useTracking.ts          # Real GPS position tracking (watchPosition)
|   |   |   |-- useAuth.ts             # Auth state hook
|   |   |-- services/
|   |   |   |-- api.ts                  # Axios API client
|   |   |-- types/
|   |       |-- route.ts                # TypeScript type definitions
|
|-- datasets/                   # Seed data
|   |-- bangalore_signal_mock.json    # Zone signal strengths
|   |-- routes_seed.json              # Sample routes
|   |-- towers_mock.csv               # Mock cell tower data
|
|-- database/                   # Database setup
|   |-- SCHEMA.md               # MongoDB collection schemas
|   |-- init_db.py              # Database initialization + seed script
|
|-- docs/                       # Documentation
|   |-- API.md                  # Full API reference
|   |-- ARCHITECTURE.md         # System design + data flow
|   |-- DEPLOYMENT.md           # Deployment guide (Vercel, Railway, Atlas)
```

## API Endpoints (39 Total)

### Frontend API (`/api/*`) -- 18 endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/routes/fast` | Fast route geometry from TomTom (no ML scoring) |
| GET | `/api/routes` | Full route scoring with ML, towers, weather, dead zones |
| GET | `/api/heatmap` | Multi-layer heatmap data (signal/traffic) for Bangalore |
| GET | `/api/weather` | Current weather conditions + signal impact factor |
| GET | `/api/alerts` | Active congestion/crowd alerts near user position |
| GET | `/api/traffic-flow` | Real-time TomTom traffic flow for a road point |
| GET | `/api/incidents` | TomTom traffic incidents in a bounding box |
| GET | `/api/dead-zones` | Predict dead zones per carrier along a route |
| GET | `/api/predict` | Short-horizon signal prediction for a zone |
| POST | `/api/reroute` | Reroute with signal bias when dead zone detected |
| GET | `/api/geocode` | Forward geocoding via Nominatim |
| GET | `/api/reverse-geocode` | Reverse geocoding via Nominatim |
| GET | `/api/towers` | Tower data summary (count, operators, source) |
| GET | `/api/towers/geo` | Individual tower lat/lng for map rendering |
| GET | `/api/offline-bundle` | Pre-computed offline navigation bundle |
| GET | `/api/detect-network` | ISP/carrier detection from client IP |
| GET | `/api/network-strength` | Signal strength estimate for current user |
| GET | `/api/services/health` | Health check for all internal services |

### ML Model API (`/model/*`) -- 12 endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/model/score-routes` | Score candidate routes with ML model |
| PUT | `/model/predict-signal` | Predict signal strength at a point |
| PUT | `/model/analyze-route` | Analyze route connectivity with bad zones |
| PUT | `/model/detect-zones` | Detect edge-case zones along a route |
| PUT | `/model/health` | Model status and training metadata |
| PUT | `/model/smart-route` | Smart routing with user intent resolution |
| PUT | `/model/record-choice` | Record route choice for preference learning |
| PUT | `/model/resolve-intent` | Resolve text intent to preference value |
| PUT | `/model/auto-route` | RL-powered automatic route selection |
| PUT | `/model/record-trip` | Update RL distributions after trip |
| PUT | `/model/user-patterns` | View learned RL patterns for a user |
| PUT | `/model/refresh-towers` | Fetch fresh tower data from OpenCelliD API |

### Auth API (`/api/v1/*`) -- 6 endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/login` | JWT login (in-memory demo or MongoDB) |
| POST | `/api/v1/register` | User registration |
| GET | `/api/v1/me` | Get current user profile from JWT |
| GET | `/api/v1/health` | Service health check |
| POST | `/api/v1/route` | MongoDB-backed ranked route generation |
| POST | `/api/v1/rl/update` | Record route outcome for RL profile update |

Full API documentation: [docs/API.md](docs/API.md)

## Scoring Engine

### Route Ranking Formula

```
final_score = weight * (signal_score / 100) + (1 - weight) * eta_score + stability_bonus
stability_bonus = (stability_score / 100) * 0.1 * weight
```

| Variable | Range | Description |
|----------|-------|-------------|
| `weight` | 0.0 - 1.0 | User preference (slider: 0 = speed, 1 = signal) |
| `signal_score` | 0 - 100 | Average predicted signal strength along route |
| `eta_score` | 0.0 - 1.0 | Normalized ETA (1 = fastest candidate, 0 = slowest) |
| `stability_score` | 0 - 100 | Combined continuity + longest-stable-fraction metric |
| `stability_bonus` | 0 - 0.1 | Up to 10% boost for stable signal routes (scales with weight) |

### RL Personalization (Thompson Sampling)

Each user has a Beta(alpha, beta) distribution learned over time:

```
rl_sample ~ Beta(alpha, beta)
effective_weight = 0.6 * user_weight + 0.4 * rl_sample
```

- User picks signal-heavy route and is satisfied -> alpha += 1
- User picks speed route and is satisfied -> beta += 1
- Over time, the system learns each user's true preference

### Signal Prediction

The ML model (ResidualSignalNet) predicts signal quality at each point:

**Input features (22 dims):** latitude, longitude, tower distance, tower signal dBm, terrain type (7 one-hot), hour (sin/cos), density, building height, operator, tower range, frequency, tx power, tower height, path loss, weather factor

**Output (3 heads):** signal_strength (0-100), drop_probability (0-1), handoff_risk (0-1)

## Signal Zones

### Bangalore Coverage Map

| Zone | Terrain | Density | Typical Signal |
|------|---------|---------|----------------|
| MG Road | Urban main | High | Strong (78-95) |
| Koramangala | Urban main | High | Strong (70-85) |
| Indiranagar | Urban main | High | Strong (72-88) |
| Electronic City | Suburban | Medium | Weak (28-45) |
| Whitefield | Suburban | Medium | Medium (50-65) |
| Hebbal | Highway | Medium | Medium (45-60) |
| Bannerghatta | Suburban | Low | Weak (20-35) |
| Hosur Road | Highway | Medium | Medium (40-55) |
| Peenya | Suburban | Low | Weak (25-40) |

### Edge Case Zones

| Zone | Type | Signal Impact |
|------|------|--------------|
| Namma Metro Tunnels | Tunnel | -45 dB (near total loss) |
| Hebbal Flyover Underpass | Underpass | -25 dB |
| Silk Board Underpass | Underpass | -20 dB |
| Commercial Street | Urban canyon | -12 dB |
| Brigade Road | Urban canyon | -11 dB |

### Edge Cases Handled

| Scenario | Solution |
|----------|----------|
| Tunnel signal loss | 45dB penalty in predictions, dead zone alert |
| Rural low signal everywhere | Best available route with advisory warning |
| Sudden tower outage | Reroute button triggers re-scoring |
| Rain degradation | Time-of-day features capture weather patterns |
| User changes carrier | Re-fetch with new telecom filter |
| Fast route has dead zone | Highlighted in route card, user decides |
| No alternate route | Return single route with signal advisory |
| GPS drift | watchPosition with enableHighAccuracy for continuous updates |
| ML service down | Fallback neutral predictions (signal=50, drop=0.1) |
| TomTom key missing | OSRM real-road alternatives (direct + via-zone), traffic-adjusted |
| OSRM unavailable | Synthetic route generator (offline fallback) |

## Quick Start

No API keys are required -- without them the app uses OSRM for real road
routes, the bundled tower snapshot, and neutral weather. A Mapbox public token
is needed for the map itself.

### 1. Backend + ML model (one process, port 8000)

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux/Mac
pip install torch --index-url https://download.pytorch.org/whl/cpu   # optional: smaller CPU-only torch
pip install -r requirements.txt
cd ..
cp .env.example .env           # optional API keys
uvicorn backend.main:app --port 8000
```

Run `uvicorn` from the **repository root** -- `backend.main` imports the sibling
`model` package. API docs: http://localhost:8000/docs

### 2. Frontend (port 3000)

```bash
cd frontend
cp .env.example .env.local     # set NEXT_PUBLIC_MAPBOX_TOKEN
npm install
npm run dev
```

Open http://localhost:3000. Demo login: `demo` / `demo123`.

### 3. Docker (both services)

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx docker compose up --build
```

`backend/docker-compose.yml` additionally starts MongoDB for persistent profiles.

## Testing

```bash
# Backend unit tests (no external services needed)
backend/venv/Scripts/python -m pytest backend/tests -q        # 69 tests

# Model component suite
backend/venv/Scripts/python test_models.py                    # 73 checks

# Live API integration tests (backend must be running on :8000)
backend/venv/Scripts/python -m pytest test_integration.py -q

# Frontend
cd frontend && npm test          # 82 tests
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

## Deployment

| Component | Platform | Config |
|-----------|----------|--------|
| Frontend | Vercel | Root: `frontend`, auto-detected Next.js |
| Backend | Railway / Render | Start (repo root): `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| Database | MongoDB Atlas | Free M0 tier, set `MONGO_URI` env var |

Full deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend URL for frontend |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | _(required for map)_ | Mapbox public token |
| `SECRET_KEY` | dev-only fallback | JWT signing secret (set in any shared deployment) |
| `OPENWEATHER_API_KEY` | _(optional)_ | Live weather impact on signal |
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `DB_NAME` | `cellularmaze` | Database name |
| `MODEL_URL` | `http://localhost:8002` | ML prediction service |
| `OSRM_URL` | `https://router.project-osrm.org` | Keyless road routing used when no TomTom key is set |
| `TOMTOM_API_KEY` | _(optional)_ | TomTom routing with live traffic (preferred when set) |
| `TOMTOM_BASE_URL` | `https://api.tomtom.com` | TomTom API base URL |
| `OPENCELLID_API_KEY` | _(optional)_ | Live tower lookups along routes (bundled snapshot otherwise) |

## Real-Time Data Sources

### TomTom Routing API

Used for road-snapped multi-route generation with live traffic.

**Fields extracted per route:**

| Field | Source | Description |
|-------|--------|-------------|
| `eta` | `summary.travelTimeInSeconds` | Travel time in minutes (includes traffic) |
| `traffic_delay` | `summary.trafficDelayInSeconds` | Extra delay vs free-flow in minutes |
| `geometry` | `legs[].points[].latitude/longitude` | Road-snapped path (430-824 points per route) |
| `distance_km` | Computed from geometry | Haversine sum of consecutive points |

**Additional fields available (not yet extracted):**

| Field | Description |
|-------|-------------|
| `summary.lengthInMeters` | Exact road distance in meters |
| `summary.departureTime` | Estimated departure time (ISO 8601) |
| `summary.arrivalTime` | Estimated arrival time (ISO 8601) |
| `summary.noTrafficTravelTimeInSeconds` | ETA with zero traffic (needs `computeTravelTimeFor=all`) |
| `summary.historicTrafficTravelTimeInSeconds` | Historic average ETA |
| `summary.liveTrafficIncidentsTravelTimeInSeconds` | Live incident-adjusted ETA |
| Traffic sections: `simpleCategory` | Per-segment incident type: JAM, ROAD_WORK, ROAD_CLOSURE |
| Traffic sections: `effectiveSpeedInKmh` | Speed through incident zone |
| Traffic sections: `delayInSeconds` | Delay caused by each incident |
| Traffic sections: `magnitudeOfDelay` | Severity: 0=unknown, 1=minor, 2=moderate, 3=major, 4=closure |

---

### OpenCelliD API

Used for real-time cell tower lookup along each route path. Queried via `cell/getInArea` with a bounding box around sampled route points.

**Raw fields returned per tower:**

| Field | Type | Description |
|-------|------|-------------|
| `lat`, `lon` | float | Tower coordinates |
| `mcc` | int | Mobile Country Code (404 or 405 for India) |
| `mnc` | int | Mobile Network Code (identifies carrier) |
| `lac` | int | Location Area Code |
| `cellid` | int | Unique cell tower ID |
| `radio` | string | Technology: GSM, UMTS, LTE, NR, NBIOT |
| `averageSignalStrength` | int (dBm) | Crowd-sourced avg signal (e.g. -70 to -105 dBm; 0 = no data) |
| `range` | int (meters) | Estimated coverage radius |
| `samples` | int | Number of crowd-sourced measurements (data quality) |
| `changeable` | bool | `true` = position from measurements; `false` = operator-certified |
| `tac` | int | Tracking Area Code (LTE/NR only) |
| `rnc` | int | Radio Network Controller (UMTS only) |

**Derived fields computed in `model/opencellid.py`:**

| Field | Description |
|-------|-------------|
| `tower_id` | Composite key: `OCI_{mcc}_{mnc}_{cellid}` |
| `operator` | Human name: Jio / Airtel / Vi / BSNL / Unknown (from MNC map) |
| `signal_score` | 0-100 score converted from dBm using radio-type ranges |
| `avg_signal_dbm` | Raw dBm value preserved from `averageSignalStrength` |
| `range_m` | Coverage radius in meters (raw `range` value) |
| `frequency_mhz` | Typical frequency: GSM=900, UMTS=2100, LTE=1800, NR=3500 |
| `tx_power_dbm` | Typical TX power: GSM/UMTS=43 dBm, LTE=46 dBm, NR=49 dBm |
| `height_m` | Typical tower height: GSM=35m, UMTS/LTE=30m, NR=25m |
| `zone` | Bangalore zone name or `"route"` for path-fetched towers |

---

## Documentation

- [API Reference](docs/API.md) -- Full endpoint documentation with request/response examples
- [Architecture](docs/ARCHITECTURE.md) -- System design, data flow, ML model details
- [Deployment Guide](docs/DEPLOYMENT.md) -- Vercel, Railway, Atlas setup instructions
- [Database Schema](database/SCHEMA.md) -- MongoDB collections, indexes, seed data
