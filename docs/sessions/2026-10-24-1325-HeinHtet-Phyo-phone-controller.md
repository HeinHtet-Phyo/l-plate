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

## Update 14:05: the cabin (TEAM-PLAN §3)
`apps/web/src/render/cabin/`. `index.ts` exports `createCabin(s): CabinPart` (the contract in `render/types.ts`). Built in parallel by sub-agents against a shared `layout.ts`:
- `layout.ts`: the eye-relative frame (origin = eye, −z forward, RHD so the car centre line is x = −0.37) and every position: windscreen, dash, bonnet, wheel, cluster, sat nav, mirrors, wipers.
- `interior.ts`: dash with a binnacle recess, A-pillars, roof, visor, doors, crowned red bonnet. The steering wheel turns by `-car.steeringWheelAngle()`. About 7 draw calls.
- `cluster.ts`: canvas speedo, rev counter (fake 6-speed auto), digital mph, gear, indicator arrows, handbrake light. Redraws only on change.
- `satnav.ts`: 768×360 canvas. Manoeuvre and roundabout icons, distance, instruction and "then" bar, ETA and miles left, heading-up route map. Amber when off route or rerouting; free drive shows road, limit and clock.
- `mirrors.ts`: rear-view plus two door mirrors. Half-float 4× MSAA targets, flipped with repeat (−1, 1) and offset (1, 0), one mirror per frame, `?mirrors=0` turns them off. The glass is `toneMapped: true` so the mirrors match the windscreen view (targets hold linear HDR).
- `rain.ts`: shader raindrops on the windscreen, and two wipers sweeping every 1.4 s that clear the drops in their sector.
- `index.ts`: the cabin's own hemisphere and sun lights, dimmed by `conditions.daylight` and `cloud`. It copies the world camera's fov and aspect, and pitch comes from `s.pitch`.

Verified: `tsc --noEmit` is clean for all of `apps/web`. I rendered Goodmayes in Chrome through a local harness (uncommitted `src/main.tsx`: placeholder road ribbons and boxes for the world, the TEAM-PLAN render loop order, `?preset=` and `?auto=1`) at sunny, rain and night. All parts were visible and lined up, with no console errors.
Known limits: the left door mirror sits about 66° left, outside a 100° horizontal FOV (as in a real RHD car, you'd turn your head). The digital mph is partly hidden by the wheel hub.

## Update 15:20: model referee, phone fault buzz and report card, QR fix
- **Model referee:** `POST /api/referee` (`apps/server/src/referee.ts`) and `apps/web/src/referee/Referee.tsx`. Opens from "Compare examiner models" on the summary, or standalone at `/referee`. A live run had DeepSeek V4.1 Flash, Qwen3-235B and Kimi-K3 all scoring 100 in 0.9 to 3.7 s.
- **Highway Code lookup** is capped at 4 s and cached, because a slow embeddings call stalled debriefs for 18 s. The referee went from 22 s to 7.8 s.
- **Phone:** `fault` and `report` host messages. A fault triggers a vibration and banner (long and red for serious ones); the debrief shows a PASS/FAIL report card.
- **QR not working:** the venue Wi-Fi is IPv6-only, and the QR pointed at `192.0.0.2`, a CLAT address phones can't reach. Vite also listened only on localhost, and steering is now gyro-only, so it needs HTTPS. Fix: `host: true`, IPv6-aware `lanUrls()`, and `pnpm dev:phone` (HTTPS via `@vitejs/plugin-basic-ssl`). Verified with Playwright: the phone page loaded over `https://[ipv6]:5173` in 0.9 s, it was a secure context, and 46 controls arrived in 1.5 s. **Not yet tested on a real iPhone**; venue client isolation could still block it.
