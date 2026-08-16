# BloodLink for Android (friends)

This is a **client**. It does not host a server. The host’s computer runs BloodLink; this app only opens their secret join address.

## Easiest (no Android Studio)

1. Get the secret link from the host (Invite People).
2. Open it in **Chrome**.
3. Menu → **Add to Home screen** / **Install app**.
4. Type a username and password.

## Android Studio

1. File → Open this `android` folder.
2. Run on a phone or emulator.
3. First launch: paste the host’s **full secret URL** (the `https://….trycloudflare.com/?g=…&invite=…` link), not a LAN IP, unless you are on the same Wi‑Fi as a host that published one.
4. ⋮ → **Change server** if the tunnel address changed.

The app asks for the microphone only if you join a voice channel. Voice is relayed by the host; other users do not see your IP.
