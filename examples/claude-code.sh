#!/usr/bin/env bash
# Launch Claude Code through llm-gate.
# Adjust LLM_GATE_TOKEN if you set LLM_GATE_AUTH_TOKEN on the server.

set -euo pipefail

LLM_GATE_HOST="${LLM_GATE_HOST:-127.0.0.1}"
LLM_GATE_PORT="${LLM_GATE_PROXY_PORT:-8082}"
LLM_GATE_TOKEN="${LLM_GATE_TOKEN:-any}"

export ANTHROPIC_BASE_URL="http://${LLM_GATE_HOST}:${LLM_GATE_PORT}"
export ANTHROPIC_AUTH_TOKEN="${LLM_GATE_TOKEN}"

echo "→ ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
exec claude "$@"
