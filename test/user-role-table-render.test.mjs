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
  const code = extract(assetsHtml, 'function renderTable() {', 'function applyClientColVisibility()');
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
      });
    }
    return elements.get(id);
  };
  getElementById('searchInput').value = '';
  getElementById('clientFilter').value = 'all';
  getElementById('typeFilter').value = 'all';
  getElementById('locationFilter').value = 'all';
  getElementById('inspectionDateFilter').value = '';
  const context = {
    session: { role: 'user', customerId: 'C001' },
    ASSETS: [{
      assetId: 'AST-0001',
      id: 'asset-1',
      name: 'Top Drive',
      type: 'Drilling Equipment',
      serial: 'SN-1',
      location: 'FL-C001-010',
      client: '9c390bd2-2a6f-4d4f-a2c9-123456789abc',
      zone: '',
      status: 'active',
      inspectionDate: '',
    }],
    activeStatusFilter: 'all',
    currentPage: 1,
    PAGE_SIZE: 25,
    sortCol: 'name',
    sortDir: 1,
    filteredData: [],
    h: (value) => String(value ?? ''),
    getStatusBadge: (value) => value,
    TYPE_COLORS: { 'Drilling Equipment': { color: '#000' }, Other: { color: '#000' } },
    window: { _funcLocsCache: [] },
    document: { getElementById },
    renderPagination: () => {},
    applyColVisibility: () => {},
    applyClientColVisibility: () => {},
    syncAssetsToStorage: () => {},
  };
  vm.runInNewContext(`${code}; this.renderTable = renderTable;`, context);
  context.renderTable();

  assert.equal(getElementById('tableCount').textContent, 1);
  assert.equal(getElementById('emptyState').style.display, 'none');
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
