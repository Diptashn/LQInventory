#!/usr/bin/env bash
# Test the export-to-sheet endpoint end-to-end: login -> get token -> call export.
set -euo pipefail
BASE="https://lq-inventory.vercel.app"

LOGIN=$(curl -s -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"dipta","password":"admin123"}')

TOKEN=$(printf '%s' "$LOGIN" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')

if [ -z "$TOKEN" ]; then
  echo "LOGIN FAILED: $LOGIN"
  exit 1
fi
echo "token ok (len=${#TOKEN})"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/export-to-sheet" \
  -w "\n[HTTP:%{http_code}]\n"