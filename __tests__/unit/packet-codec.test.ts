import { describe, expect, it } from "vitest"

import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { decodePacket, PacketDecodeError } from "../../src/protocol/packet-decoder.js"
import {
    encodeAngle,
    encodeBoost,
    encodeChallengeResponse,
    encodeKeySteering,
    encodeKeyTurn,
    encodePacket,
    encodePing,
    encodeSpawn,
    PacketEncodeError,
} from "../../src/protocol/packet-encoder.js"
import { DeathReason, KeySteerDirection, OutboundPacket, SnakeRemoveReason } from "../../src/protocol/types.js"

describe("Packet Codec Suite", () => {
    describe("Inbound Packet Decoder (decodePacket)", () => {
        it("throws PacketDecodeError on buffers shorter than 3 bytes", () => {
            expect(() => decodePacket(new Uint8Array([]))).toThrow(PacketDecodeError)
            expect(() => decodePacket(new Uint8Array([0, 1]))).toThrow(PacketDecodeError)
        })

        it("correctly unpacks timestamp delta and opcode byte for pong", () => {
            const raw = new Uint8Array([0x01, 0x2c, 112]) // timestamp = 300ms, opcode = 'p'
            const packet = decodePacket(raw)
            expect(packet.timestamp).toBe(300)
            expect(packet.opcode).toBe("p")
            expect(packet.type).toBe("pong")
        })

        it('decodes Packet "6" (Pre-init Security Challenge)', () => {
            const writer = new BinaryWriter()
                .writeUint16(45)
                .writeUint8(54) // '6'
                .writeBytes(new Uint8Array(65).fill(97))

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("pre_init_challenge")
            expect(packet.opcode).toBe("6")
            expect(packet.timestamp).toBe(45)
            if (packet.type === "pre_init_challenge") {
                expect(packet.challenge.length).toBe(65)
            }
        })

        it('decodes Packet "a" (Initial Setup) with arena parameters', () => {
            const writer = new BinaryWriter()
                .writeUint16(50)
                .writeUint8(97) // 'a'
                .writeUint24(21600) // gameRadius
                .writeUint16(411) // mscps
                .writeUint16(300) // sectorSize
                .writeUint16(100) // sectorCount
                .writeUint16(10) // spangdv
                .writeUint16(1) // nsp1
                .writeUint16(2) // nsp2
                .writeUint16(3) // nsp3
                .writeUint16(4) // mamu
                .writeUint16(5) // mamu2
                .writeUint16(6) // cst
                .writeUint8(11) // protocolVersion

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("initial_setup")
            if (packet.type === "initial_setup") {
                expect(packet.gameRadius).toBe(21600)
                expect(packet.mscps).toBe(411)
                expect(packet.sectorSize).toBe(300)
                expect(packet.sectorCount).toBe(100)
                expect(packet.spangdv).toBe(10)
                expect(packet.nsp1).toBe(1)
                expect(packet.nsp2).toBe(2)
                expect(packet.nsp3).toBe(3)
                expect(packet.mamu).toBe(4)
                expect(packet.mamu2).toBe(5)
                expect(packet.cst).toBe(6)
                expect(packet.protocolVersion).toBe(11)
            }
        })

        it('throws PacketDecodeError on truncated setup "a" packet', () => {
            const writer = new BinaryWriter()
                .writeUint16(50)
                .writeUint8(97)
                .writeUint16(1234) // Only 2 bytes payload instead of 24
            expect(() => decodePacket(writer.toUint8Array())).toThrow(PacketDecodeError)
        })

        it('decodes Packet "s" Variant A (Snake Removed / Died)', () => {
            const bufDied = new Uint8Array([0x00, 0x10, 115, 0x04, 0xd2, 1]) // ID 1234, died
            const p1 = decodePacket(bufDied)
            expect(p1.type).toBe("snake_remove")
            if (p1.type === "snake_remove") {
                expect(p1.snakeId).toBe(1234)
                expect(p1.reason).toBe(SnakeRemoveReason.DIED)
                expect(p1.status).toBe("died")
            }

            const bufLeft = new Uint8Array([0x00, 0x10, 115, 0x04, 0xd2, 0]) // ID 1234, left
            const p2 = decodePacket(bufLeft)
            if (p2.type === "snake_remove") {
                expect(p2.reason).toBe(SnakeRemoveReason.LEFT_VIEWPORT)
                expect(p2.status).toBe("left")
            }
        })

        it('decodes Packet "s" Variant B (Snake Add) with scaled coordinates and body parts', () => {
            const writer = new BinaryWriter()
                .writeUint16(20)
                .writeUint8(115) // 's'
                .writeUint16(55) // snakeId = 55
                .writeUint8(3) // skinId = 3
                .writeUint24(50000) // rawX (world x = 10000)
                .writeUint24(75000) // rawY (world y = 15000)
                .writeString8("Viper") // nickLen = 5 + "Viper"
                .writeUint8(128) // angleByte (PI rad)
                .writeUint8(128) // wantedAngleByte
                .writeUint8(60) // speed
                .writeUint16(500) // fam
                // 2 body parts (4 bytes each)
                .writeUint16(9900)
                .writeUint16(14900)
                .writeUint16(9800)
                .writeUint16(14800)

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("snake_add")
            if (packet.type === "snake_add") {
                expect(packet.snakeId).toBe(55)
                expect(packet.skinId).toBe(3)
                expect(packet.x).toBe(10000)
                expect(packet.y).toBe(15000)
                expect(packet.nickname).toBe("Viper")
                expect(packet.angle).toBeCloseTo(Math.PI, 2)
                expect(packet.wantedAngle).toBeCloseTo(Math.PI, 2)
                expect(packet.speed).toBe(60)
                expect(packet.fam).toBe(500)
                expect(packet.bodyParts).toHaveLength(2)
                expect(packet.bodyParts[0]).toEqual({ x: 9900, y: 14900 })
                expect(packet.bodyParts[1]).toEqual({ x: 9800, y: 14800 })
            }
        })

        it('decodes Packet "g" (Short Move) and "G" (Extended Move)', () => {
            const gWriter = new BinaryWriter().writeUint16(5).writeUint8(103).writeUint16(42).writeUint16(500).writeUint16(600)
            const pG = decodePacket(gWriter.toUint8Array())
            expect(pG.type).toBe("snake_move")
            if (pG.type === "snake_move") {
                expect(pG.snakeId).toBe(42)
                expect(pG.x).toBe(500)
                expect(pG.y).toBe(600)
                expect(pG.mode).toBe("relative")
            }

            const gExtWriter = new BinaryWriter()
                .writeUint16(5)
                .writeUint8(71) // 'G'
                .writeUint16(42)
                .writeUint24(5000) // rawX / 5 = 1000
                .writeUint24(6000) // rawY / 5 = 1200
            const pGExt = decodePacket(gExtWriter.toUint8Array())
            expect(pGExt.type).toBe("snake_move_ext")
            if (pGExt.type === "snake_move_ext") {
                expect(pGExt.snakeId).toBe(42)
                expect(pGExt.x).toBe(1000)
                expect(pGExt.y).toBe(1200)
                expect(pGExt.mode).toBe("absolute")
            }
        })

        it('decodes Packet "e", "4", "5", "3" (Rotations) and "E" (High Precision)', () => {
            const rotWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(101) // 'e'
                .writeUint16(10)
                .writeUint8(64) // angle = 64/256 * 2pi = pi/2
                .writeUint8(128) // wantedAngle = pi
                .writeUint8(80) // speed
            const pRot = decodePacket(rotWriter.toUint8Array())
            expect(pRot.type).toBe("snake_rotate")
            if (pRot.type === "snake_rotate") {
                expect(pRot.snakeId).toBe(10)
                expect(pRot.angle).toBeCloseTo(Math.PI / 2, 2)
                expect(pRot.wantedAngle).toBeCloseTo(Math.PI, 2)
                expect(pRot.speed).toBe(80)
            }

            const rotExtWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(69) // 'E'
                .writeUint16(10)
                .writeUint16(32768) // angle = 32768/65536 * 2pi = pi
                .writeUint16(16384) // wantedAngle = pi/2
                .writeUint8(90)
            const pRotExt = decodePacket(rotExtWriter.toUint8Array())
            expect(pRotExt.type).toBe("snake_rotate")
            if (pRotExt.type === "snake_rotate") {
                expect(pRotExt.opcode).toBe("E")
                expect(pRotExt.angle).toBeCloseTo(Math.PI, 3)
                expect(pRotExt.wantedAngle).toBeCloseTo(Math.PI / 2, 3)
                expect(pRotExt.speed).toBe(90)
            }
        })

        it('decodes Packet "n" (Snake Grow) and "N" (Ext Snake Grow)', () => {
            const nWriter = new BinaryWriter().writeUint16(0).writeUint8(110).writeUint16(7).writeUint16(300).writeUint16(400)
            const pN = decodePacket(nWriter.toUint8Array())
            expect(pN.type).toBe("snake_grow")
            if (pN.type === "snake_grow") {
                expect(pN.snakeId).toBe(7)
                expect(pN.x).toBe(300)
                expect(pN.y).toBe(400)
            }

            const nExtWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(78) // 'N'
                .writeUint16(7)
                .writeUint24(1500) // 1500 / 5 = 300
                .writeUint24(2000) // 2000 / 5 = 400
            const pNExt = decodePacket(nExtWriter.toUint8Array())
            expect(pNExt.type).toBe("snake_grow_ext")
            if (pNExt.type === "snake_grow_ext") {
                expect(pNExt.snakeId).toBe(7)
                expect(pNExt.x).toBe(300)
                expect(pNExt.y).toBe(400)
            }
        })

        it('decodes Packet "h" (Fullness / fam update)', () => {
            const writer = new BinaryWriter()
                .writeUint16(1)
                .writeUint8(104) // 'h'
                .writeUint16(88)
                .writeUint16(1200)
            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("snake_fullness")
            if (packet.type === "snake_fullness") {
                expect(packet.snakeId).toBe(88)
                expect(packet.fam).toBe(1200)
            }
        })

        it('decodes single food packets "f" (Natural) and "b" (Turbo)', () => {
            const writer = new BinaryWriter()
                .writeUint16(10)
                .writeUint8(102) // 'f'
                .writeUint8(4) // color
                .writeInt16(150) // x
                .writeInt16(-200) // y
                .writeUint8(2) // size
            const pF = decodePacket(writer.toUint8Array())
            expect(pF.type).toBe("food_spawn")
            if (pF.type === "food_spawn") {
                expect(pF.x).toBe(150)
                expect(pF.y).toBe(-200)
                expect(pF.color).toBe(4)
                expect(pF.size).toBe(2)
                expect(pF.isTurbo).toBe(false)
                expect(pF.id).toBe(-200 * 21600 * 3 + 150)
            }

            const writerB = new BinaryWriter()
                .writeUint16(10)
                .writeUint8(98) // 'b'
                .writeUint8(5)
                .writeInt16(10)
                .writeInt16(20)
                .writeUint8(1)
            const pB = decodePacket(writerB.toUint8Array())
            expect(pB.type).toBe("food_spawn")
            if (pB.type === "food_spawn") {
                expect(pB.isTurbo).toBe(true)
            }
        })

        it('decodes batch food packet "F"', () => {
            const writer = new BinaryWriter()
                .writeUint16(5)
                .writeUint8(70) // 'F'
                .writeUint8(1)
                .writeInt16(10)
                .writeInt16(20)
                .writeUint8(1)
                .writeUint8(2)
                .writeInt16(30)
                .writeInt16(40)
                .writeUint8(3)
            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("food_batch")
            if (packet.type === "food_batch") {
                expect(packet.foods).toHaveLength(2)
                expect(packet.foods[0].x).toBe(10)
                expect(packet.foods[1].y).toBe(40)
            }
        })

        it('decodes Packet "c" (Food Eaten)', () => {
            const writer = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(99) // 'c'
                .writeInt16(150)
                .writeInt16(-250)
                .writeUint16(42)
            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("food_eaten")
            if (packet.type === "food_eaten") {
                expect(packet.x).toBe(150)
                expect(packet.y).toBe(-250)
                expect(packet.eaterSnakeId).toBe(42)
                expect(packet.id).toBe(-250 * 21600 * 3 + 150)
            }
        })

        it('decodes Packet "y" (Prey Add vs Remove) and "j" (Prey Update)', () => {
            // Prey remove (payload <= 2)
            const pRemWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(121) // 'y'
                .writeUint16(501)
            const pRem = decodePacket(pRemWriter.toUint8Array())
            expect(pRem.type).toBe("prey_remove")
            if (pRem.type === "prey_remove") {
                expect(pRem.preyId).toBe(501)
            }

            // Prey add (payload > 2)
            const pAddWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(121) // 'y'
                .writeUint16(501)
                .writeUint8(3) // color
                .writeInt16(120) // x
                .writeInt16(340) // y
                .writeUint8(2) // size
            const pAdd = decodePacket(pAddWriter.toUint8Array())
            expect(pAdd.type).toBe("prey_add")
            if (pAdd.type === "prey_add") {
                expect(pAdd.preyId).toBe(501)
                expect(pAdd.color).toBe(3)
                expect(pAdd.x).toBe(120)
                expect(pAdd.y).toBe(340)
                expect(pAdd.size).toBe(2)
            }

            // Prey update 'j'
            const pUpdWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(106) // 'j'
                .writeUint16(501)
                .writeInt16(125)
                .writeInt16(345)
                .writeUint8(64) // angle = pi/2
                .writeUint8(40) // speed
            const pUpd = decodePacket(pUpdWriter.toUint8Array())
            expect(pUpd.type).toBe("prey_update")
            if (pUpd.type === "prey_update") {
                expect(pUpd.preyId).toBe(501)
                expect(pUpd.x).toBe(125)
                expect(pUpd.y).toBe(345)
                expect(pUpd.angle).toBeCloseTo(Math.PI / 2, 2)
                expect(pUpd.speed).toBe(40)
            }
        })

        it('decodes Packet "l" (Leaderboard)', () => {
            const writer = new BinaryWriter()
                .writeUint16(100)
                .writeUint8(108) // 'l'
                .writeUint8(1) // localInTop10
                .writeUint16(3) // localRank
                .writeUint16(250) // totalSnakes
                // Entry 1
                .writeUint16(5000)
                .writeUint8(120)
                .writeString8("Player1")
                // Entry 2
                .writeUint16(4500)
                .writeUint8(80)
                .writeString8("Player2")

            const packet = decodePacket(writer.toUint8Array())
            expect(packet.type).toBe("leaderboard")
            if (packet.type === "leaderboard") {
                expect(packet.localPlayerInTop10).toBe(true)
                expect(packet.localRank).toBe(3)
                expect(packet.totalSnakes).toBe(250)
                expect(packet.entries).toHaveLength(2)
                expect(packet.entries[0]).toEqual({
                    rank: 1,
                    score: 5000,
                    fam: 120,
                    nickname: "Player1",
                })
                expect(packet.entries[1]).toEqual({
                    rank: 2,
                    score: 4500,
                    fam: 80,
                    nickname: "Player2",
                })
            }
        })

        it('decodes Packet "v" (Player Death) and "k" (Kill Stats)', () => {
            const vWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(118) // 'v'
                .writeUint8(0) // normal death
            const pV = decodePacket(vWriter.toUint8Array())
            expect(pV.type).toBe("death")
            if (pV.type === "death") {
                expect(pV.reason).toBe(DeathReason.NORMAL)
                expect(pV.reasonText).toBe("normal")
            }

            const vWriterHigh = new BinaryWriter().writeUint16(0).writeUint8(118).writeUint8(1)
            const pVHigh = decodePacket(vWriterHigh.toUint8Array())
            if (pVHigh.type === "death") {
                expect(pVHigh.reason).toBe(DeathReason.NEW_HIGH_SCORE)
                expect(pVHigh.reasonText).toBe("new_high_score")
            }

            const kWriter = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(107) // 'k'
                .writeUint16(12)
            const pK = decodePacket(kWriter.toUint8Array())
            expect(pK.type).toBe("kill_stats")
            if (pK.type === "kill_stats") {
                expect(pK.kills).toBe(12)
            }
        })

        it('decodes Packet "W" (Sector Add) and "w" (Sector Remove)', () => {
            const wAdd = new Uint8Array([0, 0, 87, 10, 20]) // 'W'
            const pAdd = decodePacket(wAdd)
            expect(pAdd.type).toBe("sector_add")
            if (pAdd.type === "sector_add") {
                expect(pAdd.sectorX).toBe(10)
                expect(pAdd.sectorY).toBe(20)
            }

            const wRem = new Uint8Array([0, 0, 119, 10, 20]) // 'w'
            const pRem = decodePacket(wRem)
            expect(pRem.type).toBe("sector_remove")
            if (pRem.type === "sector_remove") {
                expect(pRem.sectorX).toBe(10)
                expect(pRem.sectorY).toBe(20)
            }
        })

        it("gracefully handles unknown opcodes as unknown type", () => {
            const raw = new Uint8Array([0, 5, 255, 1, 2, 3])
            const packet = decodePacket(raw)
            expect(packet.type).toBe("unknown")
            if (packet.type === "unknown") {
                expect(packet.opcode).toBe(String.fromCharCode(255))
                expect(packet.payload).toEqual(new Uint8Array([1, 2, 3]))
            }
        })
    })

    describe("Outbound Packet Encoders", () => {
        it("encodes angles into [0..250] range correctly", () => {
            expect(encodeAngle(0)[0]).toBe(0)
            expect(encodeAngle(Math.PI / 2)[0]).toBe(62)
            expect(encodeAngle(Math.PI)[0]).toBe(125)
            expect(encodeAngle((3 * Math.PI) / 2)[0]).toBe(187)
            expect(encodeAngle(Math.PI * 2 - 0.0001)[0]).toBe(249)
            expect(encodeAngle(-Math.PI / 2)[0]).toBe(187)
        })

        it("throws PacketEncodeError on non-finite angle inputs", () => {
            expect(() => encodeAngle(NaN)).toThrow(PacketEncodeError)
            expect(() => encodeAngle(Infinity)).toThrow(PacketEncodeError)
        })

        it("encodes boost states", () => {
            expect(encodeBoost(true)).toEqual(new Uint8Array([253]))
            expect(encodeBoost(false)).toEqual(new Uint8Array([254]))
        })

        it("encodes ping packets for modern and legacy protocol", () => {
            expect(encodePing(11)).toEqual(new Uint8Array([251]))
            expect(encodePing(4)).toEqual(new Uint8Array([112]))
        })

        it("encodes key steering and key turn commands", () => {
            expect(encodeKeySteering("stop")).toEqual(new Uint8Array([252, 0]))
            expect(encodeKeySteering("left")).toEqual(new Uint8Array([252, 1]))
            expect(encodeKeySteering("right")).toEqual(new Uint8Array([252, 2]))
            expect(encodeKeyTurn(KeySteerDirection.LEFT)).toEqual(new Uint8Array([252, 1]))
        })

        it("encodes spawn packet with nickname truncation, skin ID, and emojis", () => {
            const packet = encodeSpawn("ThisIsAVeryLongNicknameThatExceeds24Characters", 5, 11)
            expect(packet[0]).toBe(115) // 's'
            expect(packet[1]).toBe(10) // 11 - 1
            expect(packet[2]).toBe(5) // skinId
            const nickBytes = packet.subarray(3)
            const decodedNick = new TextDecoder().decode(nickBytes)
            expect(decodedNick).toBe("ThisIsAVeryLongNicknameT")
            expect(decodedNick.length).toBe(24)

            const emojiPacket = encodeSpawn("🐍Bot🚀", 2, 11)
            expect(emojiPacket[0]).toBe(115)
            const decodedEmoji = new TextDecoder().decode(emojiPacket.subarray(3))
            expect(decodedEmoji).toBe("🐍Bot🚀")
        })

        it("encodes challenge response and enforces 24-byte requirement", () => {
            const valid = new Uint8Array(24).fill(65)
            expect(encodeChallengeResponse(valid)).toHaveLength(24)
            expect(() => encodeChallengeResponse(new Uint8Array(20))).toThrow(PacketEncodeError)
            // @ts-expect-error testing invalid input
            expect(() => encodeChallengeResponse(null)).toThrow(PacketEncodeError)
        })

        it("dispatches outbound packets through encodePacket", () => {
            const pAngle: OutboundPacket = { type: "steer_angle", angleByte: 125, angleRadians: Math.PI }
            expect(encodePacket(pAngle)[0]).toBe(125)

            const pBoost: OutboundPacket = { type: "boost", active: true }
            expect(encodePacket(pBoost)).toEqual(new Uint8Array([253]))

            const pPing: OutboundPacket = { type: "ping" }
            expect(encodePacket(pPing)).toEqual(new Uint8Array([251]))

            const pKey: OutboundPacket = { type: "key_steer", direction: KeySteerDirection.RIGHT }
            expect(encodePacket(pKey)).toEqual(new Uint8Array([252, 2]))

            const pSpawn: OutboundPacket = { type: "spawn", nickname: "TestBot", skinId: 1 }
            expect(encodePacket(pSpawn)[0]).toBe(115)

            const pChallenge: OutboundPacket = {
                type: "challenge_response",
                token: new Uint8Array(24).fill(90),
            }
            expect(encodePacket(pChallenge)).toHaveLength(24)
        })
    })
})
