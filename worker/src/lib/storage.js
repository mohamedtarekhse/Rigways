let b2AuthCache = null;

export function isStorageConfigured(env) {
  return !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) || !!env.CERT_BUCKET;
}

async function getB2Auth(env) {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY || !env.B2_BUCKET_ID || !env.B2_BUCKET_NAME) {
    throw new Error('B2 is not fully configured');
  }

  const now = Date.now();
  if (b2AuthCache && b2AuthCache.expiresAt - now > 60_000) return b2AuthCache;

  const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
  const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!authRes.ok) throw new Error(`B2 authorize failed (${authRes.status})`);
  const auth = await authRes.json();
  b2AuthCache = {
    authorizationToken: auth.authorizationToken,
    apiUrl: auth.apiUrl,
    downloadUrl: auth.downloadUrl,
    expiresAt: now + 23 * 60 * 60 * 1000,
  };
  return b2AuthCache;
}

async function computeSha1FromBuffer(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeStorageKey(key) {
  return String(key || '')
    .replace(/[^a-zA-Z0-9._\/-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 220);
}

async function objectExists(env, key) {
  if (env.CERT_BUCKET) return (await env.CERT_BUCKET.get(key)) !== null;

  const auth = await getB2Auth(env);
  const listRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: {
      Authorization: auth.authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bucketId: env.B2_BUCKET_ID,
      startFileName: key,
      maxFileCount: 1,
    }),
  });
  if (!listRes.ok) throw new Error(`B2 check existence failed (${listRes.status})`);
  const listData = await listRes.json();
  const found = (listData.files || [])[0];
  return !!found && found.fileName === key;
}

async function uniqueStorageKey(env, baseKey) {
  const extMatch = baseKey.match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0] : '';
  const stem = extMatch ? baseKey.slice(0, -ext.length) : baseKey;

  if (!(await objectExists(env, baseKey))) return baseKey;
  for (let i = 1; i <= 100; i += 1) {
    const nextKey = `${stem}-${i}${ext}`;
    if (!(await objectExists(env, nextKey))) return nextKey;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export async function putStorageObject(env, baseKey, body, contentType = 'application/octet-stream', metadata = {}) {
  const finalKey = await uniqueStorageKey(env, sanitizeStorageKey(baseKey));

  if (env.CERT_BUCKET) {
    await env.CERT_BUCKET.put(finalKey, body, {
      httpMetadata: { contentType },
      customMetadata: metadata,
    });
    return finalKey;
  }

  const auth = await getB2Auth(env);
  const uploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      Authorization: auth.authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
  });
  if (!uploadUrlRes.ok) {
    const errText = await uploadUrlRes.text().catch(() => '');
    throw new Error(`B2 get_upload_url failed (${uploadUrlRes.status}): ${errText}`);
  }

  const uploadUrl = await uploadUrlRes.json();
  const bodyBuffer = body instanceof ArrayBuffer ? body : await body.arrayBuffer();
  const sha1Hash = await computeSha1FromBuffer(bodyBuffer);
  const metaHeaders = Object.fromEntries(
    Object.entries(metadata || {}).map(([k, v]) => [`X-Bz-Info-${k}`, encodeURIComponent(String(v ?? ''))]),
  );

  const uploadRes = await fetch(uploadUrl.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadUrl.authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(finalKey),
      'Content-Type': contentType,
      'X-Bz-Content-Sha1': sha1Hash,
      ...metaHeaders,
    },
    body: bodyBuffer,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`B2 upload_file failed (${uploadRes.status}): ${errText}`);
  }
  return finalKey;
}
