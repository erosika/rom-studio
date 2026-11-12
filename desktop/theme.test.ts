import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./plugin.js", import.meta.url), "utf8").replace(/^import .*$/gm, "").replace("export default", "const plugin =");
test("the host sends painted theme tokens only to its pane origin", () => {
  const sent: any[] = [];
  const root = { dataset: { hermesMode: "light" } };
  const context = {
    document: { documentElement: root }, URL,
    getComputedStyle: () => ({ getPropertyValue: (key: string) => ({ "--dt-background": "#efefef", "--dt-card": "#fafafa", "--dt-input-bg": "0%", "--ui-text-primary": "#151515", "--theme-primary": "#9955cc", "--dt-font-sans": "system-ui" })[key] ?? "" }),
    PANES_AREA: "panes", ROUTES_AREA: "routes",
  };
  runInNewContext(source, context);
  const publish = runInNewContext("typeof publishTheme === 'function' ? publishTheme : null", context);
  expect(publish, "the frame must receive the actual host palette").toBeFunction();
  publish({ src: "http://127.0.0.1:8789/?host=desktop", contentWindow: { postMessage: (...args: any[]) => sent.push(args) } });
  expect(sent).toHaveLength(1);
  expect(sent[0][1]).toBe("http://127.0.0.1:8789");
  expect(sent[0][0]).toMatchObject({ type: "rom-studio:theme", version: 1, mode: "light", tokens: { "--bg": "#efefef", "--text": "#151515", "--accent": "#9955cc", "--font": "system-ui" } });
  // Desktop input fill is derived from card + opacity, not a --ui-input-background token.
  expect(sent[0][0].tokens['--input']).toBe('color-mix(in srgb, #fafafa 0%, transparent)');
});
