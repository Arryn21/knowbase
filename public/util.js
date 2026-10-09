// Shared helpers for app.js and today.js.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
};
export const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

/** Tiny trend line as an inline SVG string. Decorative: the value it summarizes is printed beside it. */
export function sparkline(values, { w = 56, h = 16, area = false, cls = '', stretch = false } = {}) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 1.5 - ((y - min) / span) * (h - 3)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fill = area ? `<polygon points="0,${h} ${line} ${w},${h}" class="spark-area" />` : '';
  // stretch: fill the container's width while keeping the stroke width constant.
  const fit = stretch ? ' preserveAspectRatio="none"' : ` width="${w}" height="${h}"`;
  const nss = stretch ? ' vector-effect="non-scaling-stroke"' : '';
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}"${fit} aria-hidden="true" focusable="false">${fill}<polyline points="${line}" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${nss} /></svg>`;
}
