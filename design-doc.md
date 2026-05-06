# MotionForge — Design Document v0.1

> **Status:** WIP / live document
> **Ultima actualizare:** 2026-05-05
> **Nume:** *MotionForge* este placeholder. Final TBD.

---

## 1. Viziune și constrângeri

Engine programatic 2D pentru compoziții video deterministe, generabile de agenți AI prin tooluri MCP. Aceeași compoziție rulează în două moduri:

- **Browser** — preview live în Canvas2D, redat la fps-ul ecranului prin `requestAnimationFrame`.
- **Server (Node/Bun)** — randare frame-cu-frame cu skia-canvas, pipe RGBA către `ffmpeg` → MP4.

### Constrângeri non-negociabile

1. **Determinism complet.** `renderFrame(composition, t) → pixels` e o funcție pură. Același input → același output, indiferent de hardware sau ordine.
2. **Reprezentare canonică = JSON.** Compoziția e date, nu cod. API-ul programatic și tool-urile MCP construiesc același JSON validabil cu schemă.
3. **AI-native.** Tooluri MCP atomice și ortogonale. Agentul nu scrie cod, apelează tooluri. Stările intermediare sunt inspectabile și verificabile vizual cu frame preview la cerere.
4. **Timeline în secunde, nu frame-uri.** Compoziția nu se schimbă dacă alegi 24 vs 60 fps la export.
5. **Coordonate canvas standard.** Origin top-left, y-down. Unghiuri în radiani. Culori hex sau `{r,g,b,a}`.

### Out of scope pentru v0.1

- Audio (muxing post-render, dar nu sinteză/timeline audio)
- Video clips ca surse (doar imagini statice ca sprite-uri)
- Particule, fizică, efecte de shader
- Text multi-linie cu wrap automat
- Color spaces avansate (RGB lerp linear pentru moment)

---

## 2. Concepte de bază

| Concept | Definiție |
|---|---|
| **Composition** | Container top-level. Are dimensiuni, fps, durată, background, listă de assets, listă de layers, listă de tweens. |
| **Asset** | Resursă externă (imagine, font) declarată o dată, referențiată prin `id`. |
| **Layer** | Stack ordonat după `z`. Are propriul `opacity` și `blendMode`. Conține items. |
| **Item** | `Sprite \| Text \| Shape \| Group`. Are `id`, transform de bază, proprietăți specifice tipului. |
| **Group** | Item-container cu transform propriu. Copiii moștenesc transform-ul (matrix multiply). |
| **Tween** | Interpolare a unei proprietăți a unui item, între `from` și `to`, în intervalul `[start, start+duration]`, cu `easing` numit. |
| **Transform** | `{ x, y, scaleX, scaleY, rotation, anchorX, anchorY, opacity }` — comun tuturor items. |

### Reguli de timp

- Toate timpii (start, duration) în secunde.
- Două tweens pe **aceeași proprietate** a aceluiași item nu pot avea ferestre temporale suprapuse (validare → eroare).
- Înainte de start: proprietatea = `tween.from`.
- În timpul tween-ului: lerp(from, to, ease(progress)).
- După end: proprietatea = `tween.to` (hold).
- Dacă **niciun tween** nu adresează proprietatea: valoarea de bază din item.

### Reguli de anchor

`anchorX/anchorY ∈ [0, 1]`, fracție din `width/height`. `(0,0)` = top-left. `(0.5, 0.5)` = centru. Anchor afectează rotația și scale (item se rotește în jurul anchor point).

---

## 3. JSON Schema — formatul canonic

### 3.1 Forma generală

```json
{
  "version": "0.1",
  "composition": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 25.0,
    "background": "#000000"
  },
  "assets": [
    { "id": "logo", "type": "image", "src": "./assets/logo.png" },
    { "id": "bg", "type": "image", "src": "./assets/bg.jpg" },
    { "id": "inter", "type": "font", "src": "./fonts/Inter-Bold.ttf", "family": "Inter" }
  ],
  "layers": [
    {
      "id": "background-layer",
      "z": 0,
      "opacity": 1.0,
      "blendMode": "normal",
      "items": [ /* item ids */ "bg-sprite" ]
    },
    {
      "id": "foreground-layer",
      "z": 10,
      "opacity": 1.0,
      "blendMode": "normal",
      "items": ["logo-sprite", "title-text"]
    }
  ],
  "items": {
    "bg-sprite": {
      "type": "sprite",
      "asset": "bg",
      "transform": {
        "x": 0, "y": 0,
        "scaleX": 1, "scaleY": 1,
        "rotation": 0,
        "anchorX": 0, "anchorY": 0,
        "opacity": 1
      },
      "width": 1920,
      "height": 1080
    },
    "logo-sprite": {
      "type": "sprite",
      "asset": "logo",
      "transform": {
        "x": 960, "y": 540,
        "scaleX": 1, "scaleY": 1,
        "rotation": 0,
        "anchorX": 0.5, "anchorY": 0.5,
        "opacity": 0
      },
      "width": 400,
      "height": 400
    },
    "title-text": {
      "type": "text",
      "text": "Hello, World",
      "font": "inter",
      "fontSize": 96,
      "color": "#ffffff",
      "transform": {
        "x": 960, "y": 800,
        "scaleX": 1, "scaleY": 1,
        "rotation": 0,
        "anchorX": 0.5, "anchorY": 0.5,
        "opacity": 1
      }
    }
  },
  "tweens": [
    {
      "id": "logo-fade-in",
      "target": "logo-sprite",
      "property": "transform.opacity",
      "from": 0, "to": 1,
      "start": 0.0, "duration": 1.0,
      "easing": "easeOutQuad"
    },
    {
      "id": "logo-pop",
      "target": "logo-sprite",
      "property": "transform.scaleX",
      "from": 0.5, "to": 1.0,
      "start": 0.0, "duration": 1.5,
      "easing": "easeOutBack"
    },
    {
      "id": "logo-pop-y",
      "target": "logo-sprite",
      "property": "transform.scaleY",
      "from": 0.5, "to": 1.0,
      "start": 0.0, "duration": 1.5,
      "easing": "easeOutBack"
    }
  ]
}
```

### 3.2 Tipuri de items

#### `sprite`
```ts
{
  type: "sprite",
  asset: string,       // asset id, must be type "image"
  width: number,       // px, draw size (independent of source image size)
  height: number,
  tint?: string,       // hex, multiplied with sprite colors. Default white.
  transform: Transform
}
```

#### `text`
```ts
{
  type: "text",
  text: string,
  font: string,        // asset id, must be type "font"
  fontSize: number,    // px
  color: string,       // hex or rgba()
  align?: "left" | "center" | "right",  // default "left"
  transform: Transform
}
```

#### `shape`
```ts
{
  type: "shape",
  kind: "rect" | "circle" | "polygon",
  width?: number,      // for rect, circle (diameter)
  height?: number,     // for rect
  points?: [[x,y], ...], // for polygon
  fillColor?: string,
  strokeColor?: string,
  strokeWidth?: number,
  cornerRadius?: number, // for rect
  transform: Transform
}
```

#### `group`
```ts
{
  type: "group",
  items: string[],     // ids of child items
  transform: Transform
}
```

### 3.3 Tween — proprietăți tweenable

Sintaxa `property` folosește dot-path. Lista actuală suportată:

| Path | Tipuri compatibile | Lerp |
|---|---|---|
| `transform.x`, `transform.y` | toate | numeric |
| `transform.scaleX`, `transform.scaleY` | toate | numeric |
| `transform.rotation` | toate | numeric (radiani) |
| `transform.opacity` | toate | numeric, clamp [0,1] |
| `transform.anchorX`, `transform.anchorY` | toate | numeric |
| `width`, `height` | sprite, shape | numeric |
| `fontSize` | text | numeric |
| `color`, `fillColor`, `strokeColor`, `tint` | text/shape/sprite | RGB lerp |

### 3.4 Easings suportate (v0.1)

`linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`, `easeInQuart`, `easeOutQuart`, `easeInOutQuart`, `easeInBack`, `easeOutBack`, `easeInOutBack`, `easeInSine`, `easeOutSine`, `easeInOutSine`, `easeInExpo`, `easeOutExpo`, `easeInOutExpo`.

Implementare: dictionar de funcții pure `(t: number) → number` cu `t ∈ [0,1]`.

### 3.5 Validare

Validatorul rulează la `validate()` și înainte de orice render. Verifică:

1. JSON conform schemei.
2. Toate `target` din tweens referențiază items existente.
3. Toate `asset` referențiate există în lista `assets`.
4. `property` din tween e tweenable pentru tipul itemului.
5. Tween-uri pe aceeași `(target, property)` nu se suprapun temporal.
6. `start + duration ≤ composition.duration` (warning, nu eroare — coada poate fi tăiată).
7. Layers sortate după `z` (nu obligatoriu în JSON, engine sortează la render).
8. Nu există cicluri în group hierarchy.

---

## 4. MCP Tools — interfața pentru agenți

Tooluri atomice, ortogonale, idempotent acolo unde e posibil. Agentul construiește incremental și inspectează.

### 4.1 Composition lifecycle

#### `create_composition`
```ts
{
  width: number,
  height: number,
  fps: number,
  duration: number,
  background?: string  // default "#000000"
} → { compositionId: string }
```
Creează o compoziție nouă în starea serverului MCP. Returnează un `compositionId` folosit implicit de toolurile următoare (sau explicit prin parametru opțional).

#### `get_composition`
```ts
{} → { json: CompositionJSON }
```
Returnează JSON-ul complet al compoziției curente. Folosit de agent pentru self-inspection.

#### `set_composition_property`
```ts
{ property: "width" | "height" | "fps" | "duration" | "background", value: any }
→ { ok: true }
```

#### `validate`
```ts
{} → { valid: boolean, errors: ValidationError[], warnings: ValidationWarning[] }
```

#### `reset`
```ts
{} → { ok: true }
```
Șterge compoziția curentă.

### 4.2 Assets

#### `register_asset`
```ts
{
  id: string,
  type: "image" | "font",
  src: string,  // path local sau URL
  family?: string  // doar pentru fonturi
} → { ok: true }
```

#### `list_assets`
```ts
{} → { assets: Asset[] }
```

#### `remove_asset`
```ts
{ id: string } → { ok: true }
```
Eroare dacă vreun item îl mai folosește.

### 4.3 Layers

#### `add_layer`
```ts
{ id?: string, z: number, opacity?: number, blendMode?: string }
→ { layerId: string }
```

#### `update_layer`
```ts
{ id: string, props: Partial<{ z, opacity, blendMode }> } → { ok: true }
```

#### `remove_layer`
```ts
{ id: string, cascade?: boolean }
→ { ok: true } | { error: "non-empty layer, pass cascade=true to remove items too" }
```

### 4.4 Items

#### `add_sprite`
```ts
{
  layerId: string,
  asset: string,
  x: number, y: number,
  width: number, height: number,
  anchorX?: number, anchorY?: number,
  rotation?: number, opacity?: number,
  scaleX?: number, scaleY?: number,
  tint?: string,
  id?: string
} → { itemId: string }
```

#### `add_text`
```ts
{
  layerId: string,
  text: string,
  font: string,
  fontSize: number,
  color: string,
  x: number, y: number,
  anchorX?: number, anchorY?: number,
  align?: "left" | "center" | "right",
  rotation?: number, opacity?: number,
  id?: string
} → { itemId: string }
```

#### `add_shape`
```ts
{
  layerId: string,
  kind: "rect" | "circle" | "polygon",
  x: number, y: number,
  width?: number, height?: number,
  points?: number[][],
  fillColor?: string, strokeColor?: string, strokeWidth?: number,
  cornerRadius?: number,
  rotation?: number, opacity?: number,
  id?: string
} → { itemId: string }
```

#### `add_group`
```ts
{
  layerId: string,
  x: number, y: number,
  childItemIds?: string[],
  id?: string
} → { itemId: string }
```

#### `update_item`
```ts
{ id: string, props: Partial<ItemProps> } → { ok: true }
```

#### `move_item_to_layer`
```ts
{ itemId: string, targetLayerId: string } → { ok: true }
```

#### `remove_item`
```ts
{ id: string } → { ok: true }
```
Cascade: șterge automat tween-urile care îl țintesc.

### 4.5 Tweens

#### `add_tween`
```ts
{
  target: string,
  property: string,    // dot-path, ex "transform.opacity"
  from: number | string,  // string pentru culori
  to: number | string,
  start: number,
  duration: number,
  easing?: string,     // default "linear"
  id?: string
} → { tweenId: string } | { error: string }
```
Eroare dacă se suprapune cu alt tween pe aceeași `(target, property)`.

#### `update_tween`
```ts
{ id: string, props: Partial<TweenProps> } → { ok: true }
```

#### `remove_tween`
```ts
{ id: string } → { ok: true }
```

#### `list_tweens`
```ts
{ target?: string, property?: string } → { tweens: Tween[] }
```

### 4.6 Inspection și render

#### `render_preview_frame`
```ts
{ time: number, format?: "png" | "jpeg" } → { image: base64 }
```
Randează un singur frame la timpul `t`. Folosit de agent pentru verificare vizuală intermediară.

#### `render_to_video`
```ts
{
  outputPath: string,
  codec?: "libx264" | "libx265",
  crf?: number,        // default 18
  preset?: string,     // default "medium"
  pixFmt?: string      // default "yuv420p"
} → { ok: true, outputPath: string, durationMs: number }
```

#### `render_thumbnail_strip`
```ts
{ count: number, output?: "base64[]" | "filepath" } → { images: string[] }
```
`count` frame-uri uniform distribuite pe timeline. Util pentru preview rapid al întregului clip.

### 4.7 Convenții pentru agent

- Toate tool-urile întorc structuri JSON, nu prose.
- Erorile sunt structurate: `{ error: { code, message, hint? } }`.
- ID-urile se pot specifica explicit (idempotență, agentul le poate cita ulterior) sau auto-generate.
- După orice modificare, agentul poate apela `validate` pentru sanity check înainte de render.
- Pattern recomandat: `add_*` → `validate` → `render_preview_frame` la momente cheie → `render_to_video`.

---

## 5. Renderer Core — scene graph + tween system

### 5.1 Arhitectură

```
┌─────────────────────────────────────────────┐
│  CompositionJSON  (sursă canonică)          │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  SceneGraph (in-memory tree)                │
│  - Composition                              │
│    └─ Layer[]   (sortat după z)            │
│       └─ Item[] (Sprite|Text|Shape|Group)  │
│           └─ children (pentru Group)        │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  computeStateAt(t) → ResolvedScene          │
│  (aplică tweens, returnează tree cu        │
│   transform-uri și props finale)            │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  draw(resolvedScene, ctx)                   │
│  (Canvas2D context — browser sau skia)      │
└─────────────────────────────────────────────┘
```

### 5.2 Pipeline-ul unui frame

```ts
function renderFrame(comp: Composition, t: number, ctx: Canvas2DContext) {
  const resolved = computeStateAt(comp, t);
  drawBackground(ctx, comp.background, comp.width, comp.height);
  for (const layer of sortBy(resolved.layers, 'z')) {
    ctx.save();
    ctx.globalAlpha *= layer.opacity;
    applyBlendMode(ctx, layer.blendMode);
    for (const item of layer.items) {
      drawItem(ctx, item, resolved);
    }
    ctx.restore();
  }
}
```

`renderFrame` nu cunoaște platforma (browser sau Node) — primește un `Canvas2DContext` care implementează API-ul Canvas2D standard. Browser folosește contextul nativ; serverul folosește skia-canvas care are același API.

### 5.3 Tween resolver

Pseudo-code pentru `computeStateAt`:

```ts
function computeStateAt(comp: Composition, t: number): ResolvedScene {
  const resolved = cloneStructural(comp);  // shallow clone of items

  // group tweens by (targetId, property)
  const tweenIndex = new Map<string, Tween[]>();
  for (const tween of comp.tweens) {
    const key = `${tween.target}::${tween.property}`;
    if (!tweenIndex.has(key)) tweenIndex.set(key, []);
    tweenIndex.get(key)!.push(tween);
  }

  for (const [key, tweens] of tweenIndex) {
    tweens.sort((a, b) => a.start - b.start);
    const [targetId, property] = key.split('::');
    const item = resolved.items[targetId];

    // find applicable tween for time t
    let active: Tween | null = null;
    for (const tween of tweens) {
      if (t >= tween.start) active = tween;
      else break;
    }

    if (!active) continue; // before any tween → use base value
    const localT = (t - active.start) / active.duration;
    const clamped = Math.max(0, Math.min(1, localT));
    const eased = EASINGS[active.easing ?? 'linear'](clamped);
    const value = lerp(active.from, active.to, eased, property);
    setByPath(item, property, value);
  }

  return resolved;
}
```

**Observații importante:**

- Resolver-ul e pur. Aceeași `(comp, t)` → aceeași `ResolvedScene`.
- O proprietate fără tween rămâne la valoarea declarată în item.
- După ultimul tween al unei proprietăți, valoarea rămâne la `to` (hold).
- `lerp` are semnătură polimorfă: numeric pentru majoritate, RGB pentru culori.

### 5.4 drawItem

```ts
function drawItem(ctx: Canvas2DContext, item: Item, scene: ResolvedScene) {
  ctx.save();
  const tr = item.transform;
  ctx.translate(tr.x, tr.y);
  ctx.rotate(tr.rotation);
  ctx.scale(tr.scaleX, tr.scaleY);
  ctx.globalAlpha *= tr.opacity;

  // anchor offset: translate to origin minus anchor*size
  const w = (item as any).width ?? 0;
  const h = (item as any).height ?? 0;
  ctx.translate(-tr.anchorX * w, -tr.anchorY * h);

  switch (item.type) {
    case 'sprite': drawSprite(ctx, item); break;
    case 'text':   drawText(ctx, item); break;
    case 'shape':  drawShape(ctx, item); break;
    case 'group':
      for (const childId of item.items) {
        drawItem(ctx, scene.items[childId], scene);
      }
      break;
  }
  ctx.restore();
}
```

Group-ul moștenește implicit transformul prin Canvas2D state stack — `ctx.save/restore` + `translate/rotate/scale` rezolvă matrix multiplication automat.

### 5.5 Asset loading

```ts
interface AssetLoader {
  loadImage(src: string): Promise<ImageBitmap | Image>;
  loadFont(src: string, family: string): Promise<void>;
}
```

Două implementări:
- `BrowserAssetLoader` — `Image` element + `FontFace` API.
- `NodeAssetLoader` — `loadImage` din skia-canvas, `registerFont` pentru fonturi.

Înainte de orice render, `await loader.preloadAll(comp.assets)`. Garantează că `drawSprite` nu blochează.

### 5.6 Drivers (browser vs server)

#### Browser preview driver

```ts
function attach(comp: Composition, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let startTime = performance.now();
  let rafId: number;

  function loop() {
    const t = (performance.now() - startTime) / 1000;
    if (t > comp.duration) {
      cancelAnimationFrame(rafId);
      return;
    }
    renderFrame(comp, t, ctx);
    rafId = requestAnimationFrame(loop);
  }
  loop();
  return { stop: () => cancelAnimationFrame(rafId), seek: (s) => { startTime = performance.now() - s*1000; } };
}
```

#### Server render driver

```ts
async function renderToFile(comp: Composition, outPath: string, opts?: RenderOpts) {
  const { Canvas } = await import('skia-canvas');
  await preloadAssets(comp.assets);

  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${comp.width}x${comp.height}`,
    '-r', String(comp.fps),
    '-i', 'pipe:0',
    '-c:v', opts?.codec ?? 'libx264',
    '-preset', opts?.preset ?? 'medium',
    '-crf', String(opts?.crf ?? 18),
    '-pix_fmt', 'yuv420p',
    outPath,
  ]);

  const totalFrames = Math.ceil(comp.duration * comp.fps);
  const canvas = new Canvas(comp.width, comp.height);
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < totalFrames; i++) {
    const t = i / comp.fps;
    renderFrame(comp, t, ctx);
    const buffer = await canvas.toBuffer('raw'); // RGBA
    if (!ffmpeg.stdin.write(buffer)) {
      await once(ffmpeg.stdin, 'drain');
    }
  }
  ffmpeg.stdin.end();
  await once(ffmpeg, 'close');
}
```

Aceeași `renderFrame`. Doar driverul diferă.

### 5.7 Performanță și resource

- **Canvas reuse** pe server — un singur canvas, `clearRect` între frame-uri (nu re-alloc).
- **Asset cache** global, după hash de src.
- **Tween index pre-computed** la încărcare (nu re-grupezi la fiecare frame).
- Pentru clipuri lungi, randarea se poate paraleliza pe **frame ranges** (workers separați, output concatenat cu ffmpeg `concat`). Pentru v0.1: serial.

---

## 6. Pipeline-ul ffmpeg

Comanda canonică:

```bash
ffmpeg -y \
  -f rawvideo -pix_fmt rgba -s 1920x1080 -r 30 -i pipe:0 \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  output.mp4
```

**Note:**

- `-pix_fmt rgba` la input pentru că skia-canvas întoarce RGBA. Converția la `yuv420p` se face de ffmpeg pentru compatibilitate cu playere.
- `-crf 18` = calitate aproape lossless. Pentru web mai mic, `crf 23`.
- Pentru audio (post-v0.1): `-i audio.mp3 -c:a aac -b:a 192k -shortest`.
- Pentru playere care vor `+faststart` (web streaming): adaugă `-movflags +faststart`.

---

## 7. Întrebări deschise / de revizuit

| # | Întrebare | Status |
|---|---|---|
| Q1 | Tween cu `from` explicit obligatoriu sau opțional (fallback la valoarea curentă)? Acum: explicit. | open |
| Q2 | Color space pentru lerp culori — RGB linear sau OKLab? Acum: RGB simplu. | open |
| Q3 | Suport pentru `cubic-bezier(x1,y1,x2,y2)` ca easing custom în plus față de cele numite? | open |
| Q4 | Group cu transform propriu — păstrăm doar matrix implicit prin Canvas2D, sau expunem și matrix explicit pentru queries? | open |
| Q5 | Curs de evoluție: după v0.1 — adăugăm video clips ca surse, particule, sau efecte (blur, glow)? Care e prioritar? | open |
| Q6 | Validation strictness: tween peste durata compoziției = warning sau eroare? Acum: warning. | open |
| Q7 | Convenția pentru anchor cu group: anchor relativ la bounding box al children sau (0,0)? Acum: (0,0). | open |
| Q8 | MCP tool granularity: `add_sprite` cu mulți parametri vs `add_sprite` minimal + `update_item`? Acum: bogat la add. | open |
| Q9 | Suport timeline pentru schimbarea de asset la item în timpul compoziției (ex: sprite change la t=5s)? | open |
| Q10 | Random/seed pentru efecte deterministe (jitter, noise)? Avem nevoie de PRNG seedabil în engine. | open |
| Q11 | Caching frame-uri pentru re-render parțial când o singură proprietate se schimbă? | open |

---

## 8. Roadmap (indicativ)

- **v0.1** — Schema + tooluri MCP de bază + renderer 2D + ffmpeg pipeline. Sprite, text, shape, group. Tween numeric + color RGB.
- **v0.2** — Audio muxing post-render. Easing custom cubic-bezier. Frame-range parallelization pe server.
- **v0.3** — Video clips ca surse (extract frame la timp t din video file).
- **v0.4** — Efecte vizuale: blur, glow, drop shadow.
- **v0.5** — Particule simple (emitters cu count, lifetime, transform tweens).
- **v1.0** — Editor vizual web (preview interactiv + drag-drop pe timeline) ca client peste același JSON.

---

## 9. Convenții pentru live document

- Schimbările se fac inline în secțiunile relevante. Decizii pe întrebările deschise (Q*) se mută în textul principal cu notă în Changelog.
- Versiunea schemei JSON crește la breaking change. Adăugiri compatibile (props noi opționale) păstrează versiunea.
- Fiecare adăugare nouă de tool MCP trebuie să apară aici **înainte** de implementare.

---

## Changelog

- **2026-05-05** — v0.1 inițial. Schema, tooluri MCP, renderer core, ffmpeg pipeline. 11 întrebări deschise notate.