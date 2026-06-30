/*
 * Orchestrates icon generation. Spawns one Electron process per icon variant
 * (reliable rendering), then builds the .icns iconset (sips/iconutil) and the
 * menu-bar template icon (python). Run: npm run icons
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BUILD = join(ROOT, 'build')
const RES = join(ROOT, 'resources')
const ELECTRON = join(ROOT, 'node_modules', '.bin', 'electron')
const CAPTURE = join(HERE, 'capture-icon.cjs')

// Child Electron must run as an app, not as Node — strip the inherited flag.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

function capture(palette, size, outFile) {
  execFileSync(ELECTRON, [CAPTURE, palette, String(size), outFile], { stdio: 'inherit', env })
}

mkdirSync(BUILD, { recursive: true })
mkdirSync(RES, { recursive: true })

// 1) Idle master -> build/icon.png (+ dock-idle)
const iconPng = join(BUILD, 'icon.png')
capture('idle', 1024, iconPng)
copyFileSync(iconPng, join(RES, 'dock-idle.png'))

// 2) .icns iconset
const iconset = join(BUILD, 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)
const sizes = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
]
for (const [s, name] of sizes) {
  execFileSync('sips', ['-z', String(s), String(s), iconPng, '--out', join(iconset, name)], { stdio: 'ignore' })
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(BUILD, 'icon.icns')])
rmSync(iconset, { recursive: true, force: true })

// 3) Status-coloured Dock variants
capture('connected', 1024, join(RES, 'dock-connected.png'))
capture('connecting', 1024, join(RES, 'dock-connecting.png'))

// 4) Menu-bar template icon
execFileSync('python3', [join(HERE, 'make-tray.py')], { stdio: 'inherit' })

console.log('Icons written to build/ and resources/')
