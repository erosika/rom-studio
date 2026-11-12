// Checks plugin.yaml without Hermes: the fields the catalog needs are there, and the version and capabilities agree everywhere.
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8"), yaml = (f: string) => Bun.YAML.parse(read(f)) as Record<string, any>;
const m = yaml("plugin.yaml"), c = yaml("catalog/rom-studio.yaml"), d = JSON.parse(read("dashboard/manifest.json")), bad: string[] = [];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

for (const key of ["name", "version", "description", "author", "license", "requires_hermes", "platforms", "config_schema"]) if (!m[key]) bad.push(`plugin.yaml: ${key} is missing`);
if (!/^[a-z0-9_-]{1,64}$/.test(String(m.name))) bad.push("plugin.yaml: name must be [a-z0-9_-]{1,64}");
if (!/^>=\d+\.\d+(\.\d+)?$/.test(String(m.requires_hermes))) bad.push("plugin.yaml: requires_hermes must be a SemVer floor such as >=0.21.6");
for (const [key, entry] of Object.entries(m.config_schema ?? {}) as [string, any][]) if (!["str", "int", "float", "bool", "list", "dict"].includes(entry?.type)) bad.push(`plugin.yaml: config_schema.${key} needs a plain type (there are no secrets)`);
for (const key of ["name", "requires_hermes", "platforms"]) if (!same(c[key], m[key])) bad.push(`catalog entry: ${key} differs from plugin.yaml`);
if (String(c.version) !== String(m.version) || String(d.version) !== String(m.version)) bad.push("the version differs between plugin.yaml, dashboard/manifest.json and the catalog entry");
if (!read("kit/mcp.ts").includes(`version: "${m.version}"`)) bad.push("kit/mcp.ts reports a different version");
if (!read("CHANGELOG.md").includes(`## ${m.version}`)) bad.push("CHANGELOG.md has no heading for this version");
if (!same(c.capabilities?.provides_tools, m.provides_tools) || !same(c.capabilities?.provides_hooks, m.provides_hooks)) bad.push("catalog entry: capabilities differ from plugin.yaml");
console.log(bad.join("\n") || "manifest ok");
process.exit(bad.length ? 1 : 0);
