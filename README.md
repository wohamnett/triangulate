# Triangulate 🗺️
**NYC Meetup Finder** — finds the fairest spot to meet based on everyone's location.

## How it works
1. Each friend enters their exact address
2. Google Geocoding converts addresses to coordinates
3. Google Places finds real venues near the transit midpoint
4. Google Distance Matrix calculates actual subway times for everyone
5. Claude AI ranks venues by fairness and suggests subway routes
6. Results shown on a live Leaflet/OpenStreetMap map

---

## Setup — 3 steps

### Step 1 — Prerequisites
Make sure you have **Node.js 18+** installed.
```bash
node --version   # should be 18.x or higher
```
If not, download it from https://nodejs.org

---

### Step 2 — API Keys

You need two API keys:

**Google Maps API Key** (you already have this: `AIzaSyC4kOL4t5D-MS-Px5mRJ4-odjsf_z3Q5rA`)

Make sure these APIs are enabled in your Google Cloud Console:
- Maps JavaScript API
- Places API
- Geocoding API
- Distance Matrix API

Go to: https://console.cloud.google.com → APIs & Services → Library

**Anthropic API Key**

Get one at https://console.anthropic.com → API Keys → Create Key

---

### Step 3 — Run it

```bash
# 1. Clone or unzip this project, then enter the folder
cd triangulate

# 2. Copy the environment file and fill in your keys
cp .env.example .env
```

Open `.env` in any text editor and fill in:
```
GOOGLE_MAPS_API_KEY=AIzaSyC4kOL4t5D-MS-Px5mRJ4-odjsf_z3Q5rA
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

```bash
# 3. Install frontend dependencies
npm install

# 4. Install server dependencies
cd server && npm install && cd ..

# 5. Start everything (frontend + API server together)
npm start
```

Open http://localhost:3000 — Triangulate is running! 🎉

---

## Architecture

```
triangulate/
├── src/
│   ├── App.jsx          # React frontend — full Google Maps integration
│   ├── main.jsx         # React entry point
│   └── index.css        # Global styles + Leaflet dark theme
├── server/
│   └── index.js         # Express API proxy — keeps keys off the frontend
│                          Endpoints:
│                          GET  /api/geocode         → Google Geocoding
│                          GET  /api/autocomplete    → Google Places Autocomplete
│                          GET  /api/places          → Google Places Text Search
│                          GET  /api/place-details   → Google Place Details
│                          POST /api/distances       → Google Distance Matrix
│                          POST /api/recommend       → Claude AI fairness ranking
├── .env.example         # Copy to .env and fill in your keys
├── vite.config.js       # Vite dev server — proxies /api to Express
├── index.html           # HTML entry point
└── package.json         # Frontend dependencies
```

**Why a server?** API keys must never be exposed in frontend code — anyone could steal them and rack up charges on your account. The Express server keeps them server-side and proxies requests from the React app.

---

## Deploying to the web (optional)

To share with friends without running it locally:

**Easiest: Railway**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```
Set your environment variables in the Railway dashboard.

**Or: Render / Fly.io / Heroku** — all work the same way. Set `GOOGLE_MAPS_API_KEY` and `ANTHROPIC_API_KEY` as environment variables in the dashboard, then deploy.

---

## Troubleshooting

**"Address not found"** — Make sure the Geocoding API is enabled in Google Cloud Console.

**"Places search failed"** — Make sure the Places API is enabled.

**Blank map** — Check your browser console. If you see a Leaflet error, ensure `leaflet` was installed (`npm install` in the root folder).

**Port already in use** — Change `PORT=3001` in `.env` and update `vite.config.js` proxy target to match.
