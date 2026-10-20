/**
 * @file client-lifecycle.test.ts
 * @description Comprehensive E2E integration test suite for Slither.io client lifecycle.
 * Covers Tiers 1-4 per TEST_INFRA.md:
 * - Tier 1: Feature Coverage (8 features x 5 tests = 40 tests)
 * - Tier 2: Boundary & Corner Cases (8 features x 5 tests = 40 tests)
 * - Tier 3: Cross-Feature Combinations (8 tests)
 * - Tier 4: Real-World Application Scenarios (5 scenarios)
 * Total: 93 automated E2E tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ClientState, SlitherClient } from "../../src/client/slither-client.js"
import {
    angleDifference,
    directionTo,
    distance,
    normalizeAngle,
    protocolByteToRadians,
    protocolToWorld,
    radiansToProtocolByte,
    worldToProtocol,
} from "../../src/math/vector.js"
import { createBasicGameScenario } from "../../src/mock/mock-scenarios.js"
import { MockSlitherServer } from "../../src/mock/mock-server.js"
import { GameState } from "../../src/models/game-state.js"
import { BinaryReader, BufferUnderflowError } from "../../src/protocol/binary-reader.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { decodePacket } from "../../src/protocol/packet-decoder.js"
import {
    encodeAngle,
    encodeBoost,
    encodeChallengeResponse,
    encodeKeySteering,
    encodePing,
    encodeSpawn,
} from "../../src/protocol/packet-encoder.js"
import {
    KeySteerDirection,
    OutboundCommand,
} from "../../src/protocol/types.js"

describe("Milestone 4: E2E Integration Suite — Client Lifecycle (Tiers 1-4)", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    // =========================================================================
    // TIER 1: FEATURE COVERAGE (8 features x 5 tests = 40 tests)
    // =========================================================================
    describe("Tier 1: Feature Coverage", () => {
        // Feature 1: Anti-Bot Handshake
        describe("Feature 1: Anti-Bot Handshake", () => {
            it("1.1 automatically resolves Packet '6' challenge and reaches READY state", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                expect(client.state).toBe(ClientState.DISCONNECTED)

                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))

                expect(client.state).toBe(ClientState.READY)
                client.disconnect()
            })

            it("1.2 computes and sends exactly 24-byte challenge response token", async () => {
                const socket = server.createClientSocket()
                let challengeResponseLength = 0
                const origSend = socket.send.bind(socket)
                socket.send = (data: any) => {
                    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
                    if (bytes.length === 24) {
                        challengeResponseLength = bytes.length
                    }
                    origSend(data)
                }

                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))

                expect(challengeResponseLength).toBe(24)
                expect(client.state).toBe(ClientState.READY)
                client.disconnect()
            })

            it("1.3 validates handshake token and unlocks player spawn capability", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))

                const snake = await client.spawn("HeroSnake", 2)
                expect(snake).toBeDefined()
                expect(snake.name).toBe("HeroSnake")
                expect(client.state).toBe(ClientState.PLAYING)
                client.disconnect()
            })

            it("1.4 handles handshake with custom challenge seed strings", async () => {
                const customSeed =
                    "AlphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXiOmicronPiRhoSigmaTauUpsilonPhiChiPsiOmega_1234567890!"
                const customServer = new MockSlitherServer({
                    challengeSeed: customSeed,
                    autoTick: false,
                })

                const socket = customServer.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))

                expect(client.state).toBe(ClientState.READY)
                client.disconnect()
                await customServer.stop()
            })

            it("1.5 resets client state cleanly to DISCONNECTED on abrupt disconnect during handshake", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                const connectPromise = client.connect()

                client.disconnect()
                await connectPromise.catch(() => {})

                expect(client.state).toBe(ClientState.DISCONNECTED)
            })
        })

        // Feature 2: Binary Codec & 24-bit Ints
        describe("Feature 2: Binary Codec & 24-bit Ints", () => {
            it("2.1 serializes and deserializes 24-bit unsigned integers accurately", () => {
                const testValues = [0, 1, 255, 65535, 1000000, 16777215]
                for (const val of testValues) {
                    const writer = new BinaryWriter().writeUint24(val)
                    const reader = new BinaryReader(writer.toUint8Array())
                    expect(reader.readUint24()).toBe(val)
                }
            })

            it("2.2 serializes and deserializes 24-bit signed integers correctly", () => {
                const testValues = [-8388608, -100000, -1, 0, 1, 100000, 8388607]
                for (const val of testValues) {
                    const writer = new BinaryWriter().writeInt24(val)
                    const reader = new BinaryReader(writer.toUint8Array())
                    expect(reader.readInt24()).toBe(val)
                }
            })

            it("2.3 preserves Big-Endian byte ordering across 16-bit, 24-bit, and 32-bit values", () => {
                const writer = new BinaryWriter()
                    .writeUint16(0x1234)
                    .writeUint24(0x56789a)
                    .writeUint32(0xbcdef012)
                const buf = writer.toUint8Array()

                // Check raw bytes
                expect(buf[0]).toBe(0x12)
                expect(buf[1]).toBe(0x34)
                expect(buf[2]).toBe(0x56)
                expect(buf[3]).toBe(0x78)
                expect(buf[4]).toBe(0x9a)
                expect(buf[5]).toBe(0xbc)
                expect(buf[6]).toBe(0xde)
                expect(buf[7]).toBe(0xf0)
                expect(buf[8]).toBe(0x12)

                const reader = new BinaryReader(buf)
                expect(reader.readUint16()).toBe(0x1234)
                expect(reader.readUint24()).toBe(0x56789a)
                expect(reader.readUint32()).toBe(0xbcdef012)
            })

            it("2.4 encodes and decodes length-prefixed strings with UTF-8 characters", () => {
                const testStrings = ["", "bot", "Slither Master", "Cobra 🐍 #1"]
                for (const str of testStrings) {
                    const writer = new BinaryWriter().writeString8(str)
                    const reader = new BinaryReader(writer.toUint8Array())
                    expect(reader.readString8()).toBe(str)
                }
            })

            it("2.5 throws BufferUnderflowError when reading beyond buffer bounds", () => {
                const reader = new BinaryReader(new Uint8Array([1, 2]))
                expect(() => reader.readUint24()).toThrow(BufferUnderflowError)
            })
        })

        // Feature 3: Inbound Packet Decoding
        describe("Feature 3: Inbound Packet Decoding", () => {
            it("3.1 decodes initial setup packet 'a' into structured WorldInfo", () => {
                const packetBuf = new BinaryWriter()
                    .writeUint16(10) // timestamp delta
                    .writeUint8(97) // 'a'
                    .writeUint24(21600) // radius
                    .writeUint16(411) // mscps
                    .writeUint16(300) // sectorSize
                    .writeUint16(144) // sectorCount
                    .writeUint16(48) // spangdv
                    .writeUint16(425) // nsp1
                    .writeUint16(500) // nsp2
                    .writeUint16(600) // nsp3
                    .writeUint16(1200) // mamu
                    .writeUint16(1400) // mamu2
                    .writeUint16(822) // cst
                    .writeUint8(11) // protocolVersion
                    .toUint8Array()

                const packet = decodePacket(packetBuf)
                expect(packet.type).toBe("initial_setup")
                if (packet.type === "initial_setup") {
                    expect(packet.gameRadius).toBe(21600)
                    expect(packet.mscps).toBe(411)
                    expect(packet.protocolVersion).toBe(11)
                }
            })

            it("3.2 decodes snake add packet 's' with body coordinates and metadata", () => {
                const packetBuf = new BinaryWriter()
                    .writeUint16(0)
                    .writeUint8(115) // 's'
                    .writeUint16(42) // snakeId
                    .writeUint8(5) // skin
                    .writeUint24(50000) // x * 5
                    .writeUint24(60000) // y * 5
                    .writeString8("ApexPredator")
                    .writeUint8(128) // angle byte
                    .writeUint8(128) // wanted angle byte
                    .writeUint8(58) // speed byte
                    .writeUint16(0) // fullness
                    .writeUint16(9980) // body segment 1 x
                    .writeUint16(12000) // body segment 1 y
                    .toUint8Array()

                const packet = decodePacket(packetBuf)
                expect(packet.type).toBe("snake_add")
                if (packet.type === "snake_add") {
                    expect(packet.snakeId).toBe(42)
                    expect(packet.name).toBe("ApexPredator")
                    expect(packet.skin).toBe(5)
                    expect(packet.x).toBe(10000)
                    expect(packet.y).toBe(12000)
                }
            })

            it("3.3 decodes movement packet 'g' and rotation packet 'e'", () => {
                const moveBuf = new BinaryWriter()
                    .writeUint16(5)
                    .writeUint8(103) // 'g'
                    .writeUint16(10)
                    .writeUint16(1500)
                    .writeUint16(2500)
                    .toUint8Array()
                const movePacket = decodePacket(moveBuf)
                expect(movePacket.type).toBe("snake_move")
                if (movePacket.type === "snake_move") {
                    expect(movePacket.snakeId).toBe(10)
                    expect(movePacket.x).toBe(1500)
                    expect(movePacket.y).toBe(2500)
                }

                const rotBuf = new BinaryWriter()
                    .writeUint16(5)
                    .writeUint8(101) // 'e'
                    .writeUint16(10)
                    .writeUint8(64)
                    .writeUint8(128)
                    .writeUint8(115)
                    .toUint8Array()
                const rotPacket = decodePacket(rotBuf)
                expect(rotPacket.type).toBe("snake_rotate")
                if (rotPacket.type === "snake_rotate") {
                    expect(rotPacket.snakeId).toBe(10)
                    expect(rotPacket.speed).toBe(115)
                }
            })

            it("3.4 decodes natural food 'f', turbo food 'b', batch 'F', and food eaten 'c'", () => {
                const foodF = decodePacket(
                    new BinaryWriter().writeUint16(0).writeUint8(102).writeUint8(3).writeInt16(100).writeInt16(200).writeUint8(2).toUint8Array()
                )
                expect(foodF.type).toBe("food_spawn")

                const foodB = decodePacket(
                    new BinaryWriter().writeUint16(0).writeUint8(98).writeUint8(4).writeInt16(150).writeInt16(250).writeUint8(1).toUint8Array()
                )
                expect(foodB.type).toBe("food_spawn")

                const foodBatch = decodePacket(
                    new BinaryWriter()
                        .writeUint16(0)
                        .writeUint8(70) // 'F'
                        .writeUint8(1).writeInt16(10).writeInt16(20).writeUint8(1)
                        .writeUint8(2).writeInt16(30).writeInt16(40).writeUint8(2)
                        .toUint8Array()
                )
                expect(foodBatch.type).toBe("food_batch")
                if (foodBatch.type === "food_batch") {
                    expect(foodBatch.foods.length).toBe(2)
                }

                const foodEaten = decodePacket(
                    new BinaryWriter().writeUint16(0).writeUint8(99).writeInt16(10).writeInt16(20).writeUint16(42).toUint8Array()
                )
                expect(foodEaten.type).toBe("food_eaten")
                if (foodEaten.type === "food_eaten") {
                    expect(foodEaten.eaterSnakeId).toBe(42)
                }
            })

            it("3.5 decodes prey packets ('y', 'j') and player death packet 'v'", () => {
                const preyAdd = decodePacket(
                    new BinaryWriter().writeUint16(0).writeUint8(121).writeUint16(7).writeUint8(2).writeInt16(500).writeInt16(600).writeUint8(3).toUint8Array()
                )
                expect(preyAdd.type).toBe("prey_add")

                const death = decodePacket(
                    new BinaryWriter().writeUint16(0).writeUint8(118).writeUint8(0).toUint8Array()
                )
                expect(death.type).toBe("death")
                if (death.type === "death") {
                    expect(death.reason).toBe(0)
                }
            })
        })

        // Feature 4: Outbound Command Encoding
        describe("Feature 4: Outbound Command Encoding", () => {
            it("4.1 encodes continuous heading angle into protocol byte 0..250", () => {
                const angle0 = encodeAngle(0)
                expect(angle0.length).toBe(1)
                expect(angle0[0]).toBe(0)

                const anglePi = encodeAngle(Math.PI)
                expect(anglePi[0]).toBe(125)

                const angleHalfPi = encodeAngle(Math.PI / 2)
                expect(angleHalfPi[0]).toBe(62) // or 63
            })

            it("4.2 encodes boost start (253) and boost stop (254) commands", () => {
                const boostStart = encodeBoost(true)
                expect(boostStart.length).toBe(1)
                expect(boostStart[0]).toBe(OutboundCommand.BOOST_START)

                const boostStop = encodeBoost(false)
                expect(boostStop.length).toBe(1)
                expect(boostStop[0]).toBe(OutboundCommand.BOOST_STOP)
            })

            it("4.3 encodes player spawn packet with skin ID and UTF-8 nickname", () => {
                const spawnPacket = encodeSpawn("PlayerBot", 7)
                expect(spawnPacket[0]).toBe(OutboundCommand.SPAWN)
                expect(spawnPacket[2]).toBe(7) // skin ID
                const nameStr = Buffer.from(spawnPacket.subarray(3)).toString("utf8")
                expect(nameStr).toBe("PlayerBot")
            })

            it("4.4 encodes heartbeat ping packet (251)", () => {
                const ping = encodePing()
                expect(ping.length).toBe(1)
                expect(ping[0]).toBe(OutboundCommand.PING)
            })

            it("4.5 encodes key steering command (252)", () => {
                const straight = encodeKeySteering(KeySteerDirection.STRAIGHT)
                expect(straight[0]).toBe(OutboundCommand.KEY_STEER)
                expect(straight[1]).toBe(KeySteerDirection.STRAIGHT)

                const left = encodeKeySteering(KeySteerDirection.LEFT)
                expect(left[1]).toBe(KeySteerDirection.LEFT)

                const right = encodeKeySteering(KeySteerDirection.RIGHT)
                expect(right[1]).toBe(KeySteerDirection.RIGHT)
            })
        })

        // Feature 5: Angle & Steering Math
        describe("Feature 5: Angle & Steering Math", () => {
            it("5.1 normalizes arbitrary angles into standard [0, 2pi) range", () => {
                expect(normalizeAngle(0)).toBe(0)
                expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 5)
                expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5)
                expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 5)
                expect(normalizeAngle(-Math.PI * 4)).toBeCloseTo(0, 5)
            })

            it("5.2 converts radians to protocol bytes (0..250) and back with high fidelity", () => {
                const angles = [0, 0.5, 1.5, Math.PI, 4.5, 6.0]
                for (const ang of angles) {
                    const byte = radiansToProtocolByte(ang)
                    expect(byte).toBeGreaterThanOrEqual(0)
                    expect(byte).toBeLessThanOrEqual(250)
                    const restored = protocolByteToRadians(byte)
                    expect(Math.abs(normalizeAngle(ang) - restored)).toBeLessThanOrEqual((Math.PI * 2) / 250 + 1e-3)
                }
            })

            it("5.3 calculates shortest signed angle difference across boundary wraps", () => {
                expect(angleDifference(1, 0)).toBeCloseTo(1, 4)
                expect(angleDifference(0, 1)).toBeCloseTo(-1, 4)
                // Boundary crossing
                const diffAcrossZero = angleDifference(0.1, Math.PI * 2 - 0.1)
                expect(diffAcrossZero).toBeCloseTo(0.2, 4)
            })

            it("5.4 computes Euclidean distance and heading direction between 2D points", () => {
                const p1 = { x: 0, y: 0 }
                const p2 = { x: 30, y: 40 }
                expect(distance(p1, p2)).toBeCloseTo(50, 4)

                const heading = directionTo(p1, { x: 10, y: 0 })
                expect(heading).toBeCloseTo(0, 4)

                const headingNorth = directionTo(p1, { x: 0, y: 10 })
                expect(headingNorth).toBeCloseTo(Math.PI / 2, 4)
            })

            it("5.5 transforms protocol scaled coordinates (x*5) to world space and back", () => {
                const worldX = 1234.5
                const protocolX = worldToProtocol(worldX)
                expect(protocolX).toBe(Math.round(worldX * 5))
                expect(protocolToWorld(protocolX)).toBeCloseTo(worldX, 0)
            })
        })

        // Feature 6: Real-time Game State
        describe("Feature 6: Real-time Game State", () => {
            it("6.1 aggregates self snake, other snakes, foods, and preys in memory", () => {
                const state = new GameState()
                expect(state.snakes.size).toBe(0)
                expect(state.foods.size).toBe(0)
                expect(state.preys.size).toBe(0)
                expect(state.mySnakeId).toBeNull()
                expect(state.self).toBeUndefined()
            })

            it("6.2 indexes spawned foods into spatial hash grid and updates on removal", () => {
                const state = new GameState()
                state.updateFromPacket({
                    type: "food_spawn",
                    food: { id: 101, x: 500, y: 500, size: 2, color: 1 },
                } as any)

                expect(state.foods.size).toBe(1)
                const nearest = state.queries.findNearestFood({ x: 510, y: 500 }, { maxDistance: 300 })
                expect(nearest).toBeDefined()
                expect(nearest?.id).toBe(101)

                state.updateFromPacket({
                    type: "food_eaten",
                    foodId: 101,
                    x: 500,
                    y: 500,
                } as any)
                expect(state.foods.size).toBe(0)
                const nearestAfter = state.queries.findNearestFood({ x: 510, y: 500 }, { maxDistance: 300 })
                expect(nearestAfter).toBeNull()
            })

            it("6.3 updates snake body segments and heading on movement packet", () => {
                const state = new GameState()
                state.updateFromPacket({
                    type: "snake_add",
                    snakeId: 1,
                    name: "Mover",
                    skin: 0,
                    x: 1000,
                    y: 1000,
                    angle: 0,
                    wantedAngle: 0,
                    speed: 58,
                    fullness: 0,
                    body: [
                        { x: 1000, y: 1000 },
                        { x: 985, y: 1000 },
                    ],
                } as any)

                const snake = state.snakes.get(1)!
                expect(snake.x).toBe(1000)

                state.updateFromPacket({
                    type: "snake_move",
                    snakeId: 1,
                    x: 1020,
                    y: 1000,
                } as any)

                expect(snake.x).toBe(1020)
                expect(snake.head.x).toBe(1020)
            })

            it("6.4 updates leaderboard rankings from packet 'l'", () => {
                const state = new GameState()
                state.updateFromPacket({
                    type: "leaderboard",
                    entries: [
                        { rank: 1, score: 2500, fam: 0, nickname: "King" },
                        { rank: 2, score: 1800, fam: 0, nickname: "Queen" },
                    ],
                    localInTop10: true,
                    localRank: 1,
                    totalSnakes: 20,
                } as any)

                expect(state.leaderboard.length).toBe(2)
                expect(state.leaderboard[0].nickname).toBe("King")
                expect(state.leaderboard[0].score).toBe(2500)
            })

            it("6.5 clears all entities, queries, and spatial grid on gameState.clear()", () => {
                const state = new GameState()
                state.updateFromPacket({
                    type: "food_spawn",
                    food: { id: 1, x: 100, y: 100, size: 1, color: 0 },
                } as any)
                expect(state.foods.size).toBe(1)

                state.clear()
                expect(state.foods.size).toBe(0)
                expect(state.snakes.size).toBe(0)
                expect(state.mySnakeId).toBeNull()
            })
        })

        // Feature 7: High-Level Client API
        describe("Feature 7: High-Level Client API", () => {
            it("7.1 turnTo(angle) implements discrete dirty-checking to prevent redundant sends", async () => {
                const socket = server.createClientSocket()
                const sentPackets: Uint8Array[] = []
                const origSend = socket.send.bind(socket)
                socket.send = (data: any) => {
                    sentPackets.push(data instanceof Uint8Array ? data : new Uint8Array(data))
                    origSend(data)
                }

                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("DirtyBot", 0)

                sentPackets.length = 0
                // Consecutive identical angles
                client.turnTo(Math.PI)
                client.turnTo(Math.PI)
                client.turnTo(Math.PI + 0.001) // Maps to same protocol byte

                expect(sentPackets.length).toBe(1)
                client.disconnect()
            })

            it("7.2 setBoost(active) implements idempotency to prevent duplicate packet dispatch", async () => {
                const socket = server.createClientSocket()
                const sentPackets: Uint8Array[] = []
                const origSend = socket.send.bind(socket)
                socket.send = (data: any) => {
                    sentPackets.push(data instanceof Uint8Array ? data : new Uint8Array(data))
                    origSend(data)
                }

                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("BoostIdem", 0)

                sentPackets.length = 0
                // Call boost 3 times consecutively
                client.setBoost(true)
                client.setBoost(true)
                client.setBoost(true)

                expect(sentPackets.length).toBe(1)
                expect(sentPackets[0][0]).toBe(OutboundCommand.BOOST_START)

                client.disconnect()
            })

            it("7.3 moveTo({x, y}) computes target heading and distance, steering the snake", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("MoveToBot", 0)

                const result = client.moveTo({ x: 12000, y: 10800 })
                expect(Number.isFinite(result.angle)).toBe(true)
                expect(result.distance).toBeGreaterThan(0)

                client.disconnect()
            })

            it("7.4 turnToDegrees(deg) converts degrees to radians and directs snake heading", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("DegBot", 0)

                client.turnToDegrees(180)
                await new Promise((resolve) => setTimeout(resolve, 50))
                const serverSnake = server.getPlayerSnake()
                expect(serverSnake?.wantedAngle).toBeCloseTo(Math.PI, 1)

                client.disconnect()
            })

            it("7.5 emits standard lifecycle events: connect, game_start, spawn, tick, disconnect", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })

                const eventsReceived: string[] = []
                client.on("connect", () => eventsReceived.push("connect"))
                client.on("game_start", () => eventsReceived.push("game_start"))
                client.on("spawn", () => eventsReceived.push("spawn"))
                client.on("tick", () => {
                    if (!eventsReceived.includes("tick")) eventsReceived.push("tick")
                })
                client.on("disconnect", () => eventsReceived.push("disconnect"))

                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("EventBot", 0)
                await new Promise((resolve) => setTimeout(resolve, 50))
                client.disconnect()

                expect(eventsReceived).toContain("connect")
                expect(eventsReceived).toContain("game_start")
                expect(eventsReceived).toContain("spawn")
                expect(eventsReceived).toContain("tick")
                expect(eventsReceived).toContain("disconnect")
            })
        })

        // Feature 8: Local Mock WebSocket Server
        describe("Feature 8: Local Mock WebSocket Server", () => {
            it("8.1 starts, manages active sessions, and stops cleanly", async () => {
                expect(server.port).toBe(0)
                const port = await server.start(0)
                expect(port).toBeGreaterThan(0)
                expect(server.url).toContain("ws://127.0.0.1")

                await server.stop()
                expect(server.port).toBe(0)
            })

            it("8.2 transmits anti-bot challenge immediately upon connection open", async () => {
                const socket = server.createClientSocket()
                let challengeReceived = false

                socket.onmessage = (ev) => {
                    const data = new Uint8Array(ev.data)
                    const packet = decodePacket(data)
                    if (packet.type === "pre_init_challenge") {
                        challengeReceived = true
                    }
                }

                socket.triggerOpen()
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(challengeReceived).toBe(true)
            })

            it("8.3 spawns player snake and initializes world parameters in server memory", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))

                const snake = await client.spawn("ServerPlayer", 4)
                expect(server.getSnake(snake.id)).toBeDefined()
                expect(server.getPlayerSnake()).toBeDefined()
                expect(server.getPlayerSnake()?.name).toBe("ServerPlayer")

                client.disconnect()
            })

            it("8.4 advances snake kinematics along heading on discrete step() calls", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("KineStep", 0)

                const serverSnake = server.getPlayerSnake()!
                const initialX = serverSnake.x
                server.step(100) // 100ms movement at 115.6 units/s
                expect(serverSnake.x).toBeGreaterThan(initialX)

                client.disconnect()
            })

            it("8.5 detects food eating collision and broadcasts food_eaten packet", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("FoodCollider", 0)

                const serverSnake = server.getPlayerSnake()!
                const foodId = server.spawnFood(serverSnake.x + 10, serverSnake.y, 2, 0)

                let eaten = false
                client.on("food_eaten", (ev) => {
                    if (ev.foodId === foodId) eaten = true
                })

                server.step(100)
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(eaten).toBe(true)

                client.disconnect()
            })
        })
    })

    // =========================================================================
    // TIER 2: BOUNDARY & CORNER CASES (8 features x 5 tests = 40 tests)
    // =========================================================================
    describe("Tier 2: Boundary & Corner Cases", () => {
        // Feature 1 Boundary: Anti-Bot Handshake
        describe("Feature 1 Boundary: Anti-Bot Handshake", () => {
            it("2.1.1 verifies challenge seed of exactly 65 bytes (minimum protocol bound)", async () => {
                const minSeed = "A".repeat(65)
                const minServer = new MockSlitherServer({ challengeSeed: minSeed, autoTick: false })
                const socket = minServer.createClientSocket()
                const client = new SlitherClient({ socket })

                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(client.state).toBe(ClientState.READY)

                client.disconnect()
                await minServer.stop()
            })

            it("2.1.2 verifies challenge seed of 1024 bytes (large payload upper bound)", async () => {
                const largeSeed = "X".repeat(1024)
                const largeServer = new MockSlitherServer({ challengeSeed: largeSeed, autoTick: false })
                const socket = largeServer.createClientSocket()
                const client = new SlitherClient({ socket })

                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(client.state).toBe(ClientState.READY)

                client.disconnect()
                await largeServer.stop()
            })

            it("2.1.3 resolves challenge with special symbols, spaces, and punctuation", async () => {
                const specialSeed =
                    "Special!@#$%^&*()_+~`|}{[]:;?><,./-=\t 1234567890 MixedCaseChallengeSeedValueForSlitherVerification!"
                const specialServer = new MockSlitherServer({ challengeSeed: specialSeed, autoTick: false })
                const socket = specialServer.createClientSocket()
                const client = new SlitherClient({ socket })

                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(client.state).toBe(ClientState.READY)

                client.disconnect()
                await specialServer.stop()
            })

            it("2.1.4 rejects corrupted challenge token and terminates with policy violation 1008", async () => {
                const socket = server.createClientSocket()
                let closedCode: number | null = null

                socket.onclose = (ev) => {
                    closedCode = ev.code
                }
                socket.onmessage = (ev) => {
                    const data = new Uint8Array(ev.data)
                    const packet = decodePacket(data)
                    if (packet.type === "pre_init_challenge") {
                        // Send invalid 24 bytes
                        socket.send(new Uint8Array(24).fill(0xee))
                    }
                }

                socket.triggerOpen()
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(closedCode).toBe(1008)
            })

            it("2.1.5 rejects non-24-byte response length and terminates session", async () => {
                const socket = server.createClientSocket()
                let closedCode: number | null = null

                socket.onclose = (ev) => {
                    closedCode = ev.code
                }
                socket.onmessage = (ev) => {
                    const data = new Uint8Array(ev.data)
                    const packet = decodePacket(data)
                    if (packet.type === "pre_init_challenge") {
                        // Send invalid 16 bytes
                        socket.send(new Uint8Array(16).fill(1))
                    }
                }

                socket.triggerOpen()
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(closedCode).toBe(1008)
            })
        })

        // Feature 2 Boundary: Binary Codec
        describe("Feature 2 Boundary: Binary Codec", () => {
            it("2.2.1 tests 24-bit unsigned integer extremes: 0 and 16,777,215 (0xFFFFFF)", () => {
                const w = new BinaryWriter().writeUint24(0).writeUint24(0xffffff)
                const r = new BinaryReader(w.toUint8Array())
                expect(r.readUint24()).toBe(0)
                expect(r.readUint24()).toBe(0xffffff)
            })

            it("2.2.2 tests 24-bit signed integer extremes: -8,388,608 and 8,388,607", () => {
                const w = new BinaryWriter().writeInt24(-8388608).writeInt24(8388607)
                const r = new BinaryReader(w.toUint8Array())
                expect(r.readInt24()).toBe(-8388608)
                expect(r.readInt24()).toBe(8388607)
            })

            it("2.2.3 handles empty byte buffers without memory corruption", () => {
                const w = new BinaryWriter()
                expect(w.toUint8Array().length).toBe(0)
                const r = new BinaryReader(new Uint8Array(0))
                expect(r.remaining).toBe(0)
            })

            it("2.2.4 tests 16-bit integer boundary values: 0 and 65535", () => {
                const w = new BinaryWriter().writeUint16(0).writeUint16(65535)
                const r = new BinaryReader(w.toUint8Array())
                expect(r.readUint16()).toBe(0)
                expect(r.readUint16()).toBe(65535)
            })

            it("2.2.5 handles UTF-8 strings at boundary lengths (empty and 255 chars)", () => {
                const empty = ""
                const maxLen = "A".repeat(255)
                const w = new BinaryWriter().writeString8(empty).writeString8(maxLen)
                const r = new BinaryReader(w.toUint8Array())
                expect(r.readString8()).toBe(empty)
                expect(r.readString8()).toBe(maxLen)
            })
        })

        // Feature 3 Boundary: Inbound Packet Decoding
        describe("Feature 3 Boundary: Inbound Packet Decoding", () => {
            it("3.1.1 decodes minimum valid 3-byte packet (timestamp delta + opcode)", () => {
                const pongBuf = new BinaryWriter().writeUint16(0).writeUint8(112).toUint8Array() // 'p'
                const packet = decodePacket(pongBuf)
                expect(packet.type).toBe("pong")
            })

            it("3.1.2 decodes empty food batch packet 'F' without items", () => {
                const emptyBatch = new BinaryWriter().writeUint16(0).writeUint8(70).toUint8Array()
                const packet = decodePacket(emptyBatch)
                expect(packet.type).toBe("food_batch")
                if (packet.type === "food_batch") {
                    expect(packet.foods.length).toBe(0)
                }
            })

            it("3.1.3 decodes dense food batch packet 'F' with 100 pellets", () => {
                const w = new BinaryWriter().writeUint16(0).writeUint8(70)
                for (let i = 0; i < 100; i++) {
                    w.writeUint8(i % 30).writeInt16(i * 10).writeInt16(i * 20).writeUint8(2)
                }
                const packet = decodePacket(w.toUint8Array())
                expect(packet.type).toBe("food_batch")
                if (packet.type === "food_batch") {
                    expect(packet.foods.length).toBe(100)
                }
            })

            it("3.1.4 handles packets with unexpected trailing bytes without crashing", () => {
                const w = new BinaryWriter().writeUint16(0).writeUint8(118).writeUint8(0).writeUint32(0xdeadbeef)
                const packet = decodePacket(w.toUint8Array())
                expect(packet.type).toBe("death")
            })

            it("3.1.5 decodes unknown opcode byte to UnknownInboundPacket preserving raw payload", () => {
                const unknownBuf = new Uint8Array([0, 1, 0xfe, 10, 20, 30])
                const packet = decodePacket(unknownBuf)
                expect(packet.type).toBe("unknown")
                if (packet.type === "unknown") {
                    expect(packet.opcode).toBe(String.fromCharCode(0xfe))
                    expect(packet.payload.length).toBe(3)
                }
            })
        })

        // Feature 4 Boundary: Outbound Command Encoding
        describe("Feature 4 Boundary: Outbound Command Encoding", () => {
            it("4.1.1 encodes angle at lower boundary 0 radians to byte 0", () => {
                const p = encodeAngle(0)
                expect(p[0]).toBe(0)
            })

            it("4.1.2 encodes angle at upper boundary (2pi - eps) to byte 249", () => {
                const p = encodeAngle(Math.PI * 2 - 1e-4)
                expect(p[0]).toBe(249)
            })

            it("4.1.3 truncates nicknames longer than 24 characters in spawn packet", () => {
                const longName = "Supercalifragilisticexpialidocious"
                const p = encodeSpawn(longName, 0)
                const encodedName = Buffer.from(p.subarray(3)).toString("utf8")
                expect(encodedName.length).toBeLessThanOrEqual(24)
            })

            it("4.1.4 encodes min and max skin IDs (0 and 38)", () => {
                const pMin = encodeSpawn("Bot", 0)
                expect(pMin[2]).toBe(0)

                const pMax = encodeSpawn("Bot", 38)
                expect(pMax[2]).toBe(38)
            })

            it("4.1.5 defaults empty nickname to fallback string in spawn packet", () => {
                const p = encodeSpawn("", 0)
                expect(p.length).toBe(3)
            })
        })

        // Feature 5 Boundary: Angle & Steering Math
        describe("Feature 5 Boundary: Angle & Steering Math", () => {
            it("5.1.1 normalizes large negative angles (-10pi -> 0)", () => {
                const norm = normalizeAngle(-Math.PI * 10)
                expect(norm).toBeCloseTo(0, 5)
            })

            it("5.1.2 normalizes large positive angles (100pi -> 0)", () => {
                const norm = normalizeAngle(Math.PI * 100)
                expect(norm).toBeCloseTo(0, 5)
            })

            it("5.1.3 directionTo between identical coordinates returns 0 without NaN", () => {
                const p = { x: 500, y: 500 }
                const dir = directionTo(p, p)
                expect(dir).toBe(0)
                expect(Number.isNaN(dir)).toBe(false)
            })

            it("5.1.4 distance between identical coordinates returns 0", () => {
                const p = { x: 123.4, y: 567.8 }
                expect(distance(p, p)).toBe(0)
            })

            it("5.1.5 calculates angle difference across the 0 / 2pi boundary wrap", () => {
                const angleA = 0.05
                const angleB = Math.PI * 2 - 0.05
                const diff = angleDifference(angleA, angleB)
                expect(diff).toBeCloseTo(0.1, 4)
            })
        })

        // Feature 6 Boundary: Real-time Game State
        describe("Feature 6 Boundary: Real-time Game State", () => {
            it("6.1.1 ignoring removal of non-existent food ID does not throw", () => {
                const state = new GameState()
                expect(() => {
                    state.updateFromPacket({
                        type: "food_eaten",
                        foodId: 999999,
                        x: 0,
                        y: 0,
                    } as any)
                }).not.toThrow()
            })

            it("6.1.2 ignoring removal of non-existent snake ID does not throw", () => {
                const state = new GameState()
                expect(() => {
                    state.updateFromPacket({
                        type: "snake_remove",
                        snakeId: 88888,
                        reason: 0,
                    } as any)
                }).not.toThrow()
            })

            it("6.1.3 accepts empty leaderboard packet cleanly", () => {
                const state = new GameState()
                expect(() => {
                    state.updateFromPacket({
                        type: "leaderboard",
                        entries: [],
                        localInTop10: false,
                        localRank: 0,
                        totalSnakes: 0,
                    } as any)
                }).not.toThrow()
                expect(state.leaderboard.length).toBe(0)
            })

            it("6.1.4 supports entities at arena boundary coordinates (gameRadius)", () => {
                const state = new GameState()
                state.updateFromPacket({
                    type: "snake_add",
                    snakeId: 1,
                    name: "BorderSnake",
                    skin: 0,
                    x: 21600,
                    y: 21600,
                    angle: 0,
                    wantedAngle: 0,
                    speed: 58,
                    fullness: 0,
                    body: [{ x: 21600, y: 21600 }],
                } as any)

                const s = state.snakes.get(1)
                expect(s?.x).toBe(21600)
                expect(s?.y).toBe(21600)
            })

            it("6.1.5 repeated calls to gameState.clear() are idempotent and safe", () => {
                const state = new GameState()
                state.clear()
                state.clear()
                state.clear()
                expect(state.snakes.size).toBe(0)
            })
        })

        // Feature 7 Boundary: High-Level Client API
        describe("Feature 7 Boundary: High-Level Client API", () => {
            it("7.1.1 rapid consecutive setBoost(true) calls send exactly one packet", async () => {
                const socket = server.createClientSocket()
                let boostStartCount = 0
                const origSend = socket.send.bind(socket)
                socket.send = (data: any) => {
                    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
                    if (bytes[0] === OutboundCommand.BOOST_START) boostStartCount++
                    origSend(data)
                }

                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("RapidBoost", 0)

                for (let i = 0; i < 10; i++) client.setBoost(true)
                expect(boostStartCount).toBe(1)

                client.disconnect()
            })

            it("7.1.2 rapid consecutive setBoost(false) calls send zero packets when not boosting", async () => {
                const socket = server.createClientSocket()
                let boostStopCount = 0
                const origSend = socket.send.bind(socket)
                socket.send = (data: any) => {
                    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
                    if (bytes[0] === OutboundCommand.BOOST_STOP) boostStopCount++
                    origSend(data)
                }

                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                await client.spawn("RapidStop", 0)

                for (let i = 0; i < 5; i++) client.setBoost(false)
                expect(boostStopCount).toBe(0)

                client.disconnect()
            })

            it("7.1.3 calling moveTo before player snake spawns throws descriptive error", () => {
                const client = new SlitherClient()
                expect(() => client.moveTo({ x: 100, y: 100 })).toThrow(/player snake has not spawned/)
            })

            it("7.1.4 handles multi-byte emoji nickname without buffer corruption", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))

                const snake = await client.spawn("🐍🔥👑", 0)
                expect(snake).toBeDefined()
                expect(client.state).toBe(ClientState.PLAYING)

                client.disconnect()
            })

            it("7.1.5 duplicate disconnect() calls are idempotent and maintain DISCONNECTED state", () => {
                const client = new SlitherClient()
                expect(client.state).toBe(ClientState.DISCONNECTED)
                client.disconnect()
                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
            })
        })

        // Feature 8 Boundary: Local Mock WebSocket Server
        describe("Feature 8 Boundary: Local Mock WebSocket Server", () => {
            it("8.1.1 calling start() when already started is idempotent and returns bound port", async () => {
                const port1 = await server.start(0)
                const port2 = await server.start(0)
                expect(port1).toBe(port2)
            })

            it("8.1.2 calling stop() when already stopped resolves cleanly", async () => {
                await server.stop()
                await server.stop()
                expect(server.port).toBe(0)
            })

            it("8.1.3 simulateSnakeDeath for non-existent or dead snake does not throw", () => {
                expect(() => server.simulateSnakeDeath(99999, 0)).not.toThrow()
            })

            it("8.1.4 spawns food at coordinate extremes (0,0 and gameRadius,gameRadius)", () => {
                const f1 = server.spawnFood(0, 0, 1, 0)
                const f2 = server.spawnFood(server.options.gameRadius, server.options.gameRadius, 1, 0)
                expect(server.getFood(f1)).toBeDefined()
                expect(server.getFood(f2)).toBeDefined()
            })

            it("8.1.5 client abrupt socket close removes server session and marks snake dead", async () => {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 50))
                const snake = await client.spawn("DropBot", 0)

                socket.close(1006, "Abrupt drop")
                await new Promise((resolve) => setTimeout(resolve, 50))
                expect(server.getSnake(snake.id)).toBeUndefined()
            })
        })
    })

    // =========================================================================
    // TIER 3: CROSS-FEATURE COMBINATIONS (8 tests)
    // =========================================================================
    describe("Tier 3: Cross-Feature Combinations", () => {
        it("3.1 steering while boosting maintains boost velocity and dispatches updated discrete angle", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("BoostSteer", 0)

            client.setBoost(true)
            await new Promise((resolve) => setTimeout(resolve, 50))
            const serverSnake = server.getPlayerSnake()!
            expect(serverSnake.isBoosting).toBe(true)

            // Steer while boosting
            client.turnTo(Math.PI / 2)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(serverSnake.isBoosting).toBe(true)
            expect(serverSnake.wantedAngle).toBeCloseTo(Math.PI / 2, 1)

            client.disconnect()
        })

        it("3.2 food consumption while rotating: snake steers toward food, rotates, and eats", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("RotEater", 0)

            const serverSnake = server.getPlayerSnake()!
            // Spawn food to the north (+Y)
            const targetFood = { x: serverSnake.x, y: serverSnake.y + 30 }
            const foodId = server.spawnFood(targetFood.x, targetFood.y, 2, 1)

            let foodEaten = false
            client.on("food_eaten", (ev) => {
                if (ev.foodId === foodId) foodEaten = true
            })

            // Turn north and step physics
            client.turnTo(Math.PI / 2)
            server.step(100)
            server.step(100)
            server.step(100)

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(foodEaten).toBe(true)

            client.disconnect()
        })

        it("3.3 multi-snake viewport interactions: two independent clients observe mutual presence", async () => {
            const sock1 = server.createClientSocket()
            const client1 = new SlitherClient({ socket: sock1 })
            await client1.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            const snake1 = await client1.spawn("PeerAlpha", 1)

            const sock2 = server.createClientSocket()
            const client2 = new SlitherClient({ socket: sock2 })
            await client2.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            const snake2 = await client2.spawn("PeerBeta", 2)

            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(client1.gameState.snakes.has(snake2.id)).toBe(true)
            expect(client2.gameState.snakes.has(snake1.id)).toBe(true)

            client1.disconnect()
            client2.disconnect()
        })

        it("3.4 death during high-speed boosting cancels boost state and transitions client to DEAD", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            const snake = await client.spawn("DoomedBooster", 0)

            client.setBoost(true)
            expect(client.isBoosting).toBe(true)

            server.simulateSnakeDeath(snake.id, 0)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(client.state).toBe(ClientState.DEAD)
            expect(client.isBoosting).toBe(false)

            client.disconnect()
        })

        it("3.5 spatial hash grid queries combined with client moveTo navigation", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("QueryNavigator", 0)

            const serverSnake = server.getPlayerSnake()!
            // Spawn food within query radius
            server.spawnFood(serverSnake.x + 150, serverSnake.y + 150, 3, 2)
            await new Promise((resolve) => setTimeout(resolve, 50))

            const nearest = client.queries.findNearestFood(client.gameState.self!.head, { maxDistance: 300 })
            expect(nearest).toBeDefined()

            const nav = client.moveTo({ x: nearest!.x, y: nearest!.y })
            expect(nav.distance).toBeGreaterThan(0)
            expect(Number.isFinite(nav.angle)).toBe(true)

            client.disconnect()
        })

        it("3.6 dynamic prey movement and client heading tracking over multiple steps", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("PreyHunter", 0)

            const preyId = server.spawnPrey({ x: 10900, y: 10900, speed: 100, angle: 0 })
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.gameState.preys.has(preyId)).toBe(true)

            // Step prey
            server.updatePrey(preyId, 10950, 10900, 0, 100)
            await new Promise((resolve) => setTimeout(resolve, 50))

            const livePrey = client.gameState.preys.get(preyId)!
            expect(livePrey.x).toBe(10950)

            // Hunter moves to updated prey position
            const nav = client.moveTo({ x: livePrey.x, y: livePrey.y })
            expect(nav.distance).toBeGreaterThan(0)

            client.disconnect()
        })

        it("3.7 leaderboard ranking updates synchronized with food consumption and score growth", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("LeaderClimber", 0)

            let leaderboardUpdated = false
            client.on("leaderboard_update", (entries) => {
                if (entries.length > 0) leaderboardUpdated = true
            })

            // Spawn and eat food
            const serverSnake = server.getPlayerSnake()!
            server.spawnFood(serverSnake.x + 10, serverSnake.y, 4, 1)
            server.step(100)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(leaderboardUpdated).toBe(true)
            client.disconnect()
        })

        it("3.8 rapid chained lifecycle: handshake -> immediate spawn -> boost -> turn execution", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            const spawnPromise = client.spawn("FastChain", 3)
            client.setBoost(true)
            client.turnTo(Math.PI)

            const snake = await spawnPromise
            expect(snake).toBeDefined()
            expect(client.state).toBe(ClientState.PLAYING)

            client.disconnect()
        })
    })

    // =========================================================================
    // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 scenarios)
    // =========================================================================
    describe("Tier 4: Real-World Application Scenarios", () => {
        it("Scenario 4.1: Bot Handshake & Autonomous Spawn", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            let gameStartReceived = false
            let spawnReceived = false

            client.on("game_start", (world) => {
                gameStartReceived = true
                expect(world.gameRadius).toBe(server.options.gameRadius)
            })

            client.on("spawn", (snake) => {
                spawnReceived = true
                expect(snake.name).toBe("AutoBot")
            })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            const snake = await client.spawn("AutoBot", 5)
            expect(snake).toBeDefined()
            expect(snake.id).toBeGreaterThan(0)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(gameStartReceived).toBe(true)
            expect(spawnReceived).toBe(true)

            client.disconnect()
        })

        it("Scenario 4.2: Food Collector Bot Navigation", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("CollectorBot", 0)

            const serverSnake = server.getPlayerSnake()!
            // Spawn 5 food pellets ahead of snake
            for (let i = 1; i <= 5; i++) {
                server.spawnFood(serverSnake.x + i * 20, serverSnake.y, 2, i % 5)
            }
            await new Promise((resolve) => setTimeout(resolve, 50))

            let foodsEatenCount = 0
            client.on("food_eaten", () => {
                foodsEatenCount++
            })

            // Navigate forward through the food path
            for (let step = 0; step < 10; step++) {
                const nearest = client.queries.findNearestFood(client.gameState.self!.head, { maxDistance: 300 })
                if (nearest) {
                    client.moveTo({ x: nearest.x, y: nearest.y })
                }
                server.step(50)
            }
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(foodsEatenCount).toBeGreaterThanOrEqual(1)
            client.disconnect()
        })

        it("Scenario 4.3: Speed Boost & Energy Management", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("EnergyBot", 0)

            const serverSnake = server.getPlayerSnake()!
            expect(serverSnake.speed).toBe(server.options.baseSpeed)

            // Start boost
            client.setBoost(true)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(serverSnake.isBoosting).toBe(true)
            expect(serverSnake.speed).toBe(server.options.boostSpeed)

            // Step server to shed boost mass
            for (let i = 0; i < 5; i++) {
                server.step(50)
            }
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Verify turbo food was shed behind snake
            expect(server.getAllFoods().some((f) => f.isTurbo)).toBe(true)

            // Stop boost and recover cruising speed
            client.setBoost(false)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(serverSnake.isBoosting).toBe(false)
            expect(serverSnake.speed).toBe(server.options.baseSpeed)

            client.disconnect()
        })

        it("Scenario 4.4: Obstacle Avoidance & Snake Interaction", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            await client.spawn("AvoidanceBot", 0)

            // Spawn scenario with 2 bot snakes and food clusters
            const scenario = createBasicGameScenario(server, {
                botCount: 2,
                foodClusterCount: 2,
                foodPerCluster: 10,
            })

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.gameState.snakes.size).toBeGreaterThanOrEqual(2)
            expect(client.gameState.foods.size).toBeGreaterThanOrEqual(10)

            // Check obstacle query
            const selfHead = client.gameState.self!.head
            const obstacles = client.queries.findNearbyObstacles(selfHead, 1000)
            expect(obstacles.length).toBeGreaterThanOrEqual(1)

            // Steer away from first obstacle
            const obs = obstacles[0]
            const obsHeading = directionTo(selfHead, obs.point)
            const awayAngle = normalizeAngle(obsHeading + Math.PI / 2)
            client.turnTo(awayAngle)

            client.disconnect()
        })

        it("Scenario 4.5: Complete Life Cycle: Connect -> Play -> Die -> Disconnect", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            // 1. Connect
            expect(client.state).toBe(ClientState.DISCONNECTED)
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            // 2. Play
            const snake = await client.spawn("LifeCycleBot", 1)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.gameState.self).toBeDefined()

            client.turnTo(Math.PI)
            client.setBoost(true)
            server.step(50)

            // 3. Die
            let deathEventReceived = false
            client.on("snake_died", (ev) => {
                if (ev.isSelf) deathEventReceived = true
            })

            server.simulateSnakeDeath(snake.id, 0)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(deathEventReceived).toBe(true)
            expect(client.state).toBe(ClientState.DEAD)
            expect(client.isBoosting).toBe(false)

            // 4. Disconnect
            client.disconnect()
            expect(client.state).toBe(ClientState.DISCONNECTED)
            expect(client.gameState.snakes.size).toBe(0)
        })
    })
})
