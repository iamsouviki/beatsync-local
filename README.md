# BeatSync Local

An experimental, self-hosted Wi-Fi audio room. Share audio from a desktop browser tab or native sender with other devices connected to the same local network.

## Status

This is a prototype, not a universal Chromecast/AirPlay receiver. Browser audio paths and room APIs have automated coverage. Android and iPhone companion builds have compiled, but native music-service compatibility and locked-screen playback have not been verified across physical devices. Protected apps can block capture. Receivers buffer independently; sample-accurate synchronization is not implemented.

## Run locally

Requires Node.js 22 or newer. The web server has no npm dependencies.

```sh
npm start
```

Open the localhost address printed in the terminal. On other devices, open the printed Wi-Fi URL, **using the same port**, then join the host's room code. Keep the host room open. Rooms are in memory and expire when their members leave or the server restarts. No accounts are required.

The default HTTP port is 3000. To configure ports, copy `.env.example` to `.env`. The macOS background service uses port 3001 and HTTPS port 3444. Avoid running multiple instances on different ports: they have separate room lists.

### Browser tab audio

On desktop Chrome or Edge, play music in another tab, click **Cast a music tab**, select that tab, and enable **Share tab audio**. Audio tracks are sent through WebRTC; no screen video is transmitted. Receivers may need to tap **Play incoming audio**. Play/pause stays in the source tab. Phone browsers can receive but generally cannot capture other apps' audio.

Localhost is treated as a secure context for browser capture. Sending from another computer requires trusted HTTPS. Joining over HTTP may trigger a browser security prompt or local-network permission. Chrome-specific failures should be distinguished from network reachability using another browser or a plain HTTP diagnostic server.

### Native Mac apps

Requires macOS 13+, Xcode command-line tools, and screen/system-audio recording permission:

```sh
npm run build:native
```

Create a room on the server Mac's **localhost** address and select **Cast Mac apps**. The ScreenCaptureKit helper emits audio buffers only. Major browsers are excluded to prevent feedback; use tab sharing for browser sources. The Mac plays its original app audio while room listeners receive PCM over the HTTP/HTTPS event stream. Guests cannot start system capture remotely.

### Android companion

The Android 10+ companion captures app playback through MediaProjection and sends stereo PCM directly to the room over Wi-Fi. No USB or debugging is required for this path. Enter a reachable server URL and room code, approve the capture prompt, and switch to your music app. Some apps disable playback capture.

```sh
npm run build:android
```

Requires Java, Android SDK platform android-35, and build-tools 35.0.0. Set `ANDROID_HOME` if the SDK isn't in the default macOS location. The script creates a development-signed APK under `.native/android/BeatSync-WiFi.apk`. A locally built APK is downloadable from `/download/android.apk`; no APK, signing key, or certificate is distributed in this source repository.

An optional scrcpy forwarding path is also provided (`npm run cast:android`), requiring scrcpy, Android 11+, and device authorization. `npm run connect:android` is an ADB diagnostic connection, not the normal Wi-Fi workflow.

### iPhone companion

The SwiftUI host and ReplayKit broadcast upload extension are in `companions/ios`:

```sh
brew install xcodegen
cd companions/ios
xcodegen generate
open BeatSyncPhone.xcodeproj
```

Configure your own Apple development team, unique bundle IDs, and registered App Group for both targets. Update App Group and extension identifiers in the Swift files to match. Device installation requires signing. Save the server URL and room code, start the BeatSync broadcast using the system picker, then switch to your music app. Only `.audioApp` samples are uploaded; video and microphone samples are discarded. Apps can suppress protected audio. A successful simulator build is not physical-device verification.

## HTTPS

Certificates are optional for HTTP listening. To generate a local self-signed certificate:

```sh
npm run setup:https
```

Restart the server. Other devices must explicitly trust that certificate before the HTTPS address is trusted. Certificate generation changes no system trust settings. Do not publish private keys.

For a publicly trusted certificate on a private Wi-Fi hostname, use a domain you control and DNS-01 validation:

```sh
brew install certbot
npm run setup:domain -- beatsync.example.com
```

Certbot prompts for registration, terms acceptance, and a DNS TXT record. Configure router local DNS to resolve your hostname to the server's reserved LAN address. The setup script writes certificate paths and the preferred origin into ignored `.env` after issuance succeeds. No port forwarding is required. Manual DNS validation requires manual renewal; provider plugins can automate it. Renewed certificate files are loaded on server restart.

## macOS background service

```sh
npm run service:install
npm run service:status
npm run service:stop
npm run service:start
npm run service:restart
npm run service:uninstall
```

Installs a per-user LaunchAgent using ports 3001/3444. It starts at login and restarts after a crash; the Mac must remain awake and connected. Logs stay in ignored `.logs/`. The helper may need recording permission for this launch context. Server restarts clear rooms.

## Networking and background playback

All devices need a reachable server address, correct port, and a non-isolated LAN. Reserve the server's IP in router DHCP to avoid changing URLs. Guest Wi-Fi, client isolation, local-network permissions, proxies, and secure-DNS overrides can affect connectivity. The server listens on all IPv4 interfaces; it does not configure your router or firewall. Do not expose this prototype to the public internet.

The web receiver declares a playback audio-session type where supported and registers Media Session controls. Mobile browsers may suspend live networking or Web Audio after backgrounding. Reliable locked-screen receiving on all phones requires additional native receiver work; current companion apps are senders.

HTTP signaling and native PCM are unencrypted; WebRTC media uses its encrypted transport. Use trusted HTTPS on networks where plaintext traffic is unsuitable. Room member tokens are generated at runtime, never hardcoded. Native system capture is restricted to loopback requests. Limits are 16 room members and 100 active rooms; practical audio performance varies.

## Development

```sh
npm test
npm run check
```

- `server.mjs`: rooms, authentication, SSE, WebRTC signaling, phone audio input.
- `public/`: web UI, browser capture, playback, media-session integration.
- `native/` and `native-bridge.mjs`: macOS app-audio helper.
- `companions/`: Android and iPhone sender source.
- `scripts/`: local builds, TLS setup, diagnostics, and macOS service management.
- `test/`: room lifecycle, sender authorization, audio transport/decoding, media controls.

The web UI optionally loads fonts from Google Fonts, with system fallbacks. No cloud audio relay is used.

## References

Original implementation informed by these projects; no third-party source is vendored:

- [BeatSync](https://github.com/freeman-jiang/beatsync): room-based listening; its synchronization algorithm is not implemented here.
- [WebRTC samples](https://github.com/webrtc/samples): browser capture and peer-connection patterns.
- [MiroTalk](https://github.com/miroslavpejic85/mirotalk): self-hosted P2P architecture reference.
- [RPiPlay](https://github.com/FD-/RPiPlay): distinction between native AirPlay receiving and browser casting.
- [scrcpy](https://github.com/Genymobile/scrcpy): optional Android forwarding tool, installed separately.

## License

[MIT](LICENSE).
