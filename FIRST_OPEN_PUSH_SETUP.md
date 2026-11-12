# iPhone new-session and first-launch notifications (Said Here)

Said Here can notify the owner on an iPhone when an anonymous API session is first issued **without any mobile app update**. The existing published app calls `/api/session` when it first needs a new anonymous identity, and stores that identity locally. This is NOT an App Store/Google Play download event and cannot verify a unique device or a new installation. The generic alert does not reliably identify iOS versus Android. Updated native app builds can additionally report the platform for a more precise *first app open* event, using the same notification ledger so there are no duplicate notifications.

## Owner setup

1. Install **Pushover** on your iPhone, create an account at https://pushover.net, and allow notifications. Pushover currently offers a trial and then a one-time iOS licence.
2. In the Pushover dashboard, copy your **User Key** and create an **Application/API Token** for Said Here at https://pushover.net/apps/build. Do not commit either key to GitHub.
3. In the Render dashboard for Said Here's web service, add two **secret environment variables**:
   - `PUSHOVER_USER_KEY` — your Pushover User Key
   - `PUSHOVER_APP_TOKEN` — your app's API token
   - Optional: `PUSHOVER_DEVICE` — the name of your iPhone in Pushover, to send alerts only to that device (otherwise all your Pushover devices receive them)
4. Deploy the server update, including `npm run migrate` (Render already does this). **No Flutter release is needed for generic new-session push alerts.** A future Flutter app release enables the separate, platform-specific first-open data.
5. To confirm a real new-session alert, use an app installation without a saved anonymous session, or clear local app storage on a test device (this resets its local identity and can erase app data). Opening an app that already has a saved anonymous session will not create a new session or trigger this alert.

## Behavior / limitations

- Existing builds already use `POST /api/session`. Creating a fresh anonymous API session triggers an optional, asynchronous *new app session* Pushover alert. The API request is never delayed by Pushover. The backend caps these alerts at 30 successful notifications/hour to limit abuse.
- Updated builds can also use `POST /api/app/first-open`, requiring the existing anonymous session and an `ios` or `android` platform.
- PostgreSQL stores one push ledger row per anonymous session. The generic backend notification and the native first-open endpoint share the ledger, preventing two pushes for the same session. Generic push failures are logged without blocking app use; updated native first-open requests can retry on later launches.
- The app remembers pending notifications across launches without blocking the user. Prior installations with an existing stored anonymous session are not counted as new when they upgrade.
- Pushover is an external notification service, so never send personal user details in the push payload. The notification contains only the OS platform.
- Deleting an anonymous session also deletes the matching event. Clearing app storage or reinstalling may produce a new anonymous session; a first open is therefore only an approximation of an installation, not an authoritative store download metric.
- Credentials must be configured privately in Render; they are never stored in app bundles or GitHub.

## Verify delivery

Once both keys are configured in Render, open **Main Admin → Analytics → iPhone installation notifications**, then select **Send test notification**. The test sends only to your Pushover devices and does not add a fake installation record. The control remains disabled until both credentials are detected.
