const fs = require('fs');
const path = require('path');

const workerJsPath = path.join(__dirname, '_worker.js');
const webPushJsPath = path.join(__dirname, 'worker', 'src', 'lib', 'web-push.js');

const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');
let webPushContent = fs.readFileSync(webPushJsPath, 'utf8');

// Remove original exports from webPushContent to fit inside _worker.js
webPushContent = webPushContent.replace('export async function sendPushNotification', 'async function sendPushNotification');
webPushContent = webPushContent.replace('export async function sendPushToUser', 'async function sendPushToUser');
webPushContent = webPushContent.replace('export async function sendPushToRoles', 'async function sendPushToRoles');
webPushContent = webPushContent.replace('export function getVapidConfig', 'function getVapidConfig');

const startMarker = '// ── web-push.js ──';
const endMarker = '// ── push.js ──';

const startIndex = workerJsContent.indexOf(startMarker);
const endIndex = workerJsContent.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found!");
  process.exit(1);
}

const before = workerJsContent.slice(0, startIndex + startMarker.length);
const after = workerJsContent.slice(endIndex);

const newContent = `${before}\n${webPushContent}\n${after}`;

fs.writeFileSync(workerJsPath, newContent, 'utf8');
console.log('Successfully synced web-push logic to _worker.js!');
