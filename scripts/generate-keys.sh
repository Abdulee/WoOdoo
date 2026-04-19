#!/usr/bin/env bash
# =============================================================================
# WoOdoo — Generate Secret Keys
# =============================================================================
# Generates SECRET_KEY (32-byte hex) and FERNET_KEY for the .env file.
#
# Usage:
#   bash scripts/generate-keys.sh          # Print keys to stdout
#   bash scripts/generate-keys.sh --write  # Append/update keys in .env
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Generate a 32-byte hex SECRET_KEY
generate_secret_key() {
    python3 -c "import secrets; print(secrets.token_hex(32))"
}

# Generate a Fernet encryption key
generate_fernet_key() {
    python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
}

echo -e "${GREEN}=== WoOdoo Key Generator ===${NC}"
echo ""

SECRET_KEY=$(generate_secret_key)
echo -e "${YELLOW}SECRET_KEY${NC}=${SECRET_KEY}"

FERNET_KEY=$(generate_fernet_key 2>/dev/null) || {
    echo -e "${RED}Warning: cryptography package not installed. Skipping FERNET_KEY.${NC}"
    echo -e "${RED}Install with: pip install cryptography${NC}"
    FERNET_KEY=""
}

if [ -n "$FERNET_KEY" ]; then
    echo -e "${YELLOW}FERNET_KEY${NC}=${FERNET_KEY}"
fi

echo ""

# If --write flag is passed, update/create .env file
if [[ "${1:-}" == "--write" ]]; then
    ENV_FILE="${2:-.env}"

    if [ ! -f "$ENV_FILE" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example "$ENV_FILE"
            echo -e "${GREEN}Created ${ENV_FILE} from .env.example${NC}"
        else
            touch "$ENV_FILE"
            echo -e "${GREEN}Created empty ${ENV_FILE}${NC}"
        fi
    fi

    # Update SECRET_KEY
    if grep -q "^SECRET_KEY=" "$ENV_FILE"; then
        sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" "$ENV_FILE"
        echo -e "${GREEN}Updated SECRET_KEY in ${ENV_FILE}${NC}"
    else
        echo "SECRET_KEY=${SECRET_KEY}" >> "$ENV_FILE"
        echo -e "${GREEN}Added SECRET_KEY to ${ENV_FILE}${NC}"
    fi

    # Update FERNET_KEY
    if [ -n "$FERNET_KEY" ]; then
        if grep -q "^FERNET_KEY=" "$ENV_FILE"; then
            sed -i "s|^FERNET_KEY=.*|FERNET_KEY=${FERNET_KEY}|" "$ENV_FILE"
            echo -e "${GREEN}Updated FERNET_KEY in ${ENV_FILE}${NC}"
        else
            echo "FERNET_KEY=${FERNET_KEY}" >> "$ENV_FILE"
            echo -e "${GREEN}Added FERNET_KEY to ${ENV_FILE}${NC}"
        fi
    fi

    echo ""
    echo -e "${GREEN}Done! Keys written to ${ENV_FILE}${NC}"
else
    echo -e "To write these keys to your .env file, run:"
    echo -e "  ${YELLOW}bash scripts/generate-keys.sh --write${NC}"
    echo ""
    echo -e "Or copy the values above into your .env file manually."
fi
