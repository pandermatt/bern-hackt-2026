import { generateVAPIDKeys } from "web-push";

/*
 * Prints a VAPID keypair for `.env.local`.
 *
 * A pair identifies *this deployment* to the push services, and every
 * subscription a browser hands out is bound to the public key it was created
 * with — so regenerating the pair silently invalidates every row in
 * `push_subscriptions` and every device has to enable notifications again.
 * Generate once, store, and treat the private key like any other secret.
 *
 * Push is optional: with no keys set the settings row says so and the app runs
 * exactly as it did before. Nothing here touches the database.
 */
const { publicKey, privateKey } = generateVAPIDKeys();

console.log("Add these to .env.local:\n");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com`);
