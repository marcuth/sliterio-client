# Slither.io protocol reference

This document describes the binary WebSocket protocol as implemented by this library (`src/protocol/`). It was reverse engineered from the public client and may change when the game updates.

## Conventions

- Transport: WebSocket, binary frames (`binaryType = "arraybuffer"`).
- All multi-byte integers are **Big-Endian**. `u8`, `u16`, `i16`, `u24` below refer to that encoding.
- Opcodes are single ASCII characters on the inbound side.
- World coordinates sent as `u24` are scaled: `world = raw / 5` (`COORDINATE_SCALE`).
- Angles use different resolutions depending on the packet:

| Encoding | Range | Radians |
| --- | --- | --- |
| u8 | 0..255 | `v / 256 * 2π` |
| u16 | 0..65535 | `v / 65536 * 2π` |
| u24 | 0..16777215 | `v / 16777215 * 2π` |
| Outbound steering byte | 0..250 | `v / 250 * 2π` |

## Framing

### Production servers (`isProduction: true`)

Each WebSocket message holds one or more subpackets, and a subpacket is `opcode (1 byte) + payload` (no timestamp).

If the first byte of the message is `< 32`, the message is a list of length-prefixed subpackets:

- first byte `< 32`: length is the 16-bit value `(b0 << 8) | b1`, followed by that many bytes;
- first byte `>= 32`: length is `b0 - 32`, followed by that many bytes.

Otherwise the whole message is a single subpacket. The pre-init challenge (`6`) is sent unframed.

### Mock / simple mode

Every message is `timestamp (u16) + opcode (1 byte) + payload`. The mock server uses this layout because the packets are easier to inspect.

## Handshake

```
client                                   server
  |  open WebSocket                         |
  |  [1]            (production only)  ---> |
  |  [99, 0]        (production only)  ---> |
  | <--- '6' + challenge (>= 65 bytes)      |
  |  solved token ----------------------->  |
  |  spawn ------------------------------>  |
  | <--- 'a' initial setup                  |
  | <--- 's' own snake                      |
  | <--- 'g' 'f' 'F' 'l' ...  (game)        |
  |  angle / boost / ping  <------------->  |
```

### Anti-bot challenge (`6`)

The server sends a scrambled challenge. `decodeSlitherSecret(secret)` (`src/protocol/secret-resolver.ts`) turns the payload (at least 65 bytes) into a 24-byte token using 24 pairs of bytes read from offset 17:

1. For pair `i`, take `secret[17 + 2i]` and `secret[18 + 2i]`. If a byte is `<= 96`, add 32 (to lowercase).
2. `v1 = (b1 - 98 - 34i) mod 26` and `v2 = (b2 - 115 - 34i) mod 26`, with negative remainders wrapped into `0..25`.
3. `x = (v1 << 4) | v2`; `offset = x >= 97 ? 97 : 65`; `x -= offset`.
4. On the first pair, seed an accumulator: `acc = 2 + x`.
5. Output byte `i` = `((x + acc) mod 26) + offset`.
6. `acc += 3 + x`.

The 24-byte result is sent back as-is.

On official servers the challenge payload is itself an obfuscated script: it is decoded (nibble pairs offset by `23 + 17k`), executed to fill a 27-byte array, and then passed through a rotation cipher. `SlitherClient` handles both variants and falls back to `decodeSlitherSecret` if evaluation fails.

## Outbound commands

| Bytes | Meaning |
| --- | --- |
| `[0..250]` | Steering angle (`encodeAngle`). |
| `[251]` | Ping (protocol >= 5; older versions use `112`). |
| `[252, dir]` | Key steering: `0` stop, `1` left, `2` right. |
| `[253]` | Boost start. |
| `[254]` | Boost stop. |
| `[115, version-1, skin, ...nick]` | Spawn (simple mode). Nickname is UTF-8, max 24 chars. |

Production spawn (`115`): `[115, 30, clientVersion (u16), 20-byte constant, skin, nickLen, ...nick, 0, 255]` with `clientVersion = 291`.

The client sends a ping every `pingIntervalMs` (default 250 ms) and only transmits a steering byte when it differs from the last one.

## Inbound packets

| Opcode | Name | Payload |
| --- | --- | --- |
| `6` | Pre-init challenge | Challenge bytes (>= 65). |
| `a` | Initial setup | `gameRadius u24, mscps u16, sectorSize u16, sectorCount u16, spangdv u16, nsp1 u16, nsp2 u16, nsp3 u16, mamu u16, mamu2 u16, cst u16, protocolVersion u8?` (default 11). |
| `s` | Snake add / remove | See below. |
| `g` | Snake move (relative) | `id u16, x u16, y u16`. |
| `G` | Snake move (absolute) | `id u16, x u24, y u24` (x, y / 5). |
| `e` `3` `4` `5` | Snake rotate | `id u16, angle u8, wanted u8?, speed u8?`. |
| `E` | Snake rotate (hi-res) | `id u16, angle u16, wanted u16?, speed u8?`. |
| `n` | Snake grow | `id u16, x u16, y u16`. |
| `N` | Snake grow (ext) | `id u16, x u24, y u24` (x, y / 5). |
| `h` | Fullness | `id u16, fam u16`. |
| `f` `b` | Food spawn (natural / turbo) | `color u8, x i16, y i16, size u8`. |
| `F` | Food batch | Repeated `color u8, x i16, y i16, size u8`. |
| `c` | Food eaten | `x i16, y i16, eaterId u16?`. |
| `y` | Prey add / remove | Remove: `id u16`. Add: `id u16, color u8, x i16, y i16, size u8?`. |
| `j` | Prey update | `id u16, x i16, y i16, angle u8, speed u8`. |
| `l` | Leaderboard | `inTop10 u8, rank u16, total u16`, then entries `score u16, fam u8, nickLen u8, nick`. |
| `v` | Death | `reason u8?`: `0` normal, `1` new high score, `2` disconnected. |
| `k` | Kill stats | `kills u16` (or `u8`). |
| `p` | Pong | None. |
| `W` / `w` | Sector add / remove | `sx u8, sy u8`. |

Unrecognised opcodes are returned as `{ type: "unknown", opcode, payload }`.

### Snake add / remove (`s`)

- **Remove**: payload `<= 3` bytes: `id u16, reason u8?`, where `1` = died and `0` = left the viewport.
- **Add (official layout)**: `id u16, angle u24, 1 unused byte, wanted u24, speed u16 (/10), fam u24, skin u8, x u24, y u24, nickLen u8, nick`. In production this is followed by a length-prefixed cosmetics block and then the body as `dx u8, dy u8` pairs, each `(v - 127) / 2`, accumulated from the head position.
- **Add (simple layout)**: `id u16, skin u8, x u24, y u24, nickLen u8, nick, angle u8, wanted u8, speed u8, fam u16`, then body points as `x u16, y u16` pairs.

### Food ids

Foods have no id on the wire. The library derives one as `y * gameRadius * 3 + x` (`calcFoodId`) and removes it when a `c` packet arrives at the same coordinates.

## Using the codec directly

```ts
import { decodePacket, encodeAngle, encodeBoost, decodeSlitherSecret } from "@marcuth/slitherio"

const packet = decodePacket(bytes)          // simple mode
const prod = decodePacket(bytes, true)      // production subpacket
const steer = encodeAngle(Math.PI / 2)      // Uint8Array [62]
const boost = encodeBoost(true)             // Uint8Array [253]
const token = decodeSlitherSecret(challenge)
```

In simple mode `decodePacket` throws `PacketDecodeError` on malformed input; in production mode it returns an `unknown` packet instead, so one bad subpacket never breaks the stream.
