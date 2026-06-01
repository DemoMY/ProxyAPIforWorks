#!/usr/bin/env bash
# Plain curl test against the Anthropic-compatible /v1/messages endpoint.

set -euo pipefail

BASE="${LLM_GATE_BASE:-http://127.0.0.1:8082}"
TOKEN="${LLM_GATE_TOKEN:-any}"

curl "$BASE/v1/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 100,
    "messages": [
      {"role": "user", "content": "Скажи Привет одним словом."}
    ]
  }'
