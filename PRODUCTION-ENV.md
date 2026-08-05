# Production `.env` — server par kya set karna hai

Ye file **jaan-bujh kar khaali** hai. Asli value kabhi git me nahi jaati.
Server par `.env` kholo aur ye sab set karo, phir restart karo.

---

## Abhi galat ya khaali hai — `/api/health` isi ki shikayat kar raha hai

```
PUBLIC_SITE_URL=https://boltirakhi.com
```
🔴 **QR isi se banta hai.** Localhost raha to QR chhap kar parcel ke saath chala
jaayega aur galti tab pata chalegi jab kuch nahi ho sakta.

```
CORS_ORIGINS=https://boltirakhi.com,https://www.boltirakhi.com
```
Ab code www/non-www ko ek hi maanta hai, par dono likh dena saaf rehta hai.

```
RAZORPAY_MODE=test          # live jaane par 'live'
RAZORPAY_KEY_ID=            # rzp_test_... (live par rzp_live_...)
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=    # Razorpay dashboard → Webhooks
```
🔴 Mode aur key ka **mel hona chahiye**. Baad me `/api/health` par
`payments.mismatch` **false** dikhna chahiye.

```
SMS_ENABLED=true
SMS_USERNAME=               # NotifyNow
SMS_PASSWORD=
```
`false` raha to OTP sirf server ke log me chhapega — koi login nahi kar payega.

```
EMAIL_ENABLED=true
RESEND_API_KEY=
EMAIL_FROM=Bolti Rakhi <orders@boltirakhi.com>
```
`EMAIL_FROM` **Resend par verified domain ka hona chahiye**, warna 403 —
aur wo error bad key jaisa dikhta hai jabki DNS ki baat hoti hai.

```
AWS_REGION=ap-south-1
AWS_S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```
🔴 Inke bina **Bolti record karna 503 deta hai** — poora USP band. Bucket par
CORS me asli domain daalna mat bhoolna, warna browser se upload block hoga.

---

## Pehle se set hai — chhedna mat

```
NODE_ENV=production
PORT=
MONGODB_URI=
JWT_SECRET=                 # production ka alag ho
ADMIN_SEED_EMAIL=
ADMIN_SEED_PASSWORD=
```

## Abhi zaroorat nahi

```
SHIPROCKET_ENABLED=false
SHIPROCKET_EMAIL=
SHIPROCKET_PASSWORD=
AWS_CDN_DOMAIN=             # CloudFront lagne par
```

---

## Set karne ke baad

```bash
# restart
pm2 restart boltirakhi-api      # ya jo bhi process manager ho

# search ka index — bina iske search KHAALI aayegi aur koi error nahi dikhega
npm run reindex

# jaanch
curl -s https://api.boltirakhi.com/api/health
```

`/api/health` me ye teen dekhna:

| Field | Kya hona chahiye |
|---|---|
| `payments.configured` | `true` |
| `payments.mismatch` | **`false`** — `true` aaya to live mat jaana |
| `notifications` | `["sms","email"]` — khaali array matlab creds nahi lage |

---

## Razorpay dashboard par ek kaam

Webhooks → naya endpoint:
```
https://api.boltirakhi.com/api/webhooks/razorpay
Event: payment.captured
```
🔴 Bina iske jo customer payment ke baad tab band kar dega, uska order
`created` me atka rahega **aur paisa aa chuka hoga**.
