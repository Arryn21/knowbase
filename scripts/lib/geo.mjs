// Home base: ZIP 90746 (Carson, CA). Distances drive the LA events sort.
export const HOME = { zip: '90746', lat: 33.8584, lon: -118.2551 };

export function milesFrom(lat, lon, from = HOME) {
  if (lat == null || lon == null) return null;
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat - from.lat);
  const dLon = toRad(lon - from.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
