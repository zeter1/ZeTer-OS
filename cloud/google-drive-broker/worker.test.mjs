import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import worker from './worker.mjs';

// Executes production SQL against real ephemeral SQLite; only the D1 transport is fake.
class MemoryD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    this.batchTail = Promise.resolve();
  }
  prepare(sql) {
    const database = this;
    let params = [];
    const run = () => {
      const stmt = this.sqlite.prepare(sql);
      // SQLite ?NNN uses named binding in Node's API, unlike D1 positional binding.
      const bindings = Object.fromEntries(params.map((value, i) => [String(i + 1), value]));
      return { stmt, bindings };
    };
    const prepared = {
      bind(...values) { params = values; return prepared; },
      async first() { const { stmt, bindings } = run(); const row = stmt.get(bindings); return row ? { ...row } : null; },
      async run() {
        if (database.beforeRun) { const callback = database.beforeRun; database.beforeRun = null; callback(); }
        const { stmt, bindings } = run();
        if (stmt.columns().length) return { success: true, results: stmt.all(bindings).map(row => ({ ...row })) };
        return { success: true, meta: stmt.run(bindings), results: [] };
      }
    };
    return prepared;
  }
  async batch(statements) {
    const previous = this.batchTail;
    let release;
    this.batchTail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
    if (this.beforeBatch) { const callback = this.beforeBatch; this.beforeBatch = null; callback(); }
    this.sqlite.exec('BEGIN');
    try { const result = []; for (const stmt of statements) result.push(await stmt.run()); this.sqlite.exec('COMMIT'); return result; }
    catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
    } finally { release(); }
  }
}
const appOrigin = 'https://dkoles.com';
const brokerOrigin = 'https://broker.example';
const nonce = randomBytes(32).toString('base64url');
const digest = s => createHash('sha256').update(s).digest('base64url');
test('reservation migration is additive, repeatable and preserves populated legacy tables', t => {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const legacy = schema.slice(0, schema.indexOf('CREATE TABLE IF NOT EXISTS sync_bootstrap'));
  const migration = readFileSync(new URL('./migrations/20261026_sync_reservations.sql', import.meta.url), 'utf8');
  sql.exec(legacy);
  sql.exec(`INSERT INTO oauth_pending VALUES ('state','origin','nonce','cipher',123);
    INSERT INTO sessions VALUES ('handle','origin','account','web','cipher',456,2);
    INSERT INTO start_limits VALUES ('bucket',3,789);
    INSERT INTO sync_heads VALUES ('account',4,'operation','{"kept":"head"}');
    INSERT INTO sync_operations VALUES ('account','operation','hash','{"kept":"receipt"}');`);
  const legacyNames = ['oauth_pending','sessions','start_limits','sync_heads','sync_operations'];
  const snapshot = names => names.map(name => ({name, schema:sql.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name=? ORDER BY type,name').all(name), rows:sql.prepare('SELECT * FROM '+name).all()}));
  const before = snapshot(legacyNames);
  sql.exec(migration);
  assert.deepEqual(snapshot(legacyNames), before);
  sql.exec(`INSERT INTO sync_bootstrap VALUES ('account','root','{"kept":"bootstrap"}');
    INSERT INTO directory_reservations VALUES ('account','root','path','parent','folder','file');`);
  const allNames = [...legacyNames,'sync_bootstrap','directory_reservations'];
  const once = snapshot(allNames);
  sql.exec(migration);
  assert.deepEqual(snapshot(allNames), once, 'second migration preserves both existing and new reservation data');
  sql.exec(schema);
  assert.deepEqual(snapshot(allNames), once, 'full schema stays compatible after migration');
  assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name), [...allNames,'sync_root_replacements'].sort());
});

test('root recreation migration is additive and repeatable with populated prior schema', t => {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  sql.exec(schema.slice(0, schema.indexOf('CREATE TABLE IF NOT EXISTS sync_root_replacements')));
  sql.exec(`INSERT INTO sync_heads VALUES ('account',4,'operation','{"kept":"head"}');
    INSERT INTO sync_operations VALUES ('account','operation','hash','{"kept":"receipt"}');
    INSERT INTO sync_bootstrap VALUES ('account','root','{"kept":"bootstrap"}');
    INSERT INTO directory_reservations VALUES ('account','root','path','parent','folder','file');`);
  const snapshot = () => ['sync_heads','sync_operations','sync_bootstrap','directory_reservations'].map(name => ({ name,
    schema: sql.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name=? ORDER BY type,name').all(name), rows: sql.prepare('SELECT * FROM '+name).all() }));
  const before = snapshot();
  const migration = readFileSync(new URL('./migrations/new20261026_root_recreation.sql', import.meta.url), 'utf8');
  sql.exec(migration);
  sql.exec(`INSERT INTO sync_root_replacements VALUES ('account','old',4,'new','{"kept":"winner"}');`);
  const receipt = sql.prepare('SELECT * FROM sync_root_replacements').all();
  sql.exec(migration); sql.exec(schema);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(sql.prepare('SELECT * FROM sync_root_replacements').all(), receipt);
});

const rootShape = suffix => ({ rootFolderId: 'root_' + suffix, dataFolderId: 'data_' + suffix, historyFolderId: 'history_' + suffix, stagingFolderId: 'staging_' + suffix });
test('recreate atomically reserves concurrent/lost-response winner and keeps old accepted head and receipts', async t => {
  const f = fixture(t), a = await f.native(), b = await f.native(), sql = f.env.DB.sqlite;
  const oldInput = candidate({rootFolderId: 'root_old'});
  const oldResponse = await f.syncApi('/sync/commit', a.sessionHandle, oldInput, true);
  assert.equal(oldResponse.status, 200); const old = await oldResponse.json();
  const receipts = sql.prepare('SELECT * FROM sync_operations').all();
  const request = (handle, shape) => f.syncApi('/sync/recreate', handle, {expectedGeneration:1, oldRootFolderId:'root_old', bootstrap:shape}, true);
  const responses = await Promise.all([request(a.sessionHandle, rootShape('a')), request(b.sessionHandle, rootShape('b'))]);
  for (const response of responses) assert.equal(response.status, 200);
  const [first, second] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(first, second); assert.deepEqual(first.head, old.head); assert.equal(first.generation, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_root_replacements').get().n, 1);
  const winner = sql.prepare('SELECT * FROM sync_root_replacements').all();
  assert.deepEqual((await (await request(a.sessionHandle, rootShape('retry'))).json()).bootstrap, first.bootstrap);
  assert.deepEqual(sql.prepare('SELECT * FROM sync_root_replacements').all(), winner);
  assert.deepEqual(sql.prepare('SELECT * FROM sync_operations').all(), receipts);
  const bootstrap = await f.syncApi('/sync/bootstrap', b.sessionHandle, {expectedGeneration:1,bootstrap:null}, true);
  assert.equal(bootstrap.status,200); assert.deepEqual((await bootstrap.json()).bootstrap, first.bootstrap);
  sql.prepare('UPDATE sync_bootstrap SET bootstrap_json=?').run(JSON.stringify({...first.bootstrap,stagingFolderId:'tampered_staging'}));
  assert.equal((await f.syncApi('/sync/bootstrap',b.sessionHandle,{expectedGeneration:1,bootstrap:null},true)).status,409,'matching new root alone does not authorize a different structure');
  sql.prepare('UPDATE sync_bootstrap SET bootstrap_json=?').run(JSON.stringify(first.bootstrap));
  assert.equal((await f.syncApi('/sync/commit', a.sessionHandle, candidate({expectedGeneration:1, operationId:'e'.repeat(32), rootFolderId:'root_old'}),true)).status,409);
  assert.deepEqual(await (await f.syncApi('/sync/commit', a.sessionHandle, oldInput,true)).json(),old,'old operation receipt remains recoverable');
  const next = await f.syncApi('/sync/commit', b.sessionHandle, candidate({expectedGeneration:1,operationId:'d'.repeat(32),rootFolderId:first.bootstrap.rootFolderId}),true);
  assert.equal(next.status,200); assert.equal((await next.json()).generation,2);
  assert.equal((await request(a.sessionHandle,rootShape('stale'))).status,409);
  assert.deepEqual(sql.prepare('SELECT * FROM sync_root_replacements').all(), winner);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_operations').get().n,2);
});

test('null-head recreation changes only the initial reservation and rejects arbitrary mismatch', async t => {
  const f=fixture(t), a=await f.native(), sql=f.env.DB.sqlite;
  await f.syncApi('/sync/bootstrap',a.sessionHandle,{expectedGeneration:0,bootstrap:rootShape('old')},true);
  const input={expectedGeneration:0,oldRootFolderId:'root_old',bootstrap:rootShape('new')};
  const response=await f.syncApi('/sync/recreate',a.sessionHandle,input,true); assert.equal(response.status,200);
  const value=await response.json(); assert.equal(value.head,null); assert.equal(value.generation,0);
  assert.deepEqual(value.bootstrap,rootShape('new'));
  assert.equal((await f.syncApi('/sync/recreate',a.sessionHandle,{...input,bootstrap:rootShape('retry')},true)).status,200);
  assert.equal((await f.syncApi('/sync/commit',a.sessionHandle,candidate({rootFolderId:'root_old'}),true)).status,409);
  assert.equal((await f.syncApi('/sync/commit',a.sessionHandle,candidate({rootFolderId:'root_new'}),true)).status,200);
  sql.prepare('UPDATE sync_bootstrap SET root_folder_id=?,bootstrap_json=?').run('root_foreign',JSON.stringify(rootShape('foreign')));
  assert.equal((await f.syncApi('/sync/bootstrap',a.sessionHandle,{expectedGeneration:1,bootstrap:null},true)).status,409);
});

test('recreate fails closed on disconnect/account/session/generation gaps and invalid input', async t => {
  const f=fixture(t), a=await f.native(), sql=f.env.DB.sqlite;
  await f.syncApi('/sync/bootstrap',a.sessionHandle,{expectedGeneration:0,bootstrap:rootShape('old')},true);
  const input={expectedGeneration:0,oldRootFolderId:'root_old',bootstrap:rootShape('new')};
  for(const bad of [{...input,extra:'no'},{...input,expectedGeneration:-1},{...input,expectedGeneration:1.2},
    {...input,expectedGeneration:Number.MAX_SAFE_INTEGER},{...input,oldRootFolderId:'bad/id'},
    {...input,bootstrap:null},{...input,bootstrap:{}},{...input,bootstrap:{...rootShape('new'),extra:'no'}},
    {...input,bootstrap:{...rootShape('new'),dataFolderId:'root_new'}},{...input,bootstrap:{...rootShape('new'),dataFolderId:'root_old'}}]) {
    assert.equal((await f.syncApi('/sync/recreate',a.sessionHandle,bad,true)).status,400);
  }
  assert.equal((await f.syncApi('/sync/recreate',a.sessionHandle,{...input,oldRootFolderId:'foreign'},true)).status,409);
  f.identify(()=>({user:{permissionId:'foreign-recreate-account'}})); const foreign=await f.native();
  assert.equal((await f.syncApi('/sync/recreate',foreign.sessionHandle,input,true)).status,409);
  const handleHash=createHash('sha256').update(a.sessionHandle).digest('base64url');
  const scenarios=[
    {change:()=>sql.prepare('UPDATE sessions SET generation=generation+1 WHERE handle_hash=?').run(handleHash),status:401,reset:()=>sql.prepare('UPDATE sessions SET generation=0 WHERE handle_hash=?').run(handleHash)},
    {change:()=>sql.prepare('UPDATE sessions SET account_key=? WHERE handle_hash=?').run('other',handleHash),status:401,reset:()=>sql.prepare('UPDATE sessions SET account_key=? WHERE handle_hash=?').run(a.accountKey,handleHash)},
    {change:()=>sql.prepare('INSERT INTO sync_heads VALUES (?,1,?,?)').run(a.accountKey,'injected',JSON.stringify({rootFolderId:'root_old',generation:1})),status:409,reset:()=>sql.prepare('DELETE FROM sync_heads WHERE account_key=?').run(a.accountKey)},
    {change:()=>sql.prepare('DELETE FROM sessions WHERE handle_hash=?').run(handleHash),status:401,reset:()=>{}}
  ];
  for(const scenario of scenarios){
    f.env.DB.beforeBatch=scenario.change;
    assert.equal((await f.syncApi('/sync/recreate',a.sessionHandle,input,true)).status,scenario.status);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_root_replacements').get().n,0);
    assert.equal(sql.prepare('SELECT root_folder_id FROM sync_bootstrap WHERE account_key=?').get(a.accountKey).root_folder_id,'root_old');
    scenario.reset();
  }
});

test('recreate transaction rolls back its receipt if canonical reservation write fails; explicit retry succeeds', async t => {
  const f=fixture(t), a=await f.native(), sql=f.env.DB.sqlite;
  await f.syncApi('/sync/bootstrap',a.sessionHandle,{expectedGeneration:0,bootstrap:rootShape('old')},true);
  const input={expectedGeneration:0,oldRootFolderId:'root_old',bootstrap:rootShape('new')};
  f.env.DB.beforeRun=()=>{f.env.DB.beforeRun=()=>{throw new Error('synthetic reservation failure');};};
  assert.equal((await f.syncApi('/sync/recreate',a.sessionHandle,input,true)).status,503);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_root_replacements').get().n,0);
  assert.equal(sql.prepare('SELECT root_folder_id FROM sync_bootstrap').get().root_folder_id,'root_old');
  const response=await f.syncApi('/sync/recreate',a.sessionHandle,input,true);
  assert.equal(response.status,200);assert.deepEqual((await response.json()).bootstrap,rootShape('new'));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_root_replacements').get().n,1);
});
test('public home and privacy disclose data boundaries without scripts, network or OAuth configuration', async () => {
  for (const path of ['/', '/privacy']) {
    const response = await worker.fetch(new Request(brokerOrigin + path), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(response.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.match(response.headers.get('Content-Security-Policy'), /form-action 'none'/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    const html = await response.text();
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /https:\/\/dkoles\.com\/zeteros\/index\.html/);
    assert.match(html, /mailto:zeter11@gmail\.com/);
    assert.doesNotMatch(html, /<(?:script|iframe|img|form|input|link|style)\b|\son\w+=/i);
    if (path === '/privacy') {
      for (const term of ['drive.file', 'AES-256-GCM', 'D1', '90', 'PKCE', 'DPAPI', 'https://myaccount.google.com/connections', 'удаления']) assert.ok(html.includes(term), term);
      assert.match(html, /не сохраняются на сервере/);
      assert.match(html, /историю принятых операций/);
    }
    for (const options of [{ method: 'POST' }, { method: 'GET', query: '?code=sensitive' }]) {
      const denied = await worker.fetch(new Request(brokerOrigin + path + (options.query || ''), { method: options.method }), {});
      assert.notEqual(denied.status, 200);
      assert.ok(!(await denied.text()).includes('sensitive'));
    }
  }
  assert.equal((await worker.fetch(new Request(brokerOrigin + '/token', { method: 'POST' }), {})).status, 503);
});

test('bootstrap reserves one account winner before Drive writes; read/retry/generation/isolation stay strict', async t => {
  const f = fixture(t), a = await f.native(), b = await f.native();
  const shape = suffix => ({ rootFolderId: 'root_' + suffix, dataFolderId: 'data_' + suffix, historyFolderId: 'history_' + suffix, stagingFolderId: 'staging_' + suffix });
  const reserve = (handle, bootstrap, expectedGeneration = 0) => f.syncApi('/sync/bootstrap', handle, { expectedGeneration, bootstrap }, true);
  assert.deepEqual((await (await reserve(a.sessionHandle, null)).json()).bootstrap, null);
  const responses = await Promise.all([reserve(a.sessionHandle, shape('a')), reserve(b.sessionHandle, shape('b'))]);
  for (const response of responses) assert.equal(response.status, 200);
  const [first, second] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(first.bootstrap, second.bootstrap);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_bootstrap').get().n, 1);
  assert.deepEqual((await (await reserve(a.sessionHandle, null)).json()).bootstrap, first.bootstrap, 'lost response reload reads reservation without new proposal');
  assert.equal((await f.syncApi('/sync/commit', a.sessionHandle, candidate({rootFolderId: 'unreserved_root'}), true)).status, 409);
  assert.equal((await f.syncApi('/sync/commit', a.sessionHandle, candidate({rootFolderId: first.bootstrap.rootFolderId}), true)).status, 200);
  assert.equal((await reserve(b.sessionHandle, shape('late'))).status, 409);
  assert.deepEqual((await (await reserve(a.sessionHandle, null, 1)).json()).bootstrap, first.bootstrap);
  for (const value of [undefined, [], 'bad', {}, {...shape('x'),extra:'x'}, {...shape('x'),dataFolderId:'root_x'}]) {
    const response = await f.syncApi('/sync/bootstrap', a.sessionHandle, {expectedGeneration:1,bootstrap:value}, true);
    assert.equal(response.status,400);
  }
  f.identify(() => ({user:{permissionId:'different-bootstrap-account'}}));const other=await f.native();
  assert.equal((await reserve(other.sessionHandle, shape('other'))).status,200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_bootstrap').get().n,2);
});

test('bootstrap never replaces accepted legacy head; disconnect and generation change in insert gap reject', async t => {
  const f=fixture(t), own=await f.native(), sql=f.env.DB.sqlite;
  assert.equal((await f.syncApi('/sync/commit',own.sessionHandle,candidate(),true)).status,200);
  const input={expectedGeneration:1,bootstrap:{rootFolderId:'foreign_root',dataFolderId:'data',historyFolderId:'history',stagingFolderId:'staging'}};
  assert.equal((await f.syncApi('/sync/bootstrap',own.sessionHandle,input,true)).status,409);
  const current=(await (await f.syncApi('/sync/head',own.sessionHandle,undefined,true)).json()).head;
  input.bootstrap.rootFolderId=current.rootFolderId;
  f.env.DB.beforeRun=()=>sql.prepare('UPDATE sync_heads SET generation=2 WHERE account_key=?').run(own.accountKey);
  assert.equal((await f.syncApi('/sync/bootstrap',own.sessionHandle,input,true)).status,409);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_bootstrap').get().n,0);
  sql.prepare('UPDATE sync_heads SET generation=1 WHERE account_key=?').run(own.accountKey);
  f.env.DB.beforeRun=()=>sql.prepare('DELETE FROM sessions').run();
  assert.equal((await f.syncApi('/sync/bootstrap',own.sessionHandle,input,true)).status,401);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_bootstrap').get().n,0);
});

test('directory reservation chooses one winner across devices and generations; rejects stale/root/parent/account drift',async t=>{
  const f=fixture(t),a=await f.native(),b=await f.native(),sql=f.env.DB.sqlite;
  const headInput=candidate();assert.equal((await f.syncApi('/sync/commit',a.sessionHandle,headInput,true)).status,200);
  const value={expectedGeneration:1,rootFolderId:headInput.rootFolderId,parentId:'data_folder',name:'Папка',pathKey:'a'.repeat(64),operationId:'b'.repeat(32),id:null};
  const reserve=(handle,input)=>f.syncApi('/sync/directory',handle,input,true);
  assert.equal((await (await reserve(a.sessionHandle,value)).json()).id,null);
  const responses=await Promise.all([reserve(a.sessionHandle,{...value,id:'directory_a'}),reserve(b.sessionHandle,{...value,id:'directory_b'})]);
  for(const response of responses)assert.equal(response.status,200);
  const results=await Promise.all(responses.map(response=>response.json()));assert.equal(results[0].id,results[1].id);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM directory_reservations').get().n,1);
  assert.equal((await reserve(a.sessionHandle,{...value,parentId:'wrong_parent'})).status,409);
  assert.equal((await reserve(a.sessionHandle,{...value,rootFolderId:'wrong_root'})).status,409);
  assert.equal((await reserve(a.sessionHandle,{...value,expectedGeneration:0})).status,409);
  assert.equal((await f.syncApi('/sync/commit',a.sessionHandle,candidate({expectedGeneration:1,operationId:'c'.repeat(32)}),true)).status,200);
  assert.equal((await (await reserve(a.sessionHandle,{...value,expectedGeneration:2})).json()).id,results[0].id);
  f.identify(()=>({user:{permissionId:'other-directory-account'}}));const other=await f.native();
  assert.equal((await reserve(other.sessionHandle,{...value,id:'other_file'})).status,409);
  assert.equal((await f.syncApi('/sync/commit',other.sessionHandle,headInput,true)).status,200);
  assert.equal((await (await reserve(other.sessionHandle,{...value,id:'other_file'})).json()).id,'other_file');
  const bad=[{...value,pathKey:'bad'},{...value,expectedGeneration:true},{...value,name:'../bad'},{...value,id:[]},{...value,accountKey:a.accountKey}];
  for(const input of bad)assert.equal((await reserve(a.sessionHandle,input)).status,400);
  f.env.DB.beforeRun=()=>sql.prepare('DELETE FROM sessions WHERE account_key=?').run(a.accountKey);
  assert.equal((await reserve(a.sessionHandle,{...value,expectedGeneration:2,pathKey:'d'.repeat(64),id:'never_created'})).status,401);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM directory_reservations').get().n,2);
});
function fixture(t) {
  const env = { DB: new MemoryD1(), ALLOWED_ORIGINS: appOrigin, PUBLIC_URL: brokerOrigin,
    DESKTOP_CLIENT_ID: '596333951366-plnunnogqvpcsc89th5v2chhd0qv8hv7.apps.googleusercontent.com',
    DESKTOP_CLIENT_SECRET: 'synthetic-desktop-secret',
    GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64url') };
  const original = globalThis.fetch;
  const calls = [];
  let identity = () => Response.json({ user: { permissionId: 'same-drive-permission-id' } });
  let tokenMetadata = () => Response.json({ aud: env.DESKTOP_CLIENT_ID, azp: env.DESKTOP_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.file', expires_in: '3600', exp: String(Math.floor(Date.now() / 1000) + 3600) });
  let responder = () => ({ access_token: 'synthetic-access', expires_in: 3600, refresh_token: 'synthetic-refresh', token_type: 'Bearer' });
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url === 'https://oauth2.googleapis.com/tokeninfo') {
      assert.equal(options.method, 'POST'); assert.equal(options.body, undefined);
      assert.ok(options.signal instanceof AbortSignal); assert.match(options.headers.Authorization, /^Bearer /);
      return await tokenMetadata(options.headers.Authorization.slice(7));
    }
    if (url === 'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)') {
      assert.equal(options.method, 'GET'); assert.match(options.headers.Authorization, /^Bearer /);
      assert.ok(options.signal instanceof AbortSignal);
      return await identity(options.headers.Authorization.slice(7));
    }
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.method, 'POST'); assert.ok(options.signal instanceof AbortSignal);
    const form = Object.fromEntries(options.body); calls.push(form);
    const result = await responder(form, options);
    return result instanceof Response ? result : Response.json(result);
  };
  t.after(() => { globalThis.fetch = original; env.DB.sqlite.close(); });
  const request = (path, options = {}) => worker.fetch(new Request(brokerOrigin + path, options), env);
  const start = (origin = appOrigin, value = nonce) => request('/oauth/start?' + new URLSearchParams({ origin, nonce: value }), { headers: { 'CF-Connecting-IP': '192.0.2.1' } });
  const api = (path, handle, extra = {}) => request(path, { method: 'POST', headers: { Origin: appOrigin, Authorization: 'Bearer ' + handle, 'Content-Type': 'application/json', ...extra }, body: '{}' });
  const callback = state => request('/oauth/callback?' + new URLSearchParams({ state, code: 'synthetic-code' }));
  const connect = async () => {
    const redirect = await start(); assert.equal(redirect.status, 302);
    const auth = new URL(redirect.headers.get('Location'));
    const result = await callback(auth.searchParams.get('state')); assert.equal(result.status, 200);
    const html = await result.text(); const match = html.match(/"sessionHandle":"([A-Za-z0-9_-]{43})"/);
    assert.ok(match); return { handle: match[1], html, auth, result };
  };
  const native = async (accessToken = 'native-ephemeral-token') => {
    const response = await request('/native/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken }) });
    assert.equal(response.status, 200); return await response.json();
  };
  const nativeToken = (input, extra = {}) => request('/native/token', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.2', ...extra }, body: JSON.stringify(input) });
  const syncApi = (path, handle, input, native = false) => request(path, { method: input === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + handle, ...(native ? {} : { Origin: appOrigin }), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  return { env, calls, request, start, api, callback, connect, native, nativeToken, syncApi, respond(fn) { responder = fn; },
    metadata(fn) { tokenMetadata = async token => { const value = await fn(token); return value instanceof Response ? value : Response.json(value); }; },
    identify(fn) { identity = async token => { const value = await fn(token); return value instanceof Response ? value : Response.json(value); }; } };
}

const desktopGrant = () => ({ grant_type: 'authorization_code', code: 'native-code', code_verifier: 'a'.repeat(43), redirect_uri: 'http://127.0.0.1:49152/oauth2callback' });
const desktopRefresh = () => ({ grant_type: 'refresh_token', refresh_token: 'native-refresh' });
test('native code and refresh exchange fixed Desktop credentials without persisting or exposing extra upstream fields', async t => {
  const f = fixture(t);
  f.respond(() => ({ access_token: 'native-access', refresh_token: 'native-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/drive.file', id_token: 'must-not-return' }));
  let response = await f.nativeToken(desktopGrant());
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.deepEqual(await response.json(), { access_token: 'native-access', refresh_token: 'native-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/drive.file' });
  assert.deepEqual(f.calls[0], { ...desktopGrant(), client_id: f.env.DESKTOP_CLIENT_ID, client_secret: 'synthetic-desktop-secret' });
  f.respond(() => ({ access_token: 'renewed-access', expires_in: 3600 }));
  response = await f.nativeToken({ ...desktopRefresh(), refresh_token: 'a'.repeat(8192) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access_token: 'renewed-access', expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/drive.file' });
  assert.equal(f.calls[1].refresh_token.length, 8192);
  for (const table of ['sessions', 'oauth_pending', 'sync_heads', 'sync_operations']) assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM start_limits').get().n, 1);
  const dump = JSON.stringify(f.env.DB.sqlite.prepare('SELECT * FROM start_limits').all());
  for (const value of ['native-code', 'native-refresh', 'synthetic-desktop-secret', '192.0.2.2']) assert.ok(!dump.includes(value));
});

test('native token input forbids Origin, query, method, credential overrides, invalid loopback and PKCE before Google', async t => {
  const f = fixture(t);
  for (const input of [{ ...desktopGrant(), client_id: 'attacker' }, { ...desktopGrant(), client_secret: 'attacker' },
    { ...desktopRefresh(), code: 'extra' }, { grant_type: 'other' }, { ...desktopRefresh(), refresh_token: '' },
    { ...desktopRefresh(), refresh_token: 'a'.repeat(8193) }, { ...desktopRefresh(), refresh_token: 'bad\nvalue' }]) {
    assert.equal((await f.nativeToken(input)).status, 400);
  }
  for (const redirect_uri of ['http://localhost:123/oauth2callback', 'http://127.0.0.1/oauth2callback', 'https://127.0.0.1:123/oauth2callback',
    'http://127.0.0.1:0/oauth2callback', 'http://127.0.0.1:65536/oauth2callback', 'http://127.0.0.1:123/oauth2callback?x=1',
    'http://127.0.0.1:123/other', 'http://127.0.0.1:0123/oauth2callback', 'http://evil@127.0.0.1:123/oauth2callback']) assert.equal((await f.nativeToken({ ...desktopGrant(), redirect_uri })).status, 400);
  for (const code_verifier of ['a'.repeat(42), 'a'.repeat(129), 'a'.repeat(42) + '=']) assert.equal((await f.nativeToken({ ...desktopGrant(), code_verifier })).status, 400);
  for (const Origin of [appOrigin, 'null']) assert.equal((await f.nativeToken(desktopGrant(), { Origin })).status, 403);
  assert.equal((await f.nativeToken(desktopGrant(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('/native/token?code=secret', { method: 'POST' })).status, 400);
  assert.equal((await f.request('/native/token')).status, 405);
  assert.equal((await f.request('/native/token', { method: 'OPTIONS', headers: { Origin: appOrigin } })).status, 403);
  assert.equal((await f.nativeToken({ ...desktopRefresh(), refresh_token: 'a'.repeat(17000) })).status, 413);
  delete f.env.DESKTOP_CLIENT_SECRET;
  assert.equal((await f.nativeToken(desktopGrant())).status, 503);
  assert.equal(f.calls.length, 0);
});

test('native token output rejects invalid scope, expiry, malformed or missing tokens; rate runs before Google', async t => {
  const f = fixture(t);
  const valid = { access_token: 'native-access', refresh_token: 'native-refresh', expires_in: 3600, token_type: 'Bearer' };
  const responses = [{ ...valid, scope: 'openid' }, { ...valid, scope: 'https://www.googleapis.com/auth/drive.file openid' },
    { ...valid, expires_in: 0 }, { ...valid, expires_in: '3600' }, { ...valid, expires_in: 86401 },
    { ...valid, token_type: 'MAC' }, { ...valid, access_token: 'a'.repeat(8193) }, { ...valid, refresh_token: '' },
    { access_token: 'access', expires_in: 3600 }, { ...valid, access_token: [] }];
  for (const value of responses) { f.respond(() => value); const r = await f.nativeToken(desktopGrant()); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'google_response_invalid' }); }
  assert.equal(f.calls.length, 10);
  assert.equal((await f.nativeToken(desktopGrant())).status, 429);
  assert.equal(f.calls.length, 10);
});

test('only confirmed Google invalid_grant signals reconnect; upstream failures stay opaque and retryable', async t => {
  const f = fixture(t);
  for (const [status, body, expected] of [[400, { error: 'invalid_grant', error_description: 'private' }, 401],
    [401, { error: 'invalid_client' }, 503], [429, { error: 'rate_limited' }, 502], [503, { error: 'invalid_grant' }, 502]]) {
    f.respond(() => Response.json(body, { status }));
    const r = await f.nativeToken(desktopRefresh()); assert.equal(r.status, expected);
    assert.deepEqual(await r.json(), { error: expected === 401 ? 'reconnect_required' : expected === 503 ? 'google_client_configuration' : 'google_unavailable' });
  }
  for (const response of [new Response('not-json'), new Response('a'.repeat(32769))]) {
    f.respond(() => response); const r = await f.nativeToken(desktopRefresh()); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'google_response_invalid' });
  }
  f.respond(() => { throw new Error('private-code private-refresh private-secret'); });
  assert.deepEqual(await (await f.nativeToken(desktopRefresh())).json(), { error: 'google_unavailable' });
  f.respond(() => ({ access_token: 'recovered', expires_in: 3600 }));
  assert.equal((await f.nativeToken(desktopRefresh())).status, 200);
});

test('native Google diagnostics expose fixed stages without upstream private details', async t => {
  const f = fixture(t);
  for (const error of ['invalid_client', 'unauthorized_client', 'invalid_request']) {
    f.respond(() => Response.json({ error, error_description: 'private-code private-refresh private-secret' }, { status: 400 }));
    const response = await f.nativeToken(desktopGrant());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'google_client_configuration' });
  }
  for (const body of [null, [], { access_token: 'private-access', expires_in: 'bad' }, { access_token: 'private-access', expires_in: 3600, token_type: {} }]) {
    f.respond(() => Response.json(body));
    const response = await f.nativeToken(desktopGrant());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'google_response_invalid' });
  }
});

test('Workers-compatible manual redirects reject without forwarding Google credentials', async t => {
  const f = fixture(t);
  const redirect = () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/token' } });
  f.respond(redirect);
  const token = await f.nativeToken(desktopRefresh());
  assert.equal(token.status, 502); assert.equal(token.headers.get('Location'), null);
  assert.deepEqual(await token.json(), { error: 'google_unavailable' });
  assert.equal(f.calls.length, 1);
  f.metadata(redirect);
  const session = () => f.request('/native/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: 'synthetic-access' }) });
  assert.equal((await session()).status, 502);
  f.metadata(() => ({ aud: f.env.DESKTOP_CLIENT_ID, azp: f.env.DESKTOP_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file', expires_in: '3600', exp: String(Math.floor(Date.now() / 1000) + 3600) }));
  f.identify(redirect);
  assert.equal((await session()).status, 502);
  assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
});

test('native token deadline aborts upstream and returns no secrets; malformed token_type rejects', async t => {
  const f = fixture(t);
  const originalTimer = globalThis.setTimeout;
  let deadline;
  globalThis.setTimeout = (fn, ms) => { deadline = ms; return originalTimer(fn, 0); };
  try {
    f.respond((form, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('private-timeout')), { once: true });
    }));
    const response = await f.nativeToken(desktopRefresh());
    assert.equal(deadline, 10000); assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'google_unavailable' });
  } finally { globalThis.setTimeout = originalTimer; }
  f.respond(() => ({ access_token: 'access', expires_in: 3600, token_type: 0 }));
  assert.equal((await f.nativeToken(desktopRefresh())).status, 502);
});

test('offline PKCE connection stores ciphertext/hash only; callback security and refresh retention', async t => {
  const f = fixture(t); const c = await f.connect();
  assert.equal(c.auth.origin + c.auth.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({ access_type: 'offline', prompt: 'consent', code_challenge_method: 'S256', scope: 'https://www.googleapis.com/auth/drive.file', redirect_uri: brokerOrigin + '/oauth/callback' })) assert.equal(c.auth.searchParams.get(key), value);
  assert.equal(c.auth.searchParams.get('code_challenge'), digest(f.calls[0].code_verifier));
  assert.match(c.html, /history\.replaceState/); assert.ok(c.html.indexOf('history.replaceState') < c.html.indexOf('postMessage'));
  assert.match(c.result.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(c.result.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(c.result.headers.get('Cache-Control'), 'no-store');
  assert.ok(c.html.includes('"nonce":"' + nonce + '"')); assert.ok(c.html.includes(',' + JSON.stringify(appOrigin) + ')'));
  const row = { ...f.env.DB.sqlite.prepare('SELECT * FROM sessions').get() };
  assert.equal(row.handle_hash, digest(c.handle)); assert.match(row.refresh_cipher, /^v1\./);
  const serialized = JSON.stringify(row) + c.html;
  for (const secret of ['synthetic-refresh', 'synthetic-access', 'synthetic-secret', f.calls[0].code_verifier]) assert.ok(!serialized.includes(secret));
  f.respond(() => ({ access_token: 'next-access', expires_in: 3600 }));
  const first = await f.api('/token', c.handle); assert.equal(first.status, 200);
  const token = await first.json(); assert.equal(token.accessToken, 'next-access'); assert.ok(token.expiresAt > Date.now());
  assert.equal(f.env.DB.sqlite.prepare('SELECT refresh_cipher FROM sessions').get().refresh_cipher, row.refresh_cipher);
  assert.equal((await f.api('/token', c.handle)).status, 200);
  assert.equal(f.calls[2].refresh_token, 'synthetic-refresh');
  assert.equal(f.env.DB.sqlite.prepare('SELECT expires_at FROM sessions').get().expires_at, row.expires_at);
});

test('invalid, expired and replayed state never exchange a code; failed consent consumes state', async t => {
  const f = fixture(t);
  assert.equal((await f.callback('invalid')).status, 400);
  assert.equal((await f.callback(randomBytes(32).toString('base64url'))).status, 400);
  let r = await f.start(); let state = new URL(r.headers.get('Location')).searchParams.get('state');
  f.env.DB.sqlite.exec('UPDATE oauth_pending SET expires_at = 1');
  assert.equal((await f.callback(state)).status, 400); assert.equal(f.calls.length, 0);
  r = await f.start(); state = new URL(r.headers.get('Location')).searchParams.get('state');
  assert.equal((await f.request('/oauth/callback?' + new URLSearchParams({ state, error: 'access_denied' }))).status, 400);
  assert.equal((await f.callback(state)).status, 400); assert.equal(f.calls.length, 0);
  const c = await f.connect(); const count = f.calls.length;
  assert.equal((await f.callback(c.auth.searchParams.get('state'))).status, 400); assert.equal(f.calls.length, count);
});

test('origin and nonce injection, strict CORS/method/body boundaries', async t => {
  const f = fixture(t);
  for (const origin of ['null', '*', appOrigin + '.evil.example', appOrigin + '/path', 'http://dkoles.com']) assert.equal((await f.start(origin)).status, 400);
  for (const value of ['<script>alert(1)</script>', nonce + 'x', '', 'a'.repeat(42)]) assert.equal((await f.start(appOrigin, value)).status, 400);
  assert.equal((await f.request('/token', { method: 'GET', headers: { Origin: appOrigin } })).status, 405);
  assert.equal((await f.api('/token', nonce, { Origin: 'null' })).status, 403);
  let r = await f.request('/token', { method: 'OPTIONS', headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Origin'), appOrigin); assert.equal(r.headers.get('Access-Control-Allow-Credentials'), null);
  r = await f.request('/token', { method: 'OPTIONS', headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-injected' } }); assert.equal(r.status, 403);
  r = await f.request('/token', { method: 'POST', headers: { Origin: appOrigin, Authorization: 'Bearer ' + nonce, 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) }); assert.equal(r.status, 413);
  assert.equal((await f.api('/token?secret=value', nonce)).status, 400);
  assert.equal((await f.request('/unowned')).status, 404);
});

test('missing initial refresh fails closed without creating a session; upstream errors are opaque', async t => {
  const f = fixture(t);
  f.respond(() => ({ access_token: 'sensitive-access', expires_in: 3600 }));
  const start = await f.start(); const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const result = await f.callback(state); assert.equal(result.status, 401);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal(await result.text(), '{"error":"reconnect_required"}');
  f.respond(() => { throw new Error('synthetic-secret synthetic-code sensitive-access'); });
  const retry = await f.start(); const failure = await f.callback(new URL(retry.headers.get('Location')).searchParams.get('state'));
  assert.equal(failure.status, 502); assert.equal(await failure.text(), '{"error":"google_unavailable"}');
});

test('disconnect while refresh waits cannot resurrect or expose an access token; retry remains disconnected', async t => {
  const f = fixture(t); const c = await f.connect();
  let release; let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  f.respond(() => new Promise(resolve => { release = resolve; entered(); }));
  const refreshing = f.api('/token', c.handle); await ready;
  assert.equal((await f.api('/disconnect', c.handle)).status, 200);
  release({ access_token: 'late-access', expires_in: 3600, refresh_token: 'rotated-refresh' });
  const late = await refreshing; assert.equal(late.status, 409); assert.equal(await late.text(), '{"error":"session_changed"}');
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal((await f.api('/token', c.handle)).status, 401);
  assert.equal((await f.api('/disconnect', c.handle)).status, 200);
  assert.equal(f.calls.length, 2); // No revoke request, no retry exchange.
});

test('concurrent refresh CAS rejects stale completion and preserves the winning refresh token', async t => {
  const f = fixture(t); const c = await f.connect();
  const releases = []; const waits = [];
  f.respond(() => new Promise(resolve => { releases.push(resolve); waits.splice(0).forEach(w => w()); }));
  const waitFor = async count => { while (releases.length < count) await new Promise(resolve => waits.push(resolve)); };
  const first = f.api('/token', c.handle); await waitFor(1);
  const second = f.api('/token', c.handle); await waitFor(2);
  releases[1]({ access_token: 'winner', expires_in: 3600, refresh_token: 'winner-refresh' });
  assert.equal((await second).status, 200);
  releases[0]({ access_token: 'loser', expires_in: 3600, refresh_token: 'loser-refresh' });
  assert.equal((await first).status, 409);
  f.respond(form => { assert.equal(form.refresh_token, 'winner-refresh'); return { access_token: 'verified', expires_in: 3600 }; });
  assert.equal((await f.api('/token', c.handle)).status, 200);
});

test('expired sessions reject refresh; AAD prevents ciphertext moving to another handle', async t => {
  const f = fixture(t); const a = await f.connect(); const b = await f.connect();
  const sql = f.env.DB.sqlite;
  const original = sql.prepare('SELECT refresh_cipher FROM sessions WHERE handle_hash = ?').get(digest(a.handle));
  sql.prepare('UPDATE sessions SET refresh_cipher = ? WHERE handle_hash = ?').run(original.refresh_cipher, digest(b.handle));
  assert.equal((await f.api('/token', b.handle)).status, 503);
  sql.prepare('UPDATE sessions SET expires_at = 1 WHERE handle_hash = ?').run(digest(a.handle));
  const count = f.calls.length; assert.equal((await f.api('/token', a.handle)).status, 401); assert.equal(f.calls.length, count);
});

test('rate limit and global pending cap are atomic SQL conditions; health has no secrets', async t => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.start()).status, 302);
  assert.equal((await f.start()).status, 429);
  const serialized = JSON.stringify(f.env.DB.sqlite.prepare('SELECT * FROM start_limits').all()); assert.ok(!serialized.includes('192.0.2.1'));
  f.env.DB.sqlite.exec('DELETE FROM start_limits');
  const insert = f.env.DB.sqlite.prepare('INSERT INTO oauth_pending VALUES (?, ?, ?, ?, ?)');
  for (let i = 10; i < 500; i++) insert.run('cap-' + i, appOrigin, nonce, 'synthetic', Date.now() + 600000);
  assert.equal((await f.start()).status, 429);
  const health = await f.request('/health'); assert.equal(await health.text(), '{"ok":true}');
  const source = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8'); assert.doesNotMatch(source, /console\.(log|warn|error|debug)/);
});

const candidate = (overrides = {}) => ({ expectedGeneration: 0, operationId: 'a'.repeat(32), rootFolderId: 'root-folder-1',
  candidate: { snapshotId: 'b'.repeat(32), manifestFileId: 'manifest-file-1', manifestSha256: 'c'.repeat(64), contentHash: 'd'.repeat(64) }, ...overrides });

test('native identity comes from Drive, never stores its token, and shares the web account pointer', async t => {
  const f = fixture(t); const web = await f.connect(); let seen;
  f.identify(token => { seen = token; return { user: { permissionId: 'same-drive-permission-id' } }; });
  const native = await f.native(); assert.equal(seen, 'native-ephemeral-token');
  const expectedAccount = createHash('sha256').update('zeter-drive-user-v1:same-drive-permission-id').digest('hex');
  assert.equal(native.accountKey, expectedAccount); assert.ok(native.expiresAt > Date.now());
  const rows = f.env.DB.sqlite.prepare('SELECT * FROM sessions').all();
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.account_key === expectedAccount));
  const nativeRow = rows.find(row => row.kind === 'native'); assert.equal(nativeRow.refresh_cipher, null); assert.equal(nativeRow.origin, '');
  assert.ok(!JSON.stringify(rows).includes('native-ephemeral-token'));
  const empty = await f.syncApi('/sync/head', native.sessionHandle, undefined, true); assert.deepEqual(await empty.json(), { accountKey: expectedAccount, head: null, generation: 0 });
  const commit = await f.syncApi('/sync/commit', web.handle, candidate()); assert.equal(commit.status, 200); const accepted = await commit.json();
  assert.equal(accepted.head.generation, 1); assert.equal(accepted.head.parentGeneration, 0); assert.ok(accepted.head.committedAt > 0);
  const viaNative = await f.syncApi('/sync/head', native.sessionHandle, undefined, true); assert.deepEqual(await viaNative.json(), accepted);
  assert.equal((await f.syncApi('/token', native.sessionHandle, {}, true)).status, 401);
  assert.equal((await f.syncApi('/sync/head', native.sessionHandle)).status, 401);
  assert.equal((await f.syncApi('/sync/head', web.handle, undefined, true)).status, 401);
});

test('native endpoint rejects browser Origin and unverified/malformed identity without sessions', async t => {
  const f = fixture(t);
  for (const origin of [appOrigin, 'null', '']) {
    const r = await f.request('/native/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"accessToken":"ephemeral"}' }); assert.equal(r.status, 403);
  }
  f.identify(() => Response.json({ error: { message: 'sensitive-upstream-message' } }, { status: 401 }));
  let result = await f.request('/native/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"accessToken":"ephemeral"}' });
  assert.equal(result.status, 401); assert.equal(await result.text(), '{"error":"reconnect_required"}');
  f.identify(() => ({ user: { permissionId: '' } }));
  result = await f.request('/native/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"accessToken":"ephemeral"}' }); assert.equal(result.status, 502);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('native refuses token substitution from another OAuth client despite the same Drive identity', async t => {
  const f = fixture(t);
  let aboutCalls = 0;
  f.identify(() => { aboutCalls++; return { user: { permissionId: 'same-drive-permission-id' } }; });
  const valid = () => ({ aud: f.env.DESKTOP_CLIENT_ID, azp: f.env.DESKTOP_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.file', expires_in: 3600, exp: Math.floor(Date.now() / 1000) + 3600 });
  const foreign = '123456789-otherclient.apps.googleusercontent.com';
  const invalid = [
    { ...valid(), aud: foreign, azp: foreign }, // Same user, different OAuth application.
    { ...valid(), azp: foreign }, // Correct audience alone does not authorize presenter.
    { ...valid(), aud: foreign },
    { ...valid(), aud: undefined }, { ...valid(), azp: undefined },
    { ...valid(), scope: 'https://www.googleapis.com/auth/drive.readonly' },
    { ...valid(), scope: 'https://www.googleapis.com/auth/drive.file.extra' },
    { ...valid(), scope: undefined },
    { ...valid(), expires_in: 0 }, { ...valid(), expires_in: -1 }, { ...valid(), expires_in: '3600junk' },
    { ...valid(), exp: Math.floor(Date.now() / 1000) - 1 }, { ...valid(), exp: undefined }
  ];
  for (const metadata of invalid) {
    f.metadata(() => metadata);
    const result = await f.request('/native/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"accessToken":"substituted-sensitive-token"}' });
    assert.equal(result.status, 401); assert.equal(await result.text(), '{"error":"reconnect_required"}');
  }
  assert.equal(aboutCalls, 0); assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  f.metadata(token => { assert.equal(token, 'native-ephemeral-token'); return valid(); });
  const native = await f.native(); assert.equal(aboutCalls, 1);
  assert.equal(native.accountKey, createHash('sha256').update('zeter-drive-user-v1:same-drive-permission-id').digest('hex'));
});

test('native token metadata failures remain bounded and opaque, without creating sessions', async t => {
  const f = fixture(t); let aboutCalls = 0;
  f.identify(() => { aboutCalls++; return { user: { permissionId: 'same-drive-permission-id' } }; });
  const request = () => f.request('/native/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"accessToken":"sensitive-token"}' });
  f.metadata(() => new Response('sensitive-token upstream-error', { status: 400 }));
  let result = await request(); assert.equal(result.status, 401); assert.equal(await result.text(), '{"error":"reconnect_required"}');
  f.metadata(() => new Response('sensitive-token'.repeat(1000)));
  result = await request(); assert.equal(result.status, 502); assert.equal(await result.text(), '{"error":"google_unavailable"}');
  f.metadata(() => { throw new Error('sensitive-token network-error'); });
  result = await request(); assert.equal(result.status, 502); assert.equal(await result.text(), '{"error":"google_unavailable"}');
  delete f.env.DESKTOP_CLIENT_ID;
  result = await request(); assert.equal(result.status, 503); assert.equal(await result.text(), '{"error":"not_configured"}');
  assert.equal(aboutCalls, 0); assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('CAS loser gets canonical head; response-loss retries remain idempotent after later commits', async t => {
  const f = fixture(t); const a = await f.native(); const b = await f.native();
  const input = candidate();
  let response = await f.syncApi('/sync/commit', a.sessionHandle, input, true); assert.equal(response.status, 200); const first = await response.json();
  const loserInput = candidate({ operationId: '1'.repeat(32) });
  response = await f.syncApi('/sync/commit', b.sessionHandle, loserInput, true); assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'sync-conflict', head: first.head, generation: 1 });
  const nextInput = candidate({ expectedGeneration: 1, operationId: '2'.repeat(32) });
  response = await f.syncApi('/sync/commit', b.sessionHandle, nextInput, true); assert.equal(response.status, 200); const second = await response.json(); assert.equal(second.generation, 2);
  response = await f.syncApi('/sync/commit', a.sessionHandle, input, true); assert.equal(response.status, 200); assert.deepEqual(await response.json(), first);
  response = await f.syncApi('/sync/commit', a.sessionHandle, { ...input, rootFolderId: 'different-folder' }, true); assert.equal(response.status, 409);
  const head = await f.syncApi('/sync/head', a.sessionHandle, undefined, true); assert.deepEqual(await head.json(), second);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_operations').get().n, 2);
});

test('foreign accounts cannot read, replace or select another account head', async t => {
  const f = fixture(t); const own = await f.native();
  assert.equal((await f.syncApi('/sync/commit', own.sessionHandle, candidate(), true)).status, 200);
  f.identify(() => ({ user: { permissionId: 'foreign-drive-id' } })); const foreign = await f.native(); assert.notEqual(own.accountKey, foreign.accountKey);
  let response = await f.syncApi('/sync/head', foreign.sessionHandle, undefined, true); assert.deepEqual(await response.json(), { accountKey: foreign.accountKey, head: null, generation: 0 });
  response = await f.syncApi('/sync/commit', foreign.sessionHandle, { ...candidate(), accountKey: own.accountKey }, true); assert.equal(response.status, 400);
  response = await f.syncApi('/sync/commit', foreign.sessionHandle, candidate({ expectedGeneration: 1 }), true); assert.equal(response.status, 409);
  assert.equal((await f.syncApi('/sync/commit', foreign.sessionHandle, candidate(), true)).status, 200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_heads').get().n, 2);
});

test('expired/disconnected sessions cannot read/commit; disconnect in the CAS gap cannot publish', async t => {
  const f = fixture(t); const native = await f.native(); const sql = f.env.DB.sqlite;
  // The hook runs after identity/prechecks, immediately before the atomic SQL transaction.
  f.env.DB.beforeBatch = () => sql.prepare('DELETE FROM sessions WHERE handle_hash = ?').run(digest(native.sessionHandle));
  let response = await f.syncApi('/sync/commit', native.sessionHandle, candidate(), true); assert.equal(response.status, 401);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_heads').get().n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_operations').get().n, 0);
  assert.equal((await f.syncApi('/sync/head', native.sessionHandle, undefined, true)).status, 401);
  const next = await f.native(); assert.equal((await f.syncApi('/sync/commit', next.sessionHandle, candidate(), true)).status, 200);
  sql.prepare('UPDATE sessions SET expires_at = 1 WHERE handle_hash = ?').run(digest(next.sessionHandle));
  assert.equal((await f.syncApi('/sync/head', next.sessionHandle, undefined, true)).status, 401);
  assert.equal((await f.syncApi('/sync/commit', next.sessionHandle, candidate({ expectedGeneration: 1, operationId: 'e'.repeat(32) }), true)).status, 401);
  const connected = await f.native(); assert.equal((await f.syncApi('/disconnect', connected.sessionHandle, {}, true)).status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sync_heads').get().n, 1);
  const reconnected = await f.native(); response = await f.syncApi('/sync/head', reconnected.sessionHandle, undefined, true); assert.equal((await response.json()).generation, 1);
});

test('invalid sync generations/ids/hashes/body and cross-origin requests reject without mutation', async t => {
  const f = fixture(t); const native = await f.native();
  const cases = [candidate({ expectedGeneration: -1 }), candidate({ expectedGeneration: 0.5 }), candidate({ expectedGeneration: Number.MAX_SAFE_INTEGER }), candidate({ operationId: 'bad' }), candidate({ rootFolderId: 'https://evil.example' }),
    candidate({ candidate: { ...candidate().candidate, contentHash: 'X'.repeat(64) } }), candidate({ candidate: { ...candidate().candidate, snapshotId: '<script>' } }), candidate({ candidate: { ...candidate().candidate, extra: 1 } })];
  for (const input of cases) assert.equal((await f.syncApi('/sync/commit', native.sessionHandle, input, true)).status, 400);
  const preflight = await f.request('/sync/head', { method: 'OPTIONS', headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } }); assert.equal(preflight.status, 204);
  const hostile = await f.request('/sync/head', { headers: { Origin: 'https://evil.example', Authorization: 'Bearer ' + native.sessionHandle } }); assert.equal(hostile.status, 403);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_heads').get().n, 0);
});
