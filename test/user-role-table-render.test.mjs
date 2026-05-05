import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const assetsHtml = readFileSync(new URL('../assets.html', import.meta.url), 'utf8');
const certsHtml = readFileSync(new URL('../certificates.html', import.meta.url), 'utf8');

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `Missing start marker: ${start}`);
  assert.notEqual(to, -1, `Missing end marker: ${end}`);
  return source.slice(from, to);
}

{
  const code = extract(assetsHtml, 'const statusLabels = {', 'function getTypeIcon');
  const context = {};
  vm.runInNewContext(`${code}; this.getStatusBadge = getStatusBadge;`, context);

  assert.doesNotThrow(() => context.getStatusBadge('active'));
  assert.match(context.getStatusBadge('active'), /Active/);
  assert.doesNotThrow(() => context.getStatusBadge('maintenance'));
  assert.match(context.getStatusBadge('maintenance'), /Maintenance/);
}

{
  const from = certsHtml.lastIndexOf('function fmtCertId(cert)');
  const to = certsHtml.indexOf('function toggleColDropdown', from);
  assert.notEqual(from, -1, 'Missing certificate fmtCertId');
  assert.notEqual(to, -1, 'Missing certificate formatter end marker');
  const code = certsHtml.slice(from, to);
  const context = {};
  vm.runInNewContext(`${code}; this.fmtCertId = fmtCertId;`, context);

  assert.equal(context.fmtCertId({ certId: 12, jobNumber: 'JOB-2026-004' }), '2026-004/012');
  assert.equal(context.fmtCertId({ certId: '2026-004/012', jobNumber: 'JOB-2026-004' }), '2026-004/012');
}

console.log('user role table render regression passed');
