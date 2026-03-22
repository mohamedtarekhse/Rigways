// worker/src/utils/response.js
// Consistent { success, data?, error?, code? } shape on every response

export function json(body, status = 200, env = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(env) },
  });
}

function cors(env = {}) {
  const origin = env.CORS_ALLOW_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

export function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: cors(env) });
}

export const ok        = (data, env)       => json({ success: true,  data },                                 200, env);
export const created   = (data, env)       => json({ success: true,  data },                                 201, env);
export const badReq    = (error, code, env)=> json({ success: false, error, code },                          400, env);
export const unauth    = (env)             => json({ success: false, error: 'Unauthorized',   code: 'UNAUTH'   }, 401, env);
export const forbidden = (env)             => json({ success: false, error: 'Forbidden',      code: 'FORBIDDEN'}, 403, env);
export const notFound  = (res, env)        => json({ success: false, error: `${res} not found`, code: 'NOT_FOUND'}, 404, env);
export const conflict  = (error, env)      => json({ success: false, error, code: 'CONFLICT' },              409, env);
export const serverErr = (env)             => json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' }, 500, env);
