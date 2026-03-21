require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Serve built React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autocomplete', async (req, res) => {
  const { input } = req.query;
  if (!input) return res.status(400).json({ error: 'input required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&location=40.7128,-74.0060&radius=40000&types=establishment|geocode&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json({ predictions: data.predictions || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/places', async (req, res) => {
  const { query, lat, lng } = req.query;
  if (!query || !lat || !lng) return res.status(400).json({ error: 'query, lat, lng required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' New York City')}&location=${lat},${lng}&radius=2500&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json({ results: (data.results || []).slice(0, 5) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/place-details', async (req, res) => {
  const { placeId } = req.query;
  if (!placeId) return res.status(400).json({ error: 'placeId required' });
  try {
    const fields = 'name,formatted_address,rating,user_ratings_total,opening_hours,website,photos';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GMAPS_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json({ result: data.result || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/photo', async (req, res) => {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'ref required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${ref}&key=${GMAPS_KEY}`;
    const response = await fetch(url);
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    response.body.pipe(res);
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recommend', async (req, res) => {
  const { friends, venueLabel, places } = req.body;
  if (!friends || !venueLabel) return res.status(400).json({ error: 'friends and venueLabel required' });
  const friendList = friends.map(f => `- ${f.name}: ${f.address} (${f.coords.lat.toFixed(4)}, ${f.coords.lng.toFixed(4)})`).join('\n');
  const placesList = places?.map((p, i) => `${i+1}. ${p.name} at ${p.address} (${p.coords.lat.toFixed(4)}, ${p.coords.lng.toFixed(4)}) — rated ${p.rating}, ${p.isOpen ? 'open now' : 'hours unknown'}`).join('\n') || '';
  const prompt = `You are a NYC transit expert. Friends want to meet up.\n\nFriends:\n${friendList}\n\nThey want: ${venueLabel}\n\nNearby venues:\n${placesList}\n\nRank using: 40% fairness + 35% proximity + 25% rating. Return ONLY JSON:\n{"midpoint_neighborhood":"Name","midpoint_reason":"sentence","venues":[{"index":0,"combined_score":91,"fairness":88,"fairness_reason":"sentence","recommendation_reason":"sentence","travel_times":[{"person":"Name","minutes":18,"mode":"subway","route":"Take F to 14th St"}]}]}`;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    res.json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Catch-all: serve React app for any non-API route
app.get('*', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Triangulate running on port ${PORT}`));
