# McEnv
Docker for block game servers
---
Reproducible Minecraft server environments — define your entire server in one config file and reproduce it anywhere with one command.

## Install

**Linux:**
```bash
curl -fsSL https://github.com/meloncatting/mcenv/releases/latest/download/mcenv-linux -o mcenv
chmod +x mcenv
sudo mv mcenv /usr/local/bin/mcenv
```

**macOS:**
```bash
curl -fsSL https://github.com/meloncatting/mcenv/releases/latest/download/mcenv-macos -o mcenv
chmod +x mcenv
sudo mv mcenv /usr/local/bin/mcenv
```

**Windows:** Download `mcenv-win.exe` from [Releases](https://github.com/meloncatting/mcenv/releases), rename it to `mcenv.exe`, and move it to `C:\Windows\System32\`.

---

## Quick start

**From an existing server:**
```bash
mcenv init ./my-server -o ./my-server-config
cd my-server-config
mcenv install
```

**From scratch:**
```bash
mcenv init -n my-server
# edit mcenv.yaml
mcenv install
```

---

## Commands

| Command | What it does |
|---|---|
| `mcenv init [server-dir]` | Scan existing server → generate `mcenv.yaml` + `configs/` |
| `mcenv install` | Download all mods/plugins and install the server |
| `mcenv update` | Re-resolve versions and reinstall |
| `mcenv list` | Show every pinned artifact and its SHA-256 |
| `mcenv validate` | Check config for errors (no network needed) |
| `mcenv clean` | Delete server directory, keep download cache |
| `mcenv cache size/clean` | Manage `~/.mcenv/cache/` |
| `mcenv dockerize` | Generate `Dockerfile` + `docker-compose.yml` |

---

## Example config

```yaml
name: survival-fabric
minecraft_version: "1.21.1"

loader:
  type: fabric
  version: "*"

java:
  version: "21"
  memory: "4G"

config_dir: ./configs   # your plugin/mod configs live here

server:
  difficulty: normal
  gamemode: survival
  max_players: 20
  online_mode: true
  motd: "My Server"

mods:
  - id: fabric-api
    source: modrinth
    version: "*"
  - id: lithium
    source: modrinth
    version: "*"
  - id: sodium
    source: modrinth
    version: "*"
```

---

## How configs work

Put your plugin and mod config files in `configs/` — the structure mirrors your server directory:

```
configs/
  server.properties
  plugins/
    LuckPerms/config.yml
  config/
    lithium.properties
```

Every `mcenv install` copies these into the server directory. Commit `configs/` to git — that's your source of truth.

---

## Sharing a server

```bash
# Export your server
mcenv init ./my-server -o ./my-server-config
zip -r my-server-config.zip my-server-config/

# Someone else reproduces it exactly
unzip my-server-config.zip
cd my-server-config
mcenv install
cd server && ./start.sh
```

No jars included — everything downloads automatically at the exact same versions.

---

## Supported loaders

`vanilla` · `paper` · `fabric` · `quilt` · `forge` · `neoforge`

## Supported mod sources

`modrinth` · `url` · `local`

---

Copyright (c) 2026 meloncatting. All rights reserved.
