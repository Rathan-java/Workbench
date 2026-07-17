# Ara Workbench Deployment

This is the container-based Azure path used by the existing GitHub Actions workflow.

## Target Shape

- Azure Database for MySQL Flexible Server runs the database.
- One Linux Web App for Containers runs the API image.
- One Linux Web App for Containers runs the web image.
- The browser calls the web app at `/api/...`; nginx inside the web container proxies those requests to the API app. This keeps refresh cookies same-origin and lets `SameSite=Strict` work.

## 1. Create Azure MySQL

Create an **Azure Database for MySQL Flexible Server**:

- Version: MySQL 8.0.
- Tier: Burstable B1ms is enough to start.
- Networking: enable public access for the first deployment, and allow Azure services to reach the server. Move to private networking later if required.
- Database name: `ara_workbench`.

Use a `DATABASE_URL` like this in the API app settings:

```text
mysql://adminuser:P%40ss@yourserver.mysql.database.azure.com:3306/ara_workbench?sslaccept=strict&connection_limit=10&pool_timeout=20
```

Percent-encode special characters in the password. For example, `@` becomes `%40`, `#` becomes `%23`, `:` becomes `%3A`, and `/` becomes `%2F`.

## 2. Create The App Services

Create two Linux **Web App for Containers** resources:

- API app: runs the `api` image.
- Web app: runs the `web` image.

Start with Basic if Free is too constrained. Set the web app's container port to `8080`; the API listens on `4000`.

## 3. Configure API App Settings

Set these on the API Web App:

```text
NODE_ENV=production
PORT=4000
WEBSITES_PORT=4000
DATABASE_URL=mysql://...
JWT_ACCESS_SECRET=<fresh 48-byte random secret>
JWT_REFRESH_SECRET=<different fresh 48-byte random secret>
SEED_ADMIN_EMAIL=admin@ara-workbench.local
SEED_ADMIN_PASSWORD=<strong non-default temporary admin password>
SEED_DEMO_DATA=false
COOKIE_SECURE=true
CLIENT_URL=https://<your-web-app>.azurewebsites.net
CORS_ORIGINS=
TRUST_PROXY=1
SWAGGER_ENABLED=false
MAIL_ENABLED=true
SMTP_HOST=<smtp host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<smtp user>
SMTP_PASSWORD=<smtp password>
MAIL_FROM_NAME=Ara Workbench
MAIL_FROM_ADDRESS=<verified sender>
```

Generate the JWT secrets locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Production boot will fail if `SEED_ADMIN_PASSWORD` is still the default or `COOKIE_SECURE=false`.

## 4. Configure Web App Settings

Set this on the web Web App:

```text
WEBSITES_PORT=8080
API_UPSTREAM=https://<your-api-app>.azurewebsites.net
```

Keep the frontend API path as `/api/v1`. The web container proxies that path to the API app.

## 5. Configure GitHub Actions

In GitHub, open **Settings -> Secrets and variables -> Actions**.

Repository variables:

```text
PUBLISH_IMAGES=true
DEPLOY_ENABLED=true
```

Repository secrets:

```text
AZURE_CREDENTIALS=<output from az ad sp create-for-rbac --sdk-auth>
AZURE_API_APP_NAME=<api app service name>
AZURE_WEB_APP_NAME=<web app service name>
AZURE_API_URL=https://<your-api-app>.azurewebsites.net
```

The workflow builds both images, publishes them to GHCR, deploys both Web Apps, and smoke-tests `AZURE_API_URL/readyz`.

## 6. Deploy

Push to `main`:

```bash
git push origin main
```

The API container runs `prisma migrate deploy` and `node prisma/seed.js` on boot. The migration step is idempotent; it only applies pending migrations.

## 7. Verify Production

After deployment:

- Open `https://<your-api-app>.azurewebsites.net/readyz`; it should return ready.
- Open the web app and sign in with the seeded Management account.
- Change the first-login Management password immediately.
- Confirm login, logout, task entry, approvals, reports, Settings, and mail test.
- Check App Service logs for migration, seed, mailer, and scheduler messages.
- Confirm the browser is calling `https://<your-web-app>.azurewebsites.net/api/v1/...`, not the API app directly.

## Demo Credentials For Local Testing

When `SEED_DEMO_DATA=true`, every seeded demo user uses:

```text
Password@2026!
```

Useful seeded accounts:

| Role | Email | Password |
|---|---|---|
| Management | `admin@ara-workbench.local` | `ChangeMe@Admin123` locally only; use a strong non-default value in production |
| Tech Lead | `priya.sharma@ara-workbench.local` | `Password@2026!` |
| Employee | `arjun.nair@ara-workbench.local` | `Password@2026!` |
