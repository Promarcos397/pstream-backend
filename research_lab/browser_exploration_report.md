# 🛡️ Browser Agent: VidSrc Architecture & Multi-Repo Blueprint Report

![Browser Recording](file:///C:/Users/ibrah/.gemini/antigravity/brain/2682f852-2e6a-40f8-8417-8ceb3c7d9d44/vidsrc_repo_explore_1774901317919.webp)

#### 1. Architectural Overhaul: Modular Providers vs. Simple Scripts
Across the four repositories, I identified two distinct architectural patterns:

*   **Modular Provider Pattern (`cinepro-org/core`, `cool-dev-guy/vidsrc.ts`):** 
    *   Uses a **Class-based approach**. Each source (VidPlay, FileMoon, Vidsrc) is a dedicated class inheriting from a `BaseProvider`.
    *   **Logic:** Centralized `resolver` picks a provider, which then handles its own unique fetching, extraction, and decryption logic.
    *   **Recommendation:** This is what we should follow for our `extractors/` folder to ensure scalability.
*   **Sequential Ajax Chain (`Rararazzbian/VidsrcFetcher`):** 
    *   Focuses on the **AJAX handshake** of `vidsrc.to`. It follows a strict sequence: `Embed ID` -> `Data-ID` -> `Source List` -> `Encoded URL` -> `Decrypted Stream`.
    *   Uses **TLS Fingerprinting** via `curl_cffi` (Python) to impersonate a real browser, which is the most reliable way to bypass Cloudflare 403 blocks.

#### 2. The Decryption "Holy Grail" (decoder.ts logic)
The `cool-dev-guy/vidsrc.ts` repository contains the definitive JS implementations for the `vkey` decryption algorithms. Here are the core functions we need to port:

| Algorithm Name | Logical Operations | Key / Constant |
| :--- | :--- | :--- |
| **Stutter Step** (`GTAxQyTyBx`) | Reverse String -> Take every 2nd char -> Base64 Decode | N/A |
| **Block Flip** (`bMGyx71TzQLfdonN`) | Split into 3-char chunks -> Reverse Chunks -> Join | N/A |
| **Shift Cluster** (`Iry9MQXnLs`) | Hex Decode -> XOR with Key -> CharCode Shift (-3) | `pWB9V)[*4I'nJpp?ozyB~dbr9yt!_n4u` |
| **ROT13 Reverse** (`IGLImMhWrI`) | Reverse -> ROT13 Substitution -> Reverse -> Base64 | N/A |
| **Base64 Shift** (`laM1dAi3vO`) | Reverse -> URL-Safe Base64 Fix -> Decode -> Shift (-5) | N/A |

#### 3. VidPlay & `futoken` Deep Dive
`Rararazzbian/VidsrcFetcher` reveals the exact flow for VidPlay (the most common provider):
1.  **Handshake:** Fetch `https://vidplay.online/e/{hash}` with a proper Referer.
2.  **Token Generation:** Fetch `https://vidplay.online/futoken`. This returns a JavaScript snippet that calculates a dynamic key based on local environment variables (like `window.location.host`).
3.  **Media Info:** Call `https://vidplay.online/mediainfo/{hash}?autostart=true&key={generated_token}&v={timestamp}`.
4.  **Result:** This returns a JSON object containing the encrypted M3U8 URL and subtitles.

#### 4. FileMoon & Playerjs Unpacking
`0xamo/vidsrc` and `cinepro-org/core` provide the blueprint for FileMoon extraction:
*   They don't use heavy decryption. Instead, they look for the `Playerjs` configuration object.
*   **Domain Mapping:** They use a dictionary to resolve internal placeholders:
    `{v1}` maps to `shadowlandschronicles.com`, `{v2}` maps to `cloudnestra.com`.
*   **Regex:** They use `file:\s*"([^"]+)"` to extract string placeholders containing M3U8 streams.

#### 5. Alternative Mirrors & Bypassing
A major discovery in `cinepro-org/core` is the use of **Mirrors**:
*   Instead of hitting `vidsrc.to` directly (which has heavy Cloudflare protection), they use **`vsembed.ru`** or **`vidsrcme.ru`**.
*   These mirrors host the same content with significantly weaker anti-bot protection.
