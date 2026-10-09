// Map on the LA page: events (same filters as the list) and SoCal earthquakes around home.
// Leaflet and the OpenStreetMap tiles load the first time the LA page opens.
import { esc, safeUrl } from './util.js';

const HOME = [33.8584, -118.2551];
let L = null;
let map = null;
let eventsLayer = null;
let quakesLayer = null;
let loading = null;
let pending = null;
let fitted = false;

function loadLeaflet() {
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.append(js);
  });
  return loading;
}

const token = (name) => getComputedStyle(document.getElementById('local')).getPropertyValue(name).trim();

function popup(e) {
  const when = e.allDay ? e.startDay : new Date(e.start).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `<a href="${safeUrl(e.url)}" target="_blank" rel="noopener"><b>${esc(e.title)}</b></a><br>${esc(when)} · ${esc(e.free ? 'Free' : e.priceText || '')}<br>${esc([e.venue, e.area].filter(Boolean).join(', '))}${e.miles != null ? ` · ${e.miles} mi` : ''}`;
}

function draw(events, quakes) {
  eventsLayer.clearLayers();
  quakesLayer.clearLayers();
  const hue = token('--c-local');
  const quakeColor = token('--down');
  const ring = token('--surface');
  const points = [HOME];
  for (const q of quakes) {
    L.circleMarker([q.lat, q.lon], { radius: 3 + q.mag * 2.2, color: quakeColor, weight: 1.5, fillColor: quakeColor, fillOpacity: 0.12 })
      .bindTooltip(`M${q.mag.toFixed(1)} · ${esc(q.title)}`)
      .addTo(quakesLayer);
  }
  for (const e of events) {
    if (e.lat == null || e.lon == null) continue;
    L.circleMarker([e.lat, e.lon], { radius: e.free ? 7 : 6, color: ring, weight: 2, fillColor: hue, fillOpacity: 0.95 })
      .bindPopup(popup(e))
      .addTo(eventsLayer);
    points.push([e.lat, e.lon]);
  }
  // Fit once; later filter changes shouldn't yank the view around.
  if (!fitted && points.length > 1) {
    map.fitBounds(points, { padding: [24, 24], maxZoom: 12 });
    fitted = true;
  }
}

/** Call when the LA page becomes visible (the map needs a sized container). */
export async function showMap() {
  const el = document.getElementById('evMap');
  if (!el) return;
  try {
    L = await loadLeaflet();
  } catch {
    el.innerHTML = '<p class="map-error">Map unavailable right now.</p>';
    return;
  }
  if (!map) {
    // Like the panes, the map only takes the mouse wheel after a click.
    map = L.map(el, { scrollWheelZoom: false }).setView(HOME, 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    quakesLayer = L.layerGroup().addTo(map);
    eventsLayer = L.layerGroup().addTo(map);
    L.circleMarker(HOME, { radius: 8, color: token('--surface'), weight: 3, fillColor: token('--accent'), fillOpacity: 1 })
      .bindTooltip('Home · 90746')
      .addTo(map);
    map.on('click', () => map.scrollWheelZoom.enable());
    el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
  }
  map.invalidateSize();
  if (pending) draw(...pending);
}

export function updateMap(events, quakes) {
  pending = [events, quakes];
  if (map) draw(events, quakes);
}
