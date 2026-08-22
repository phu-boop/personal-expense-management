#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_ENV_FILE="$ROOT_DIR/client/.env"
SERVER_ENV_FILE="$ROOT_DIR/server/.env"
CLIENT_EXAMPLE="$ROOT_DIR/client/.env.example"
SERVER_EXAMPLE="$ROOT_DIR/server/.env.example"

if [[ ! -f "$CLIENT_EXAMPLE" ]]; then
  echo "Missing client example file: $CLIENT_EXAMPLE" >&2
  exit 1
fi

if [[ ! -f "$SERVER_EXAMPLE" ]]; then
  echo "Missing server example file: $SERVER_EXAMPLE" >&2
  exit 1
fi

if [[ ! -f "$CLIENT_ENV_FILE" ]]; then
  cp "$CLIENT_EXAMPLE" "$CLIENT_ENV_FILE"
  echo "Created $CLIENT_ENV_FILE from example."
fi

if [[ ! -f "$SERVER_ENV_FILE" ]]; then
  cp "$SERVER_EXAMPLE" "$SERVER_ENV_FILE"
  echo "Created $SERVER_ENV_FILE from example."
fi

generate_demo_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    echo "demo-dev-secret-change-me-please-change-this-value"
  fi
}

validate_value() {
  local key="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    return 1
  fi

  case "$key" in
    VITE_GOOGLE_CLIENT_ID|GOOGLE_CLIENT_ID)
      # Reject obvious placeholders and demo values so the user is forced to provide a real client ID
      if [[ "$value" == *"your-google-client-id-here"* || "$value" == *"replace_with_"* || "$value" == *"demo-google-client-id"* ]]; then
        echo "Invalid value for $key. Replace placeholder/demo with a real Google OAuth client ID (e.g. 1234567890-abcde.apps.googleusercontent.com)" >&2
        return 1
      fi
      if [[ ! "$value" =~ ^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$ ]]; then
        echo "Invalid value for $key. Expected a Google OAuth client ID like 1234567890-abcde.apps.googleusercontent.com" >&2
        return 1
      fi
      ;;
    JWT_SECRET)
      if (( ${#value} < 32 )); then
        echo "Invalid value for $key. Use at least 32 characters for a secure secret." >&2
        return 1
      fi
      ;;
  esac

  return 0
}

prompt_for_value() {
  local key="$1"
  local prompt_text="$2"
  local default_value="${3:-}"
  local answer=""

  while true; do
    if [[ -n "$default_value" ]]; then
      read -r -p "$prompt_text [$default_value]: " answer
      answer="${answer:-$default_value}"
    else
      read -r -p "$prompt_text: " answer
    fi

    if validate_value "$key" "$answer"; then
      echo "$answer"
      return 0
    fi
  done
}

ensure_key_value() {
  local file_path="$1"
  local key="$2"
  local prompt_text="$3"
  local default_value="${4:-}"

  local current_value=""
  current_value="$(grep -E "^${key}=" "$file_path" | head -n 1 | cut -d= -f2- || true)"

  local placeholder_match=0
  if [[ -n "$current_value" ]]; then
    case "$current_value" in
      *"your-google-client-id-here"*|*"replace_with_"*|*"your-secret-here"*|*"example"*|*"demo-google-client-id"*)
        placeholder_match=1
        ;;
    esac
  fi

  if [[ -z "$current_value" || "$placeholder_match" -eq 1 ]]; then
    local answer="$(prompt_for_value "$key" "$prompt_text" "$default_value")"

    if grep -q "^${key}=" "$file_path"; then
      sed -i.bak -E "s|^${key}=.*|${key}=${answer}|" "$file_path"
    else
      printf '\n%s=%s\n' "$key" "$answer" >> "$file_path"
    fi
  elif ! validate_value "$key" "$current_value"; then
    local answer="$(prompt_for_value "$key" "$prompt_text" "$default_value")"

    if grep -q "^${key}=" "$file_path"; then
      sed -i.bak -E "s|^${key}=.*|${key}=${answer}|" "$file_path"
    else
      printf '\n%s=%s\n' "$key" "$answer" >> "$file_path"
    fi
  fi
}

ensure_key_value "$CLIENT_ENV_FILE" "VITE_API_URL" "Enter the frontend API URL" "http://localhost:5000"

CLIENT_GOOGLE_VALUE="$(grep -E "^VITE_GOOGLE_CLIENT_ID=" "$CLIENT_ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
SERVER_GOOGLE_VALUE="$(grep -E "^GOOGLE_CLIENT_ID=" "$SERVER_ENV_FILE" | head -n 1 | cut -d= -f2- || true)"

if [[ -z "$CLIENT_GOOGLE_VALUE" || -z "$SERVER_GOOGLE_VALUE" ]]; then
  GOOGLE_CLIENT_ID_INPUT="$(prompt_for_value "VITE_GOOGLE_CLIENT_ID" "Enter the Google OAuth client ID used by both frontend and backend" "demo-google-client-id.apps.googleusercontent.com")"
  sed -i.bak -E "s|^VITE_GOOGLE_CLIENT_ID=.*|VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID_INPUT}|" "$CLIENT_ENV_FILE"
  sed -i.bak -E "s|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID_INPUT}|" "$SERVER_ENV_FILE"
  echo "Google OAuth value updated in both frontend and backend env files."
elif ! validate_value "VITE_GOOGLE_CLIENT_ID" "$CLIENT_GOOGLE_VALUE" || ! validate_value "GOOGLE_CLIENT_ID" "$SERVER_GOOGLE_VALUE"; then
  GOOGLE_CLIENT_ID_INPUT="$(prompt_for_value "VITE_GOOGLE_CLIENT_ID" "Enter the Google OAuth client ID used by both frontend and backend" "demo-google-client-id.apps.googleusercontent.com")"
  sed -i.bak -E "s|^VITE_GOOGLE_CLIENT_ID=.*|VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID_INPUT}|" "$CLIENT_ENV_FILE"
  sed -i.bak -E "s|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID_INPUT}|" "$SERVER_ENV_FILE"
  echo "Google OAuth value updated in both frontend and backend env files."
fi

ensure_key_value "$SERVER_ENV_FILE" "PORT" "Enter server port" "5000"
ensure_key_value "$SERVER_ENV_FILE" "MONGO_URI" "Enter Mongo connection string for Docker" "mongodb://mongo:27017/expense_manager?replicaSet=rs0"
ensure_key_value "$SERVER_ENV_FILE" "REDIS_URL" "Enter Redis URL for Docker" "redis://redis:6379"
ensure_key_value "$SERVER_ENV_FILE" "JWT_SECRET" "Enter a secure JWT secret" "$(generate_demo_secret)"
ensure_key_value "$SERVER_ENV_FILE" "CORS_ORIGIN" "Enter frontend allowed origin list" "http://localhost:5173,http://127.0.0.1:5173"

echo "Environment files are ready. Starting Docker Compose..."

cd "$ROOT_DIR"
docker compose up --build
