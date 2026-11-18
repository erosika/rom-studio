// ROM Studio pane, desktop half: shows the pane page in a frame and pokes it when the feed changes; until the page is
// there it says why in plain words, with the one thing to do. Plain ESM, no build step. Nothing here moves on its own.
import { Button, PANES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

let rest, os
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

// The heading for each state the backend reports; its sentence comes from the backend (common.py).
const TITLES = {
  'no-game': 'Choose your game folder', 'no-folder': 'Game folder not found', 'no-server': 'ROM Studio is incomplete',
  'no-bun': 'bun is needed', 'port-taken': 'Port in use', 'other-game': "Another game's page is open",
  stopped: 'The page stopped', waiting: 'Starting ROM Studio', starting: 'Starting ROM Studio', unloaded: 'ROM Studio is switched off',
}
const SETTINGS = new Set(['no-game', 'no-folder', 'port-taken', 'other-game'])
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/

function openOutside(url) {
  const fallback = () => window.open(url, '_blank', 'noopener,noreferrer')
  Promise.resolve(os?.openExternal?.(url)).then((done) => { if (done !== true) fallback() }).catch(fallback)
}
// the plugin's settings form (its plugin.yaml config_schema): the app's own address for it, as its gear button opens it
function openSettings() {
  try { host.navigate('/settings?tab=plugins&agent=rom-studio') } catch { /* an older app: Settings, Plugins by hand */ }
}

// A calm message in the app's own type and colours: a heading, the sentence, and at most two buttons.
function Message({ title, body, actions = [], link }) {
  return jsx('div', { role: 'status', style: { padding: '20px 18px', display: 'grid', gap: 10, alignContent: 'start', maxWidth: 520, lineHeight: 1.5 }, children: [
    jsx('strong', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ui-text-primary)' }, children: title }, 't'),
    jsx('p', { style: { margin: 0, fontSize: 13, color: 'var(--ui-text-secondary)', overflowWrap: 'anywhere' }, children: body }, 'b'),
    link ? jsx('p', { style: { margin: 0, fontSize: 12, color: 'var(--ui-text-secondary)', overflowWrap: 'anywhere', userSelect: 'text' }, children: link }, 'l') : null,
    actions.length ? jsx('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }, children: actions.map(([label, onClick], i) => jsx(Button, { size: 'sm', variant: i === 0 ? 'default' : 'outline', onClick, children: label }, label)) }, 'a') : null,
  ] })
}

function Pane() {
  const [where, setWhere] = useState(null)
  const [tick, setTick] = useState(0)
  const frame = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const again = () => { setSlow(false); setTick((n) => n + 1) }
  const url = where?.url ?? null
  useEffect(() => { // ask the backend now, and again: every few seconds while there is no page, now and then once there is
    let gone = false, timer
    rest('/where').then((w) => { if (!gone) setWhere(w) }).catch(() => { if (!gone) setWhere({ state: 'off' }) })
      .finally(() => { if (!gone) timer = setTimeout(() => setTick((n) => n + 1), url ? 15000 : 4000) })
    return () => { gone = true; clearTimeout(timer) }
  }, [tick])
  useEffect(() => { setLoaded(false); setSlow(false) }, [url])
  useEffect(() => {
    if (!url || loaded) return
    const t = setTimeout(() => setSlow(true), 8000) // nothing loaded in the frame: say so instead of a blank pane
    return () => clearTimeout(t)
  }, [url, loaded])
  useEffect(() => {
    const el = frame.current
    if (!el) return
    frames.add(el)
    // Theme, accent, mode and typography are all painted onto the host root.
    const observer = new MutationObserver(() => publishTheme(el))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-hermes-mode', 'data-hermes-theme'] })
    publishTheme(el)
    return () => { frames.delete(el); observer.disconnect() }
  }, [url, slow])
  if (!where) return jsx(Message, { title: 'Opening ROM Studio', body: 'Asking Hermes where the page is.' })
  if (where.state === 'off') return jsx(Message, { title: 'ROM Studio is off in Hermes', body: 'Its part inside Hermes is not answering. Switch the plugin on with: hermes plugins enable rom-studio. Then press Try again.', actions: [['Try again', again]] })
  if (!url) {
    const actions = [['Try again', again], ...(SETTINGS.has(where.state) ? [['Open settings', openSettings]] : [])]
    return jsx(Message, { title: TITLES[where.state] ?? 'ROM Studio', body: where.message ?? 'The ROM Studio page is not there yet.', actions })
  }
  if (!/^https?:\/\//.test(url)) return jsx(Message, { title: 'Pane address not valid', body: 'The pane address in Settings, Plugins, rom-studio must start with http:// or https://.', actions: [['Open settings', openSettings]] })
  const target = new URL(url), here = location.protocol.startsWith('http') ? location.hostname : ''
  if (LOCAL.test(target.hostname) && here && !LOCAL.test(here)) // this app is open from another device: 127.0.0.1 would be that device
    return jsx(Message, { title: 'ROM Studio runs on the computer Hermes runs on', body: 'To watch from this device, start the page with a link for other devices (bun pane/server.ts --bind 0.0.0.0 --game <your game folder>) and put the whole link it prints in Settings, Plugins, rom-studio, Pane address.', link: url })
  if (location.protocol === 'https:' && target.protocol === 'http:' && !LOCAL.test(target.hostname)) // a secure page may not frame a plain http page from another computer
    return jsx(Message, { title: 'Open ROM Studio in a browser', body: 'Hermes is open over https here, so it cannot show a page from a plain http address. Open it in a browser, or use an https address as the pane address.', link: url, actions: [['Open in browser', () => openOutside(url)]] })
  if (slow) return jsx(Message, { title: 'The page did not answer', body: 'The ROM Studio page did not load in eight seconds. Hermes starts it again if it stopped.', link: url, actions: [['Try again', again], ['Open in browser', () => openOutside(url)]] })
  const src = new URL(url)
  src.searchParams.set('host', 'desktop')
  src.searchParams.set('hostOrigin', location.origin)
  // the page keeps its own address (its scripts, its saved choices) and may open the game in a new window; it cannot move this app elsewhere
  return jsx('iframe', { ref: frame, src: src.href, title: 'ROM Studio', onLoad: () => { setLoaded(true); publishTheme(frame.current) }, style: { width: '100%', height: '100%', border: 0, background: 'var(--dt-background)' },
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads', allow: 'clipboard-write', referrerPolicy: 'no-referrer' }, src.href)
}

export default {
  id: 'rom-studio',
  name: 'ROM Studio',
  register(ctx) {
    rest = ctx.rest
    os = ctx.os
    // the page listens for this message and looks at the feed right away
    ctx.onEvent('plugin.rom-studio.feed', () => frames.forEach((el) => el.contentWindow?.postMessage('feed', new URL(el.src).origin))) // only to the page this frame was given
    ctx.register({ id: 'pane', area: PANES_AREA, title: 'ROM Studio', data: { placement: 'right', width: '380px' }, render: () => jsx(Pane, {}) })
    ctx.register({ id: 'page', area: ROUTES_AREA, title: 'ROM Studio', data: { path: '/rom-studio' }, render: () => jsx(Pane, {}) })
    if (SIDEBAR_NAV_AREA) ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/rom-studio', label: 'ROM Studio', codicon: 'game' } })
  },
}
