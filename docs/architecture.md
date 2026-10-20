# Architecture

```
src/
├── index.ts            Public entry point
├── protocol/           Wire format
│   ├── types.ts            Opcodes, packet interfaces, helpers
│   ├── binary-reader.ts    Big-Endian reader (8/16/24/32-bit, strings)
│   ├── binary-writer.ts    Big-Endian writer
│   ├── packet-decoder.ts   bytes -> InboundPacket
│   ├── packet-encoder.ts   OutboundPacket -> bytes
│   └── secret-resolver.ts  Anti-bot challenge solver
├── math/
│   ├── vector.ts           Angles, distances, coordinate scaling
│   └── spatial-grid.ts     Spatial hash grid + WorldQueries
├── models/             Snake, Food, Prey, leaderboard, GameState
├── client/
│   ├── events.ts           TypedEventEmitter and event map
│   └── slither-client.ts   High-level client
└── mock/
    ├── mock-server.ts      Local WebSocket server implementing the protocol
    └── mock-scenarios.ts   Helpers for combat / feeding simulations
```

## Data flow

1. `SlitherClient` receives raw bytes from the WebSocket.
2. `decodePacket` turns them into a tagged `InboundPacket` union.
3. `GameState.updateFromPacket` applies the packet to the world model and returns `GameEvent`s.
4. The client re-emits those as typed events (`snake_update`, `food_eaten`, ...) and a `tick`.
5. Commands (`turnTo`, `setBoost`, `spawn`) are encoded by `packet-encoder` and sent back.

## Client state machine

```
DISCONNECTED -> CONNECTING -> HANDSHAKING -> READY -> PLAYING -> DEAD
      ^                                                           |
      +-----------------------------------------------------------+
```

- `HANDSHAKING`: socket open, waiting for the challenge.
- `READY`: challenge answered, `spawn()` may be called.
- `PLAYING`: own snake received.
- `DEAD`: a death packet arrived; `spawn()` again to respawn.

## Spatial queries

`SpatialHashGrid` buckets foods and obstacles by cell, so `WorldQueries.findNearestFood`, `findFoodClusters` and `findNearbyObstacles` only inspect nearby cells instead of the whole world.

## Mock server

`MockSlitherServer` implements the handshake, spawn, movement ticks, food spawning and death, so the client and your bots can be tested without the network. The test suite lives in `__tests__/` (`unit`, `mock`, `e2e`).
