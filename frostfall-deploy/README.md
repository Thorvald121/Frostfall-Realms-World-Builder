# ◈ Frostfall Realms — Deployment Guide

A dark fantasy worldbuilding engine built with Next.js, Supabase, and deployed on Vercel.

---

## Prerequisites

- A [GitHub](https://github.com) account
- [Node.js](https://nodejs.org) 18+ installed locally
- A [Supabase](https://supabase.com) account (free)
- A [Vercel](https://vercel.com) account (free)
- Optionally: An [Anthropic API key](https://console.anthropic.com) for AI Document Import

---

## Step 1: Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `frostfall-realms`
3. Set to **Public** or **Private** (your choice)
4. Click **Create repository**
5. Clone it locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/frostfall-realms.git
   cd frostfall-realms
   ```
6. Copy all files from this deployment package into the repo folder

---

## Step 2: Set Up Supabase

### 2a. Create Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name: `frostfall-realms`
3. Set a database password (save this!)
4. Region: Choose closest to you
5. Click **Create new project** and wait ~2 minutes

### 2b. Run Database Schema

1. In Supabase Dashboard → **SQL Editor** → **New Query**
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run** — you should see "Success. No rows returned."

### 2c. Enable Auth Providers

1. Go to **Authentication** → **Providers**
2. **Email**: Already enabled by default
3. **Google** (optional):
   - Toggle ON
   - Add your Google OAuth Client ID and Secret
   - [Google Cloud Console guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
4. **GitHub** (optional):
   - Toggle ON
   - Add your GitHub OAuth App credentials
   - [GitHub OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-github)

### 2d. Get Your API Keys

1. Go to **Settings** → **API**
2. Copy **Project URL** (looks like `https://xxxxx.supabase.co`)
3. Copy **anon/public key** (starts with `eyJ...`)

---

## Step 3: Configure Environment

1. Copy the template:
   ```bash
   cp .env.example .env.local
   ```
2. Fill in your keys:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ANTHROPIC_API_KEY=your-anthropic-key-here
   ```

---

## Step 4: Test Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the auth screen.

1. Create an account with email/password
2. Check your email for confirmation (Supabase sends one by default)
3. Sign in and verify the app works with your data

---

## Step 5: Deploy to Vercel

### 5a. Push to GitHub

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

### 5b. Import to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Select your `frostfall-realms` GitHub repo
3. Framework Preset: **Next.js** (auto-detected)
4. **Environment Variables** — add these:

   | Variable | Value |
   |----------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
   | `NEXT_PUBLIC_ANTHROPIC_API_KEY` | Your Anthropic API key |
   | `NEXT_PUBLIC_BMAC_URL` | Your Buy Me a Coffee link |
   | `NEXT_PUBLIC_KOFI_URL` | Your Ko-fi link |
   | `NEXT_PUBLIC_STRIPE_URL` | Your Stripe donation link |

5. Click **Deploy**
6. Wait ~60 seconds for the build

### 5c. Update Supabase Auth Redirect

After deployment, you'll get a URL like `https://frostfall-realms.vercel.app`

1. Go to Supabase → **Authentication** → **URL Configuration**
2. Set **Site URL** to your Vercel URL
3. Add your Vercel URL to **Redirect URLs**

---

## Step 6: Set Up Donations (Optional)

### Buy Me a Coffee
1. Sign up at [buymeacoffee.com](https://buymeacoffee.com)
2. Get your page URL
3. Add as `NEXT_PUBLIC_BMAC_URL` in Vercel env vars

### Ko-fi
1. Sign up at [ko-fi.com](https://ko-fi.com)
2. Get your page URL
3. Add as `NEXT_PUBLIC_KOFI_URL` in Vercel env vars

### Stripe
1. Create a Stripe Payment Link at [dashboard.stripe.com/payment-links](https://dashboard.stripe.com/payment-links)
2. Add as `NEXT_PUBLIC_STRIPE_URL` in Vercel env vars

---

## Step 7: Custom Domain (Optional)

1. In Vercel → Your Project → **Settings** → **Domains**
2. Add your domain (e.g., `frostfallrealms.com`)
3. Follow Vercel's DNS configuration instructions
4. Update Supabase Site URL to match

---

## Project Structure

```
frostfall-realms/
├── app/
│   ├── layout.jsx          # Root layout with fonts & global styles
│   └── page.jsx            # Main page (AuthGate → FrostfallRealms)
├── components/
│   ├── AuthGate.jsx         # Login/Register/OAuth auth flow
│   └── FrostfallRealms.jsx  # Main worldbuilding app (1800+ lines)
├── lib/
│   └── supabase.js          # Supabase client + DB helpers
├── supabase/
│   └── schema.sql           # Database tables, RLS policies, storage
├── public/                   # Static assets
├── .env.example              # Environment variable template
├── .gitignore
├── next.config.js
├── package.json
└── README.md                 # This file
```

---

## Free Tier Limits

| Service | Free Tier |
|---------|-----------|
| **Vercel** | 100GB bandwidth, unlimited deploys, 1 project |
| **Supabase** | 500MB database, 1GB file storage, 50K monthly users |
| **Anthropic** | Pay-per-use ($3/M input tokens with Sonnet) |

You'll only need to upgrade if you get thousands of active users.

---

## Troubleshooting

**"Invalid API key" on login** → Double-check your Supabase anon key in Vercel env vars

**OAuth redirects to wrong URL** → Update Supabase Auth → URL Configuration with your Vercel URL

**AI Import not working** → Verify your Anthropic API key is set in env vars

**Data not saving** → Check Supabase Dashboard → Logs for RLS policy errors

**Build fails on Vercel** → Check build logs; common issue is missing `"use client"` directive

---

## Future Roadmap

- [ ] World Map module (interactive regions)
- [ ] Relationship Web (force-directed graph)
- [ ] Manuscript / Novel structure
- [ ] Multi-world support UI
- [ ] Public world sharing (read-only links)
- [ ] Collaborative editing
- [ ] Version history
