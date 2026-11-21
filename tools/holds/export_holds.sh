#!/usr/bin/env bash
# 銃の持ち方を weapon_poses.blend から書き出す (export_holds.py の注)。.blend は読むだけ
#     bash tools/holds/export_holds.sh [--check]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUT="$ROOT/src/presentation/scene/arms/holds.generated.ts"
set +e
"$BLENDER" -b "$ROOT/tools/raw/weapon_poses.blend" --factory-startup --python "$ROOT/tools/holds/export_holds.py" -- "$ROOT" "$OUT" "$@" 2>&1 | grep "^HOLD"
code=${PIPESTATUS[0]}
set -e
exit $code
