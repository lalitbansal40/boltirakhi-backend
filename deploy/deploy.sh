#!/usr/bin/env bash
#
# Backend ko update karke restart karta hai.
#
#   cd /var/www/boltirakhi-backend && bash deploy/deploy.sh
#
# GitHub Actions bhi yahi chalata hai, taaki manual aur automatic deploy
# me koi farak na rahe.
#
set -euo pipefail

APP_DIR="/var/www/boltirakhi-backend"
PM2_NAME="boltirakhi-api"

cd "$APP_DIR"

echo "==> Pehle: $(git rev-parse --short HEAD)"

# Rollback ke liye — kuch toota to `git checkout <ye hash>` kaafi hai.
PREVIOUS=$(git rev-parse HEAD)

git fetch origin main
git reset --hard origin/main

echo "==> Ab: $(git rev-parse --short HEAD)"

# `npm ci`, `npm install` nahi — lockfile se bilkul wahi versions aayenge
# jo test hue the. `install` chupchaap minor version badal deta hai.
#
# dev dependencies bhi chahiye: build `tsc` se hota hai aur wo unhi me hai.
# `--omit=dev` yahan nahi lagana — wo fail nahi hota, bas typescript chhod
# deta hai, aur agla step "tsc: not found" par mar jaata hai.
echo "==> Dependencies"
npm ci

echo "==> Build"
npm run build

# Build ho chuka, ab dev dependencies ki zaroorat nahi — RAM aur disk khaali.
echo "==> Dev dependencies hata rahe hain"
npm prune --omit=dev

# Build ke baad hi restart — pehle karoge to purani dist chalti rahegi aur
# lagega deploy ka koi asar nahi hua.
echo "==> Restart"
pm2 restart "$PM2_NAME" --update-env

# PM2 "restart" bolne ke baad bhi process crash-loop me ja sakta hai; ye
# poochhta hai ki wo sach me zinda hai.
echo "==> Health check"
sleep 4

for attempt in 1 2 3 4 5; do
  if curl -fsS localhost:5000/api/health >/dev/null 2>&1; then
    STATUS=$(curl -s localhost:5000/api/health)
    echo "    ok: $STATUS"

    if echo "$STATUS" | grep -q '"db":"connected"'; then
      echo
      echo "✅ Deploy ho gaya — $(git rev-parse --short HEAD)"
      exit 0
    fi

    echo "⚠️  App chalu hai par DB se juda nahi."
    echo "    Atlas → Network Access me EC2 ka IP dekho."
    exit 1
  fi

  echo "    koshish $attempt/5…"
  sleep 3
done

echo
echo "❌ Health check fail. Rollback ke liye:"
echo "   git reset --hard $PREVIOUS && npm ci && npm run build && pm2 restart $PM2_NAME"
echo
pm2 logs "$PM2_NAME" --lines 30 --nostream
exit 1
