# Slither.io protocol reference

This document describes the binary WebSocket protocol as implemented by this library (`src/protocol/`). It was reverse engineered from the public client and may change when the game updates.

## Conventions

- Transport: WebSocket, binary frames (`binaryType = "arraybuffer"`).
- All multi-byte integers are **Big-Endian**. `u8`, `u16`, `u16`, `u24` below refer to that encoding.
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

## Inbound packets: simple (mock) mode

| Opcode | Name | Payload |
| --- | --- | --- |
| `6` | Pre-init challenge | Challenge bytes (>= 65). |
| `a` | Initial setup | `gameRadius u24, mscps u16, sectorSize u16, sectorCount u16, spangdv u16, nsp1 u16, nsp2 u16, nsp3 u16, mamu u16, mamu2 u16, cst u16, protocolVersion u8?`. |
| `s` | Snake add / remove | Remove: `id u16, reason u8?`. Add: `id u16, skin u8, x u24, y u24, nickLen u8, nick, angle u8, wanted u8, speed u8, fam u16`, then `x u16, y u16` body pairs. |
| `g` / `G` | Snake move | `id u16, x u16, y u16` / `id u16, x u24, y u24` (x, y / 5). |
| `e` `3` `4` `5` / `E` | Snake rotate | `id u16, angle u8, wanted u8?, speed u8?` / `id u16, angle u16, ...`. |
| `n` / `N` | Snake grow | Same coordinates as `g` / `G`. |
| `h` | Fullness | `id u16, fam u16`. |
| `f` `b` / `F` | Food | `color u8, x u16, y u16, size u8` (repeated for `F`). |
| `c` | Food eaten | `x u16, y u16, eaterId u16?`. |
| `y` / `j` | Prey add, remove / update | See `packet-decoder.ts`. |
| `l` | Leaderboard | `inTop10 u8, rank u16, total u16`, then `score u16, fam u8, nickLen u8, nick`. |
| `v` | Death | `reason u8?`. |
| `k` `p` `W` `w` | Kills, pong, sectors | See `packet-decoder.ts`. |

## Inbound packets: official servers

Official servers (protocol 19 at the time of writing) are heavily compressed. The behaviour below was taken from the public game client and verified against live servers; it is implemented by `ProductionDecoder` (`src/protocol/production-decoder.ts`), which keeps the state these packets depend on.

Three ideas explain most of the format:

1. **Your own snake has no id.** Short variants of a packet mean "the snake you control" (the snake from the first `s` after `a`).
2. **Head positions are derived, not sent.** A move packet carries only a 16-bit heading `iang` (`angle = iang / 65536 * 2π`); the new head is the previous head plus `defaultMsl` (42 units) along that heading. If `iang` is omitted, the previous one is reused.
3. **Food is addressed by sector.** A food id is `(sectorX << 24) | (sectorY << 16) | (dx << 8) | dy`, and `x = sectorX * sectorSize + dx * sectorSize / 256`. The sector of the last food / eaten packet is remembered and reused by shorter packets.

### Setup (`a`)

`gameRadius u24, mscps u16, sectorSize u16, sectorCount u16, spangdv u8 (/10), nsp1 u16 (/100), nsp2 u16 (/100), nsp3 u16 (/100), mamu u16 (/1000), mamu2 u16 (/1000), cst u16 (/1000), protocolVersion u8, defaultMsl u8, ...`.

### Snakes

| Opcode | Payload (after the opcode) |
| --- | --- |
| `s` add | `id u16, angle u24, dir u8, wanted u24, speed u16 (/1000), fam u24 (/16777215), skin u8, x u24, y u24 (/5), nickLen u8, nick, skinLen u8, skin..., cosmetic u8`, then the body. |
| `s` remove | `id u16, killed u8` (payload <= 6 bytes). |
| `g` | `id u16, iang u16?` (payload 4 bytes with angle, 2 without). |
| `G` | Own snake: `iang u16?` (payload 2 bytes with angle, 0 without). |
| `n` / `N` | Like `g` / `G` plus `fam u24` at the end: the snake grew by one segment. |
| `+` / `=` | Absolute position: `[id u16,] iang u16, x u16, y u16`. |
| `e` `E` `3` `4` `5` | Rotation, own snake when the payload is <= 2 bytes (else `id u16` first). Remaining bytes by total packet length: see below. |
| `d` `7` | Own snake rotation: `angle u8, wanted u8, speed u8`. |
| `h` | `id u16, fam u24`. |
| `r` | `id u16, fam u24?`: one tail segment removed. |
| `k` | `id u16, kills u24`. |

Body of an `s` add packet, listed tail to head: one absolute point (`x u24, y u24`, /5), then `dx u8, dy u8` pairs with `(v - 127) / 2` each. In protocol >= 15 the last two bytes are an `iang u16` for the final point instead of a delta pair.

Rotation payloads (all angles `u8 * 2π / 256`, speed `u8 / 18`):

| Total packet length | `e` | `E` / `4` | `3` / `5` |
| --- | --- | --- | --- |
| 6 | `angle, wanted, speed` | same | same |
| 5 or 3 | `angle, speed` | `wanted, speed` | `angle, wanted` |
| 4 or 2 | `angle` | `wanted` | `3`: `speed` |

### World

| Opcode | Payload |
| --- | --- |
| `F` | `sectorX u8, sectorY u8`, then repeated `color u8, dx u8, dy u8, size u8 (/5)`. |
| `f` / `b` | `[sectorX u8, sectorY u8,] dx u8, dy u8, [color u8,] size u8 (/5)`; sector present when the payload is >= 5 bytes, color when it is 4 or 6. |
| `c` | `[sectorX u8, sectorY u8,] dx u8, dy u8`; sector omitted when the payload is 2 bytes. |
| `C` | Like `c`, eaten by the last eater. |
| `<` | Like `c` plus `eaterId u16` (payload 4 bytes: sector omitted). |
| `y` | `id u16` removes; `id u16, snakeId u16` eaten; otherwise add: `id u16, color u8, x u24, y u24 (/5), size u8 (/5), dir u8, wanted u24, angle u24, speed u16`. |
| `j` | `id u16, x u16, y u16` (`1 + v * 3`) followed by optional angle / speed fields chosen by payload length. |
| `l` | `myPosition u8, rank u16, total u16`, then entries `sct u16, fam u24, color u8, nickLen u8, nick`. |
| `v` | `reason u8`: `0` died, `1` new high score, `2` disconnected. |
| `W` / `w` | Sector enter / leave (`sx u8, sy u8`); leaving drops the food of that sector. |
| `p` | Pong. |

Score is computed as `floor((fpsls[sct] + fam / fmlts[sct] - 1) * 15 - 5)`, where for `i < mscps`: `fmlts[i] = (1 - i / mscps)^2.25` and `fpsls[i] = fpsls[i-1] + 1 / fmlts[i-1]`; `sct` is the number of body segments.

Unrecognised opcodes (for example the minimap `M`) are returned as `{ type: "unknown", opcode, payload }`.

## Using the codec directly

```ts
import { decodePacket, ProductionDecoder, encodeAngle, encodeBoost, decodeSlitherSecret } from "@marcuth/slitherio"

const packet = decodePacket(bytes)          // simple mode
const decoder = new ProductionDecoder()      // official servers: stateful
const packets = decoder.decode(subpacket)  // zero or more packets
const steer = encodeAngle(Math.PI / 2)      // Uint8Array [62]
const boost = encodeBoost(true)             // Uint8Array [253]
const token = decodeSlitherSecret(challenge)
```

`decodePacket` handles the simple (mock) format and throws `PacketDecodeError` on malformed input. `ProductionDecoder.decode` returns an `unknown` packet instead, so one bad subpacket never breaks the stream.
