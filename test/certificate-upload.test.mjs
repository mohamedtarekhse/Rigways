import assert from 'node:assert/strict';

import { handleCertificates } from '../worker/src/routes/certificates.js';
import { signJwt } from '../worker/src/middleware/jwt.js';

const JWT_SECRET = 'test-secret';

async function authHeaders(role = 'technician') {
  const token = await signJwt({
    sub: 'user-1',
    role,
    name: 'Upload Tester',
    username: 'upload.tester',
  }, JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      return objects.get(key) || null;
    },
    async put(key, body, options) {
      objects.set(key, { body, httpMetadata: options?.httpMetadata || {}, customMetadata: options?.customMetadata || {} });
    },
  };
}

async function testCertificateUploadStoresFile() {
  const bucket = fakeBucket();
  const form = new FormData();
  form.set('file', new File(['certificate-pdf'], 'Inspection Report.pdf', { type: 'application/pdf' }));
  form.set('client_id', 'C001');
  form.set('job_number', 'JOB-2026-001');
  form.set('cert_number', 'CERT-001');

  const request = new Request('https://example.test/api/certificates/upload', {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });

  const response = await handleCertificates(request, { JWT_SECRET, CERT_BUCKET: bucket }, '/certificates/upload');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.file_url, 'clients/C001/jobs/JOB-2026-001/JOB-2026-001_CERT-001_inspection-report.pdf');
  assert.equal(body.data.file_name, 'JOB-2026-001_CERT-001_inspection-report.pdf');
  assert.equal(bucket.objects.size, 1);
}

await testCertificateUploadStoresFile();
console.log('certificate upload regression passed');
