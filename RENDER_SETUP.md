# Deploy SaidHere / The Wall on Render

The Wall runs as a Node/Express service on Render with Render Postgres. The root `render.yaml` defines both resources.

## Production resources

- Web service: `saidhere-api-9ab3`
- Custom domain: `https://saidhere.app`
- Database: `saidhere-db-9ab3`
- Region: Singapore
- Database public access: disabled
- Health check: `/health`
- Store: `/shop`
- Customer portal: `/my-walls`
- Platform admin: `/admin`
- Orders: `/admin/orders`
- Stripe webhook: `/api/stripe/webhook`

The deploy starts with:

```text
npm run migrate && npm start
```

Migrations are idempotent. The production server runs the reviewed source modules directly; the small generated customer-portal file is an exact copy retained only for filename compatibility.

## Required Render secrets

These keys are declared with `sync: false` and must be entered in Render:

```text
STRIPE_SECRET_KEY
STRIPE_PRICE_WALL_PLAQUE
STRIPE_WEBHOOK_SECRET
SMTP_USERNAME
SMTP_PASSWORD
ORDER_NOTIFICATION_EMAIL
```

The Blueprint supplies the non-secret defaults:

```text
PUBLIC_APP_URL=https://saidhere.app
WALL_PLAQUE_DISPLAY_PRICE=A$15.00
STRIPE_SHIPPING_COUNTRIES=AU
SMTP_HOST=mail-au.smtp2go.com
SMTP_PORT=587
CUSTOMER_EMAIL_FROM=The Wall <orders@saidhere.app>
CUSTOMER_REPLY_TO=orders@saidhere.app
ORDER_EMAIL_FROM=The Wall <orders@saidhere.app>
```

The display-price variable is only website text. The actual charge comes from the Stripe Price referenced by `STRIPE_PRICE_WALL_PLAQUE`; verify that Price is also A$15.00 before going live.

## Stripe

Use a normal one-time Stripe Price for the physical Wall. This Stripe account currently has Managed Payments enabled by default, so The Wall explicitly sends:

```text
managed_payments[enabled]=false
```

for its Checkout Session. This is required so Stripe accepts shipping-address collection for this physical product.

Configure the webhook endpoint:

```text
https://saidhere.app/api/stripe/webhook
```

Subscribe to all four events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

Copy that endpoint's `whsec_...` signing secret into `STRIPE_WEBHOOK_SECRET`.

Checkout creation is server-side, uses an idempotency key tied to the internal order UUID, collects the shipping address, and never exposes the Stripe secret to Flutter or browser code. Webhook signatures are checked against the untouched raw request body and processed event IDs are recorded to make retries safe.

The Stripe success page also re-checks the Checkout Session directly. This gives the purchase flow a recovery path if webhook delivery is delayed.

## Email

Transactional mail is sent through SMTP2GO using Nodemailer. After payment:

1. The order is linked to the purchaser account.
2. The purchaser receives a branded order confirmation with quantity, total, shipping details and an owner-account link.
3. `ORDER_NOTIFICATION_EMAIL` receives the internal order notification.
4. Delivery attempts, provider errors and message IDs are recorded on the order and visible in Admin → Orders.

If the customer email does not arrive, the paid order is still usable: the first physical NFC scan can verify the purchase email and activate the owner account.

SMTP2GO is outbound only. Incoming forwarding for `orders@saidhere.app` is configured separately at the domain provider and must be tested separately.

## Admin bootstrap

Open:

```text
https://saidhere.app/admin
```

On a brand-new production database, the migration creates the Main Admin user `admin`. It does **not** use the public default password `password` in production. If `INITIAL_ADMIN_PASSWORD` is not supplied, a random temporary password is printed once in the Render deploy logs. The admin is forced to change that temporary password before using the rest of the admin console.

For local/non-production databases only, the bootstrap fallback remains `admin/password`.

Changing or resetting an admin password revokes the user's other admin sessions.

## Paid-order fulfilment

The normal workflow is deliberately small:

1. Stripe confirms payment.
2. Open **Admin → Orders**.
3. Click **Assign next NFC** for each purchased Wall.
4. Program the one-time HTTPS URL shown into the physical NFC tag.
5. If the URL is lost before shipping, click **Replace NFC**; the old URL is invalidated and a new one-time URL is issued.
6. Pack the Wall and click **Mark shipped**.
7. The customer receives it and scans the Wall for the first time.
8. First scan lets the purchaser choose the Wall name and location. If their owner account is not active yet, the same physical scan can verify the purchase email and create the password.
9. Later name/location changes and reported-post moderation are available through `/my-walls`.

The raw NFC secret is never stored in Postgres. Only its SHA-256 hash is retained.

## Customer owner permissions

A Wall owner can change their Wall name/location, deactivate/reactivate it, see aggregate activity, and review reported posts. They are not shown which anonymous visitor authored a post. They can keep a reported post or remove it; ordinary unreported posts cannot be removed through the owner moderation UI.

## Security notes

- Render Postgres is private-only in the Blueprint.
- Phones never connect directly to Postgres.
- NFC secrets and browser/session tokens are stored only as hashes.
- Admin and owner passwords are salted and scrypt-hashed.
- Browser state-changing actions use CSRF protection.
- Customer/admin login and setup endpoints are rate-limited.
- A physical scan grants 15 minutes of server-enforced anonymous write access.
- Deactivating a Wall blocks new writes immediately, even if a visitor previously had time remaining.
- Six posts per minute per anonymous session are allowed before temporary blocking.
- Three distinct reports automatically hide a post until reviewed.

A static NFC URL can still be copied and replayed. Permanent write-locking prevents rewriting the chip, not cloning the URL. A future higher-security option is a cryptographic dynamic tag such as NTAG 424 DNA with server-side verification.

## Release checks

Before calling a deployment production-ready, verify:

- Render is running the intended Git commit and `/health` succeeds.
- The Stripe Price amount matches the website price.
- All four webhook events are subscribed and test deliveries return 2xx.
- One complete Stripe test-mode order reaches paid status, sends both emails, activates My Walls, assigns/replaces NFC, marks shipped and completes first-scan setup.
- A reply to `orders@saidhere.app` reaches the intended forwarding inbox.
- The production Android `assetlinks.json` is deployed using the real release/Google Play signing SHA-256 before Android App Links are relied on.
