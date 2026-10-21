# Deploy SaidHere / The Wall on Render

The Wall uses a Render Node web service plus Render Postgres. The root `render.yaml` defines both resources as a Blueprint.

## Production architecture

- Web service: `saidhere-api-9ab3`
- Custom host: `https://saidhere.app`
- Database: `saidhere-db-9ab3`
- Region: Singapore
- Database public access: disabled (`ipAllowList: []`)
- API health check: `/health`
- Public storefront: `/`
- Plaque shop: `/shop`
- Customer owner portal: `/my-walls`
- Platform admin: `/admin`
- Orders / fulfilment: `/admin/fulfillment`
- Stripe webhook: `/api/stripe/webhook`

The API receives the database's private Render connection string through `DATABASE_URL` automatically.

## Deploy

1. In Render, choose **New > Blueprint**.
2. Connect the GitHub repository `9AB3/SaidHere`.
3. Render detects the root `render.yaml`.
4. Review the resources and apply the Blueprint.
5. Add the required secret environment values listed below.
6. Wait for the database and web service to finish deploying.
7. Open `https://saidhere.app/health` (or the Render service health URL during DNS cutover).

Expected response:

```json
{"ok":true,"service":"saidhere-api"}
```

The web service starts with:

```text
npm run migrate && npm start
```

so the Postgres tables are created or upgraded automatically on deployment. `npm start` also generates the production runtime that mounts the Stripe webhook before body parsers and adds the storefront, commerce, customer-owner and browser-admin routes.

## Required commerce environment values

The Blueprint declares the keys but intentionally does not store secrets in GitHub. Confirm these values exist in the Render service before enabling public checkout:

```text
STRIPE_SECRET_KEY
STRIPE_PRICE_WALL_PLAQUE
STRIPE_WEBHOOK_SECRET
SMTP_USERNAME
SMTP_PASSWORD
ORDER_NOTIFICATION_EMAIL
```

The Blueprint supplies these non-secret defaults:

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

`WALL_PLAQUE_DISPLAY_PRICE` is display text only. The actual amount charged comes from the Stripe Price referenced by `STRIPE_PRICE_WALL_PLAQUE`; keep those two amounts aligned.

## Stripe configuration

Create a normal one-time Stripe Price for the physical Wall plaque and put its `price_...` ID in `STRIPE_PRICE_WALL_PLAQUE`.

Create a Stripe webhook endpoint at:

```text
https://saidhere.app/api/stripe/webhook
```

Subscribe it to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

Copy that endpoint's signing secret (`whsec_...`) into Render as `STRIPE_WEBHOOK_SECRET`.

The checkout session is created server-side. The Stripe secret key never goes to Flutter or browser JavaScript. Checkout uses the internal order UUID as both `client_reference_id` and metadata so webhook events reconcile to the correct order.

The app deliberately uses ordinary Stripe Checkout for this physical product. Do not enable Stripe Managed Payments for the plaque flow; Managed Payments is a separate merchant-of-record product aimed at digital products and is unnecessary for collecting the plaque shipping address.

## SMTP2GO and order email

Outgoing order mail is sent by Nodemailer through SMTP2GO using `SMTP_USERNAME` and `SMTP_PASSWORD`.

After Stripe confirms payment:

1. The order is marked paid and linked to a customer account.
2. The purchaser receives a branded confirmation from `orders@saidhere.app` with quantity, total, shipping details and an **Activate My Walls** / **Manage My Walls** link.
3. `ORDER_NOTIFICATION_EMAIL` receives the separate internal new-order notification used for packing/fulfilment.
4. The purchaser can activate their owner account immediately; the Wall itself appears after the physical plaque is assigned during fulfilment.

SMTP2GO handles outbound delivery only. If replies to `orders@saidhere.app` should arrive in a normal Gmail inbox, configure that separately as an incoming forwarding address with the domain/DNS provider and test it independently.

## Browser admin portal

Open:

```text
https://saidhere.app/admin
```

On the first deployment that contains the database-backed admin system, the migration creates this Main Admin account if no admin users already exist:

```text
Username: admin
Password: password
```

The account is marked as using a temporary password. Change it after the first login.

The platform admin supports:

- Main Admin and per-Wall Moderator accounts;
- database-backed login sessions;
- password changes and resets;
- creating and managing Walls;
- editing Wall names and locations;
- deactivating/reactivating Walls;
- replacing NFC URLs while preserving Wall history;
- clearing messages and reviewing reports;
- audit history;
- viewing paid orders and customers;
- assigning purchased physical plaques to paid orders;
- generating/recovering customer activation links.

Customer Wall owners use the separate `/my-walls` portal and do not receive platform-admin access.

Passwords are never stored as plain text. They are salted and hashed with Node's `scrypt`. Browser sessions use random HttpOnly cookies and only token hashes are stored in Postgres.

`ADMIN_KEY` remains separate for programmatic admin API calls and is not the browser password.

## Purchased plaque fulfilment

Once an order is paid:

1. Open **Admin → Orders** (`/admin/fulfillment`).
2. Assign the next plaque for the order.
3. Enter the physical serial code (or allow a generated one), initial Wall name and optional location.
4. The server creates the Wall, NFC tag hash, plaque record and customer ownership in one transaction.
5. Copy the one-time NFC URL shown by the admin page and program that exact URL into the physical plaque.
6. Test it before permanently write-locking the tag.
7. Repeat for each item if the customer ordered multiple plaques.

The raw NFC token is returned only during creation/assignment or replacement. It is never stored in Postgres. If it is lost before programming the plaque, replace the NFC token rather than trying to recover the original.

## Database groups

The same Postgres database stores the anonymous Wall system, platform administration and commerce ownership.

Anonymous Wall/app tables include:

- `walls`
- `wall_tags`
- `wall_posts`
- `wall_visits`
- `visitor_sessions`
- `post_reports`

Platform-admin tables include:

- `admin_users`
- `admin_sessions`
- `admin_audit_log`

Commerce/customer tables include:

- `customer_accounts`
- `customer_sessions`
- `commerce_orders`
- `commerce_order_items`
- `stripe_webhook_events`
- `plaques`
- `wall_ownerships`
- `customer_claim_tokens`
- `customer_audit_log`

## Flutter API URL

The app can use the canonical host:

```text
https://saidhere.app
```

Codemagic already passes that as `API_BASE_URL`. The Render service URL remains useful for infrastructure diagnostics during custom-domain changes.

## Security notes

- Render Postgres is private-only in the Blueprint.
- Phones never connect directly to Postgres.
- Anonymous app sessions use opaque random bearer tokens stored locally on the device.
- NFC secrets are hashed before storage.
- Admin/customer passwords are salted and scrypt-hashed.
- Admin/customer browser sessions are random opaque tokens; only token hashes are stored.
- Admin/customer state-changing browser actions use CSRF protection.
- Stripe webhook signatures are verified against the untouched raw request body.
- Processed Stripe event IDs are recorded so duplicate webhook deliveries do not repeat checkout side effects.
- Stripe Checkout creation uses an idempotency key tied to the internal order.
- A valid plaque URL grants 15 minutes of server-enforced write access to that Wall.
- Six posts per minute per anonymous session are allowed before temporary blocking.
- Three distinct reports automatically hide a message.

A normal static NFC tag can still have its URL copied and replayed. Permanent write-locking stops rewriting, not cloning. For stronger physical-presence proof later, use a cryptographic tag such as NTAG 424 DNA and verify its dynamic authentication server-side.
