import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

function page(embedded = true) {
  const file = join(import.meta.dir, "theme.js");
  expect(existsSync(file), "the pane needs a host-theme receiver").toBe(true);
  const values = new Map(), listeners: Record<string, Function> = {};
  const root = { dataset: { theme: "dark" } as Record<string, string>, style: { setProperty: (k: string, v: string) => values.set(k, v), removeProperty: (k: string) => values.delete(k) } };
  const btn = { hidden: false, textContent: "", onclick: null as null | Function };
  const parent = { postMessage() {} }, window: any = {};
  window.parent = embedded ? parent : window;
  runInNewContext(readFileSync(file, "utf8"), {
    window, parent: window.parent, document: { documentElement: root, getElementById: () => btn },
    location: { search: embedded ? "?host=desktop&hostOrigin=http%3A%2F%2Flocalhost%3A9455" : "" }, URLSearchParams,
    localStorage: { paneTheme: "dark" }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    CSS: { supports: (_: string, value: string) => !value.includes("url(") },
    addEventListener: (name: string, f: Function) => listeners[name] = f,
  });
  const send = (tokens: object, source = parent, origin = "http://localhost:9455", mode = "light") => listeners.message?.({ source, origin, data: { type: "rom-studio:theme", version: 1, mode, tokens } });
  return { root, btn, values, send, parent };
}

test("embedded pane follows parent colors and mode instead of saved pane preference", () => {
  const p = page();
  p.send({ "--bg": "#fefefe", "--text": "#121212", "--accent": "#684bbf" });
  expect(p.root.dataset.theme).toBe("light");
  expect(p.root.dataset.hostTheme).toBe("true");
  expect(p.values.get("--accent")).toBe("#684bbf");
  expect(p.btn.hidden).toBe(true);
});

test("a second theme replaces colors and removes stale optional values", () => {
  const p = page();
  p.send({ "--bg": "#fefefe", "--accent": "#684bbf", "--font": "Example Font" });
  p.send({ "--bg": "#121212", "--accent": "#dbaaff" }, p.parent, "http://localhost:9455", "dark");
  expect(p.root.dataset.theme).toBe("dark");
  expect(p.values.get("--accent")).toBe("#dbaaff");
  expect(p.values.has("--font")).toBe(false);
});

test("unrelated windows, origins, invalid colors and unknown properties cannot set appearance", () => {
  const p = page();
  p.send({ "--accent": "#ff0000" }, {}, "http://localhost:9455");
  p.send({ "--accent": "#ff0000" }, p.parent, "http://unrelated.invalid");
  expect(p.values.size).toBe(0);
  p.send({ "--bg": "url(https://unrelated.invalid/a)", "--accent": "var(--unknown)", "--other": "#ff0000" });
  expect(p.values.size).toBe(0);
});

test("a standalone page retains its own dark/light control", () => {
  const p = page(false);
  expect(p.btn.hidden).toBe(false);
  expect(p.btn.textContent).toBe("Light mode");
  p.btn.onclick?.();
  expect(p.root.dataset.theme).toBe("light");
  expect(p.btn.textContent).toBe("Dark mode");
});
