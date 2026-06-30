/*
 * Renders ONE app-icon variant to a PNG with Electron, then exits. One icon per
 * process on purpose: a second BrowserWindow capture in the same process dies in
 * headless/CLI environments, while the first always succeeds.
 *
 *   electron scripts/capture-icon.cjs <palette> <size> <outFile>
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

app.disableHardwareAcceleration()

const [, , paletteName, sizeStr, outFile] = process.argv

// Status palettes. `out`/`in` drive the tunnel gradient; `core`/`check`/`rim`
// and the chromatic-aberration `ghostA/B` recolour to signal connection state.
const PALETTES = {
  idle: { out: [255, 43, 214], in: [0, 229, 255], core: '#00e5ff', check: '#f4ffff', rim: '#00e5ff', ghostA: '#ff2bd6', ghostB: '#00e5ff' },
  connected: { out: [43, 214, 255], in: [25, 255, 143], core: '#19ff8f', check: '#eafff4', rim: '#19ff8f', ghostA: '#19ff8f', ghostB: '#2bd6ff' },
  connecting: { out: [255, 159, 28], in: [255, 216, 77], core: '#ffd84d', check: '#fff6e0', rim: '#ffb02e', ghostA: '#ff9f1c', ghostB: '#ffd84d' }
}

// Cyberpunk reimagining of the TrustTunnel mark (concentric "trust badge" rings
// + checkmark): a neon perspective tunnel with a glowing, status-coloured check.
function appSvg(p) {
  const lerp = (a, b, t) => Math.round(a + (b - a) * t)
  const steps = 7
  const rings = []
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    const r = 372 - i * 47
    const sw = 30 - i * 2.4
    const col = `rgb(${lerp(p.out[0], p.in[0], t)},${lerp(p.out[1], p.in[1], t)},${lerp(p.out[2], p.in[2], t)})`
    const op = (0.55 + t * 0.45).toFixed(2)
    rings.push(
      `<circle cx="512" cy="512" r="${r}" fill="none" stroke="${col}" stroke-opacity="${op}" stroke-width="${sw.toFixed(1)}"/>`
    )
  }
  const check = (dx, dy, color, w, op) =>
    `<path d="M438 520 L494 580 L600 452" transform="translate(${dx} ${dy})" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <radialGradient id="bg" cx="50%" cy="46%" r="62%">
        <stop offset="0" stop-color="#2a0b3f"/>
        <stop offset="0.55" stop-color="#120a26"/>
        <stop offset="1" stop-color="#07060f"/>
      </radialGradient>
      <radialGradient id="core" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.5" stop-color="${p.core}"/>
        <stop offset="1" stop-color="${p.core}" stop-opacity="0"/>
      </radialGradient>
      <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="9" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="bigglow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="22"/>
      </filter>
      <clipPath id="sq"><rect x="92" y="92" width="840" height="840" rx="200"/></clipPath>
    </defs>

    <rect x="92" y="92" width="840" height="840" rx="200" fill="url(#bg)"/>
    <g clip-path="url(#sq)">
      <circle cx="512" cy="512" r="240" fill="url(#core)" filter="url(#bigglow)" opacity="0.7"/>
      <g filter="url(#glow)">${rings.join('')}</g>
      <circle cx="512" cy="512" r="70" fill="url(#core)"/>
      <g filter="url(#glow)">
        ${check(-9, 6, p.ghostA, 30, 0.9)}
        ${check(9, -6, p.ghostB, 30, 0.9)}
        ${check(0, 0, p.check, 26, 1)}
      </g>
    </g>
    <rect x="92" y="92" width="840" height="840" rx="200" fill="none" stroke="${p.rim}" stroke-opacity="0.55" stroke-width="5" filter="url(#glow)"/>
  </svg>`
}

app.whenReady().then(async () => {
  try {
    const palette = PALETTES[paletteName]
    if (!palette) throw new Error(`unknown palette: ${paletteName}`)
    const size = Number(sizeStr)
    const tmp = mkdtempSync(join(tmpdir(), 'tt-icon-'))
    const file = join(tmp, 'r.html')
    writeFileSync(
      file,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style>${appSvg(palette)}`
    )
    const win = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      backgroundColor: '#ffffff',
      useContentSize: true,
      webPreferences: { offscreen: false }
    })
    await win.loadFile(file)
    await new Promise((r) => setTimeout(r, 250))
    const img = await win.webContents.capturePage()
    writeFileSync(outFile, img.toPNG())
    rmSync(tmp, { recursive: true, force: true })
    win.destroy()
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
