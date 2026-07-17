#!/usr/bin/env bash
set -euo pipefail

# Deploy only the backend container to Azure App Service inside the same
# dedicated resource group created by azure-setup.sh.
#
# This script assumes your image already exists in a container registry.
# The repo's GitHub Actions workflow can publish:
#   ghcr.io/<owner>/<repo>/api:<tag>

PROJECT_SLUG="ara-workbench"
LOCATION="centralindia"
RESOURCE_GROUP="rg-${PROJECT_SLUG}-prod"

APP_SERVICE_PLAN="asp-${PROJECT_SLUG}-prod"
API_APP_NAME="${PROJECT_SLUG}-api-prod-CHANGE-ME"

CONTAINER_IMAGE="ghcr.io/<github-owner>/<github-repo>/api:<tag>"

# If the GHCR package is private, create a GitHub PAT with read:packages and set
# these placeholders. If the image is public, you can remove the registry args.
REGISTRY_SERVER_URL="https://ghcr.io"
REGISTRY_USERNAME="<github-username-or-org>"
REGISTRY_PASSWORD="<github-pat-with-read-packages>"

MYSQL_SERVER_NAME="${PROJECT_SLUG}-mysql-prod-CHANGE-ME"
DB_NAME="ara_workbench"
DB_USER="ara_workbench_app"
DB_PASSWORD_URL_ENCODED="CHANGE_ME_URL_ENCODED_APP_USER_PASSWORD"
DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD_URL_ENCODED}@${MYSQL_SERVER_NAME}.mysql.database.azure.com:3306/${DB_NAME}?sslaccept=strict&connection_limit=10&pool_timeout=20"

JWT_ACCESS_SECRET="CHANGE_ME_FRESH_RANDOM_48_BYTE_SECRET"
JWT_REFRESH_SECRET="CHANGE_ME_DIFFERENT_FRESH_RANDOM_48_BYTE_SECRET"
SEED_ADMIN_PASSWORD="CHANGE_ME_STRONG_TEMPORARY_ADMIN_PASSWORD"

CLIENT_URL="https://${API_APP_NAME}.azurewebsites.net"

echo "Creating Linux App Service plan in isolated resource group."
az appservice plan create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${APP_SERVICE_PLAN}" \
  --location "${LOCATION}" \
  --is-linux \
  --sku "B1" \
  --tags project="${PROJECT_SLUG}" environment="prod" isolation="dedicated"

echo "Creating backend Web App for Containers."
az webapp create \
  --resource-group "${RESOURCE_GROUP}" \
  --plan "${APP_SERVICE_PLAN}" \
  --name "${API_APP_NAME}" \
  --deployment-container-image-name "${CONTAINER_IMAGE}" \
  --https-only true \
  --tags project="${PROJECT_SLUG}" environment="prod" isolation="dedicated"

echo "Configuring container registry access."
az webapp config container set \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${API_APP_NAME}" \
  --container-image-name "${CONTAINER_IMAGE}" \
  --docker-registry-server-url "${REGISTRY_SERVER_URL}" \
  --docker-registry-server-user "${REGISTRY_USERNAME}" \
  --docker-registry-server-password "${REGISTRY_PASSWORD}"

echo "Setting backend environment variables as App Service app settings."
az webapp config appsettings set \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${API_APP_NAME}" \
  --settings \
    NODE_ENV="production" \
    PORT="4000" \
    WEBSITES_PORT="4000" \
    DATABASE_URL="${DATABASE_URL}" \
    JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET}" \
    JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}" \
    SEED_ADMIN_EMAIL="admin@ara-workbench.local" \
    SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD}" \
    SEED_ADMIN_FIRST_NAME="System" \
    SEED_ADMIN_LAST_NAME="Administrator" \
    SEED_DEMO_DATA="false" \
    COOKIE_SECURE="true" \
    CLIENT_URL="${CLIENT_URL}" \
    TRUST_PROXY="1" \
    SWAGGER_ENABLED="false" \
    MAIL_ENABLED="false" \
    SMTP_HOST="" \
    SMTP_PORT="587" \
    SMTP_SECURE="false" \
    SMTP_REQUIRE_TLS="true" \
    LOG_LEVEL="info" \
    SCHEDULER_ENABLED="true" \
    RUN_MIGRATIONS_ON_STARTUP="false" \
    RUN_SEED_ON_STARTUP="true"

echo "Enabling container logs for troubleshooting."
az webapp log config \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${API_APP_NAME}" \
  --docker-container-logging filesystem

cat <<EOF

Backend deploy configured.

Manual verification URL:
https://${API_APP_NAME}.azurewebsites.net/readyz

Reminder:
- Run Prisma migrations against Azure MySQL before relying on the CRUD-only app user.
- Replace every CHANGE_ME placeholder before running this script.
EOF
