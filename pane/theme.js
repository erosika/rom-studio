// The embedding Desktop owns appearance. Standalone pages keep their local choice.
(() => {
  const root = document.documentElement, button = document.getElementById("theme");
  const query = new URLSearchParams(location.search), embedded = window.parent !== window && query.get("host") === "desktop";
  const origin = query.get("hostOrigin");
  const colors = ["--bg", "--card", "--line", "--text", "--quiet", "--accent", "--on-accent", "--next", "--hover", "--selected", "--input"];
  const device = matchMedia("(prefers-color-scheme: light)");
  const label = () => { button.textContent = (root.dataset.theme ?? (device.matches ? "light" : "dark")) === "dark" ? "Light mode" : "Dark mode"; };
  if (embedded) {
    button.hidden = true;
    addEventListener("message", (event) => {
      const data = event.data;
      if (event.source !== window.parent || !origin || event.origin !== origin || data?.type !== "rom-studio:theme" || data.version !== 1) return;
      if (!["light", "dark"].includes(data.mode) || !data.tokens || typeof data.tokens !== "object") return;
      for (const key of colors) {
        const value = data.tokens[key];
        if (typeof value === "string" && value.length < 2048 && CSS.supports("color", value) && !/url\(|var\(/i.test(value)) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
      const font = data.tokens["--font"];
      if (typeof font === "string" && font.length < 1024 && CSS.supports("font-family", font) && !/url\(|var\(/i.test(font)) root.style.setProperty("--font", font);
      else root.style.removeProperty("--font");
      root.dataset.theme = data.mode;
      root.dataset.hostTheme = "true";
    });
  } else {
    button.onclick = () => {
      root.dataset.theme = (root.dataset.theme ?? (device.matches ? "light" : "dark")) === "dark" ? "light" : "dark";
      try { localStorage.paneTheme = root.dataset.theme; } catch {}
      label();
    };
    device.addEventListener("change", label);
    label();
  }
})();
