# Night Shift: Extraction

A complete starter repo for a browser-based top-down **2D multiplayer grid game** using only open-web tech:
- **Client:** HTML/CSS/JavaScript + `<canvas>` 2D rendering
- **Server:** Node.js + WebSocket (`ws`) with authoritative simulation
- **Persistence:** JSON file store (`/server/data/users.json`) for XP + level by username

Designed to run in **GitHub Codespaces** (or locally) with one command.

---

## Quick Start (Codespaces + local)

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

> Multiplayer test: open multiple browser tabs/windows and join with different usernames.

---

## Game Loop Overview

### Phases
1. **Gather Phase (45s)**
   - Collect resources from adjacent trees/rocks.
   - Step on chest tiles for random loot.
   - Checkpoints are just walkable tiles.

2. **Chase Phase (60s)**
   - Enemies spawn and chase nearest non-safe player.
   - Checkpoints become safe respite areas (enemies avoid them, players there are not targeted).
   - Team objective: **all players must reach objective tile(s)** before time runs out.
   - Win = XP reward and round reset. Fail = round reset.

### Inventory + Auto-Craft
- Materials: `wood`, `stone`, `cloth`, `oil`, `pebbles`
- Gear tiers (0-3): `torch`, `bat`, `slingshot`
- Press **E** to auto-craft/upgrade (server-validated):
  1. craft Torch T1, then Bat T1, then Slingshot T1
  2. then upgrades Torch → Bat → Slingshot up to tier 3

Recipes:
- Torch T1: `2 wood + 1 cloth`
- Torch upgrade: `+2 wood +1 oil` per tier
- Bat T1: `3 wood`
- Bat upgrade: `+2 wood +1 stone` per tier
- Slingshot T1: `2 wood + 2 pebbles`
- Slingshot upgrade: `+1 wood +2 pebbles +1 cloth` per tier

### Combat / Interaction
- **Space** attack:
  - Slingshot equipped: fires a projectile (stuns enemies briefly)
  - Else bat equipped: short melee stun
- Torch increases chase-phase vision radius via darkness overlay on client.

---

## Controls
- **Move:** WASD / Arrow keys
- **Auto-craft / auto-upgrade:** E
- **Attack:** Space

---

## Project Structure

```text
NightShift/
  client/
    index.html
    styles.css
    main.js
  server/
    data/
      users.json
    constants.js
    game.js
    index.js
    map.js
    persistence.js
  package.json
  README.md
```

---

## Networking & Simulation Notes

- Authoritative server simulation loop at **60 ticks/sec**.
- Snapshot broadcast every **100ms** (~10Hz).
- Client sends compact input state (`movement`, `craft`, `attack`).
- Server decides movement collision, crafting validity, enemy AI, phase transitions, objective win/fail, and XP updates.

---

## Persistence

User profile persistence in `/server/data/users.json`:
- keyed by username
- stores `xp` and `level`
- loaded on join
- saved on XP changes and disconnect

Level formula:

```js
level = Math.floor(Math.sqrt(xp / 50)) + 1;
```

---

## Next Steps (student-friendly enhancements)

1. Add a **minimap** and fog-of-war explored tiles.
2. Expand map generation with named zones (camp, market, forest) and weighted loot tables.
3. Add enemy variants (fast scout, tank, ranged) and smarter pathfinding around obstacles.
4. Add item durability + simple crafting UI queue while keeping server authoritative.
5. Add match history and per-user stats (wins, best extraction time) to the JSON profile.

