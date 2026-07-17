#!/usr/bin/env bash
set -euo pipefail

# Ara Workbench isolated Azure infrastructure.
# Review every value before running. This script creates only NEW resources in
# one dedicated resource group so this app cannot share databases or resource
# containers with other critical projects.

PROJECT_SLUG="ara-workbench"
LOCATION="centralindia"
RESOURCE_GROUP="rg-${PROJECT_SLUG}-prod"

# Must be globally unique, lowercase, 3-63 chars, letters/numbers/hyphens only.
MYSQL_SERVER_NAME="${PROJECT_SLUG}-mysql-prod-CHANGE-ME"
MYSQL_ADMIN_USER="aw_mysql_admin"
MYSQL_ADMIN_PASSWORD="CHANGE_ME_STRONG_MYSQL_ADMIN_PASSWORD"

MYSQL_VERSION="8.0.21"
MYSQL_SKU="Standard_B1ms"
MYSQL_TIER="Burstable"

# Azure Flexible Server minimum storage varies by region/SKU over time.
# 32 GiB is the usual smallest accepted value for the Azure CLI.
MYSQL_STORAGE_GB="32"

CURRENT_IP="$(curl -fsS https://api.ipify.org)"

echo "Creating isolated resource group: ${RESOURCE_GROUP}"
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --tags project="${PROJECT_SLUG}" environment="prod" isolation="dedicated"

echo "Creating dedicated Azure Database for MySQL Flexible Server: ${MYSQL_SERVER_NAME}"
az mysql flexible-server create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${MYSQL_SERVER_NAME}" \
  --location "${LOCATION}" \
  --admin-user "${MYSQL_ADMIN_USER}" \
  --admin-password "${MYSQL_ADMIN_PASSWORD}" \
  --version "${MYSQL_VERSION}" \
  --tier "${MYSQL_TIER}" \
  --sku-name "${MYSQL_SKU}" \
  --storage-size "${MYSQL_STORAGE_GB}" \
  --public-access "${CURRENT_IP}" \
  --tags project="${PROJECT_SLUG}" environment="prod" isolation="dedicated"

echo "Allowing Azure services to reach this MySQL server."
az mysql flexible-server firewall-rule create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${MYSQL_SERVER_NAME}" \
  --rule-name "AllowAzureServices" \
  --start-ip-address "0.0.0.0" \
  --end-ip-address "0.0.0.0"

echo "Allowing only your current public IP: ${CURRENT_IP}"
az mysql flexible-server firewall-rule create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${MYSQL_SERVER_NAME}" \
  --rule-name "AllowCurrentAdminIP" \
  --start-ip-address "${CURRENT_IP}" \
  --end-ip-address "${CURRENT_IP}"

echo "Enforcing encrypted MySQL connections."
az mysql flexible-server parameter set \
  --resource-group "${RESOURCE_GROUP}" \
  --server-name "${MYSQL_SERVER_NAME}" \
  --name "require_secure_transport" \
  --value "ON"

echo "Recommended TLS floor: TLS 1.2."
az mysql flexible-server parameter set \
  --resource-group "${RESOURCE_GROUP}" \
  --server-name "${MYSQL_SERVER_NAME}" \
  --name "tls_version" \
  --value "TLS 1.2"

cat <<EOF

Azure MySQL server created.

Next manual step:
1. Connect as ${MYSQL_ADMIN_USER}.
2. Review and run db-setup.sql.
3. Build DATABASE_URL using the restricted app user, not the admin user:

mysql://ara_workbench_app:<url-encoded-password>@${MYSQL_SERVER_NAME}.mysql.database.azure.com:3306/ara_workbench?sslaccept=strict&connection_limit=10&pool_timeout=20
EOF
