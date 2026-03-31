# 🛠️ VidSrc Decryption Matrix (Audit v7.0)

Extracted from latest community research (cool-dev-guy, 0xamo).

## 🔑 Hardcoded Keys
- **KEY_ALPHA**: `pWB9V)[*4I'nJpp?ozyB~dbr9yt!_n4u` (Dispatcher Type: `Iry9MQXnLs`)
- **KEY_BETA**: `3SAY~#%Y(V%>5d/Yg"$G[Lh1rK4a;7ok` (Dispatcher Type: `detdj7JHiK`)
- **KEY_GAMMA**: `X9a(O;FMV2-7VO5x;Ao :dN1NoFs?j,` (Dispatcher Type: `C66jPHx8qu`)

## 🧬 Transformation Algorithms
1. **The Stutter Step**: Reverse string -> Take every 2nd character.
2. **The Shift Cluster**:
    - Type `-3`: CharCode - 3.
    - Type `-5`: CharCode - 5.
    - Type `-7`: CharCode - 7.
3. **The Block Flip**: Split string into 3-char chunks -> Reverse chunks -> Rejoin.
4. **ROT13**: Standard alphabet rotation.

## 📡 Source Handshakes
### VidPlay (The "futoken" Method)
1. Fetch `https://vidplay.online/futoken`.
2. Extract the `var k = [...]` integer array.
3. Use those integers to XOR the media ID.
4. Call `mediainfo/{hash}` for the M3U8.

### FileMoon (The "Playerjs" Method)
1. Search for `sources: [...]` or `file: "..."` in the obfuscated JS.
2. Usually just requires a correct Referer to unwrap.
