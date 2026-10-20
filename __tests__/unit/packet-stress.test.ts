import { describe, expect, it } from "vitest"

import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { decodePacket, PacketDecodeError } from "../../src/protocol/packet-decoder.js"
import {
    encodeAngle,
    encodeBoost,
    encodeChallengeResponse,
    encodeKeySteering,
    encodePacket,
    encodePing,
    encodeSpawn,
    PacketEncodeError,
} from "../../src/protocol/packet-encoder.js"
import {
    angleToByte,
    byteToAngle,
    calcFoodId,
    DeathReason,
    InboundOpcode,
    SnakeRemoveReason,
} from "../../src/protocol/types.js"

describe("Packet Stress, Fuzzing & Boundary Verification Suite", () => {
    describe("1. Truncated Buffers & Frame Boundaries", () => {
        it("rejects buffers shorter than 3 bytes with PacketDecodeError", () => {
            const shortBuffers = [
                new Uint8Array([]),
                new Uint8Array([0]),
                new Uint8Array([0, 1]),
                new Uint8Array(0),
            ]

            for (const buf of shortBuffers) {
                expect(() => decodePacket(buf)).toThrow(PacketDecodeError)
                try {
                    decodePacket(buf)
                } catch (err) {
                    expect(err).toBeInstanceOf(PacketDecodeError)
                    const pErr = err as PacketDecodeError
                    expect(pErr.rawLength).toBe(buf.length)
                }
            }
        })

        it("rejects non-buffer / invalid inputs with PacketDecodeError", () => {
            const invalidInputs = [
                null,
                undefined,
                12345,
                "invalid string",
                {},
                true,
            ]

            for (const input of invalidInputs) {
                // @ts-expect-error testing invalid inputs
                expect(() => decodePacket(input)).toThrow(PacketDecodeError)
            }
        })

        it("rejects truncated payloads for all protocol opcodes", () => {
            // Helper to build header [timestamp(2 bytes), opcode(1 byte)] + partial payload
            const makePacket = (opcode: string, payload: Uint8Array): Uint8Array => {
                const out = new Uint8Array(3 + payload.length)
                out[0] = 0x01
                out[1] = 0x00
                out[2] = opcode.charCodeAt(0)
                out.set(payload, 3)
                return out
            }

            // Opcode 'a' expects at least 24 bytes
            for (let len = 0; len < 24; len++) {
                expect(() => decodePacket(makePacket("a", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 's' Variant A (remove) expects 2 or 3 bytes; 0 or 1 byte must underflow
            expect(() => decodePacket(makePacket("s", new Uint8Array(0)))).toThrow(PacketDecodeError)
            expect(() => decodePacket(makePacket("s", new Uint8Array(1)))).toThrow(PacketDecodeError)

            // Opcode 's' Variant B (add) has payload > 3 but needs at least 10 bytes for header fields
            for (let len = 4; len < 10; len++) {
                expect(() => decodePacket(makePacket("s", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'g' expects 6 bytes (snakeId 2 + x 2 + y 2)
            for (let len = 0; len < 6; len++) {
                expect(() => decodePacket(makePacket("g", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'G' expects 8 bytes (snakeId 2 + x 3 + y 3)
            for (let len = 0; len < 8; len++) {
                expect(() => decodePacket(makePacket("G", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'e', '4', '5', '3' expect at least 3 bytes (snakeId 2 + angle 1)
            for (const op of ["e", "4", "5", "3"]) {
                for (let len = 0; len < 3; len++) {
                    expect(() => decodePacket(makePacket(op, new Uint8Array(len)))).toThrow(PacketDecodeError)
                }
            }

            // Opcode 'E' expects at least 4 bytes (snakeId 2 + angle 2)
            for (let len = 0; len < 4; len++) {
                expect(() => decodePacket(makePacket("E", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'n' expects 6 bytes
            for (let len = 0; len < 6; len++) {
                expect(() => decodePacket(makePacket("n", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'N' expects 8 bytes
            for (let len = 0; len < 8; len++) {
                expect(() => decodePacket(makePacket("N", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'h' expects 4 bytes
            for (let len = 0; len < 4; len++) {
                expect(() => decodePacket(makePacket("h", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'f' / 'b' expect 6 bytes
            for (const op of ["f", "b"]) {
                for (let len = 0; len < 6; len++) {
                    expect(() => decodePacket(makePacket(op, new Uint8Array(len)))).toThrow(PacketDecodeError)
                }
            }

            // Opcode 'c' expects at least 4 bytes
            for (let len = 0; len < 4; len++) {
                expect(() => decodePacket(makePacket("c", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'y' (prey): payload <= 2 is remove, but needs 2 bytes for preyId; 0 or 1 byte underflows
            expect(() => decodePacket(makePacket("y", new Uint8Array(0)))).toThrow(PacketDecodeError)
            expect(() => decodePacket(makePacket("y", new Uint8Array(1)))).toThrow(PacketDecodeError)

            // Opcode 'y' add (payload > 2) needs preyId(2) + color(1) + x(2) + y(2) = 7 bytes
            for (let len = 3; len < 7; len++) {
                expect(() => decodePacket(makePacket("y", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'j' expects 8 bytes (preyId 2 + x 2 + y 2 + angle 1 + speed 1)
            for (let len = 0; len < 8; len++) {
                expect(() => decodePacket(makePacket("j", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'l' expects at least 5 bytes
            for (let len = 0; len < 5; len++) {
                expect(() => decodePacket(makePacket("l", new Uint8Array(len)))).toThrow(PacketDecodeError)
            }

            // Opcode 'W' and 'w' expect 2 bytes
            for (const op of ["W", "w"]) {
                for (let len = 0; len < 2; len++) {
                    expect(() => decodePacket(makePacket(op, new Uint8Array(len)))).toThrow(PacketDecodeError)
                }
            }
        })
    })

    describe("2. Multi-byte UTF-8 Nicknames & Resilient String Decoding", () => {
        it("decodes snake_add with multi-byte UTF-8 nicknames and emojis", () => {
            const nicknames = [
                "🐍 Cobra Real 🐍",
                "大蛇丸 (Orochimaru)",
                "Змей Горыныч",
                "ثعبان الصحراء",
                "Sângele Balaurului",
                "🎮 Player #1 🔥",
            ]

            for (const nick of nicknames) {
                const encodedNick = new TextEncoder().encode(nick)
                const writer = new BinaryWriter()
                    .writeUint16(100) // timestamp
                    .writeUint8(115) // 's'
                    .writeUint16(42) // snakeId
                    .writeUint8(7) // skinId
                    .writeUint24(10000) // rawX
                    .writeUint24(20000) // rawY
                    .writeUint8(encodedNick.length)
                    .writeBytes(encodedNick)
                    .writeUint8(128) // angle
                    .writeUint8(128) // wantedAngle
                    .writeUint8(57) // speed
                    .writeUint16(200) // fam
                    .writeUint16(2000) // body x
                    .writeUint16(4000) // body y

                const packet = decodePacket(writer.toUint8Array())
                expect(packet.type).toBe("snake_add")
                if (packet.type === "snake_add") {
                    expect(packet.nickname).toBe(nick)
                    expect(packet.bodyParts).toHaveLength(1)
                }
            }
        })

        it("gracefully falls back to empty string when nickLen exceeds remaining payload", () => {
            const writer = new BinaryWriter()
                .writeUint16(100)
                .writeUint8(115) // 's'
                .writeUint16(42)
                .writeUint8(7)
                .writeUint24(10000)
                .writeUint24(20000)
                .writeUint8(50) // claims 50 bytes of nickname, but none follow

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("snake_add")
            if (packet.type === "snake_add") {
                expect(packet.nickname).toBe("")
            }
        })

        it("decodes leaderboard entries with UTF-8 characters and handles truncated entries cleanly", () => {
            const nick1 = "👑 Rei da Selva 👑"
            const nick2 = "龍 (Dragon)"
            const enc1 = new TextEncoder().encode(nick1)
            const enc2 = new TextEncoder().encode(nick2)

            const writer = new BinaryWriter()
                .writeUint16(50)
                .writeUint8(108) // 'l'
                .writeUint8(0) // localInTop10
                .writeUint16(45) // localRank
                .writeUint16(300) // totalSnakes
                // Entry 1
                .writeUint16(15000)
                .writeUint8(250)
                .writeUint8(enc1.length)
                .writeBytes(enc1)
                // Entry 2
                .writeUint16(12000)
                .writeUint8(180)
                .writeUint8(enc2.length)
                .writeBytes(enc2)

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("leaderboard")
            if (packet.type === "leaderboard") {
                expect(packet.entries).toHaveLength(2)
                expect(packet.entries[0].nickname).toBe(nick1)
                expect(packet.entries[1].nickname).toBe(nick2)
                expect(packet.entries[0].rank).toBe(1)
                expect(packet.entries[1].rank).toBe(2)
            }
        })

        it("replaces invalid/malformed UTF-8 byte sequences gracefully without throwing", () => {
            // Malformed UTF-8: 0xC3 without continuation byte, or 0xFF
            const malformedBytes = new Uint8Array([0xff, 0xfe, 0x80, 0xc3])
            const writer = new BinaryWriter()
                .writeUint16(10)
                .writeUint8(115) // 's'
                .writeUint16(99)
                .writeUint8(0)
                .writeUint24(500)
                .writeUint24(500)
                .writeUint8(malformedBytes.length)
                .writeBytes(malformedBytes)

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("snake_add")
            if (packet.type === "snake_add") {
                expect(typeof packet.nickname).toBe("string")
                // Standard TextDecoder replaces invalid sequences with U+FFFD
                expect(packet.nickname).toContain("\uFFFD")
            }
        })
    })

    describe("3. Extreme Coordinate Values & Spatial Integrity", () => {
        it("handles maximum Uint24 coordinates (16,777,215) and zero correctly", () => {
            const writerMax = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(115) // 's'
                .writeUint16(1)
                .writeUint8(0)
                .writeUint24(16777215) // Max Uint24
                .writeUint24(16777215)
                .writeUint8(0) // empty nickname

            const pMax = decodePacket(writerMax.toUint8Array())
            expect(pMax.type).toBe("snake_add")
            if (pMax.type === "snake_add") {
                expect(pMax.x).toBe(16777215 / 5) // 3355443.0
                expect(pMax.y).toBe(16777215 / 5)
            }

            const writerMin = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(115) // 's'
                .writeUint16(1)
                .writeUint8(0)
                .writeUint24(0)
                .writeUint24(0)
                .writeUint8(0)

            const pMin = decodePacket(writerMin.toUint8Array())
            expect(pMin.type).toBe("snake_add")
            if (pMin.type === "snake_add") {
                expect(pMin.x).toBe(0)
                expect(pMin.y).toBe(0)
            }
        })

        it("handles extreme unsigned 16-bit coordinates for food and calcFoodId", () => {
            const extremes = [
                { x: 0, y: 0 },
                { x: 65535, y: 65535 },
                { x: 0, y: 65535 },
                { x: 65535, y: 0 },
                { x: 32768, y: 32768 },
            ]
            for (const { x, y } of extremes) {
                const writer = new BinaryWriter()
                    .writeUint16(0)
                    .writeUint8(102) // 'f'
                    .writeUint8(1) // color
                    .writeUint16(x)
                    .writeUint16(y)
                    .writeUint8(3) // size

                const packet = decodePacket(writer.toUint8Array())
                expect(packet.type).toBe("food_spawn")
                if (packet.type === "food_spawn") {
                    expect(packet.x).toBe(x)
                    expect(packet.y).toBe(y)
                    const expectedId = calcFoodId(x, y)
                    expect(packet.id).toBe(expectedId)
                    expect(Number.isSafeInteger(expectedId)).toBe(true)
                }
            }
        })

        it("verifies calcFoodId uniqueness across opposing quadrants", () => {
            const id1 = calcFoodId(100, 200)
            const id2 = calcFoodId(-100, -200)
            const id3 = calcFoodId(200, 100)
            const id4 = calcFoodId(-200, -100)

            const set = new Set([id1, id2, id3, id4])
            expect(set.size).toBe(4)
        })
    })

    describe("4. Malformed and Unknown Opcodes Fallback", () => {
        it("gracefully classifies unrecognized opcodes as unknown packet without throwing", () => {
            const unknownOpcodes = [
                0, // NUL
                255, // 0xFF
                "Z".charCodeAt(0),
                "!".charCodeAt(0),
                "?".charCodeAt(0),
                "1".charCodeAt(0),
            ]

            for (const op of unknownOpcodes) {
                const raw = new Uint8Array([0x00, 0x15, op, 0xaa, 0xbb, 0xcc])
                const packet = decodePacket(raw)
                expect(packet.type).toBe("unknown")
                expect(packet.timestamp).toBe(21)
                expect(packet.opcode).toBe(String.fromCharCode(op))
                if (packet.type === "unknown") {
                    expect(packet.payload).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]))
                }
            }
        })
    })

    describe("5. Angle Encoding Wrapping, Boundaries & Fuzzing", () => {
        it("maps canonical angles correctly to discrete bytes [0..250]", () => {
            expect(encodeAngle(0)[0]).toBe(0)
            expect(encodeAngle(Math.PI / 2)[0]).toBe(62)
            expect(encodeAngle(Math.PI)[0]).toBe(125)
            expect(encodeAngle((3 * Math.PI) / 2)[0]).toBe(187)
        })

        it("wraps seamlessly around 2*PI boundary", () => {
            // Exactly 2*PI wraps to 0
            expect(encodeAngle(Math.PI * 2)[0]).toBe(0)

            // Just below 2*PI encodes to 249 or 250
            const byteNearTwoPi = encodeAngle(Math.PI * 2 - 1e-9)[0]
            expect(byteNearTwoPi).toBeGreaterThanOrEqual(249)
            expect(byteNearTwoPi).toBeLessThanOrEqual(250)

            // Just above 2*PI wraps to 0
            expect(encodeAngle(Math.PI * 2 + 1e-9)[0]).toBe(0)
        })

        it("handles negative angles with correct modular normalization", () => {
            // -PI / 2 should wrap to 3*PI / 2 (byte 187)
            expect(encodeAngle(-Math.PI / 2)[0]).toBe(187)

            // -PI should wrap to PI (byte 125)
            expect(encodeAngle(-Math.PI)[0]).toBe(125)

            // -3*PI / 2 should wrap to PI / 2 (byte 62)
            expect(encodeAngle((-3 * Math.PI) / 2)[0]).toBe(62)

            // -2*PI should wrap to 0
            expect(encodeAngle(-Math.PI * 2)[0]).toBe(0)
        })

        it("handles large multi-revolution angles (positive and negative)", () => {
            // 10 * PI is 5 full revolutions -> 0
            expect(encodeAngle(10 * Math.PI)[0]).toBe(0)

            // 10 * PI + PI / 2 -> 62
            expect(encodeAngle(10 * Math.PI + Math.PI / 2)[0]).toBe(62)

            // -10 * PI - PI / 2 -> 187
            expect(encodeAngle(-10 * Math.PI - Math.PI / 2)[0]).toBe(187)

            // 1000 * PI -> 0
            expect(encodeAngle(1000 * Math.PI)[0]).toBe(0)

            // -1000 * Math.PI -> 0
            expect(encodeAngle(-1000 * Math.PI)[0]).toBe(0)
        })

        it("never outputs a byte >= 251 across 20,000 randomized fuzzed angles", () => {
            // Reserved bytes: 251=PING, 252=KEY_STEER, 253=BOOST_START, 254=BOOST_STOP
            for (let i = 0; i < 20000; i++) {
                // Random angle in [-10000, 10000]
                const randAngle = (Math.random() - 0.5) * 20000
                const byte = encodeAngle(randAngle)[0]
                expect(byte).toBeGreaterThanOrEqual(0)
                expect(byte).toBeLessThanOrEqual(250)
                expect(Number.isInteger(byte)).toBe(true)
            }
        })

        it("verifies angle roundtrip quantization error is bounded by 2*PI / 250", () => {
            const maxAllowedError = (Math.PI * 2) / 250

            for (let i = 0; i < 251; i++) {
                const continuous = (i / 250) * Math.PI * 2
                const encodedByte = encodeAngle(continuous)[0]
                const decoded = byteToAngle(encodedByte)
                const rawDiff = Math.abs(decoded - continuous)
                const error = Math.min(rawDiff, Math.abs(rawDiff - Math.PI * 2))
                expect(error).toBeLessThanOrEqual(maxAllowedError + 1e-9)
            }
        })

        it("rejects non-finite angle inputs with PacketEncodeError", () => {
            expect(() => encodeAngle(NaN)).toThrow(PacketEncodeError)
            expect(() => encodeAngle(Infinity)).toThrow(PacketEncodeError)
            expect(() => encodeAngle(-Infinity)).toThrow(PacketEncodeError)
            // @ts-expect-error testing invalid type
            expect(() => encodeAngle("not an angle")).toThrow(PacketEncodeError)
        })

        it("angleToByte helper safely returns 0 for non-finite inputs", () => {
            expect(angleToByte(NaN)).toBe(0)
            expect(angleToByte(Infinity)).toBe(0)
            expect(angleToByte(-Infinity)).toBe(0)
            // @ts-expect-error testing invalid type
            expect(angleToByte("foo")).toBe(0)
        })
    })

    describe("6. Outbound Command Dispatching & Edge Cases", () => {
        it("encodes spawn command with nickname truncated to 24 characters", () => {
            const longNick = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
            const p = encodeSpawn(longNick, 12, 11)
            expect(p[0]).toBe(115) // 's'
            expect(p[1]).toBe(10) // 11 - 1
            expect(p[2]).toBe(12) // skinId
            const nickBytes = p.subarray(3)
            expect(new TextDecoder().decode(nickBytes)).toBe("ABCDEFGHIJKLMNOPQRSTUVWX")
            expect(nickBytes.length).toBe(24)
        })

        it("encodes spawn command with empty or default parameters", () => {
            const p = encodeSpawn()
            expect(p[0]).toBe(115)
            expect(p[1]).toBe(10) // 11 - 1
            expect(p[2]).toBe(0) // default skinId
            expect(p.length).toBe(3) // 3 header bytes, empty nickname
        })

        it("enforces exact 24-byte requirement for challenge response", () => {
            const exact24 = new Uint8Array(24).fill(0x42)
            expect(encodeChallengeResponse(exact24)).toHaveLength(24)

            expect(() => encodeChallengeResponse(new Uint8Array(23))).toThrow(PacketEncodeError)
            expect(() => encodeChallengeResponse(new Uint8Array(25))).toThrow(PacketEncodeError)
            expect(() => encodeChallengeResponse(new Uint8Array(0))).toThrow(PacketEncodeError)
            // @ts-expect-error testing null
            expect(() => encodeChallengeResponse(null)).toThrow(PacketEncodeError)
        })

        it("dispatches all command types cleanly through encodePacket", () => {
            expect(encodePacket({ type: "steer_angle", angleByte: 0, angleRadians: 0 })[0]).toBe(0)
            expect(encodePacket({ type: "boost", active: true })).toEqual(new Uint8Array([253]))
            expect(encodePacket({ type: "boost", active: false })).toEqual(new Uint8Array([254]))
            expect(encodePacket({ type: "ping" })).toEqual(new Uint8Array([251]))
            expect(encodePacket({ type: "key_steer", direction: 1 })).toEqual(new Uint8Array([252, 1]))
        })
    })
})
