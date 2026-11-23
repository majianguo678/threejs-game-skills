# Signal Run

A self-contained Three.js night-runner built with TypeScript and Vite. Geometry, road markings, skyline forms, and the event-driven audio cues are generated locally at runtime; no API keys or downloaded game assets are required.

## Run locally

```powershell
cd games/signal-run
npm install
npm run dev
```

Open the local URL printed by Vite (default: `http://127.0.0.1:5188`). For a production build, run `npm run build`; preview the generated `dist/` output with `npm run preview`.

## Controls

- **A / D** or **← / →** — switch lanes
- **Space** or **↑** — jump over low amber barriers
- **Shift** — phase dash through a hazard (3.2-second cooldown)
- **P / Esc** or the pause icon — pause / resume
- **Touch** — use the left/right lane and jump/dash buttons

Survive 55 seconds to deliver the relay. Three collisions end the run; jump barriers, avoid the tall gate and drone silhouettes, or use a ready dash. Amber shards are optional route rewards. The sound toggle controls synthesized pickup, jump, dash, and impact cues.

## Checks

```powershell
npm run build
npm test
npm run inspect:canvas -- --manifest artifacts/evidence.json --url http://127.0.0.1:5188 --seed 42
```

Add `?debug` to the URL to open the local `lil-gui` tuning panel. The deterministic browser-test hooks are exposed through `window.__THREE_GAME_TEST_HOOKS__`.
