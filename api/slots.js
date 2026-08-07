// Vercel serverless function: returns available Calendly slots for a 7-day window.
// Requires env var CALENDLY_API_TOKEN (Calendly personal access token).
const EVENT_SLUG = 'guimar-pro-product-demo';
const API = 'https://api.calendly.com';

let eventTypeUri = null;
const cache = new Map(); // key -> { until, data }

async function cget(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Calendly ${r.status} for ${url.split('?')[0]}`);
  return r.json();
}

module.exports = async (req, res) => {
  const token = process.env.CALENDLY_API_TOKEN;
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (!token) return res.status(503).json({ error: 'not_configured' });

  try {
    if (!eventTypeUri) {
      const me = await cget(`${API}/users/me`, token);
      const types = await cget(`${API}/event_types?user=${encodeURIComponent(me.resource.uri)}&count=100`, token);
      const et = types.collection.find(t => t.slug === EVENT_SLUG && t.active);
      if (!et) return res.status(500).json({ error: 'event_type_not_found' });
      eventTypeUri = et.uri;
    }

    const now = new Date(Date.now() + 60 * 1000);
    let start = req.query.start ? new Date(req.query.start) : now;
    if (isNaN(start) || start < now) start = now;
    const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);

    const key = start.toISOString().slice(0, 13);
    const hit = cache.get(key);
    if (hit && Date.now() < hit.until) return res.status(200).json(hit.data);

    const avail = await cget(
      `${API}/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}` +
      `&start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}`,
      token
    );

    const data = {
      slots: avail.collection
        .filter(s => s.status === 'available')
        .map(s => ({ start: s.start_time, url: s.scheduling_url })),
    };
    cache.set(key, { until: Date.now() + 5 * 60 * 1000, data });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'upstream', detail: String(e.message || e) });
  }
};
