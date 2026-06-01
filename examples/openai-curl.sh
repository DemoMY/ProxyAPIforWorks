#!/usr/bin/env bash
# Plain curl test against the OpenAI-compatible endpoint.

set -euo pipefail

BASE="${LLM_GATE_BASE:-http://127.0.0.1:8082}"
TOKEN="${LLM_GATE_TOKEN:-any}"

curl "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [
      {"role": "user", "content": "Скажи Привет одним словом."}
    ],
    "max_tokens": 50
  }'
