# @marcuth/slitherio

A fully-typed TypeScript SDK for [Slither.io](https://slither.io): connect to game servers over WebSocket, track the world state in real time, and control a snake programmatically. It ships with a binary protocol codec, a spatial index for fast queries, and a local mock server for deterministic testing.

> **Disclaimer:** this is an unofficial project, not affiliated with Slither.io. Use it for learning, research and testing. Automating the official game may violate its terms of service.

## Features

- **Typed client** (`SlitherClient`) with a connection state machine and a typed event emitter.
- **Automatic handshake**: solves the anti-bot challenge (packet `6`) for you.
- **Movement helpers**: `turnTo`, `turnToDegrees`, `moveTo`, `setBoost`, with dirty-checking so duplicate packets are never sent.
- **Live game state**: your snake, other snakes, food, prey, leaderboard and arena bounds.
- **Spatial hash grid** for nearest-food, food-cluster and obstacle queries.
- **Collision avoidance**: `queries.findSafeHeading` picks a heading that stays clear of other snakes and the arena edge, accounting for how fast your snake can turn.
- **Protocol codec**: `decodePacket`, `encode*` functions and a Big-Endian reader/writer with 24-bit support.
- **Mock server** (`MockSlitherServer`) and scenarios for offline tests and CI.

## Installation

```bash
npm install @marcuth/slitherio ws
```

`ws` is only needed in Node.js, where there is no global `WebSocket` (or pass your own `webSocketFactory`).

## Quick start

```ts
import WebSocket from "ws"
import { SlitherClient } from "@marcuth/slitherio"

const client = new SlitherClient({
    serverUrl: "ws://127.0.0.1:8080",
    webSocketFactory: (url) => new WebSocket(url) as any,
    // isProduction: true, // for official servers
})

client.on("tick", (state) => {
    const me = state.mySnake
    if (!me) return

    const food = client.queries.findNearestFood(me.head, { maxDistance: 600 })
    const desired = food ? Math.atan2(food.y - me.head.y, food.x - me.head.x) : me.angle

    // Steer toward the food, detouring around other snakes
    const heading = client.queries.findSafeHeading(me.head, desired, {
        selfSnakeId: me.id,
        currentAngle: me.angle,
    })
    client.turnTo(heading.angle)
})

client.on("snake_died", (e) => {
    if (e.isSelf) console.log("Died!")
})

await client.connect()
await client.spawn("my-bot")
```

### Local mock server

```ts
import { MockSlitherServer } from "@marcuth/slitherio"

const server = new MockSlitherServer({ autoTick: true })
await server.start(8080)
```

Or run `npm run server`.

## API overview

| Member | Description |
| --- | --- |
| `connect(url?)` | Opens the socket and performs the handshake. |
| `spawn(nickname?, skinId?)` | Spawns a snake; resolves with the `Snake`. |
| `turnTo(radians)` / `turnToDegrees(deg)` | Sets the target heading. |
| `moveTo({ x, y })` | Turns toward a world point; returns `{ angle, distance }`. |
| `setBoost(active)` / `boost()` / `stopBoost()` | Speed boost control. |
| `disconnect()` | Closes the connection. |
| `state` | `DISCONNECTED`, `CONNECTING`, `HANDSHAKING`, `READY`, `PLAYING`, `DEAD`. |
| `gameState` / `queries` | Live world state and spatial queries. |

Events: `connect`, `disconnect`, `state_change`, `game_start`, `spawn`, `snake_add`, `snake_update`, `snake_died`, `food_spawn`, `food_eaten`, `prey_spawn`, `prey_update`, `prey_eaten`, `leaderboard_update`, `tick`, `error`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm test` | Run the Vitest suite. |
| `npm run server` | Start the local mock server. |
| `npm run example` | Run the demo bot (`--mock` for the local server). |
| `npm run lint` / `npm run format` | ESLint / Prettier. |

## Documentation

- [Protocol reference](docs/protocol.md): wire format, handshake and every packet.
- [Architecture](docs/architecture.md): source layout and how the pieces fit together.

## License

MIT © Marcuth
