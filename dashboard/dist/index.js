// ROM Studio in the Hermes web dashboard: a tab that shows the pane page, or says plainly why it is not there yet.
// A plain script (no build step) on the dashboard's plugin SDK. Nothing here moves on its own.
(function () {
  "use strict";
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;
  const { React } = SDK;
  const { useEffect, useState } = SDK.hooks;
  const { Card, CardHeader, CardTitle, CardContent, Button } = SDK.components;
  const h = React.createElement;
  const TITLES = {
    "no-game": "Choose your game folder", "no-folder": "Game folder not found", "no-server": "ROM Studio is incomplete",
    "no-bun": "bun is needed", "port-taken": "Port in use", "other-game": "Another game's page is open",
    stopped: "The page stopped", waiting: "Starting ROM Studio", starting: "Starting ROM Studio", off: "ROM Studio is off in Hermes",
  };
  const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/;

  // The dashboard's own colours, resolved to plain colour values (custom properties do not cross into a frame), sent
  // to the pane page's address only. The page shows its own palette until they arrive, and if they never do.
  const TOKENS = { "--card": "--color-card", "--line": "--color-border", "--quiet": "--color-muted-foreground", "--accent": "--color-primary",
    "--on-accent": "--color-primary-foreground", "--next": "--color-muted-foreground", "--hover": "--color-accent", "--selected": "--color-accent", "--input": "--color-input" };
  function resolved(name) {
    if (!getComputedStyle(document.documentElement).getPropertyValue(name).trim()) return "";
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }
  function modeOf(color) { // dark or light, from how bright the background is
    const n = (color.match(/[\d.]+/g) || []).map(Number), unit = /^color\(/.test(color) ? 1 : 255;
    if (n.length < 3) return "dark";
    return 0.2126 * n[0] / unit + 0.7152 * n[1] / unit + 0.0722 * n[2] / unit < 0.5 ? "dark" : "light";
  }
  function publishTheme(frame) {
    if (!frame || !frame.contentWindow) return;
    const body = getComputedStyle(document.body), tokens = { "--bg": body.backgroundColor, "--text": body.color };
    for (const [key, name] of Object.entries(TOKENS)) { const v = resolved(name); if (v) tokens[key] = v; }
    const font = getComputedStyle(document.documentElement).getPropertyValue("--theme-font-sans").trim() || body.fontFamily;
    if (font) tokens["--font"] = font;
    frame.contentWindow.postMessage({ type: "rom-studio:theme", version: 1, mode: modeOf(tokens["--bg"]), tokens }, new URL(frame.src).origin);
  }

  function Message({ title, body, link, onAgain }) {
    return h(Card, { style: { maxWidth: 640 } },
      h(CardHeader, null, h(CardTitle, null, title)),
      h(CardContent, null,
        h("p", { className: "text-sm text-muted-foreground", style: { margin: "0 0 12px", lineHeight: 1.5 } }, body),
        link ? h("p", { className: "text-xs text-muted-foreground", style: { margin: "0 0 12px", overflowWrap: "anywhere" } }, link) : null,
        onAgain ? h(Button, { onClick: onAgain }, "Try again") : null));
  }

  function RomStudio() {
    const [where, setWhere] = useState(null);
    const [tick, setTick] = useState(0);
    const frame = SDK.hooks.useRef(null);
    const again = () => setTick((n) => n + 1);
    const url = where && where.url;
    useEffect(() => { // the dashboard's theme follows into the page, now and whenever it changes
      const el = frame.current;
      if (!el) return;
      const observer = new MutationObserver(() => publishTheme(el));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-layout-variant"] });
      return () => observer.disconnect();
    }, [url]);
    useEffect(() => { // ask now, and again: every few seconds while there is no page, now and then once there is
      let gone = false, timer;
      SDK.fetchJSON("/api/plugins/rom-studio/where")
        .then((w) => { if (!gone) setWhere(w); })
        .catch(() => { if (!gone) setWhere({ state: "off", message: "Its part inside Hermes is not answering. Switch the plugin on with: hermes plugins enable rom-studio. Then press Try again." }); })
        .finally(() => { if (!gone) timer = setTimeout(again, url ? 15000 : 4000); });
      return () => { gone = true; clearTimeout(timer); };
    }, [tick]);
    if (!where) return h(Message, { title: "Opening ROM Studio", body: "Asking Hermes where the page is." });
    if (!url) return h(Message, { title: TITLES[where.state] || "ROM Studio", body: where.message || "The ROM Studio page is not there yet.", onAgain: again });
    let target;
    try { target = new URL(url); } catch { return h(Message, { title: "Pane address not valid", body: "The pane address in the ROM Studio settings must start with http:// or https://." }); }
    if (LOCAL.test(target.hostname) && !LOCAL.test(location.hostname))
      return h(Message, { title: "ROM Studio runs on the computer Hermes runs on", body: "This dashboard is open from another device, where 127.0.0.1 is that device. Start the page with a link for other devices (bun pane/server.ts --bind 0.0.0.0 --game <your game folder>) and put the whole link it prints in the ROM Studio pane address setting.", link: url });
    if (location.protocol === "https:" && target.protocol === "http:" && !LOCAL.test(target.hostname))
      return h(Message, { title: "Open ROM Studio in a browser", body: "This dashboard is open over https, so it cannot show a page from a plain http address.", link: url });
    const src = new URL(url);
    src.searchParams.set("host", "desktop"); // embedded by Hermes: take its colours
    src.searchParams.set("hostOrigin", location.origin);
    // the page keeps its own address and may open the game in a new window; it cannot move this page
    return h("iframe", { key: src.href, ref: frame, src: src.href, title: "ROM Studio", referrerPolicy: "no-referrer", allow: "clipboard-write", onLoad: () => publishTheme(frame.current),
      sandbox: "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads",
      style: { width: "100%", height: "calc(100vh - 140px)", minHeight: 480, border: 0, borderRadius: 12, display: "block" } });
  }

  window.__HERMES_PLUGINS__.register("rom-studio", RomStudio);
})();
