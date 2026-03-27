/**
 * generateVAPID.js — One-time VAPID key generator
 * Run once: node generateVAPID.js
 *
 * Then add to Cloudflare Pages → Settings → Environment Variables:
 *   VAPID_PUBLIC_KEY  = <publicKey>
 *   VAPID_PRIVATE_KEY = <privateKey>
 *   VAPID_SUBJECT     = mailto:admin@your-domain.com
 *
 * The public key also goes into notifications.html (VAPID_PUBLIC_KEY constant).
 */

const webPush = require('web-push');
const vapidKeys = webPush.generateVAPIDKeys();

console.log('\n=== VAPID Keys (save these — shown only once) ===\n');
console.log('VAPID_PUBLIC_KEY  =', vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY =', vapidKeys.privateKey);
console.log('\nAdd BOTH to Cloudflare Pages → Settings → Environment Variables');
console.log('Add VAPID_PUBLIC_KEY to notifications.html as the VAPID_PUBLIC_KEY constant.\n');
