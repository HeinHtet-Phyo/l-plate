# 2026-10-24 13:25 · @HeinHtet-Phyo · phone controller page

## Done
- `apps/web/src/phone/PhonePage.tsx` (default export): the controller at `/c/:session?t=…`.
  - "Tap to start" overlay: iOS `DeviceOrientationEvent.requestPermission()`, fullscreen + landscape lock (Android only), screen wake lock.
  - Tilt steering via the existing `tilt.ts` (`wheelAngle` + `steerFromAngle`). Centre is calibrated on the first reading and by the **Recentre** button.
  - Touch-drag on the wheel always works and overrides tilt while a finger is on it. It's the fallback when the sensor is `denied`, `unavailable` or `flat` (the page shows a hint).
  - Analogue pedals: brake on the left, accelerator on the right. A touch gives 20%, sliding to the top of the pedal gives 100%. Releasing gives 0.
  - Indicator stalks, handbrake, recover: sent as `command` messages. The stalks blink and the handbrake lights up from the host's `state` messages; the wheel shows `speedMph`.
  - Sends `controls` at 30 Hz, `sensor` on change, `ping` every 15 s. Zeroes the controls when the page is hidden.
  - Notices for an expired link (server `error`) and for `replaced` (another phone took over); neither reconnects.
- `apps/web/src/phone/link.ts`: `ControllerLink` (the phone-side socket, reconnects every 1 s) and `parseControllerUrl()`.
- `apps/web/src/phone/phone.css`: landscape-first layout with a portrait fallback and hint.

## Verified
Ran the real server (`PORT=8090`) and web (`SERVER_PORT=8090`). Then Playwright (headless Chrome, 844×390 touch viewport) acted as the phone, and a Node WebSocket acted as the host:
- tilting 30° gave steer 0.39
- the throttle near the top of the pedal gave 0.96, and releasing gave 0
- dragging left 20% of the wheel width gave steer −0.50
- the handbrake and indicator commands arrived
- `state` from the host lit the stalk and the handbrake and showed 27 mph
- about 30 `controls` messages per second; no JS errors (one 404, the favicon)

## Not done / notes
- **Not wired into the app:** `main.tsx` doesn't exist on `main` yet (Chris owns it). I used an uncommitted local harness to test.
- **Not tested on a real phone yet.** `/api/config` `lanUrls` are plain `http://`, so iPhone tilt only works through ngrok (`pnpm tunnel`); on plain LAN the page falls back to touch-drag. ngrok isn't installed on this laptop.
- **`docs/SPEC.md` is referenced by TEAM-PLAN.md but isn't committed.** I built from the TEAM-PLAN §3 brief.
- The repo needs Node ≥ 22 (`engines`, and pnpm 12 fails on Node 20 with "spawnSync … Unknown system error -8"). Fix: `nvm install 22`.

## Next
- Cabin: `apps/web/src/render/cabin/index.ts` → `createCabin(s)` (TEAM-PLAN §3).
