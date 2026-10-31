// Only OAuth credentials and synchronization pointers; no user file contents.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const TEN_MINUTES = 600000;
const SESSION_TTL = 90 * 86400000;
const encoder = new TextEncoder();

class SafeError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new SafeError(status, code); };
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => b64(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hexHash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
function httpsOrigin(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.username && !u.password; } catch { return false; }
}
function config(env) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  if (!origins.length || origins.some(o => !httpsOrigin(o)) || !httpsOrigin(env.PUBLIC_URL) ||
      !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !OPAQUE.test(env.TOKEN_ENCRYPTION_KEY || '')) fail(503, 'not_configured');
  const keyBytes = unb64(env.TOKEN_ENCRYPTION_KEY);
  if (keyBytes.length !== 32 || b64(keyBytes) !== env.TOKEN_ENCRYPTION_KEY) fail(503, 'not_configured');
  return { origins: new Set(origins), callback: env.PUBLIC_URL + '/oauth/callback', keyBytes };
}
async function crypt(cfg, mode, value, type, id, origin) {
  const key = await crypto.subtle.importKey('raw', cfg.keyBytes, 'AES-GCM', false, [mode]);
  const additionalData = encoder.encode(JSON.stringify(['v1', type, id, origin]));
  if (mode === 'encrypt') {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, encoder.encode(value));
    return 'v1.' + b64(iv) + '.' + b64(ciphertext);
  }
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') fail(401, 'reconnect_required');
  return new TextDecoder('utf-8', { fatal: true }).decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[1]), additionalData }, key, unb64(parts[2])));
}
const headers = () => ({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
function json(body, status = 200, origin) {
  const h = { ...headers(), 'Content-Type': 'application/json; charset=utf-8' };
  if (origin) { h['Access-Control-Allow-Origin'] = origin; h.Vary = 'Origin'; }
  return new Response(JSON.stringify(body), { status, headers: h });
}
function informationPage(privacy = false) {
  const title = privacy ? 'Конфиденциальность — ZeTer OS и Google Drive' : 'ZeTer OS — подключение Google Drive';
  const content = privacy
    ? '<h1>Конфиденциальность ZeTer OS и Google Drive</h1>' +
      '<p>ZeTer OS — личное рабочее пространство для Windows и браузера. Подключение Google Drive позволяет сохранять и синхронизировать выбранные данные между устройствами.</p>' +
      '<h2>Какие данные используются</h2><p>Приложение хранит рабочие данные локально и, по вашему выбору, в вашем Google Drive. Разрешение drive.file позволяет работать с файлами, созданными или открытыми через приложение; оно не даёт приложению полный доступ ко всему Диску. Содержимое файлов передаётся напрямую между приложением и Google Drive, минуя этот сервер.</p>' +
      '<h2>Подключение и сервер</h2><p>Для браузера сервер обменивает код Google OAuth на токены и хранит refresh token в D1 в зашифрованном виде AES-256-GCM. Сессия действует не более 90 дней; Google может ограничить срок доступа раньше. Для Windows код подключения, PKCE verifier и refresh token проходят через этот сервер только на время обмена с Google и не сохраняются на сервере. Windows хранит собственное подключение локально с защитой DPAPI текущего пользователя.</p>' +
      '<p>Сервер хранит привязанные к аккаунту служебные метаданные: хэш идентификатора Google Drive, сессии, указатель на согласованный снимок и историю принятых операций синхронизации. Эти данные нужны для согласования устройств и защиты от повторной записи. Пользовательские файлы на сервер не загружаются. На этих информационных страницах нет аналитики, cookies и сторонних скриптов.</p>' +
      '<h2>Отключение и удаление</h2><p>Отключение устройства удаляет его сессию; файлы в вашем Google Drive и служебная история синхронизации остаются. Файлы можно удалить в Google Drive. Отозвать доступ приложения можно в <a href="https://myaccount.google.com/connections">подключениях аккаунта Google</a>. Для запроса удаления серверных служебных данных напишите на <a href="mailto:zeter11@gmail.com">zeter11@gmail.com</a>.</p>' +
      '<p><a href="/">О сервисе</a> · <a href="https://dkoles.com/zeteros/index.html">Открыть ZeTer OS</a></p>'
    : '<h1>ZeTer OS — подключение Google Drive</h1>' +
      '<p>ZeTer OS объединяет рабочие столы, заметки, задачи и файлы в Windows и браузере. Этот сервер обеспечивает подключение Google и согласование синхронизации между вашими устройствами.</p>' +
      '<p>Подключение начинается в приложении. Вы выбираете аккаунт Google и разрешаете приложению работать с его собственными файлами в вашем Google Drive.</p>' +
      '<p><a href="https://dkoles.com/zeteros/index.html">Открыть ZeTer OS</a> · <a href="/privacy">Конфиденциальность</a></p>' +
      '<p>Поддержка: <a href="mailto:zeter11@gmail.com">zeter11@gmail.com</a></p>';
  return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><main>' + content + '</main></html>', {
    headers: { ...headers(), 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'X-Frame-Options': 'DENY' }
  });
}
async function boundedText(stream, maximum) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail(413, 'body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function googleToken(env, cfg, fields, desktop = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const form = new URLSearchParams({ client_id: desktop ? env.DESKTOP_CLIENT_ID : env.GOOGLE_CLIENT_ID,
      client_secret: desktop ? env.DESKTOP_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET });
    for (const key of ['grant_type', 'code', 'code_verifier', 'redirect_uri', 'refresh_token']) {
      if (Object.hasOwn(fields, key)) form.set(key, fields[key]);
    }
    const response = await fetch(TOKEN_URL, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    if (response.status >= 300 && response.status < 400) fail(502, 'google_unavailable');
    let token;
    try { token = JSON.parse(await boundedText(response.body, 32768)); }
    catch { fail(502, 'google_response_invalid'); }
    if (!response.ok) {
      const rejected = response.status === 400 && token?.error === 'invalid_grant';
      if ((response.status === 400 || response.status === 401) &&
          ['invalid_client', 'unauthorized_client', 'invalid_request'].includes(token?.error)) fail(503, 'google_client_configuration');
      fail(rejected ? 401 : 502, rejected ? 'reconnect_required' : 'google_unavailable');
    }
    if (!token || Array.isArray(token) || typeof token !== 'object' || typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192 ||
        !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86400 ||
        (token.token_type !== undefined && (typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer')) ||
        (token.refresh_token !== undefined && (typeof token.refresh_token !== 'string' || !token.refresh_token || token.refresh_token.length > 8192)) ||
        (token.scope !== undefined && (typeof token.scope !== 'string' || !token.scope.split(' ').includes(SCOPE)))) fail(502, 'google_response_invalid');
    if (desktop && ((token.token_type !== undefined && (typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer')) ||
        (token.scope !== undefined && token.scope.trim().split(/\s+/).join(' ') !== SCOPE) ||
        (fields.grant_type === 'authorization_code' && !token.refresh_token))) fail(502, 'google_response_invalid');
    return token;
  } catch (e) { if (e instanceof SafeError && e.code !== 'body_too_large') throw e; fail(502, 'google_unavailable'); }
  finally { clearTimeout(timer); }
}
async function googleAccount(accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(ABOUT_URL, { method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + accessToken } });
    const text = await boundedText(response.body, 8192);
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 401 : 502, response.status === 401 || response.status === 403 ? 'reconnect_required' : 'google_unavailable');
    let data; try { data = JSON.parse(text); } catch { fail(502, 'google_unavailable'); }
    const permissionId = data?.user?.permissionId;
    if (typeof permissionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(permissionId)) fail(502, 'google_unavailable');
    return await hexHash('zeter-drive-user-v1:' + permissionId);
  } catch (e) { if (e instanceof SafeError && e.code !== 'body_too_large') throw e; fail(502, 'google_unavailable'); }
  finally { clearTimeout(timer); }
}
async function verifyNativeToken(accessToken, env) {
  // Google auth library uses this POST + bearer header; no token in URL or body.
  if (typeof env.DESKTOP_CLIENT_ID !== 'string' || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(env.DESKTOP_CLIENT_ID)) fail(503, 'not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(TOKEN_INFO_URL, { method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } });
    const text = await boundedText(response.body, 8192);
    if (!response.ok) fail(response.status === 400 || response.status === 401 || response.status === 403 ? 401 : 502,
      response.status === 400 || response.status === 401 || response.status === 403 ? 'reconnect_required' : 'google_unavailable');
    let info; try { info = JSON.parse(text); } catch { fail(502, 'google_unavailable'); }
    const now = Date.now();
    const seconds = value => (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^[0-9]{1,12}$/.test(value));
    if (!info || info.aud !== env.DESKTOP_CLIENT_ID || info.azp !== env.DESKTOP_CLIENT_ID ||
        typeof info.scope !== 'string' || !info.scope.split(' ').includes(SCOPE) ||
        !seconds(info.expires_in) || Number(info.expires_in) <= 0 || Number(info.expires_in) > 86400 ||
        !seconds(info.exp) || Number(info.exp) * 1000 <= now || Number(info.exp) * 1000 > now + 86400000) fail(401, 'reconnect_required');
    return Math.min(now + Number(info.expires_in) * 1000, Number(info.exp) * 1000);
  } catch (e) { if (e instanceof SafeError && e.code !== 'body_too_large') throw e; fail(502, 'google_unavailable'); }
  finally { clearTimeout(timer); }
}
function callbackPage(origin, nonce, sessionHandle) {
  const scriptNonce = random();
  const safe = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const payload = safe({ type: 'zeter-google-drive-auth', nonce, sessionHandle });
  const body = '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Google Drive</title><p>Подключение завершено. Это окно можно закрыть.</p><script nonce="' + scriptNonce + '">history.replaceState(null,"","/oauth/callback");if(window.opener){window.opener.postMessage(' + payload + ',' + safe(origin) + ');window.close();}</script></html>';
  return new Response(body, { headers: { ...headers(), 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; script-src 'nonce-" + scriptNonce + "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'X-Frame-Options': 'DENY' } });
}

async function start(request, url, env, cfg, db, now) {
  const origin = url.searchParams.get('origin'); const nonce = url.searchParams.get('nonce');
  if (url.searchParams.getAll('origin').length !== 1 || url.searchParams.getAll('nonce').length !== 1 || !cfg.origins.has(origin) || !OPAQUE.test(nonce || '')) fail(400, 'invalid_request');
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64) fail(400, 'invalid_request');
  const bucket = Math.floor(now / TEN_MINUTES);
  const hmacKey = await crypto.subtle.importKey('raw', cfg.keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const ipHash = b64(await crypto.subtle.sign('HMAC', hmacKey, encoder.encode('oauth-start:' + bucket + ':' + ip)));
  await db.batch([
    db.prepare('DELETE FROM oauth_pending WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM start_limits WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now)
  ]);
  const limit = await db.prepare('INSERT INTO start_limits (bucket_hash, attempts, expires_at) VALUES (?1, 1, ?2) ON CONFLICT(bucket_hash) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 10 RETURNING attempts').bind(ipHash, (bucket + 1) * TEN_MINUTES).first();
  if (!limit) fail(429, 'rate_limited');
  const state = random(); const stateHash = await hash(state); const verifier = random();
  const encrypted = await crypt(cfg, 'encrypt', verifier, 'pending', stateHash, origin);
  const inserted = await db.prepare('INSERT INTO oauth_pending (state_hash, origin, nonce, verifier_cipher, expires_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM oauth_pending) < 500 RETURNING state_hash').bind(stateHash, origin, nonce, encrypted, now + TEN_MINUTES).first();
  if (!inserted) fail(429, 'rate_limited');
  const auth = new URL(AUTH_URL);
  auth.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: cfg.callback, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString();
  return new Response(null, { status: 302, headers: { ...headers(), Location: auth.href } });
}
async function callback(url, env, cfg, db, now) {
  const state = url.searchParams.get('state');
  if (url.searchParams.getAll('state').length !== 1 || !OPAQUE.test(state || '')) fail(400, 'invalid_state');
  const stateHash = await hash(state);
  // Consume first, including failed/expired callbacks. Never SELECT followed by DELETE.
  const pending = await db.prepare('DELETE FROM oauth_pending WHERE state_hash = ?1 RETURNING origin, nonce, verifier_cipher, expires_at').bind(stateHash).first();
  if (!pending || pending.expires_at <= now || !cfg.origins.has(pending.origin)) fail(400, 'invalid_state');
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !code || code.length > 4096) fail(400, 'authorization_failed');
  const verifier = await crypt(cfg, 'decrypt', pending.verifier_cipher, 'pending', stateHash, pending.origin);
  const token = await googleToken(env, cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.callback, code_verifier: verifier });
  if (!token.refresh_token) fail(401, 'reconnect_required');
  const accountKey = await googleAccount(token.access_token);
  const handle = random(); const handleHash = await hash(handle);
  const encrypted = await crypt(cfg, 'encrypt', token.refresh_token, 'session', handleHash, pending.origin);
  await db.prepare("INSERT INTO sessions (handle_hash, origin, account_key, kind, refresh_cipher, expires_at, generation) VALUES (?1, ?2, ?3, 'web', ?4, ?5, 0)").bind(handleHash, pending.origin, accountKey, encrypted, Date.now() + SESSION_TTL).run();
  return callbackPage(pending.origin, pending.nonce, handle);
}
async function jsonInput(request, maximum = 4096) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'invalid_content_type');
  if (Number(request.headers.get('Content-Length') || 0) > maximum) fail(413, 'body_too_large');
  let input; try { input = JSON.parse(await boundedText(request.body, maximum)); } catch (e) { if (e instanceof SafeError) throw e; fail(400, 'invalid_request'); }
  if (!input || Array.isArray(input) || typeof input !== 'object') fail(400, 'invalid_request');
  return input;
}
function keys(input, expected) {
  if (Object.keys(input).length !== expected.length || expected.some(key => !Object.hasOwn(input, key))) fail(400, 'invalid_request');
}
async function nativeToken(request, env, cfg, db, now) {
  if (typeof env.DESKTOP_CLIENT_ID !== 'string' || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(env.DESKTOP_CLIENT_ID) ||
      typeof env.DESKTOP_CLIENT_SECRET !== 'string' || !env.DESKTOP_CLIENT_SECRET || env.DESKTOP_CLIENT_SECRET.length > 4096) fail(503, 'not_configured');
  const input = await jsonInput(request, 16384);
  let fields;
  if (input.grant_type === 'authorization_code') {
    keys(input, ['grant_type', 'code', 'code_verifier', 'redirect_uri']);
    const redirect = typeof input.redirect_uri === 'string' && input.redirect_uri.match(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/oauth2callback$/);
    if (typeof input.code !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(input.code) ||
        typeof input.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier) ||
        !redirect || Number(redirect[1]) > 65535) fail(400, 'invalid_request');
    fields = { grant_type: 'authorization_code', code: input.code, code_verifier: input.code_verifier, redirect_uri: input.redirect_uri };
  } else if (input.grant_type === 'refresh_token') {
    keys(input, ['grant_type', 'refresh_token']);
    if (typeof input.refresh_token !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,8192}$/.test(input.refresh_token)) fail(400, 'invalid_request');
    fields = { grant_type: 'refresh_token', refresh_token: input.refresh_token };
  } else fail(400, 'invalid_request');
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64) fail(400, 'invalid_request');
  const bucket = Math.floor(now / TEN_MINUTES);
  const key = await crypto.subtle.importKey('raw', cfg.keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const ipHash = b64(await crypto.subtle.sign('HMAC', key, encoder.encode('native-token:' + bucket + ':' + ip)));
  await db.prepare('DELETE FROM start_limits WHERE expires_at <= ?1').bind(now).run();
  const allowed = await db.prepare('INSERT INTO start_limits (bucket_hash, attempts, expires_at) VALUES (?1, 1, ?2) ON CONFLICT(bucket_hash) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 10 RETURNING attempts').bind(ipHash, (bucket + 1) * TEN_MINUTES).first();
  if (!allowed) fail(429, 'rate_limited');
  const token = await googleToken(env, cfg, fields, true);
  const output = { access_token: token.access_token, expires_in: token.expires_in, token_type: 'Bearer', scope: SCOPE };
  if (token.refresh_token !== undefined) output.refresh_token = token.refresh_token;
  return json(output);
}
async function sessionIdentity(request, db, now, origin) {
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'reconnect_required');
  const id = await hash(auth.slice(7));
  const kind = origin === undefined ? 'native' : 'web';
  const boundOrigin = origin || '';
  const session = await db.prepare('SELECT account_key, kind, origin, refresh_cipher, expires_at, generation FROM sessions WHERE handle_hash = ?1 AND origin = ?2 AND kind = ?3 AND expires_at > ?4').bind(id, boundOrigin, kind, now).first();
  if (!session) fail(401, 'reconnect_required');
  return { id, session, kind, boundOrigin };
}
async function nativeSession(request, db, env) {
  const input = await jsonInput(request); keys(input, ['accessToken']);
  if (typeof input.accessToken !== 'string' || !input.accessToken || input.accessToken.length > 3500 || /[\s\x00-\x1f\x7f]/.test(input.accessToken)) fail(400, 'invalid_request');
  const tokenExpiresAt = await verifyNativeToken(input.accessToken, env);
  const accountKey = await googleAccount(input.accessToken);
  if (tokenExpiresAt <= Date.now()) fail(401, 'reconnect_required');
  const sessionHandle = random(); const expiresAt = Date.now() + SESSION_TTL;
  await db.prepare("INSERT INTO sessions (handle_hash, origin, account_key, kind, refresh_cipher, expires_at, generation) VALUES (?1, '', ?2, 'native', NULL, ?3, 0)").bind(await hash(sessionHandle), accountKey, expiresAt).run();
  return json({ sessionHandle, accountKey, expiresAt });
}
async function authenticated(request, env, cfg, db, now, origin, disconnect) {
  const input = await jsonInput(request); keys(input, []);
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'reconnect_required');
  const id = await hash(auth.slice(7));
  const kind = origin === undefined ? 'native' : 'web'; const boundOrigin = origin || '';
  if (disconnect) {
    // Browser-local disconnect: no Google revoke, which could affect other clients.
    await db.prepare('DELETE FROM sessions WHERE handle_hash = ?1 AND origin = ?2 AND kind = ?3').bind(id, boundOrigin, kind).run();
    return json({ ok: true }, 200, origin);
  }
  if (kind !== 'web') fail(401, 'reconnect_required');
  const session = await db.prepare("SELECT origin, refresh_cipher, expires_at, generation FROM sessions WHERE handle_hash = ?1 AND origin = ?2 AND kind = 'web' AND expires_at > ?3").bind(id, origin, now).first();
  if (!session) fail(401, 'reconnect_required');
  const refresh = await crypt(cfg, 'decrypt', session.refresh_cipher, 'session', id, origin);
  const token = await googleToken(env, cfg, { grant_type: 'refresh_token', refresh_token: refresh });
  const encrypted = token.refresh_token ? await crypt(cfg, 'encrypt', token.refresh_token, 'session', id, origin) : session.refresh_cipher;
  // CAS prevents a late refresh from recreating a disconnected or newer session.
  const updated = await db.prepare('UPDATE sessions SET refresh_cipher = ?1, generation = generation + 1 WHERE handle_hash = ?2 AND origin = ?3 AND generation = ?4 AND expires_at > ?5 RETURNING generation').bind(encrypted, id, origin, session.generation, Date.now()).first();
  if (!updated) fail(409, 'session_changed');
  const active = await db.prepare('SELECT generation FROM sessions WHERE handle_hash = ?1 AND origin = ?2 AND generation = ?3 AND expires_at > ?4').bind(id, origin, updated.generation, Date.now()).first();
  if (!active) fail(409, 'session_changed');
  return json({ accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 }, 200, origin);
}
const ACTIVE = 'EXISTS (SELECT 1 FROM sessions WHERE handle_hash = ?6 AND account_key = ?1 AND origin = ?7 AND kind = ?8 AND expires_at > ?9)';
function validateBootstrap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_request');
  keys(value, ['rootFolderId', 'dataFolderId', 'historyFolderId', 'stagingFolderId']);
  const ids = Object.values(value);
  if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) || new Set(ids).size !== 4) fail(400, 'invalid_request');
}
async function bootstrap(request, db, now, origin) {
  const { id, session, boundOrigin, kind } = await sessionIdentity(request, db, now, origin);
  const accountKey = session.account_key;
  const input = await jsonInput(request); keys(input, ['expectedGeneration', 'bootstrap']);
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 || input.expectedGeneration >= Number.MAX_SAFE_INTEGER) fail(400, 'invalid_request');
  if (input.bootstrap !== null) validateBootstrap(input.bootstrap);
  const current = async () => {
    const row = await db.prepare('SELECT s.account_key, h.head_json, h.generation, b.bootstrap_json, EXISTS (SELECT 1 FROM sync_root_replacements r WHERE r.account_key = s.account_key AND r.old_root_folder_id = json_extract(h.head_json, \'$.rootFolderId\') AND r.generation = h.generation AND r.root_folder_id = b.root_folder_id AND r.bootstrap_json = b.bootstrap_json) AS replacement FROM sessions s LEFT JOIN sync_heads h ON h.account_key = s.account_key LEFT JOIN sync_bootstrap b ON b.account_key = s.account_key WHERE s.handle_hash = ?1 AND s.origin = ?2 AND s.kind = ?3 AND s.expires_at > ?4 AND s.account_key = ?5').bind(id, boundOrigin, kind, Date.now(), accountKey).first();
    if (!row) fail(401, 'reconnect_required');
    if (row.head_json && row.bootstrap_json && JSON.parse(row.head_json).rootFolderId !== JSON.parse(row.bootstrap_json).rootFolderId && !row.replacement) return { accountKey, head: JSON.parse(row.head_json), generation: row.generation, bootstrap: null, invalidReservation: true };
    return { accountKey, head: row.head_json ? JSON.parse(row.head_json) : null, generation: row.generation || 0, bootstrap: row.bootstrap_json ? JSON.parse(row.bootstrap_json) : null };
  };
  const conflict = value => json({ error: 'sync-conflict', head: value.head, generation: value.generation }, 409, origin);
  let value = await current();
  if (value.generation !== input.expectedGeneration || value.invalidReservation) return conflict(value);
  if (value.bootstrap || input.bootstrap === null) return json(value, 200, origin);
  if (value.head && value.head.rootFolderId !== input.bootstrap.rootFolderId) return conflict(value);
  // A single conditional statement chooses the account winner. Generation and
  // session are checked again inside SQLite, including the disconnect/CAS gap.
  await db.prepare('INSERT INTO sync_bootstrap (account_key, root_folder_id, bootstrap_json) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM sessions WHERE handle_hash = ?5 AND account_key = ?1 AND origin = ?6 AND kind = ?7 AND expires_at > ?8)' +
    ' AND COALESCE((SELECT generation FROM sync_heads WHERE account_key = ?1), 0) = ?4' +
    ' AND NOT EXISTS (SELECT 1 FROM sync_heads WHERE account_key = ?1 AND json_extract(head_json, \'$.rootFolderId\') != ?2)' +
    ' ON CONFLICT(account_key) DO NOTHING').bind(accountKey, input.bootstrap.rootFolderId, JSON.stringify(input.bootstrap), input.expectedGeneration, id, boundOrigin, kind, Date.now()).run();
  value = await current();
  if (value.generation !== input.expectedGeneration || !value.bootstrap || value.invalidReservation) return conflict(value);
  return json(value, 200, origin);
}
async function recreate(request, db, now, origin) {
  const { id, session, boundOrigin, kind } = await sessionIdentity(request, db, now, origin);
  const accountKey = session.account_key;
  const input = await jsonInput(request); keys(input, ['expectedGeneration', 'oldRootFolderId', 'bootstrap']);
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 || input.expectedGeneration >= Number.MAX_SAFE_INTEGER ||
      typeof input.oldRootFolderId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.oldRootFolderId)) fail(400, 'invalid_request');
  validateBootstrap(input.bootstrap);
  if (Object.values(input.bootstrap).includes(input.oldRootFolderId)) fail(400, 'invalid_request');
  const current = async () => {
    const row = await db.prepare('SELECT h.head_json, h.generation, b.bootstrap_json, r.bootstrap_json AS replacement_json FROM sessions s LEFT JOIN sync_heads h ON h.account_key = s.account_key LEFT JOIN sync_bootstrap b ON b.account_key = s.account_key LEFT JOIN sync_root_replacements r ON r.account_key = s.account_key AND r.old_root_folder_id = ?7 AND r.generation = ?8 WHERE s.handle_hash = ?1 AND s.origin = ?2 AND s.kind = ?3 AND s.expires_at > ?4 AND s.account_key = ?5 AND s.generation = ?6').bind(id, boundOrigin, kind, Date.now(), accountKey, session.generation, input.oldRootFolderId, input.expectedGeneration).first();
    if (!row) fail(401, 'reconnect_required');
    return { row, value: { accountKey, head: row.head_json ? JSON.parse(row.head_json) : null, generation: row.generation || 0, bootstrap: row.bootstrap_json ? JSON.parse(row.bootstrap_json) : null } };
  };
  const conflict = value => json({ error: 'sync-conflict', head: value.head, generation: value.generation }, 409, origin);
  const state = await current();
  if (state.value.generation !== input.expectedGeneration) return conflict(state.value);
  if (state.row.replacement_json) return state.row.replacement_json === state.row.bootstrap_json ? json(state.value, 200, origin) : conflict(state.value);
  if ((state.value.bootstrap?.rootFolderId || state.value.head?.rootFolderId) !== input.oldRootFolderId ||
      state.value.head && state.value.head.rootFolderId !== input.oldRootFolderId) return conflict(state.value);
  // The immutable winner and canonical reservation change together. Old heads,
  // operations and directory receipts are retained until/after the next commit.
  const active = 'EXISTS (SELECT 1 FROM sessions WHERE handle_hash = ?6 AND account_key = ?1 AND origin = ?7 AND kind = ?8 AND expires_at > ?9 AND generation = ?10)';
  const unchanged = 'COALESCE((SELECT generation FROM sync_heads WHERE account_key = ?1), 0) = ?3';
  const canonical = 'COALESCE((SELECT root_folder_id FROM sync_bootstrap WHERE account_key = ?1), (SELECT json_extract(head_json, \'$.rootFolderId\') FROM sync_heads WHERE account_key = ?1)) = ?2';
  const headMatches = 'NOT EXISTS (SELECT 1 FROM sync_heads WHERE account_key = ?1 AND json_extract(head_json, \'$.rootFolderId\') != ?2)';
  const bindings = [accountKey, input.oldRootFolderId, input.expectedGeneration, input.bootstrap.rootFolderId, JSON.stringify(input.bootstrap), id, boundOrigin, kind, Date.now(), session.generation];
  await db.batch([
    db.prepare('INSERT INTO sync_root_replacements (account_key, old_root_folder_id, generation, root_folder_id, bootstrap_json) SELECT ?1, ?2, ?3, ?4, ?5 WHERE ' + active + ' AND ' + unchanged + ' AND ' + canonical + ' AND ' + headMatches + ' ON CONFLICT(account_key, old_root_folder_id, generation) DO NOTHING').bind(...bindings),
    db.prepare('INSERT INTO sync_bootstrap (account_key, root_folder_id, bootstrap_json) SELECT account_key, root_folder_id, bootstrap_json FROM sync_root_replacements WHERE account_key = ?1 AND old_root_folder_id = ?2 AND generation = ?3 AND EXISTS (SELECT 1 FROM sessions WHERE handle_hash = ?4 AND account_key = ?1 AND origin = ?5 AND kind = ?6 AND expires_at > ?7 AND generation = ?8) AND ' + unchanged + ' AND ' + canonical + ' AND ' + headMatches + ' ON CONFLICT(account_key) DO UPDATE SET root_folder_id = excluded.root_folder_id, bootstrap_json = excluded.bootstrap_json').bind(accountKey, input.oldRootFolderId, input.expectedGeneration, id, boundOrigin, kind, Date.now(), session.generation)
  ]);
  const latest = await current();
  if (latest.value.generation !== input.expectedGeneration || !latest.row.replacement_json || latest.row.replacement_json !== latest.row.bootstrap_json) return conflict(latest.value);
  return json(latest.value, 200, origin);
}
async function directory(request, db, now, origin) {
  const { id: sessionId, session, boundOrigin, kind } = await sessionIdentity(request, db, now, origin);
  const input = await jsonInput(request); keys(input, ['expectedGeneration', 'rootFolderId', 'parentId', 'name', 'pathKey', 'operationId', 'id']);
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 || input.expectedGeneration >= Number.MAX_SAFE_INTEGER ||
      [input.rootFolderId, input.parentId].some(value => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 240 || ['.', '..'].includes(input.name) || /[\x00-\x1f/\\]/.test(input.name) ||
      typeof input.pathKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.pathKey) || typeof input.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(input.operationId) ||
      input.id !== null && (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.id))) fail(400, 'invalid_request');
  const accountKey = session.account_key;
  const current = async () => {
    const row = await db.prepare('SELECT h.generation, h.head_json, r.parent_id, r.name, r.file_id FROM sessions s LEFT JOIN sync_heads h ON h.account_key = s.account_key LEFT JOIN directory_reservations r ON r.account_key = s.account_key AND r.root_folder_id = ?5 AND r.path_key = ?6 WHERE s.handle_hash = ?1 AND s.origin = ?2 AND s.kind = ?3 AND s.expires_at > ?4').bind(sessionId, boundOrigin, kind, Date.now(), input.rootFolderId, input.pathKey).first();
    if (!row) fail(401, 'reconnect_required');
    return { ...row, head: row.head_json ? JSON.parse(row.head_json) : null };
  };
  const matches = row => row.generation === input.expectedGeneration && row.head?.rootFolderId === input.rootFolderId;
  const conflict = row => json({ error: 'sync-conflict', head: row.head, generation: row.generation || 0 }, 409, origin);
  let row = await current();
  if (!matches(row)) return conflict(row);
  if (row.file_id && (row.parent_id !== input.parentId || row.name !== input.name)) fail(409, 'directory-conflict');
  if (row.file_id || input.id === null) return json({ accountKey, id: row.file_id || null }, 200, origin);
  await db.prepare('INSERT INTO directory_reservations (account_key, root_folder_id, path_key, parent_id, name, file_id) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM sessions WHERE handle_hash = ?7 AND account_key = ?1 AND origin = ?8 AND kind = ?9 AND expires_at > ?10)' +
    ' AND EXISTS (SELECT 1 FROM sync_heads WHERE account_key = ?1 AND generation = ?11 AND json_extract(head_json, \'$.rootFolderId\') = ?2)' +
    ' ON CONFLICT(account_key, root_folder_id, path_key) DO NOTHING').bind(accountKey, input.rootFolderId, input.pathKey, input.parentId, input.name, input.id, sessionId, boundOrigin, kind, Date.now(), input.expectedGeneration).run();
  row = await current();
  if (!matches(row) || !row.file_id) return conflict(row);
  if (row.parent_id !== input.parentId || row.name !== input.name) fail(409, 'directory-conflict');
  return json({ accountKey, id: row.file_id }, 200, origin);
}
async function sync(request, db, now, origin, commit) {
  const identity = await sessionIdentity(request, db, now, origin);
  const { id, session, boundOrigin, kind } = identity;
  const accountKey = session.account_key;
  const current = async () => {
    const row = await db.prepare('SELECT s.account_key, h.head_json, h.generation FROM sessions s LEFT JOIN sync_heads h ON h.account_key = s.account_key WHERE s.handle_hash = ?1 AND s.origin = ?2 AND s.kind = ?3 AND s.expires_at > ?4').bind(id, boundOrigin, kind, Date.now()).first();
    if (!row) fail(401, 'reconnect_required');
    return { accountKey, head: row.head_json ? JSON.parse(row.head_json) : null, generation: row.generation || 0 };
  };
  if (!commit) return json(await current(), 200, origin);
  const input = await jsonInput(request); keys(input, ['expectedGeneration', 'operationId', 'rootFolderId', 'candidate']);
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 || input.expectedGeneration >= Number.MAX_SAFE_INTEGER ||
      typeof input.operationId !== 'string' || !/^[0-9a-f]{32}$/.test(input.operationId) || typeof input.rootFolderId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.rootFolderId) ||
      !input.candidate || typeof input.candidate !== 'object' || Array.isArray(input.candidate)) fail(400, 'invalid_request');
  const candidate = input.candidate; keys(candidate, ['snapshotId', 'manifestFileId', 'manifestSha256', 'contentHash']);
  if (typeof candidate.snapshotId !== 'string' || !/^[0-9a-f]{32}$/.test(candidate.snapshotId) || typeof candidate.manifestFileId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(candidate.manifestFileId) ||
      typeof candidate.manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.manifestSha256) || typeof candidate.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.contentHash)) fail(400, 'invalid_request');
  const requestHash = await hexHash(JSON.stringify([input.expectedGeneration, input.operationId, input.rootFolderId, candidate.snapshotId, candidate.manifestFileId, candidate.manifestSha256, candidate.contentHash]));
  const accepted = await db.prepare('SELECT o.request_hash, o.head_json FROM sync_operations o JOIN sessions s ON s.account_key = o.account_key WHERE o.account_key = ?1 AND o.operation_id = ?2 AND s.handle_hash = ?3 AND s.origin = ?4 AND s.kind = ?5 AND s.expires_at > ?6').bind(accountKey, input.operationId, id, boundOrigin, kind, Date.now()).first();
  if (accepted) {
    if (accepted.request_hash !== requestHash) { const value = await current(); return json({ error: 'sync-conflict', head: value.head, generation: value.generation }, 409, origin); }
    const head = JSON.parse(accepted.head_json); return json({ accountKey, head, generation: head.generation }, 200, origin);
  }
  const head = { generation: input.expectedGeneration + 1, rootFolderId: input.rootFolderId, snapshotId: candidate.snapshotId,
    manifestFileId: candidate.manifestFileId, manifestSha256: candidate.manifestSha256, contentHash: candidate.contentHash,
    operationId: input.operationId, parentGeneration: input.expectedGeneration, committedAt: Date.now() };
  const headJson = JSON.stringify(head);
  // Both pointer CAS and immutable idempotency receipt commit in one transaction.
  const results = await db.batch([
    db.prepare('INSERT INTO sync_heads (account_key, generation, operation_id, head_json) SELECT ?1, ?2, ?3, ?4 WHERE ' + ACTIVE +
      ' AND ((?5 = 0 AND NOT EXISTS (SELECT 1 FROM sync_heads WHERE account_key = ?1)) OR EXISTS (SELECT 1 FROM sync_heads WHERE account_key = ?1 AND generation = ?5))' +
      ' AND NOT EXISTS (SELECT 1 FROM sync_operations WHERE account_key = ?1 AND operation_id = ?3)' +
      ' AND NOT EXISTS (SELECT 1 FROM sync_bootstrap WHERE account_key = ?1 AND root_folder_id != json_extract(?4, \'$.rootFolderId\'))' +
      ' ON CONFLICT(account_key) DO UPDATE SET generation = excluded.generation, operation_id = excluded.operation_id, head_json = excluded.head_json WHERE sync_heads.generation = ?5 AND ' + ACTIVE + ' RETURNING head_json')
      .bind(accountKey, head.generation, input.operationId, headJson, input.expectedGeneration, id, boundOrigin, kind, Date.now()),
    db.prepare('INSERT INTO sync_operations (account_key, operation_id, request_hash, head_json) SELECT account_key, operation_id, ?3, head_json FROM sync_heads WHERE account_key = ?1 AND operation_id = ?2 ON CONFLICT(account_key, operation_id) DO NOTHING').bind(accountKey, input.operationId, requestHash)
  ]);
  if (results[0].results?.[0]) return json({ accountKey, head: JSON.parse(results[0].results[0].head_json), generation: head.generation }, 200, origin);
  // Another equal request may have committed while this request awaited its CAS.
  const receipt = await db.prepare('SELECT request_hash, head_json FROM sync_operations WHERE account_key = ?1 AND operation_id = ?2').bind(accountKey, input.operationId).first();
  const value = await current(); // Recheck active session even for an idempotency response.
  if (receipt?.request_hash === requestHash) { const previous = JSON.parse(receipt.head_json); return json({ accountKey, head: previous, generation: previous.generation }, 200, origin); }
  return json({ error: 'sync-conflict', head: value.head, generation: value.generation }, 409, origin);
}
export default {
  async fetch(request, env) {
    let corsOrigin;
    try {
      const url = new URL(request.url);
      if ((url.pathname === '/' || url.pathname === '/privacy') && request.method === 'GET' && !url.search) return informationPage(url.pathname === '/privacy');
      if (url.pathname === '/health' && request.method === 'GET' && !url.search) return json({ ok: true });
      const cfg = config(env);
      if (url.origin !== env.PUBLIC_URL) fail(400, 'invalid_request');
      const api = ['/token', '/disconnect', '/native/session', '/native/token', '/sync/head', '/sync/commit', '/sync/bootstrap', '/sync/recreate', '/sync/directory'].includes(url.pathname);
      if (!api && url.pathname !== '/oauth/start' && url.pathname !== '/oauth/callback') fail(404, 'not_found');
      if (api) {
        const origin = request.headers.get('Origin');
        if ((url.pathname === '/native/session' || url.pathname === '/native/token') && origin !== null) fail(403, 'origin_denied');
        if (origin !== null && !cfg.origins.has(origin)) fail(403, 'origin_denied');
        if (origin !== null) corsOrigin = origin;
        if (url.search) fail(400, 'invalid_request');
        if (request.method === 'OPTIONS') {
          const allowed = new Set(['authorization', 'content-type']);
          const requested = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
          const expectedMethod = url.pathname === '/sync/head' ? 'GET' : 'POST';
          if (!corsOrigin || request.headers.get('Access-Control-Request-Method') !== expectedMethod || requested.some(h => !allowed.has(h))) fail(403, 'preflight_denied');
          return new Response(null, { status: 204, headers: { ...headers(), Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
            'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': expectedMethod, 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
        }
        if (request.method !== (url.pathname === '/sync/head' ? 'GET' : 'POST')) fail(405, 'method_not_allowed');
      } else if (request.method !== 'GET') fail(405, 'method_not_allowed');
      // Plain D1 binding queries use the primary. A replicated session could miss
      // a concurrent disconnect during the final active-session check.
      const db = env.DB;
      const now = Date.now();
      if (url.pathname === '/native/token') return await nativeToken(request, env, cfg, db, now);
      if (url.pathname === '/native/session') return await nativeSession(request, db, env);
      if (url.pathname === '/sync/bootstrap') return await bootstrap(request, db, now, corsOrigin);
      if (url.pathname === '/sync/recreate') return await recreate(request, db, now, corsOrigin);
      if (url.pathname === '/sync/directory') return await directory(request, db, now, corsOrigin);
      if (url.pathname === '/sync/head' || url.pathname === '/sync/commit') return await sync(request, db, now, corsOrigin, url.pathname === '/sync/commit');
      if (api) return await authenticated(request, env, cfg, db, now, corsOrigin, url.pathname === '/disconnect');
      if (url.pathname === '/oauth/start') return await start(request, url, env, cfg, db, now);
      return await callback(url, env, cfg, db, now);
    } catch (error) {
      // Never return/log exception messages, upstream bodies, codes or credentials.
      return json({ error: error instanceof SafeError ? error.code : 'request_failed' }, error instanceof SafeError ? error.status : 503, corsOrigin);
    }
  }
};
