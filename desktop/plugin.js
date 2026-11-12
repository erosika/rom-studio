// ROM Studio pane, desktop half: shows the pane page in a frame and pokes it when the feed changes.
// Plain ESM, no build step. The host owns the embedded page's appearance.
import { PANES_AREA, ROUTES_AREA } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

let rest
const frames = new Set() // every frame now on screen

// Read resolved values, not var(...) references: CSS properties do not cross an iframe.
function publishTheme(el) {
  if (!el?.contentWindow) return
  const root = document.documentElement, style = getComputedStyle(root)
  const map = { '--bg': '--dt-background', '--card': '--dt-card', '--line': '--dt-border', '--text': '--ui-text-primary', '--quiet': '--ui-text-secondary', '--accent': '--theme-primary', '--on-accent': '--dt-primary-foreground', '--next': '--ui-text-secondary', '--hover': '--ui-row-hover-background', '--selected': '--ui-row-active-background', '--font': '--dt-font-sans' }
  const tokens = Object.fromEntries(Object.entries(map).map(([key, value]) => [key, style.getPropertyValue(value).trim()]))
  const inputOpacity = style.getPropertyValue('--dt-input-bg').trim()
  if (tokens['--card'] && inputOpacity) tokens['--input'] = `color-mix(in srgb, ${tokens['--card']} ${inputOpacity}, transparent)`
  el.contentWindow.postMessage({ type: 'rom-studio:theme', version: 1, mode: root.dataset.hermesMode, tokens }, new URL(el.src).origin)
}

function Pane() {
  const [where, setWhere] = useState(null)
  const frame = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!where?.url || loaded) return
    const t = setTimeout(() => setSlow(true), 8000) // nothing loaded in the frame: say so instead of a blank pane
    return () => clearTimeout(t)
  }, [where, loaded])
  useEffect(() => {
    rest('/where').then(setWhere).catch(() => setWhere({ error: 'Cannot reach ROM Studio. Is the plugin switched on?' }))
  }, [])
  useEffect(() => {
    const el = frame.current
    if (!el) return
    frames.add(el)
    // Theme, accent, mode and typography are all painted onto the host root.
    const observer = new MutationObserver(() => publishTheme(el))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-hermes-mode', 'data-hermes-theme'] })
    publishTheme(el)
    return () => { frames.delete(el); observer.disconnect() }
  }, [where])
  if (!where) return null
  if (!/^https?:\/\//.test(where.url ?? '')) return jsx('p', { style: { padding: 16 }, children: where.error ?? 'The ROM Studio page address must start with http:// or https://.' })
  // a secure (https) app page may not show a plain http page from another computer: the frame would stay blank
  const local = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(where.url)
  if (location.protocol === 'https:' && where.url.startsWith('http:') && !local) return help(where.url, 'This app is open over https, so it cannot show the ROM Studio page from a plain http address.')
  if (slow) return help(where.url, 'The ROM Studio page did not answer. Is it running? (bun pane/server.ts --game <your game folder>)')
  const url = new URL(where.url)
  url.searchParams.set('host', 'desktop')
  url.searchParams.set('hostOrigin', location.origin)
  // the page keeps its own address (its scripts, its saved choices) and may open the game in a new window; it cannot move this app elsewhere
  return jsx('iframe', { ref: frame, src: url.href, title: 'ROM Studio', onLoad: () => { setLoaded(true); publishTheme(frame.current) }, style: { width: '100%', height: '100%', border: 0, background: 'var(--dt-background)' },
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads', allow: 'clipboard-write', referrerPolicy: 'no-referrer' })
}

function help(url, why) {
  return jsx('p', { style: { padding: 16, lineHeight: 1.5 }, children: [why, ' Open it in a browser instead: ', jsx('a', { href: url, target: '_blank', rel: 'noreferrer', children: url }, 'a')] })
}

export default {
  id: 'rom-studio',
  name: 'ROM Studio',
  register(ctx) {
    rest = ctx.rest
    // the page listens for this message and looks at the feed right away
    ctx.onEvent('plugin.rom-studio.feed', () => frames.forEach((el) => el.contentWindow?.postMessage('feed', new URL(el.src).origin))) // only to the page this frame was given
    ctx.register({ id: 'pane', area: PANES_AREA, title: 'ROM Studio', data: { placement: 'right', width: '380px' }, render: () => jsx(Pane, {}) })
    ctx.register({ id: 'page', area: ROUTES_AREA, title: 'ROM Studio', data: { path: '/rom-studio' }, render: () => jsx(Pane, {}) })
  },
}
