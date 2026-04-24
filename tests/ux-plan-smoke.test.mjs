import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const dashboard = read('dashboard.html');
const worker = read('_worker.js');
const app = read('app.js');
const index = read('index.html');
const wrangler = read('wrangler.toml');

assert.match(dashboard, /Operations Command Center/i, 'dashboard should be restored as the command center');
assert.doesNotMatch(dashboard, /Dashboard Removed|window\.location\.replace\('assets\.html'\)/, 'dashboard must not redirect to assets');
assert.match(dashboard, /actionQueue/i, 'dashboard should render an action queue surface');

assert.match(worker, /handleDashboard/i, 'worker should expose dashboard summary handling');
assert.match(worker, /handleActionQueue/i, 'worker should expose action queue handling');
assert.match(worker, /\/jobs\/\(\[\^\/\]\+\)\/context/, 'worker should route job context payloads');

assert.match(app, /href:'dashboard\.html'/, 'shared nav should include the command center');
assert.match(app, /SapActionQueue/i, 'shared UX helpers should render action queue items');
assert.match(app, /SapContextDrawer/i, 'shared UX helpers should support lifecycle context drawers');

assert.match(index, /dashboard\.html/, 'login should redirect to dashboard after authentication');
assert.doesNotMatch(index, /SAP S\/4HANA/i, 'login should not show SAP S/4HANA branding');

assert.doesNotMatch(wrangler, /^VAPID_PRIVATE_KEY\s*=/m, 'private VAPID key must not be stored in wrangler vars');
assert.doesNotMatch(wrangler, /^VAPID_SUBJECT\s*=/m, 'VAPID subject should be configured as a secret');
assert.match(wrangler, /\[observability\]/, 'wrangler config should enable observability');

console.log('UX plan smoke checks passed');
