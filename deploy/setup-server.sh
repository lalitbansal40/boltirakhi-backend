#!/usr/bin/env bash
#
# Fresh Ubuntu 24.04 (t3.medium) ko boltirakhi chalane layak banata hai.
# Ek hi baar chalana hai, ubuntu user se:
#
#   bash setup-server.sh
#
set -euo pipefail

echo "==> System update"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Node 22 (LTS)"
# Ubuntu ka apna node purana hai; backend >=20 maangta hai aur Next 16 ko
# 20+ chahiye.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v

echo "==> nginx, certbot, git"
sudo apt-get install -y nginx certbot python3-certbot-nginx git

echo "==> PM2"
sudo npm install -g pm2

echo "==> Folders"
sudo mkdir -p /var/www /var/www/logs /var/www/coming-soon
sudo chown -R ubuntu:ubuntu /var/www

# t3.medium par 4 GB RAM hai, jo Next ke build ke liye kaafi hai. 2 GB swap
# phir bhi rakha ja raha hai — do Next app ek saath build karne par spike
# aata hai, aur swap ke bina wo OOM kill ban jaata hai (build "bina wajah"
# marta hua dikhta hai).
if ! sudo swapon --show | grep -q '/swapfile'; then
  echo "==> 2 GB swap"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo "==> swap pehle se hai, chhod raha hoon"
fi

echo "==> Firewall"
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status

echo "==> Timezone IST"
# Server ke logs aur cron IST me padhne me aasan rehte hain. App ke andar ka
# IST handling isse alag hai (utils/istDate.ts) — wo UTC se hi chalta hai.
sudo timedatectl set-timezone Asia/Kolkata

echo
echo "==================================================="
echo " Ho gaya."
echo
echo " node    : $(node -v)"
echo " nginx   : $(nginx -v 2>&1)"
echo " pm2     : $(pm2 -v)"
echo " swap    : $(free -h | awk '/Swap/{print $2}')"
echo
echo " Aage: README.md ka STEP 5 — code clone karo"
echo "==================================================="
