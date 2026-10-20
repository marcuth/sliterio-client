/**
 * @file m4-remediation-stress.test.ts
 * @description Adversarial stress tests for Milestone 4 Remediation:
 * 1. Duplicate challenge packet injection during PLAYING, READY, and DEAD states.
 * 2. Truncated and malformed packet injection without an error listener (zero unhandled ERR_UNHANDLED_ERROR).
 * 3. Heading quantization byte 249 boundary behavior and empty spawn minimal 3-byte payload.
 * 4. Obstacle avoidance with genuine geometric angle calculation (directionTo) in Scenario 4.4.
 *
 * Authored by Challenger (M4 Remediation Gate).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientState, SlitherClient } from "../../src/client/slither-client.js"
import {
    directionTo,
    distance,
    normalizeAngle,
    radiansToProtocolByte,
    TWO_PI,
} from "../../src/math/vector.js"
import { createBasicGameScenario } from "../../src/mock/mock-scenarios.js"
import { MockSlitherServer } from "../../src/mock/mock-server.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { encodeAngle, encodeSpawn } from "../../src/protocol/packet-encoder.js"
import { angleToByte, OutboundCommand } from "../../src/protocol/types.js"

describe("Milestone 4 Remediation: Empirical Challenger Stress Harness", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    // =========================================================================
    // 1. DUPLICATE CHALLENGE PACKET INJECTION STATE TESTS
    // =========================================================================
    describe("1. Duplicate Challenge Packet Injection State Guard", () => {
        it("preserves PLAYING state and does NOT downgrade to READY on duplicate challenge packet", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            expect(client.state).toBe(ClientState.READY)

            await client.spawn("ChallengerBot", 0)
            expect(client.state).toBe(ClientState.PLAYING)

            // Track outgoing packets from client
            const clientOutbox: Uint8Array[] = []
            const originalSend = socket.send.bind(socket)
            socket.send = (data: any) => {
                clientOutbox.push(data instanceof Uint8Array ? data : new Uint8Array(data))
                return originalSend(data)
            }

            // Construct synthetic Packet '6' (pre_init_challenge) with 65-byte seed
            const challengePayload = new Uint8Array(65).fill(0x42)
            const duplicateChallenge = new BinaryWriter()
                .writeUint16(1234)
                .writeUint8(54) // Opcode '6'
                .writeBytes(challengePayload)
                .toUint8Array()

            // Inject duplicate challenge packet into running client
            socket.deliverServerPacket(duplicateChallenge)
            await new Promise((resolve) => setTimeout(resolve, 40))

            // VERIFICATION 1: Client remains strictly in PLAYING state
            expect(client.state).toBe(ClientState.PLAYING)

            // VERIFICATION 2: Client does NOT send a challenge response back to server
            // Client outbox should not have sent any 24-byte response packet
            const sentChallengeResponses = clientOutbox.filter((p) => p.length === 24)
            expect(sentChallengeResponses.length).toBe(0)

            client.disconnect()
        })

        it("preserves READY state without re-sending challenge response if duplicate challenge arrives before spawn", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            expect(client.state).toBe(ClientState.READY)

            const clientOutbox: Uint8Array[] = []
            const originalSend = socket.send.bind(socket)
            socket.send = (data: any) => {
                clientOutbox.push(data instanceof Uint8Array ? data : new Uint8Array(data))
                return originalSend(data)
            }

            const duplicateChallenge = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(54)
                .writeBytes(new Uint8Array(65).fill(0x55))
                .toUint8Array()

            socket.deliverServerPacket(duplicateChallenge)
            await new Promise((resolve) => setTimeout(resolve, 40))

            expect(client.state).toBe(ClientState.READY)
            // No new response sent while in READY
            expect(clientOutbox.length).toBe(0)

            client.disconnect()
        })

        it("survives rapid high-frequency bursts of 20 duplicate challenge packets during active play", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("BurstResilient", 1)
            expect(client.state).toBe(ClientState.PLAYING)

            // Fire 20 consecutive challenge packets
            for (let i = 0; i < 20; i++) {
                const burstPacket = new BinaryWriter()
                    .writeUint16(i)
                    .writeUint8(54)
                    .writeBytes(new Uint8Array(65).fill(i + 1))
                    .toUint8Array()
                socket.deliverServerPacket(burstPacket)
            }

            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.gameState.self).toBeDefined()
            expect(client.gameState.self?.id).toBe(client.gameState.mySnakeId)

            client.disconnect()
        })
    })

    // =========================================================================
    // 2. TRUNCATED PACKET INJECTION WITHOUT ERROR LISTENER
    // =========================================================================
    describe("2. Truncated Packet Injection Without Error Listener", () => {
        it("handles truncated frames without throwing ERR_UNHANDLED_ERROR when no error listener is attached", async () => {
            const socket = server.createClientSocket()
            // CRITICAL: Instantiate client with NO error listener attached
            const client = new SlitherClient({ socket })

            expect(client.listenerCount("error")).toBe(0)

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("NoListenerHero", 0)

            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.listenerCount("error")).toBe(0)

            // Inject spectrum of severely truncated and corrupted frames
            const truncatedPayloads: Uint8Array[] = [
                new Uint8Array(0),                                // 0 bytes
                new Uint8Array([0x00]),                           // 1 byte
                new Uint8Array([0x00, 0x01]),                     // 2 bytes
                new Uint8Array([0x00, 0x01, 115]),                // 3 bytes ('s' opcode with 0 payload bytes)
                new Uint8Array([0x00, 0x01, 115, 0x42]),          // 4 bytes ('s' opcode requiring 15+ bytes)
                new Uint8Array([0x00, 0x01, 97, 10, 20]),         // 5 bytes ('a' opcode requiring 24+ bytes)
                new Uint8Array([0x00, 0x01, 103, 1]),             // 4 bytes ('g' movement requiring 6+ bytes)
                new Uint8Array([0x00, 0x01, 108, 1, 2]),          // 5 bytes ('l' leaderboard requiring header)
                new Uint8Array([0x00, 0x01, 0xff, 9, 9, 9]),      // 6 bytes unknown opcode
            ]

            for (const payload of truncatedPayloads) {
                socket.deliverServerPacket(payload)
            }

            await new Promise((resolve) => setTimeout(resolve, 60))

            // Process must NOT have crashed with ERR_UNHANDLED_ERROR
            // Client must remain in PLAYING state and capable of normal actions
            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.gameState.self).toBeDefined()

            // Verify client can still turn and steer after surviving truncated packets
            expect(() => client.turnTo(Math.PI / 2)).not.toThrow()
            expect(() => client.setBoost(true)).not.toThrow()
            expect(() => client.setBoost(false)).not.toThrow()

            client.disconnect()
        })

        it("logs warning to options.logger when provided and error listener is absent", async () => {
            const socket = server.createClientSocket()
            const logEntries: { level: string; msg: string }[] = []
            const client = new SlitherClient({
                socket,
                logger: (level, msg) => {
                    logEntries.push({ level, msg })
                },
            })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("LoggerBot", 0)

            // Inject 4-byte truncated 's' frame (opcode 115)
            socket.deliverServerPacket(new Uint8Array([0x00, 0x01, 115, 0x99]))
            await new Promise((resolve) => setTimeout(resolve, 40))

            // Verify logger received warning without process crashing
            expect(logEntries.some((e) => e.level === "warn" && e.msg.includes("Ingestion error"))).toBe(true)
            expect(client.state).toBe(ClientState.PLAYING)

            client.disconnect()
        })
    })

    // =========================================================================
    // 3. HEADING QUANTIZATION (BYTE 249) & EMPTY SPAWN (LENGTH 3)
    // =========================================================================
    describe("3. Protocol Quantization & Minimal Spawn Layout", () => {
        it("quantizes continuous angles at upper boundary (2pi - eps) to byte 249", () => {
            // Test 4.1.2 verification:
            const epsAngle = Math.PI * 2 - 1e-4
            const encoded = encodeAngle(epsAngle)
            expect(encoded.length).toBe(1)
            expect(encoded[0]).toBe(249)

            // Direct angleToByte function verification
            expect(angleToByte(epsAngle)).toBe(249)
            expect(radiansToProtocolByte(epsAngle)).toBe(249)

            // Verify boundary spectrum
            expect(angleToByte(0)).toBe(0)
            expect(angleToByte(TWO_PI)).toBe(0) // Modulo wrap
            expect(angleToByte(TWO_PI - 1e-12)).toBe(249) // Infinitesimally close to 2pi
            expect(angleToByte((249 / 250) * TWO_PI)).toBe(249) // Lower bound of bin 249
            expect(angleToByte((248.999 / 250) * TWO_PI)).toBe(248) // Upper bound of bin 248
        })

        it("encodes empty nickname to minimal 3-byte spawn packet [115, version, skin]", () => {
            // Test 4.1.5 verification:
            const spawnPacket = encodeSpawn("", 0)
            expect(spawnPacket.length).toBe(3)
            expect(spawnPacket[0]).toBe(OutboundCommand.SPAWN) // 115 ('s')
            expect(spawnPacket[1]).toBe(10) // Protocol version 11 - 1
            expect(spawnPacket[2]).toBe(0) // Skin ID 0

            // Custom skin ID with empty nickname
            const customSkin = encodeSpawn("", 25)
            expect(customSkin.length).toBe(3)
            expect(customSkin[2]).toBe(25)

            // Non-empty nickname increases length proportionally
            const namedPacket = encodeSpawn("Alice", 0)
            expect(namedPacket.length).toBe(3 + 5)
        })
    })

    // =========================================================================
    // 4. OBSTACLE AVOIDANCE GEOMETRIC CALCULATION (SCENARIO 4.4)
    // =========================================================================
    describe("4. Geometric Obstacle Avoidance (Scenario 4.4)", () => {
        it("computes exact mathematical angle via directionTo without NaN or fake headings", () => {
            const selfHead = { x: 1000, y: 1000 }

            // Quadrant 1 (East, dx > 0, dy = 0) -> angle 0
            expect(directionTo(selfHead, { x: 1100, y: 1000 })).toBeCloseTo(0, 5)

            // Quadrant 2 (South, dx = 0, dy > 0) -> angle pi / 2
            expect(directionTo(selfHead, { x: 1000, y: 1100 })).toBeCloseTo(Math.PI / 2, 5)

            // Quadrant 3 (West, dx < 0, dy = 0) -> angle pi
            expect(directionTo(selfHead, { x: 900, y: 1000 })).toBeCloseTo(Math.PI, 5)

            // Quadrant 4 (North, dx = 0, dy < 0) -> angle 3pi / 2
            expect(directionTo(selfHead, { x: 1000, y: 900 })).toBeCloseTo((3 * Math.PI) / 2, 5)

            // Perpendicular avoidance angle verification:
            // Obstacle to East (0) -> Evasive angle: normalizeAngle(0 + pi/2) = pi/2 (South)
            const obsEast = { point: { x: 1100, y: 1000 } }
            const headingEast = directionTo(selfHead, obsEast.point)
            const evasiveEast = normalizeAngle(headingEast + Math.PI / 2)
            expect(evasiveEast).toBeCloseTo(Math.PI / 2, 5)

            // Obstacle to North (3pi/2) -> Evasive angle: normalizeAngle(3pi/2 + pi/2) = 0 (East)
            const obsNorth = { point: { x: 1000, y: 900 } }
            const headingNorth = directionTo(selfHead, obsNorth.point)
            const evasiveNorth = normalizeAngle(headingNorth + Math.PI / 2)
            expect(evasiveNorth).toBeCloseTo(0, 5)
        })

        it("executes Scenario 4.4 end-to-end with real spatial queries and genuine evasive steering", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 40))
            await client.spawn("EmpiricalAvoider", 0)

            // Create scenario with 2 bot snakes and food clusters
            createBasicGameScenario(server, {
                botCount: 2,
                foodClusterCount: 2,
                foodPerCluster: 10,
            })

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.gameState.snakes.size).toBeGreaterThanOrEqual(2)

            const selfHead = client.gameState.self!.head
            const obstacles = client.queries.findNearbyObstacles(selfHead, 1000)
            expect(obstacles.length).toBeGreaterThanOrEqual(1)

            // Verify Obstacle contract: point exists, distance is finite
            const obs = obstacles[0]
            expect(obs.point).toBeDefined()
            expect(typeof obs.point.x).toBe("number")
            expect(typeof obs.point.y).toBe("number")
            expect((obs as any).heading).toBeUndefined() // Obstacle has no heading property!

            // Compute genuine geometric heading to obstacle
            const obsHeading = directionTo(selfHead, obs.point)
            expect(Number.isFinite(obsHeading)).toBe(true)
            expect(obsHeading).toBeGreaterThanOrEqual(0)
            expect(obsHeading).toBeLessThan(TWO_PI)

            // Compute perpendicular evasive angle
            const awayAngle = normalizeAngle(obsHeading + Math.PI / 2)
            expect(Number.isFinite(awayAngle)).toBe(true)

            // Capture steering packet
            let turnPacketSent: Uint8Array | null = null
            const originalSend = socket.send.bind(socket)
            socket.send = (data: any) => {
                const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
                if (bytes.length === 1 && bytes[0] <= 250) {
                    turnPacketSent = bytes
                }
                return originalSend(data)
            }

            // Command turnTo
            client.turnTo(awayAngle)

            // Expect outbound turn packet matches discrete angle of awayAngle
            const expectedByte = angleToByte(awayAngle)
            expect(turnPacketSent).toBeDefined()
            expect(turnPacketSent![0]).toBe(expectedByte)

            client.disconnect()
        })
    })
})
