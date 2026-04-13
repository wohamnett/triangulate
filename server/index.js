require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── Geocode an address ────────────────────────────────────────────────────────
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address + ', New York City')}&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    if (data.results?.[0]) {
      res.json({ coords: data.results[0].geometry.location, formatted: data.results[0].formatted_address });
    } else {
      res.status(404).json({ error: 'Address not found', status: data.status });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Autocomplete an address (NYC biased) ─────────────────────────────────────
app.get('/api/autocomplete', async (req, res) => {
  const { input } = req.query;
  if (!input) return res.status(400).json({ error: 'input required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&types=establishment|geocode&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json({ predictions: data.predictions || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Places text search near a location ───────────────────────────────────────
app.get('/api/places', async (req, res) => {
  const { query, lat, lng } = req.query;
  if (!query || !lat || !lng) return res.status(400).json({ error: 'query, lat, lng required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=1500&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json({ results: (data.results || []).slice(0, 5) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Place details ─────────────────────────────────────────────────────────────
app.get('/api/place-details', async (req, res) => {
  const { placeId } = req.query;
  if (!placeId) return res.status(400).json({ error: 'placeId required' });
  try {
    const fields = 'name,formatted_address,rating,user_ratings_total,opening_hours,website,photos';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json({ result: data.result || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Place photo proxy (streams Google photo through server) ──────────────────
app.get('/api/photo', async (req, res) => {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'ref required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${ref}&key=${GMAPS_KEY}`;
    const response = await fetch(url);
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    response.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Distance matrix (transit) ────────────────────────────────────────────────
app.get('/api/reverse-geocode', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    if (data.results?.[0]) {
      res.json({ formatted: data.results[0].formatted_address, coords: { lat: parseFloat(lat), lng: parseFloat(lng) } });
    } else {
      res.json({ formatted: `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`, coords: { lat: parseFloat(lat), lng: parseFloat(lng) } });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/directions', async (req, res) => {
  const { origin_lat, origin_lng, dest_lat, dest_lng, mode } = req.query;
  if (!origin_lat || !dest_lat) return res.status(400).json({ error: 'origin and destination required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin_lat},${origin_lng}&destination=${dest_lat},${dest_lng}&mode=${mode || 'transit'}&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    if (data.routes?.[0]) {
      const legs = data.routes[0].legs[0];
      const steps = legs.steps.map(s => ({
        polyline: s.polyline.points,
        mode: s.travel_mode,
        duration: s.duration.text,
        line: s.transit_details?.line?.short_name || s.transit_details?.line?.name || null,
        vehicle: s.transit_details?.line?.vehicle?.type || null,
      }));
      res.json({ polyline: data.routes[0].overview_polyline.points, steps, duration: legs.duration.text });
    } else {
      res.status(404).json({ error: 'No route found', status: data.status });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/distances', async (req, res) => {
  const { origins, destination } = req.body;
  if (!origins || !destination) return res.status(400).json({ error: 'origins and destination required' });
  try {
    const orig = origins.map(o => `${o.lat},${o.lng}`).join('|');
    const dest = `${destination.lat},${destination.lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(orig)}&destinations=${encodeURIComponent(dest)}&mode=transit&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Claude AI for midpoint reasoning ─────────────────────────────────────────
app.post('/api/recommend', async (req, res) => {
  const { friends, venueLabel, places, venues, travel_times, refinement } = req.body;
  const resolvedPlaces = places || venues || [];
  const resolvedLabel = venueLabel || 'a good meetup spot';
  if (!friends) return res.status(400).json({ error: 'friends required' });

  const friendList = friends.map(f =>
    `- ${f.name}: ${f.address} (${f.coords.lat.toFixed(4)}, ${f.coords.lng.toFixed(4)})`
  ).join('\n');

  const placesList = resolvedPlaces?.map((p, i) =>
    `${i+1}. ${p.name} at ${p.address} (${p.coords.lat.toFixed(4)}, ${p.coords.lng.toFixed(4)}) — rated ${p.rating}, ${p.isOpen ? 'open now' : 'hours unknown'}`
  ).join('\n') || 'No places provided';

  const prompt = `You are a NYC transit expert. A group of friends want to meet up.

Friends and exact locations:
${friendList}

They want: ${resolvedLabel}

Here are real nearby venues (from Google Places) near the geographic midpoint:
${refinement ? `\nUSER REFINEMENT REQUEST: The user has asked to prioritize: "${refinement}". Re-rank these venues with this preference as an additional strong factor. If no venues match well, rank the closest matches first.\n` : ''}
${placesList}

For each venue, calculate realistic NYC subway transit times from each friend's location.

Rank them purely by TOTAL travel time across all friends. The venue where everyone's times ADD UP to the least is #1. Simple as that.

Tie-break only: if total times are within 2 minutes of each other, prefer the option with the smallest gap between fastest and slowest traveller.

NEVER rank a venue higher if it has any single journey over 25 minutes when a better total-time option exists.

Old scoring (ignore):
3. QUALITY (15%) — Google rating (higher is better)

The top result should minimize total travel time above all else. Venues where ANY person travels more than 20 minutes should be heavily penalized. Prefer venues where everyone travels under 15 minutes.
Return ONLY valid JSON:
{
  "midpoint_neighborhood": "Neighborhood Name",
  "midpoint_reason": "One sentence why this is fair",
  "venues": [
    {
      "index": 0,
      "combined_score": 91,
      "fairness": 88,
      "fairness_reason": "Only 4 min difference between closest and furthest person",
      "recommendation_reason": "Best blend of fairness, short commutes, and high rating",
      "travel_times": [
        { "person": "Name", "minutes": 18, "mode": "subway", "route": "Take the F to 14th St" }
      ]
    }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const path = require('path');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => { if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, '../dist/index.html')); });
}
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log('Triangulate running on port ' + PORT));
