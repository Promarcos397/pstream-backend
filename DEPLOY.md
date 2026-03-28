# P-Stream Giga Backend Deployment Guide

This backend is designed for **Hugging Face Spaces (Docker)** but should be managed via **GitHub** for versioning and easy updates.

## Step 1: Initialize Git Local (Run this first)
Run the following in your terminal inside the `giga-backend` folder:
```powershell
git init
git add .
git commit -m "Initial Giga Engine Deployment"
```

## Step 2: Create a Private GitHub Repository
1. Go to [github.com/new](https://github.com/new)
2. Name it `pstream-giga-backend`
3. Set it to **Private**
4. Copy the "Remote URL" (e.g., `https://github.com/yourname/pstream-giga-backend.git`)

## Step 3: Push to GitHub
Replace `YOUR_URL` with the one you copied:
```powershell
git remote add origin YOUR_URL
git branch -M main
git push -u origin main
```

## Step 4: Connect to Hugging Face
1. Go to [huggingface.co/new-space](https://huggingface.co/new-space)
2. Name your space (e.g., `p-stream-giga`)
3. Select **Docker** as the SDK.
4. Instead of manual upload, choose **"Connect a GitHub repository"** (if available) OR simply follow the "Push to HF" instructions using the HF remote URL.

## Step 5: Environment Variables (CRITICAL)
In your Hugging Face Space Settings, add these **Secrets**:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `JWT_SECRET`
- `REDIS_URL` (From Upstash)
- `ISP_PROXY_HOST`, `ISP_PROXY_PORT`, `ISP_PROXY_USERNAME`, `ISP_PROXY_PASSWORD`

---
*Giga Engine - High Performance Streaming for P-Stream*
