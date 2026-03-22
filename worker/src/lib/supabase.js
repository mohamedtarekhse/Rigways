// worker/src/lib/supabase.js
// Thin Supabase REST wrapper — service key never leaves the Worker

export function createSupabase(env) {
  const base = env.SUPABASE_URL;
  const key  = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Missing Supabase env vars');

  async function _fetch(path, options = {}) {
    const prefer = options._prefer || 'return=representation';
    const res = await fetch(`${base}/rest/v1${path}`, {
      ...options,
      headers: {
        'Content-Type':  'application/json',
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        prefer,
        ...(options.headers || {}),
      },
    });
    if (res.status === 204) return { data: null, error: null };
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { message: text }; }
    if (!res.ok) return { data: null, error: body };
    return { data: body, error: null };
  }

  function qs(opts = {}) {
    const p = new URLSearchParams();
    if (opts.select)  p.set('select', opts.select);
    if (opts.order)   p.set('order',  opts.order);
    if (opts.limit)   p.set('limit',  String(opts.limit));
    if (opts.offset)  p.set('offset', String(opts.offset));
    for (const [key, val] of Object.entries(opts.filters || {})) {
      const [col, op = 'eq'] = key.split('.');
      if (op === 'in')       p.append(col, `in.(${val.join(',')})`);
      else if (op === 'is')  p.append(col, `is.${val}`);
      else if (op === 'gte') p.append(col, `gte.${val}`);
      else if (op === 'lte') p.append(col, `lte.${val}`);
      else if (op === 'gt')  p.append(col, `gt.${val}`);
      else if (op === 'lt')  p.append(col, `lt.${val}`);
      else if (op === 'ilike') p.append(col, `ilike.${val}`);
      else if (op === 'neq') p.append(col, `neq.${val}`);
      else                   p.append(col, `eq.${val}`);
    }
    const str = p.toString();
    return str ? `?${str}` : '';
  }

  return {
    async from(table, opts = {}) {
      const headers = opts.single ? { Accept: 'application/vnd.pgrst.object+json' } : {};
      return _fetch(`/${table}${qs(opts)}`, { method: 'GET', headers });
    },
    async insert(table, body) {
      return _fetch(`/${table}?select=*`, { method: 'POST', body: JSON.stringify(body), _prefer: 'return=representation' });
    },
    async update(table, body, opts = {}) {
      return _fetch(`/${table}${qs({ select: opts.select || '*', filters: opts.filters })}`, { method: 'PATCH', body: JSON.stringify(body), _prefer: 'return=representation' });
    },
    async delete(table, opts = {}) {
      return _fetch(`/${table}${qs({ filters: opts.filters })}`, { method: 'DELETE', _prefer: 'return=minimal' });
    },
    async rpc(fn, params = {}) {
      return _fetch(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
    },
    async count(table, opts = {}) {
      const res = await fetch(`${base}/rest/v1/${table}${qs({ filters: opts.filters })}`, {
        method: 'HEAD',
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
      });
      const count = parseInt(res.headers.get('Content-Range')?.split('/')?.[1] || '0', 10);
      return { count: isNaN(count) ? 0 : count, error: res.ok ? null : { message: 'Count failed' } };
    },
  };
}
