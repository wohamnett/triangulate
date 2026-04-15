import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// ── Constants ─────────────────────────────────────────────────────────────────

const VENUE_TYPES = [
  { id: 'bar',         label: 'Bars & Nightlife', icon: '🍸', query: 'bar nightlife' },
  { id: 'cafe',        label: 'Cafes & Coffee',   icon: '☕', query: 'cafe coffee shop' },
  { id: 'restaurant',  label: 'Restaurants',       icon: '🍽️', query: 'restaurant' },
  { id: 'park',        label: 'Parks & Outdoors',  icon: '🌳', query: 'park outdoor' },
  { id: 'third_space', label: '3rd Spaces',        icon: '📚', query: 'library lounge coworking' },
];

const COLORS = ['#7c3aed', '#B84A32', '#2E6BA8', '#2E7D52', '#6B42A8', '#B8325A'];
const LIGHT_COLORS = ['#F4A724', '#E05A3A', '#5B9BD5', '#4CAF7D', '#9C6FDE', '#E91E8C'];

const NAME_EXAMPLES = ['Will', 'Toby', 'Maya', 'Jess', 'Omar', 'Priya'];
const LOCATION_EXAMPLES = [
  'Spring Lounge, SoHo  or  48 Spring St',
  'Cafe Mogador, East Village  or  101 St Marks Pl',
  'Transmitter Park, Greenpoint',
  'Russ & Daughters, Lower East Side',
  'Bohemian Hall, Astoria',
  'Fort Tryon Park, Inwood',
];

// ── API helpers ───────────────────────────────────────────────────────────────

const api = {
  async geocode(address) {
    const r = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
    if (!r.ok) throw new Error('Address not found');
    return r.json();
  },
  async autocomplete(input) {
    const r = await fetch(`/api/autocomplete?input=${encodeURIComponent(input)}`);
    const d = await r.json();
    return d.predictions || [];
  },
  async places(query, lat, lng) {
    const r = await fetch(`/api/places?query=${encodeURIComponent(query)}&lat=${lat}&lng=${lng}`);
    const d = await r.json();
    return d.results || [];
  },
  async placeDetails(placeId) {
    const r = await fetch(`/api/place-details?placeId=${encodeURIComponent(placeId)}`);
    const d = await r.json();
    return d.result || {};
  },
  async distances(origins, destination) {
    const r = await fetch('/api/distances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origins, destination }),
    });
    return r.json();
  },
  async recommend(friends, venueLabel, places) {
    const r = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friends, venueLabel, places }),
    });
    return r.json();
  },
  async reverseGeocode(lat, lng) {
    const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
    return r.json();
  },
  async directions(originLat, originLng, destLat, destLng) {
    const r = await fetch(`/api/directions?origin_lat=${originLat}&origin_lng=${originLng}&dest_lat=${destLat}&dest_lng=${destLng}&mode=transit`);
    return r.json();
  },
};

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// ── Address input with Google Places autocomplete ─────────────────────────────

function AddressInput({ value, onChange, onSelect, placeholder, color }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  
  const inputRef = useRef(null);
  const debounce = useRef(null);


  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    clearTimeout(debounce.current);
    if (v.length < 2) { setSuggestions([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      setFetching(true);
      try {
        const preds = await api.autocomplete(v);
        setSuggestions(preds.slice(0, 5));
        if (preds.length > 0) { setOpen(true); }
        else setOpen(false);
      } catch { setSuggestions([]); }
      finally { setFetching(false); }
    }, 300);
  };

  const pick = async (pred) => {
    const label = pred.structured_formatting?.main_text
      ? `${pred.structured_formatting.main_text}, ${(pred.structured_formatting.secondary_text || '').replace(', USA', '')}`
      : pred.description;
    setQuery(label);
    onChange(label);
    setSuggestions([]);
    setOpen(false);
    try {
      const { coords, formatted } = await api.geocode(pred.description);
      onSelect({ label: formatted || label, coords });
    } catch (e) { console.error('Geocode failed:', e); }
  };

  // Portal dropdown rendered directly into document.body
  const dropdown = open && suggestions.length > 0
    ? (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 9999, background: '#f5f3ff', border: '1px solid #D4CCC0',
          borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          {suggestions.map((s, i) => (
            <div key={s.place_id || i}
              onMouseDown={() => pick(s)}
              onMouseEnter={e => e.currentTarget.style.background = '#F5EFE4'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ padding: '9px 14px', cursor: 'pointer', background: 'transparent',
                borderBottom: i < suggestions.length - 1 ? '1px solid #EDE8DF' : 'none' }}>
              <div style={{ fontSize: 12, color: '#1e1b4b', fontFamily: "'DM Mono', monospace", marginBottom: 1 }}>
                <span style={{ color, marginRight: 7, fontSize: 7 }}>●</span>
                {s.structured_formatting?.main_text || s.description}
              </div>
              {s.structured_formatting?.secondary_text && (
                <div style={{ fontSize: 10, color: '#9A9080', paddingLeft: 14 }}>
                  {s.structured_formatting.secondary_text.replace(', USA', '')}
                </div>
              )}
            </div>
          ))}
          <div style={{ padding: '5px 14px', background: '#F5EFE4', borderTop: '1px solid #EDE8DF',
            fontSize: 8, color: '#c4b5fd', textAlign: 'right', letterSpacing: '0.05em' }}>
            powered by Google
          </div>
        </div>
    ) : null;

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={() => { if (suggestions.length > 0) { setOpen(true); } }}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder={placeholder}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
            color: '#3a3530', fontSize: 12, fontFamily: "'DM Mono', monospace" }}
        />
        {fetching && <span style={{ fontSize: 9, color: '#a78bfa', animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span>}
      </div>
      {dropdown}
    </div>
  );
}

// ── Leaflet map ───────────────────────────────────────────────────────────────

function makeIcon(html) {
  return L.divIcon({ className: '', html, iconSize: [32, 32], iconAnchor: [16, 16] });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [50, 50] });
  }, []);
  return null;
}

function MapView({ friends, venues, midpoint, selectedVenueIndex, routes }) {
  const allCoords = [
    ...friends.filter(f => f.coords).map(f => [f.coords.lat, f.coords.lng]),
    ...venues.filter(v => v.coords).map(v => [v.coords.lat, v.coords.lng]),
  ];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer center={[midpoint.lat, midpoint.lng]} zoom={13}
        style={{ width: '100%', height: '100%' }} zoomControl={true} attributionControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" maxZoom={19} />
        <FitBounds points={allCoords} />

        <Circle center={[midpoint.lat, midpoint.lng]} radius={400}
          pathOptions={{ color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.06, weight: 1, opacity: 0.3 }} />

        {/* Route lines */}
        {friends.filter(f => f.coords).map((f, i) => {
          const route = routes?.[i];
          const color = LIGHT_COLORS[i % LIGHT_COLORS.length];
          if (route?.steps && route.steps.length) {
            return route.steps.map((step, si) => {
              const walk = step.mode === 'WALKING' || step.mode === 'BICYCLING';
              return <Polyline key={f.id+'-'+si} positions={decodePolyline(step.polyline)}
                pathOptions={{ color, weight: walk ? 2 : 4, opacity: walk ? 0.45 : 0.85, dashArray: walk ? '5 8' : null }} />;
            });
          }
          if (route?.polyline) {
            return <Polyline key={f.id} positions={decodePolyline(route.polyline)}
              pathOptions={{ color, weight: 3, opacity: 0.65 }} />;
          }
          const topVenue = venues[selectedVenueIndex ?? 0];
          if (topVenue?.coords) {
            return <Polyline key={f.id}
              positions={[[f.coords.lat, f.coords.lng], [topVenue.coords.lat, topVenue.coords.lng]]}
              pathOptions={{ color, weight: 2, opacity: 0.4, dashArray: '6 6' }} />;
          }
          return null;
        })}

        {friends.filter(f => f.coords).map((f, i) => {
          const color = LIGHT_COLORS[i % LIGHT_COLORS.length];
          const dark = COLORS[i % COLORS.length];
          const icon = makeIcon(`<div style="width:30px;height:30px;border-radius:50%;background:${color};border:2.5px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:white;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2)">${(f.name[0]||'?').toUpperCase()}</div>`);
          return (
            <Marker key={f.id} position={[f.coords.lat, f.coords.lng]} icon={icon}>
              <Popup>
                <b style={{ color: dark }}>{f.name}</b><br />
                <span style={{ color: '#666' }}>{f.address}</span>
              </Popup>
            </Marker>
          );
        })}

        {venues.filter(v => v.coords).map((v, i) => {
          const color = i === 0 ? '#7c3aed' : '#2E6BA8';
          const icon = makeIcon(`<div style="width:32px;height:32px;border-radius:8px;background:${color};border:2.5px solid white;display:flex;align-items:center;justify-content:center;font-size:14px;color:white;font-weight:900;box-shadow:0 2px 8px rgba(0,0,0,0.2)">${i === 0 ? '★' : i + 1}</div>`);
          return (
            <Marker key={i} position={[v.coords.lat, v.coords.lng]} icon={icon}>
              <Popup>
                <b style={{ color }}>{v.name}</b><br />
                <span style={{ color: '#666' }}>{v.address}</span><br />
                <span style={{ color: '#888' }}>★ {v.rating} · {v.fairness ?? '—'}% fair · {v.isOpen ? '🟢 Open' : '🔴 Closed'}</span>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 1000,
        background: 'rgba(245,243,255,0.95)', border: '1px solid #D4CCC0',
        borderRadius: 8, padding: '10px 14px', pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        {friends.map((f, i) => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4, fontSize: 11, color: '#4c1d95' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: LIGHT_COLORS[i % LIGHT_COLORS.length], flexShrink: 0 }} />
            {f.name}
          </div>
        ))}
        <div style={{ borderTop: '1px solid #EDE8DF', marginTop: 5, paddingTop: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, fontSize: 11, color: '#4c1d95' }}>
            <span style={{ color: '#7c3aed', fontSize: 12 }}>★</span> best match
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#4c1d95' }}>
            <span style={{ color: '#2E6BA8', fontSize: 12 }}>2,3</span> other spots
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [friends, setFriends] = useState([
    { id: 1, name: '', address: '', coords: null },
    { id: 2, name: '', address: '', coords: null },
  ]);
  const [venueType, setVenueType]   = useState('bar');
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [results, setResults]       = useState(null);
  const [error, setError]           = useState(null);
  const [step, setStep]             = useState('setup');
  const [selectedVenueIndex, setSelectedVenueIndex] = useState(0);
  const [routes, setRoutes] = useState([]);
  const [refineMsg, setRefineMsg] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const selectedVenue = VENUE_TYPES.find(v => v.id === venueType);
  const addFriend    = () => { if (friends.length < 6) setFriends(f => [...f, { id: Date.now(), name: '', address: '', coords: null }]); };
  const removeFriend = id => { if (friends.length > 2) setFriends(f => f.filter(x => x.id !== id)); };
  const updateFriend = (id, field, val) => setFriends(f => f.map(x => x.id === id ? { ...x, [field]: val } : x));
  const setCoords    = (id, coords, label) => setFriends(f => f.map(x => x.id === id ? { ...x, coords, address: label || x.address } : x));
  const reset = () => { setStep('setup'); setResults(null); setError(null); setSelectedVenueIndex(0); setRoutes([]); };

  const refineSearch = async () => {
    if (!refineMsg.trim() || refineLoading) return;
    setRefineLoading(true);
    try {
      const midpoint = results.centroid;
      const rawVenues = await api.places(refineMsg.trim(), midpoint.lat, midpoint.lng);
      const newVenues = rawVenues.slice(0, 5).map(p => ({
        name: p.name,
        address: p.formatted_address || p.vicinity || '',
        coords: { lat: p.geometry?.location?.lat, lng: p.geometry?.location?.lng },
        rating: p.rating,
        place_id: p.place_id,
        isOpen: p.opening_hours?.open_now ?? null,
        travel_times: [],
        photo: p.photos?.[0]?.photo_reference ? `/api/photo?ref=${p.photos[0].photo_reference}` : null,
        combined_score: null,
        fairness: null,
      })).filter(p => p.coords?.lat);
      if (newVenues.length === 0) { setRefineLoading(false); setRefineMsg(''); return; }

      // Rank via server + get travel fairness scores
      const friends = results.friends;
      // Fetch distances per venue
      const distResults = await Promise.all(
        newVenues.map(v => fetch('/api/distances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origins: friends.map(f => f.coords), destination: v.coords }),
        }).then(r => r.json()).catch(() => null))
      );
      const [_, rankRes] = await Promise.all([
        Promise.resolve(null),
        fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friends, venues: newVenues, venueLabel: refineMsg.trim() }),
        }).then(r => r.json()).catch(() => ({ ranked: [] })),
      ]);

      // Attach travel times + scores to venues
      const scoredVenues = newVenues.map((v, vi) => {
        const travel_times = friends.map((f, fi) => {
          const el = distResults[vi]?.rows?.[fi]?.elements?.[0];
          return el?.status === 'OK' ? { minutes: Math.round(el.duration.value / 60), text: el.duration.text, person: f.name } : { minutes: null, text: '—', person: f.name };
        });
        const valid = travel_times.filter(t => t.minutes !== null);
        const avg = valid.length ? valid.reduce((s, t) => s + t.minutes, 0) / valid.length : null;
        const max = valid.length ? Math.max(...valid.map(t => t.minutes)) : null;
        const fairness = avg && max ? Math.round((1 - (max - avg) / (max + 1)) * 100) : null;
        return { ...v, travel_times, fairness };
      });

      // Reorder by ranked
      let finalList = scoredVenues;
      if (rankRes.ranked?.length > 0) {
        const reordered = rankRes.ranked
          .map(r => scoredVenues.find(v => v.name && r.name && (v.name === r.name || v.name.toLowerCase().includes(r.name.toLowerCase().substring(0, 8)))))
          .filter(Boolean);
        if (reordered.length > 0) {
          finalList = [...reordered, ...scoredVenues.filter(v => !reordered.includes(v))];
        }
      }

      // Add combined score based on rank + fairness
      finalList = finalList.slice(0, 3).map((v, i) => ({
        ...v,
        combined_score: v.fairness !== null ? Math.round(v.fairness * 0.5 + Math.max(0, 100 - i * 20) * 0.5) : null,
      }));

      setResults(prev => ({ ...prev, venues: finalList }));
      setSelectedVenueIndex(0);
      setRoutes([]);
      const topVenue = finalList[0];
      if (topVenue?.coords) {
        const routePromises = friends.map(f =>
          f.coords ? api.directions(f.coords.lat, f.coords.lng, topVenue.coords.lat, topVenue.coords.lng).catch(() => null) : Promise.resolve(null)
        );
        Promise.all(routePromises).then(setRoutes);
      }
    } catch(e) { console.error('refineSearch error:', e); }
    setRefineLoading(false);
    setRefineMsg('');
  };

  const selectVenue = (i) => {
    setSelectedVenueIndex(i);
    if (!results) return;
    const venue = results.venues[i];
    if (!venue?.coords) return;
    setRoutes([]);
    Promise.all(results.friends.map(f =>
      api.directions(f.coords.lat, f.coords.lng, venue.coords.lat, venue.coords.lng).catch(() => null)
    )).then(setRoutes);
  };

  const useMyLocation = (id) => {
    if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
    updateFriend(id, 'address', 'Getting your location…');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const data = await api.reverseGeocode(lat, lng);
        const address = data.formatted || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        updateFriend(id, 'address', address);
        setCoords(id, { lat, lng }, address);
      } catch {
        updateFriend(id, 'address', `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        setCoords(id, { lat, lng });
      }
    }, () => { updateFriend(id, 'address', ''); alert('Could not get location.'); });
  };

  const findMeetup = useCallback(async () => {
    const bad = friends.filter(f => !f.name.trim() || !f.address.trim());
    if (bad.length) { setError('Fill in all names and locations first.'); return; }
    const ungeocoded = friends.filter(f => !f.coords);
    if (ungeocoded.length) {
      setError(`Please select a location from the dropdown for: ${ungeocoded.map(f => f.name).join(', ')}`);
      return;
    }
    setError(null); setLoading(true);
    try {
      setLoadingMsg('🗺️ Finding fairness centroid…');
      const centroid = {
        lat: friends.reduce((s, f) => s + f.coords.lat, 0) / friends.length,
        lng: friends.reduce((s, f) => s + f.coords.lng, 0) / friends.length,
      };

      setLoadingMsg(`🔍 Searching for ${selectedVenue.label}…`);
      const places = await api.places(selectedVenue.query, centroid.lat, centroid.lng);

      setLoadingMsg('⭐ Fetching venue details…');
      const enriched = await Promise.all(places.slice(0, 3).map(async p => {
        const details = await api.placeDetails(p.place_id).catch(() => ({}));
        const photoRef = p.photos?.[0]?.photo_reference;
        return {
          name: details.name || p.name,
          address: details.formatted_address || p.formatted_address,
          rating: p.rating,
          isOpen: details.opening_hours?.open_now ?? null,
          website: details.website,
          photo: photoRef ? `/api/photo?ref=${encodeURIComponent(photoRef)}` : null,
          coords: { lat: p.geometry.location.lat, lng: p.geometry.location.lng },
          placeId: p.place_id,
        };
      }));

      setLoadingMsg('🚇 Calculating transit times…');
      const matrices = await Promise.all(
        enriched.map(v => api.distances(friends.map(f => f.coords), v.coords))
      );

      setLoadingMsg('🤔 Ranking by fairness & proximity…');
      const recommendation = await api.recommend(friends, selectedVenue.label, enriched.map(p => ({
        name: p.name, address: p.address, coords: p.coords, rating: p.rating, isOpen: p.isOpen,
      })));

      const venues = enriched.map((v, i) => {
        const rec = recommendation.venues?.find(r => r.index === i) || {};
        const matrix = matrices[i];
        const travel_times = friends.map((f, fi) => {
          const el = matrix?.rows?.[fi]?.elements?.[0];
          return {
            person: f.name,
            minutes: el?.duration?.value ? Math.round(el.duration.value / 60) : null,
            text: el?.duration?.text || '—',
            route: rec.travel_times?.find(t => t.person === f.name)?.route || '',
          };
        });
        const valid = travel_times.filter(t => t.minutes !== null).map(t => t.minutes);
        const maxT = Math.max(...valid), minT = Math.min(...valid);
        const fairness = rec.fairness ?? (valid.length > 1 ? Math.round(100 - ((maxT - minT) / maxT) * 100) : 100);
        return { ...v, travel_times, fairness, combined_score: rec.combined_score || fairness,
          fairness_reason: rec.fairness_reason || '', recommendation_reason: rec.recommendation_reason || '' };
      });

      venues.sort((a, b) => (b.combined_score || b.fairness) - (a.combined_score || a.fairness));
      const resultData = { venues, friends, centroid, midpoint: recommendation.midpoint_neighborhood || 'NYC', midpoint_reason: recommendation.midpoint_reason || '' };
      setResults(resultData);
      // Fetch real directions for top venue
      const topVenue = venues[0];
      if (topVenue?.coords) {
        const routePromises = friends.map(f =>
          api.directions(f.coords.lat, f.coords.lng, topVenue.coords.lat, topVenue.coords.lng).catch(() => null)
        );
        Promise.all(routePromises).then(setRoutes);
      }
      setStep('results');
    } catch (e) {
      setError('Something went wrong: ' + (e.message || 'unknown error'));
    } finally { setLoading(false); setLoadingMsg(''); }
  }, [friends, venueType, selectedVenue]);

  // ── Shared styles ────────────────────────────────────────────────────────────
  const card = { background: '#f5f3ff', border: '1px solid #E0D8CC', borderRadius: 10 };

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", minHeight: '100vh', background: '#F5F0E8', color: '#1e1b4b' }}>

      {/* Header */}
      <div style={{ background: '#f5f3ff', borderBottom: '1px solid #E0D8CC', padding: '14px 28px',
        display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {LIGHT_COLORS.slice(0, 3).map((c, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}
        </div>
        <svg width="22" height="20" viewBox="0 0 24 22" fill="none" style={{ flexShrink: 0, marginRight: 6 }}>
          <line x1="3" y1="3" x2="12" y2="12" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round"/>
          <line x1="21" y1="3" x2="12" y2="12" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round"/>
          <line x1="12" y1="20" x2="12" y2="12" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="3" cy="3" r="3" fill="#a78bfa"/>
          <circle cx="21" cy="3" r="3" fill="#a78bfa"/>
          <circle cx="12" cy="20" r="3" fill="#a78bfa"/>
          <circle cx="12" cy="12" r="4" fill="#7c3aed"/>
        </svg>
        <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 16, fontWeight: 800, letterSpacing: '0.04em', color: '#1e1b4b' }}>triangulate</span>
        <span style={{ fontSize: 10, color: '#c4b5fd', marginLeft: 2 }}>/ nyc meetup finder</span>
        {step === 'results' && (
          <button onClick={reset}
            style={{ marginLeft: 'auto', background: '#7c3aed', border: 'none', borderRadius: 6,
              color: 'white', padding: '7px 18px', fontSize: 11, cursor: 'pointer',
              fontFamily: "'DM Mono', monospace", fontWeight: 500, letterSpacing: '0.04em' }}>
            ← new search
          </button>
        )}
      </div>

      {/* ── Setup ── */}
      {step === 'setup' && (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 28px' }}>

          {/* Venue type */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
              01 / what are you looking for?
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {VENUE_TYPES.map(v => (
                <button key={v.id} onClick={() => setVenueType(v.id)} style={{
                  padding: '8px 15px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  fontFamily: "'DM Mono', monospace", transition: 'all 0.12s',
                  border: venueType === v.id ? '1.5px solid #C17B2F' : '1px solid #D4CCC0',
                  background: venueType === v.id ? 'rgba(193,123,47,0.08)' : '#f5f3ff',
                  color: venueType === v.id ? '#7c3aed' : '#6d28d9',
                }}>{v.icon} {v.label}</button>
              ))}
            </div>
          </div>

          {/* Friends */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 4 }}>
              02 / who's coming? ({friends.length}/6)
            </div>
            <div style={{ fontSize: 11, color: '#A89888', marginBottom: 14, lineHeight: 1.6 }}>
              Enter each person's name and where they're starting from. You can type a venue name, a landmark, a street address, or a neighbourhood — Google will suggest matches as you type. Pick from the dropdown to confirm.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', zIndex: 10 }}>
              {friends.map((f, i) => (
                <div key={f.id} style={{ ...card, borderLeft: `3px solid ${LIGHT_COLORS[i % LIGHT_COLORS.length]}`, position: 'relative', zIndex: friends.length - i, overflow: 'visible' }}>
                  {/* Name row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #EDE8DF' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: LIGHT_COLORS[i % LIGHT_COLORS.length], flexShrink: 0 }} />
                    <div style={{ fontSize: 9, color: '#a78bfa', width: 36, flexShrink: 0 }}>name</div>
                    <input
                      defaultValue={f.name}
                      onInput={e => updateFriend(f.id, 'name', e.target.value)}
                      placeholder={`e.g. ${NAME_EXAMPLES[i] || 'Alex'}`}
                      style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                        color: '#1e1b4b', fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 700 }} />
                    {friends.length > 2 && (
                      <button onClick={() => removeFriend(f.id)}
                        style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>×</button>
                    )}
                  </div>
                  {/* Location row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                    <div style={{ fontSize: 9, color: '#a78bfa', flexShrink: 0 }}>📍</div>
                    <div style={{ fontSize: 9, color: '#a78bfa', width: 36, flexShrink: 0 }}>from</div>
                    <AddressInput
                      value={f.address}
                      onChange={val => updateFriend(f.id, 'address', val)}
                      onSelect={({ label, coords }) => setCoords(f.id, coords, label)}
                      placeholder={`e.g. ${LOCATION_EXAMPLES[i]}`}
                      color={LIGHT_COLORS[i % LIGHT_COLORS.length]}
                    />
                    {f.coords
                      ? <span style={{ fontSize: 11, color: '#4CAF7D', flexShrink: 0 }}>✓</span>
                      : <span style={{ fontSize: 9, color: '#D4CCC0', flexShrink: 0 }}>pick from list</span>
                    }
                  </div>
                </div>
              ))}
            </div>

            {friends.length < 6 && (
              <button onClick={addFriend} style={{ marginTop: 8, width: '100%', padding: '9px',
                background: 'transparent', border: '1.5px dashed #D4CCC0', borderRadius: 8,
                color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                transition: 'all 0.15s' }}
                onMouseOver={e => { e.target.style.borderColor = '#a78bfa'; e.target.style.color = '#6d28d9'; }}
                onMouseOut={e => { e.target.style.borderColor = '#D4CCC0'; e.target.style.color = '#a78bfa'; }}>
                + add another person
              </button>
            )}
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(184,74,50,0.06)',
              border: '1px solid rgba(184,74,50,0.2)', borderRadius: 6,
              color: '#B84A32', fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>{error}</div>
          )}

          <button onClick={findMeetup} disabled={loading} style={{
            width: '100%', padding: '14px',
            background: loading ? '#ede9fe' : 'linear-gradient(135deg, #C17B2F, #B84A32)',
            border: 'none', borderRadius: 8,
            color: loading ? '#a78bfa' : 'white', fontSize: 13, fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: '0.05em',
            boxShadow: loading ? 'none' : '0 2px 12px rgba(193,123,47,0.3)',
          }}>
            {loading
              ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', animation: 'spin 1.2s linear infinite' }}>◌</span>
                  {loadingMsg}
                </span>
              : '→ FIND OUR SPOT'
            }
          </button>
          <div style={{ marginTop: 10, fontSize: 9, color: '#D4CCC0', textAlign: 'center' }}>
            google geocoding · places · distance matrix · claude ai
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {step === 'results' && results && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 'calc(100vh - 52px)' }}>

          {/* Map — top on mobile */}
          <div style={{ order: isMobile ? 1 : 2, flex: isMobile ? 'none' : 1, height: isMobile ? '55vw' : '100%', minHeight: isMobile ? 240 : 'auto' }}>
            <MapView friends={results.friends} venues={results.venues} midpoint={results.centroid} selectedVenueIndex={selectedVenueIndex} routes={routes} />
          </div>

          {/* Sidebar — below map on mobile */}
          <div style={{ order: isMobile ? 2 : 1, width: isMobile ? '100%' : 360, flexShrink: 0, overflowY: isMobile ? 'visible' : 'auto', borderRight: isMobile ? 'none' : '1px solid #E0D8CC', borderTop: isMobile ? '1px solid #E0D8CC' : 'none',
            padding: '18px 16px', background: '#F5F0E8' }}>

            {/* Crew */}
            <div style={{ ...card, marginBottom: 12, padding: '10px 14px' }}>
              <div style={{ fontSize: 8, color: '#a78bfa', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8 }}>the crew</div>
              {results.friends.map((f, i) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: LIGHT_COLORS[i % LIGHT_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#1e1b4b', fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 700, flexShrink: 0 }}>{f.name}</span>
                  <span style={{ fontSize: 9, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.address}</span>
                </div>
              ))}
            </div>

            {/* Midpoint */}
            <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(193,123,47,0.06)',
              borderRadius: 10, border: '1px solid rgba(193,123,47,0.2)' }}>
              <div style={{ fontSize: 8, color: '#7c3aed', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>meeting point</div>
              <div style={{ fontSize: 15, color: '#1e1b4b', fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 800 }}>{results.midpoint}</div>
              {results.midpoint_reason && <div style={{ fontSize: 10, color: '#8b5cf6', marginTop: 4, lineHeight: 1.5 }}>{results.midpoint_reason}</div>}
            </div>

            <div style={{ fontSize: 8, color: '#a78bfa', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 12 }}>
              {selectedVenue.icon} top spots · best match first
            </div>

            {/* Venue cards */}
            {results.venues.map((v, i) => (
              <div key={i} onClick={() => selectVenue(i)} style={{ ...card, marginBottom: 12, cursor: "pointer",
                border: `1px solid ${i === 0 ? 'rgba(124,58,237,0.4)' : '#ddd6fe'}` }}>
                {v.photo && (
                  <div style={{ height: 100, overflow: 'hidden', position: 'relative', borderRadius: '10px 10px 0 0' }}>
                    <img src={v.photo} alt={v.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => e.target.parentElement.style.display = 'none'} />
                    {i === 0 && <div style={{ position: 'absolute', top: 8, left: 8, background: '#7c3aed',
                      color: 'white', fontSize: 8, fontWeight: 800, padding: '3px 8px', borderRadius: 4,
                      fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: '0.1em' }}>★ TOP PICK</div>}
                    {v.isOpen !== null && (
                      <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(245,243,255,0.9)',
                        padding: '3px 8px', borderRadius: 4, fontSize: 9,
                        color: v.isOpen ? '#2E7D52' : '#B84A32', border: `1px solid ${v.isOpen ? '#2E7D52' : '#B84A32'}` }}>
                        {v.isOpen ? 'Open now' : 'Closed'}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
                    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 800, fontSize: 13, color: '#1e1b4b', lineHeight: 1.2, paddingRight: 8 }}>{v.name}</div>
                    {v.rating && <span style={{ fontSize: 11, color: '#7c3aed', flexShrink: 0, fontWeight: 600 }}>★ {v.rating}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#8b5cf6', marginBottom: 6, lineHeight: 1.4 }}>{v.address}</div>
                  {v.recommendation_reason && <div style={{ fontSize: 11, color: '#4c1d95', marginBottom: 8, lineHeight: 1.5 }}>{v.recommendation_reason}</div>}

                  {/* Score bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 8, color: '#a78bfa', letterSpacing: '0.1em', textTransform: 'uppercase' }}>match score</span>
                      <span style={{ fontSize: 10 }}>
                        <span style={{ color: (v.combined_score||0) >= 80 ? '#2E7D52' : (v.combined_score||0) >= 60 ? '#7c3aed' : '#B84A32', fontWeight: 600 }}>{v.combined_score ?? '—'}%</span>
                        <span style={{ color: '#c4b5fd', fontSize: 9 }}> · {v.fairness ?? '—'}% fair</span>
                      </span>
                    </div>
                    <div style={{ height: 3, background: '#ede9fe', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${v.combined_score}%`, borderRadius: 2,
                        background: v.combined_score >= 80 ? '#2E7D52' : v.combined_score >= 60 ? '#7c3aed' : '#B84A32' }} />
                    </div>
                  </div>

                  {/* Travel times */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: v.website ? 8 : 0 }}>
                    {(v.travel_times||[]).map((t, j) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: LIGHT_COLORS[j % LIGHT_COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: '#6d28d9', width: 50, flexShrink: 0 }}>{t.person}</span>
                        <span style={{ fontSize: 10, fontFamily: "'DM Mono'", color: t.minutes ? '#1e1b4b' : '#c4b5fd', width: 30, flexShrink: 0 }}>{t.minutes ? `${t.minutes}m` : '—'}</span>
                        <span style={{ fontSize: 9, color: '#6d28d9', display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                          {routes[j]?.steps?.length ? routes[j].steps.map((s, si) => (
                            <span key={si} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              {si > 0 && <span style={{ color: '#c4b5fd' }}>›</span>}
                              <span>{s.mode === 'WALKING' ? '🚶' : s.vehicle === 'SUBWAY' ? '🚇' : s.vehicle === 'BUS' ? '🚌' : '🚆'}</span>
                              {s.line && <span style={{ fontSize: 8, background: '#1e1b4b', color: 'white', borderRadius: 3, padding: '1px 4px' }}>{s.line}</span>}
                              <span style={{ fontSize: 9 }}>{s.duration}</span>
                            </span>
                          )) : t.route ? <span>{t.route}</span> : <span>🚇</span>}
                        </span>
                      </div>
                    ))}
                  </div>

                  {v.website && (
                    <a href={v.website} target="_blank" rel="noreferrer"
                      style={{ display: 'inline-block', fontSize: 10, color: '#2E6BA8', textDecoration: 'none' }}>
                      → visit website
                    </a>
                  )}
                </div>
              </div>
            ))}

            {/* Search again button */}
            <button onClick={reset} style={{
              width: '100%', padding: '12px', marginTop: 4, marginBottom: 8,
              background: '#7c3aed', border: 'none', borderRadius: 8,
              color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: '0.04em',
              boxShadow: '0 2px 8px rgba(193,123,47,0.25)',
            }}>
              ← search again
            </button>
          </div>

          {/* Refine results */}
          <div style={{ marginTop: 16, borderTop: '1px solid #E0D8CC', paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: '#a78bfa', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>refine results</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={refineMsg}
                onChange={e => setRefineMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && refineSearch()}
                placeholder="e.g. outdoor space, divey bar..."
                style={{ flex: 1, fontSize: 12, fontFamily: "'DM Mono', monospace", background: '#f5f3ff',
                  border: '1px solid #D4CCC0', borderRadius: 6, padding: '7px 10px', outline: 'none', color: '#1e1b4b' }}
              />
              <button onClick={refineSearch} disabled={refineLoading || !refineMsg.trim()}
                style={{ background: refineLoading || !refineMsg.trim() ? '#ddd6fe' : '#7c3aed',
                  color: 'white', border: 'none', borderRadius: 6, padding: '7px 14px',
                  cursor: refineLoading || !refineMsg.trim() ? 'default' : 'pointer', fontSize: 14, fontWeight: 700 }}>
                {refineLoading ? '⏳' : '🎲'}
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
