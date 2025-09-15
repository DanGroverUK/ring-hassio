#!/usr/bin/env bash
set -euo pipefail

OPTIONS=/data/options.json

TOKEN=$(jq -r '.ring_refresh_token' "$OPTIONS")
NAME=$(jq -r '.camera_name' "$OPTIONS")
QUALITY=$(jq -r '.stream_quality // "high"' "$OPTIONS")
DEBUG=$(jq -r '.debug // false' "$OPTIONS")
PORT=$(jq -r '.port // 8080' "$OPTIONS")

CODEC=$(jq -r '.video_codec // "auto"' "$OPTIONS")
HWACCEL=$(jq -r '.hwaccel // "auto"' "$OPTIONS")

HA_INT=$(jq -r '.ha_integration // true' "$OPTIONS")
HA_ENTITY=$(jq -r '.ha_entity_id // "binary_sensor.ring_livestream_playing"' "$OPTIONS")
HA_PREFIX=$(jq -r '.ha_event_prefix // "ring_livestream"' "$OPTIONS")
HA_BASE=$(jq -r '.ha_base_url // ""' "$OPTIONS")
HA_LL_TOKEN=$(jq -r '.ha_long_lived_token // ""' "$OPTIONS")

export NODE_ENV=production


ARGS=(--token "$TOKEN" --name "$NAME" --quality "$QUALITY" --port "$PORT"
      --codec "$CODEC" --hwaccel "$HWACCEL"
      --ha-integration "$HA_INT" --ha-entity "$HA_ENTITY" --ha-prefix "$HA_PREFIX")

[[ -n "$HA_BASE" ]] && ARGS+=(--ha-base "$HA_BASE")
[[ -n "$HA_LL_TOKEN" ]] && ARGS+=(--ha-token "$HA_LL_TOKEN")
[[ "$DEBUG" == "true" ]] && ARGS+=("--debug")

# echo "Current value of SUPERVISOR_TOKEN is: ${SUPERVISOR_TOKEN}"
cd /ringcam
echo "Current directory is: $(pwd)"
echo "Contents of $(pwd) is:"
ls -lart
echo "Starting Ring HLS server on port $PORT (quality=$QUALITY, codec=${CODEC}, hwaccel=${HWACCEL})"
node server.js "${ARGS[@]}"
