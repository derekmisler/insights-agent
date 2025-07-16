#!/bin/bash

# Load environment variables
source .env

# Get Docker token
TOKEN=$(curl -s --request POST \
  --url "https://$DOCKER_ACCOUNTS_API_HOST/v2/users/login" \
  --header 'Content-Type: application/json' \
  --data "{\"username\": \"$DOCKER_USER\",\"password\": \"$DOCKER_PASS\"}" | jq -r .token)

if [[ "$TOKEN" != "null" && "$TOKEN" != "" ]]; then
  echo "Token obtained successfully"

  # Update .env file
  if grep -q "BEARER_TOKEN=" .env; then
    # Replace existing token
    sed -i.bak "s/BEARER_TOKEN=.*/BEARER_TOKEN=$TOKEN/" .env
  else
    # Add new token
    echo "BEARER_TOKEN=$TOKEN" >> .env
  fi

  echo "Updated .env with new token"
else
  echo "Failed to obtain token"
  exit 1
fi