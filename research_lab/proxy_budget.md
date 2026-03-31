# 🌐 Defensive Architecture: Why we need Residential Proxies

To solve the "Falling back to embed" and "Handshake 403" problems.

## 🧱 The Data Center Problem
- Providers (VidSrc, etc.) use Cloudflare/Akamai.
- Data-center IPs (Hugging Face, AWS, GCP, Azure) are ALL categorized as "Low Reputation."
- They will ALWAYS return a 403 or a Captcha for any AJAX request (`/ajax/embed/episode/...`).
- **Result**: We can ONLY get the `iframe` (which works on the client browser), but NEVER the direct `M3U8` content.

## 🏗️ The Residential Solution
- **Method**: Use a "Pay-As-You-Go" residential proxy provider.
- **Traffic**: We ONLY proxy the "Handshake" (fetching the encrypted string). We do NOT proxy the video itself (3GB+).
- **Cost**: A typical 10KB handshake means 1GB of data lasts for ~100,000 requests.

## 💎 Recommended Providers
 | Provider | Start Price | Price/GB | Protocol |
 | --- | --- | --- | --- |
 | **SmartProxy** | $12.50 | $12.50 | HTTP(S) / SOCKS5 |
 | **Bright Data** | $15.00 | $15.00 | HTTP(S) / SOCKS5 |
 | **Proxy-Cheap** | $4.00 | $4.00 | HTTP(S) / SOCKS5 |
 | **HydraProxy** | $5.00 | $5.00 | HTTP(S) / SOCKS5 |

---
> [!TIP]
> I recommend starting with **Proxy-Cheap** or **HydraProxy** for a $5 test. This will likely fix the 403 blocks instantly.
