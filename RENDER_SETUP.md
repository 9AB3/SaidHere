# Deploy SaidHere on Render

SaidHere uses a Render Node web service plus Render Postgres. The root `render.yaml` defines both resources as a Blueprint.

## One-click architecture

- Web service: `saidhere-api-9ab3`
- Database: `saidhere-db-9ab3`
- Region: Singapore
- Database public access: disabled (`ipAllowList: []`)
- API health check: `/health`

The API receives the database's private Render connection string through `DATABASE_URL` automatically.

## Deploy

1. In Render, choose **New > Blueprint**.
2. Connect the GitHub repository `9AB3/SaidHere`.
3. Render detects the root `render.yaml`.
4. Review the two resources and apply the Blueprint.
5. Wait for the database and web service to finish deploying.
6. Open `https://saidhere-api-9ab3.onrender.com/health`.

Expected response:

```json
{"ok":true,"service":"saidhere-api"}
```

The web service starts with:

```text
npm run migrate && npm start
```

so the Postgres tables are created automatically on deployment.

## Create a Wall

From the Render Shell for the `saidhere-api-9ab3` web service, run:

```bash
npm run create-wall -- "The Crown - Upstairs" "Newcastle"
```

The command prints a one-time NFC URL such as:

```text
https://saidhere.app/t/<secret-token>
```

Write that exact URL to the physical NFC tag. The raw token is never stored in Postgres; only its SHA-256 hash is retained.

## Flutter API URL

The app defaults to:

```text
https://saidhere-api-9ab3.onrender.com
```

To use a different Render service or a future custom API domain:

```bash
flutter run --dart-define=API_BASE_URL=https://your-api.example.com
```

Codemagic also has `API_BASE_URL` as a workflow variable.

## Custom domain later

Once `saidhere.app` is owned and configured, keep NFC links on `https://saidhere.app/t/<token>` so Apple Universal Links and Android App Links can open the installed app. The backend can remain on the Render subdomain or move behind something like `https://api.saidhere.app`.

## Security notes

- Render Postgres is private-only in the Blueprint.
- Phones never connect directly to Postgres.
- Anonymous app sessions use opaque random bearer tokens stored locally on the device.
- NFC secrets are hashed before storage.
- A valid plaque tap grants 15 minutes of server-enforced write access to that Wall.
- Six posts per minute per anonymous session are allowed before the server temporarily blocks more.
- Three distinct reports automatically hide a message.

For a larger public rollout, add automated text moderation, a moderator console and stronger anti-bot controls.
