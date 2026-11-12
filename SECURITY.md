# Security

## Reporting

Report a problem privately through the repository's "Report a vulnerability" page (GitHub
security advisories). Please do not open a public issue for something that could harm users
before it is fixed. Say what you ran, what happened and what you expected.

## What listens, and where

| Server | Started by | Binds to | Sign-in |
|---|---|---|---|
| Pane (`pane/server.ts`) | the plugin, when a game folder is set; or you | 127.0.0.1:8778; another address only with `--bind` | none from this computer; from any other device, the key in the link it prints (`/k/<key>/`) |
| Player (`player/server.ts`) | `kit play` | 127.0.0.1:4870 | none |
| Player, phone link | `kit play --phone` | your private network addresses, port 4871, https with a certificate made on your computer | a key in the link, needed for the game file and the agent link |
| Kit MCP server (`kit/mcp.ts`) | your agent host | stdio only, no port | the host's |

Both servers answer only under this computer's own names (`localhost`, a bare address) plus any
name you list in `ROM_STUDIO_HOSTS`, refuse requests made by a page on another site, read every
body with a size limit, and send a content policy with their pages. The player passes `/pane/` on
to the pane on this computer (`ROM_STUDIO_PANE_LOCAL`, default `http://127.0.0.1:8778`), for
owners who put one trusted address in front of both.

## Trust model

1. One user, one computer. Programs running as you on that computer are trusted: from 127.0.0.1
   the pane and the player need no key.
2. Other devices are not trusted without the key: the pane's `/k/<key>/` link, the player's phone
   link. Web pages on other sites are never trusted, with or without a key in hand.
3. The decomp is code you chose to trust: building it runs its build scripts as you.
4. The in-game agent link (only in a game built with the optional base, which this repository
   does not carry) runs your own `hermes` command with your agent's normal tools and approval
   rules. ROM Studio never passes a flag that skips approvals. `"hermes_link": false` turns it off.
5. Nothing is sent to anyone. Setup downloads two things, each pinned (a sha256 in `kit/kit.ts`,
   a sha512 in `player/bun.lock`); nothing updates itself. A reverse proxy you put in front
   (`ROM_STUDIO_HOSTS`) is yours to protect: what reaches it reaches the pane as this computer.

`README.md`, "What it starts, writes and sends", is the full list.
