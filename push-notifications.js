// push-notifications.js

// Check for service worker support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker registered with scope:', registration.scope);

            // Subscribe the user to push notifications
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array('YOUR_PUBLIC_VAPID_KEY_HERE') // Replace with your public VAPID key
            });

            console.log('User is subscribed:', subscription);
            // Send subscription to your server
            await sendSubscriptionToServer(subscription);
        } catch (error) {
            console.error('Service Worker registration or push subscription failed:', error);
        }
    });
}

// Convert VAPID key from base64 to Uint8Array
function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const converted = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(converted);
    return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
}

async function sendSubscriptionToServer(subscription) {
    // Implement your logic to send the subscription object to your server
    console.log('Sending subscription to server:', subscription);
}