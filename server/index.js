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
  const { friends, venueLabel, places, venues, refinement } = req.body;
  const resolvedPlaces = places || venues || [];
  const resolvedLabel = venueLabel || 'a great meetup spot';
  if (!friends) return res.status(400).json({ error: 'friends required' });

  const friendList = friends.map(f =>
    `- ${f.name}: ${f.address} (${f.coords?.lat?.toFixed(4)}, ${f.coords?.lng?.toFixed(4)})`
  ).join('\n');

  const placesList = resolvedPlaces.map((p, i) => {
    const lat = p.coords?.lat ?? '?';
    const lng = p.coords?.lng ?? '?';
    const latStr = typeof lat === 'number' ? lat.toFixed(4) : lat;
    const lngStr = typeof lng === 'number' ? lng.toFixed(4) : lng;
    return `${i+1}. ${p.name} at ${p.address || p.vicinity || ''} (${latStr}, ${lngStr}) — rated ${p.rating || 'N/A'}`;
  }).join('\n') || 'No places provided';

  const refinementLine = refinement ? `\nUSER PREFERENCE: Re-rank these venues prioritizing "${refinement}". Venues matching this vibe should rank higher.\n` : '';

  const prompt = `You are a NYC local expert. A group of friends want to meet up in NYC.

Friends and locations:
${friendList}

They want: ${resolvedLabel}
${refinementLine}
Venues to rank:
${placesList}

Rank these venues by how well they work as a meetup spot considering travel fairness and the user's preferences.

Return ONLY a JSON array like this (no other text):
{"ranked": [{"name": "Venue Name", "reason": "brief reason"}, ...]}

Include all venues in ranked order. Use exact venue names from the list above.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    console.log('Anthropic raw response:', JSON.stringify(data).substring(0, 200));
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const path = require('path');
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV === 'production') {
  app.use(require('express').static(path.join(__dirname, '../dist2'), { setHeaders: (res, fp) => { if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')));
}
app.listen(PORT, '0.0.0.0', () => console.log('Triangulate running on port ' + PORT));

// v2
