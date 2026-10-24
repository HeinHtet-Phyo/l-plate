# Gaussian splat for L-Plate: Elephant & Castle street

**For a teammate with a fast PC (a good GPU), and their coding agent.** Chris's laptop is too slow for this.
Paste this whole file to your agent and say "do this". Judging is at **16:30**, so stop at the first version
that looks right and push it.

## Goal

Turn ~320 m of a real London street into a Gaussian-splat capture, the technique wascape.com uses. Then drive it in
L-Plate as the free drive **`elephant-splat`**, which is already in the menu
(`apps/web/src/routes/free-starts.json`: start 51.498455, −0.107231, heading 90, east).

## Source imagery

- **Panoramax sequence:** `8a558208-5401-4097-aab5-a609509595d1`. 1,601 frames over 3.07 km, Pixel 7 Pro, 3840×2160, about 0.9 m apart, shot 6 Aug 2025.
- **Licence:** **CC BY-SA 4.0**, by **RedAuburn**. The splat is a derived work, so it is CC BY-SA 4.0 too. Credit it in the app (step 6).
- **API:** `https://api.panoramax.xyz/api/collections/<id>/items?limit=500`. Paginate with the `rel: "next"` link. Each item has `geometry.coordinates` [lng, lat], `properties["view:azimuth"]`, and image URLs in `assets.hd.href` (3840 wide) and `assets.sd.href` (2048 wide).
- **No token needed.** Send a descriptive User-Agent.

## Where everything goes

| What | Where | In git? |
|---|---|---|
| Raw photos, COLMAP database, training output | `~/lplate-splat/elephant/` (**outside the repo**) | No |
| `frames.json` (lat/lng per photo) | `~/lplate-splat/elephant/frames.json` | No |
| Final splat for the web | `apps/web/public/splats/elephant-splat/scene.spz` (or `.ply`) | Yes, **under 95 MB** (GitHub's limit is 100 MB) |
| Placement | `apps/web/public/splats/elephant-splat/transform.json` | Yes |

## Steps

### 0. Setup
- **Repo:** `git pull`, then `corepack enable && pnpm install`.
- **Python environment:**
  ```bash
  mkdir -p ~/lplate-splat/elephant
  cd ~/lplate-splat
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python pycolmap==4.2.1 numpy plyfile
  ```
- **Trainer:**
  - **Brush** runs on any GPU (NVIDIA, AMD, Apple). Get v0.3.0 for your OS from https://github.com/ArthurBrussee/brush/releases and run `brush_app --help` to see the export flags.
  - **With an NVIDIA GPU**, `gsplat` / Nerfstudio `splatfacto` or Postshot are fine too.
  - Whichever you use, it must keep **COLMAP world coordinates**, or you must record its normalisation transform. See step 4.

### 1. Download the photos
Save this as `~/lplate-splat/fetch_frames.py` and run it with `.venv/bin/python fetch_frames.py`. It takes the first ~320 m, every 2nd frame (about 112 photos at ~2.9 m spacing). Use `hd` on a fast PC; it's sharper.
```python
import json, math, os, urllib.request, concurrent.futures as cf
COLL = '8a558208-5401-4097-aab5-a609509595d1'
OUT = os.path.expanduser('~/lplate-splat/elephant'); os.makedirs(f'{OUT}/images', exist_ok=True)
UA = {'User-Agent': 'L-Plate hackathon splat capture (CC BY-SA 4.0 attribution kept)'}
def get(url): return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
items, url = [], f'https://api.panoramax.xyz/api/collections/{COLL}/items?limit=500'
while url and len(items) < 600:
    page = get(url); items += page['features']
    url = next((l['href'] for l in page.get('links', []) if l.get('rel') == 'next'), None)
def dist(a, b): return math.hypot((a[0]-b[0]) * 69400, (a[1]-b[1]) * 111195)
sel, acc = [], 0.0
for i, x in enumerate(items):
    if i: acc += dist(items[i-1]['geometry']['coordinates'], x['geometry']['coordinates'])
    if acc > 320: break
    if i % 2 == 0: sel.append(x)
frames = [{'file': f'{k:04d}.jpg', 'lng': x['geometry']['coordinates'][0], 'lat': x['geometry']['coordinates'][1],
           'azimuth': x['properties'].get('view:azimuth'), 'url': x['assets']['hd']['href']} for k, x in enumerate(sel)]
json.dump(frames, open(f'{OUT}/frames.json', 'w'), indent=1)
def dl(f):
    p = f"{OUT}/images/{f['file']}"
    if not os.path.exists(p): open(p, 'wb').write(urllib.request.urlopen(urllib.request.Request(f['url'], headers=UA), timeout=120).read())
with cf.ThreadPoolExecutor(8) as ex: list(ex.map(dl, frames))
print(len(frames), 'frames over', round(acc), 'm')
```

### 2. Structure from motion (camera poses)
Save as `~/lplate-splat/sfm.py` and run `.venv/bin/python sfm.py ~/lplate-splat/elephant`. That's pycolmap 4.x with a SINGLE OPENCV camera and sequential matching. Expect **≥ 100 of the ~112 images registered**. If several models come out, it keeps the biggest.
```python
import sys, time, pathlib, pycolmap
root = pathlib.Path(sys.argv[1]); db = root / 'database.db'; img = root / 'images'; out = root / 'sparse'
out.mkdir(exist_ok=True); db.unlink(missing_ok=True); t = time.time()
ext = pycolmap.FeatureExtractionOptions(); ext.sift.max_num_features = 8192
reader = pycolmap.ImageReaderOptions(); reader.camera_model = 'OPENCV'
pycolmap.extract_features(db, img, camera_mode=pycolmap.CameraMode.SINGLE, reader_options=reader, extraction_options=ext)
pair = pycolmap.SequentialPairingOptions(); pair.overlap = 15
pycolmap.match_sequential(db, pairing_options=pair)
maps = pycolmap.incremental_mapping(db, img, out)
best = max(maps.values(), key=lambda m: m.num_reg_images()); (out / '0').mkdir(exist_ok=True); best.write(out / '0')
print('registered', best.num_reg_images(), 'images,', best.num_points3D(), 'points in', round(time.time() - t), 's')
```

### 3. Train the splat
- **Brush:** point it at `~/lplate-splat/elephant`. It reads `images/` and `sparse/0`. Train about 15–30k steps and export a `.ply`.
- **Size:** aim for **≤ 2–3 M splats**, so the web file stays under 95 MB.
- **Clean-up:** remove floaters (especially sky) in **SuperSplat** (https://superspl.at/editor), then export **compressed `.ply`** or `.spz`.
- **Check the coordinates:** the bounding box of the trained splat should match COLMAP's `points3D`. If it's shifted or scaled, the trainer normalised the scene. Undo that, or fold it into the matrix in step 4.

### 4. Align it to L-Plate's map (local metres: x east, y up, z south)
- **Get the map origin:** first make sure `apps/web/public/osm/elephant-splat.json` exists; if not, run `pnpm osm:fetch elephant-splat`. Its `origin` is the reference point.
- **Run the alignment:** save this as `~/lplate-splat/align.py` and run:
  ```bash
  .venv/bin/python align.py ~/lplate-splat/elephant/sparse/0 ~/lplate-splat/elephant/frames.json <repo>/apps/web/public/osm/elephant-splat.json <repo>/apps/web/public/splats/elephant-splat/transform.json
  ```
- **What it does:** levels the scene from the cameras' up vectors, fits scale, heading and position to the photos' GPS (2D Umeyama), and puts the ground at y = 0.
- **Check the fit:** the GPS RMS should be a few metres (phone GPS).
```python
import sys, json, math, numpy as np, pycolmap
recon = pycolmap.Reconstruction(sys.argv[1]); frames = {f['file']: f for f in json.load(open(sys.argv[2]))}
origin = json.load(open(sys.argv[3]))['origin']; out = sys.argv[4]
K = math.pi / 180 * 6371000
def proj(lat, lng): return np.array([(lng - origin['lng']) * K * math.cos(math.radians(origin['lat'])), -(lat - origin['lat']) * K])
def pose(im):
    p = im.cam_from_world() if callable(im.cam_from_world) else im.cam_from_world
    R = p.rotation.matrix(); t = np.asarray(p.translation); return R, -R.T @ t
C, G, ups = [], [], []
for im in recon.images.values():
    if im.name not in frames: continue
    R, c = pose(im); C.append(c); G.append(proj(frames[im.name]['lat'], frames[im.name]['lng']))
    ups.append(-R.T @ np.array([0.0, 1.0, 0.0]))          # COLMAP camera y points down
C, G = np.array(C), np.array(G); up = np.mean(ups, 0); up /= np.linalg.norm(up)
def rot(a, b):                                             # rotation taking unit a to unit b
    v = np.cross(a, b); c = float(a @ b); vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)
R1 = rot(up, np.array([0.0, 1.0, 0.0])); A = (C @ R1.T)[:, [0, 2]]
ma, mb = A.mean(0), G.mean(0); A0, B0 = A - ma, G - mb
U, S, Vt = np.linalg.svd(A0.T @ B0); D = np.eye(2)
if np.linalg.det(Vt.T @ U.T) < 0: D[1, 1] = -1
R2 = Vt.T @ D @ U.T; s = float(np.trace(np.diag(S) @ D) / (A0 ** 2).sum()); t2 = mb - s * R2 @ ma
Ry = np.array([[R2[0, 0], 0, R2[0, 1]], [0, 1, 0], [R2[1, 0], 0, R2[1, 1]]])
M = np.eye(4); M[:3, :3] = s * Ry @ R1; M[0, 3], M[2, 3] = t2
pts = np.array([p.xyz for p in recon.points3D.values()]) @ M[:3, :3].T + M[:3, 3]
cams = C @ M[:3, :3].T + M[:3, 3]
near = pts[np.min(np.hypot(pts[:, None, 0] - cams[None, :, 0], pts[:, None, 2] - cams[None, :, 2]), 1) < 4]
M[1, 3] = -np.percentile(near[:, 1], 10)                   # ground at y = 0
rms = float(np.sqrt(((A0 @ (s * R2).T + mb - G) ** 2).sum(1).mean()))
json.dump({'matrix': M.T.flatten().tolist(), 'scale': s, 'gpsRmsMetres': rms, 'cameraHeight': float(np.median(cams[:, 1] + M[1, 3])),
           'origin': origin, 'credit': 'Street imagery © RedAuburn via Panoramax, CC BY-SA 4.0'}, open(out, 'w'), indent=1)
print('scale', s, 'gps rms', round(rms, 2), 'm, camera height', round(float(np.median(cams[:, 1] + M[1, 3])), 2), 'm')
```
`matrix` is **column-major**: pass it straight to `new THREE.Matrix4().fromArray(matrix)`. The camera height should come out about 1.2–1.8 m; if it's way off, the up vector's sign is wrong.

### 5. Put it in the app (you can edit these files; Chris owns `apps/web/src/app/`, so tell him)
1. **Install the renderer:** `pnpm --filter @lplate/web add @sparkjsdev/spark@2.4.0`. It's the three.js Gaussian-splat renderer (peer `three >= 0.180`; we're on 0.180). Look up its current API with Context7 before writing code.
2. **Loader:** create `apps/web/src/app/splat.ts`.
   - When `session.setup.id === 'elephant-splat'`, fetch `/splats/elephant-splat/transform.json`.
   - Create the Spark renderer and a splat mesh for `/splats/elephant-splat/scene.spz`.
   - Set `mesh.matrixAutoUpdate = false`, `mesh.matrix.fromArray(t.matrix)`, and make sure Spark adds no rotation of its own.
   - Add it to the scene and return `{ object, dispose }`.
3. **Drive screen** (`apps/web/src/app/Drive.tsx`, inside `DriveScene`): create it like `tiles` (a `useMemo` plus a `useEffect` that adds it to and removes it from `scene`). While the splat is loaded, hide our city pieces that the capture replaces:
   - `city.object.getObjectByName(...)` for `city-buildings`, `tree-trunks`, `tree-canopies`, `parked-bodies`, `parked-trim` and `parked-wheels`, set to `visible = false` every frame.
   - The road surface, by setting the uniform `uRoadOnly` on material `city-surface` and also hiding its meshes, because the splat has the real road.
   - Keep traffic, signals and the cabin.
   - Turn Google tiles off for this start; they're already off, because tiles only run for Goodmayes.
4. **Physics:** parked cars are still invisible obstacles. In `apps/web/src/sim/session.ts` `build()`, skip `placeParkedCars` when `this.setup.id === 'elephant-splat'`.
5. **Credit:** show `transform.json.credit` in the HUD attribution. Set `session.mapCredit`, which the HUD already displays.

### 6. Check it
- **Run:** `pnpm dev`, then open `http://localhost:5173/?start=elephant-splat&weather=sunny`. Press Space to release the handbrake, then W.
- **The car should drive down the splat's real road**, in the left lane, with the facades either side.
- **If it's off:**
  - **Rotated:** the GPS fit flipped. Check `det` in `align.py`.
  - **Floating or sunk:** adjust `M[1,3]`, the ground percentile.
  - **Too big or too small:** you missed the trainer's normalisation.
- **Frame rate:** a few million splats should run on a good laptop. If not, prune in SuperSplat.

### 7. Ship it
- **Keep the raw photos out of git.** Commit only `apps/web/public/splats/elephant-splat/*`, `splat.ts`, the `Drive.tsx` / `session.ts` edits and `package.json` / `pnpm-lock.yaml`.
- **Before committing:** check every file is under 95 MB, and run `node scripts/scan-secrets.ts --staged`.
- **Commit and push:** `feat(splat): Elephant & Castle Gaussian-splat street (Panoramax, CC BY-SA 4.0)`, then `git pull --rebase && git push`.
- **Log it:**
  - your `HANDOFF.md` lane
  - a line in `docs/DECISIONS.md` (Gaussian splat from Panoramax CC BY-SA imagery, Brush trainer, Spark renderer)
  - anything that broke in `docs/MODEL_FAILURES.md`, if relevant
- **Tell Chris** so he can pull it onto the demo laptop.
