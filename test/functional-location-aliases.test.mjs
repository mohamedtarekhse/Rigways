import assert from 'node:assert/strict';

import { buildFunctionalLocationAliases } from '../worker/src/lib/functional-location.js';

const sampleRows = [
  { id: '3df2a067-1111-4444-9999-abcdefabcdef', fl_id: 'FL-C001-010', name: 'Rig 7' },
  { id: '7acaa7e4-2222-5555-9999-fedcbafedcba', fl_id: 'FL-C001-011', name: 'Workshop A' },
];

const byFlId = buildFunctionalLocationAliases('FL-C001-010', sampleRows);
assert.deepEqual(byFlId, ['FL-C001-010', '3df2a067-1111-4444-9999-abcdefabcdef', 'Rig 7']);

const byName = buildFunctionalLocationAliases('Rig 7', sampleRows);
assert.deepEqual(byName, ['Rig 7', 'FL-C001-010', '3df2a067-1111-4444-9999-abcdefabcdef']);

const byUuid = buildFunctionalLocationAliases('3df2a067-1111-4444-9999-abcdefabcdef', sampleRows);
assert.deepEqual(byUuid, ['3df2a067-1111-4444-9999-abcdefabcdef', 'FL-C001-010', 'Rig 7']);

console.log('functional location alias regression passed');
