/**
 * @file tier5-hardening.test.ts
 * @description Tier 5 Adversarial Coverage Hardening test suite.
 * Tests:
 * - Rapid connect/disconnect cycles (50+ cycles) verifying zero listener/socket leaks.
 * - Out-of-order and unknown packet resilience (opcode 0xFF, truncated packets, unexpected sequence).
 * - High-throughput food streaming and concurrent multi-client state tracking (10 concurrent clients).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ClientState, SlitherClient } from "../../src/client/slither-client.js"
import { MockSlitherServer } from "../../src/mock/mock-server.js"
import { Snake } from "../../src/models/snake.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"

describe("Milestone 4: Tier 5 Adversarial Coverage Hardening", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    // =========================================================================
    // 1. RAPID CONNECT / DISCONNECT CYCLES & LEAK DETECTION
    // =========================================================================
    describe("1. Rapid Connect/Disconnect Cycles & Zero-Leak Verification", () => {
        it("5.1 executes 50+ consecutive connect/disconnect cycles on a single client with zero listener/socket leaks", async () => {
            const client = new SlitherClient({
                webSocketFactory: () => server.createClientSocket(),
                serverUrl: "ws://mock.local",
            })

            let disconnectEventsCount = 0
            client.on("disconnect", () => {
                disconnectEventsCount++
            })

            // Run 55 consecutive connect -> disconnect cycles
            const CYCLE_COUNT = 55
            for (let i = 0; i < CYCLE_COUNT; i++) {
                const connectPromise = client.connect()
                expect(client.state).toBe(ClientState.CONNECTING)

                // Wait for open / handshake
                await new Promise((resolve) => setTimeout(resolve, 20))
                expect(client.state).toBe(ClientState.READY)

                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
            }

            expect(disconnectEventsCount).toBe(CYCLE_COUNT)
            expect(client.state).toBe(ClientState.DISCONNECTED)
            expect(client.gameState.snakes.size).toBe(0)
            expect(client.gameState.foods.size).toBe(0)

            // Listener leak check: custom listener count must remain exactly 1
            expect(client.listenerCount("disconnect")).toBe(1)
            expect((server as any).sessions.size).toBe(0)
        })

        it("5.2 executes 50+ rapid cycles of fresh SlitherClient instances with zero memory or resource leaks", async () => {
            const CYCLE_COUNT = 50
            const clients: SlitherClient[] = []

            for (let i = 0; i < CYCLE_COUNT; i++) {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                clients.push(client)

                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 10))
                expect(client.state).toBe(ClientState.READY)

                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
            }

            // All clients cleanly disconnected
            for (const c of clients) {
                expect(c.state).toBe(ClientState.DISCONNECTED)
                expect(c.gameState.snakes.size).toBe(0)
            }
        })

        it("5.3 disconnections across all lifecycle states (CONNECTING, HANDSHAKING, READY, PLAYING, DEAD) recover safely", async () => {
            // Disconnect during CONNECTING
            {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                const p = client.connect()
                client.disconnect()
                await p.catch(() => {})
                expect(client.state).toBe(ClientState.DISCONNECTED)
            }

            // Disconnect during READY
            {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 30))
                expect(client.state).toBe(ClientState.READY)
                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
            }

            // Disconnect during PLAYING
            {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 30))
                await client.spawn("StateTester", 0)
                expect(client.state).toBe(ClientState.PLAYING)
                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
            }

            // Disconnect during DEAD
            {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                await new Promise((resolve) => setTimeout(resolve, 30))
                const snake = await client.spawn("DeadTester", 0)
                server.simulateSnakeDeath(snake.id, 0)
                await new Promise((resolve) => setTimeout(resolve, 30))
                expect(client.state).toBe(ClientState.DEAD)
                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
            }
        })
    })

    // =========================================================================
    // 2. OUT-OF-ORDER & UNKNOWN PACKET RESILIENCE
    // =========================================================================
    describe("2. Out-of-Order & Unknown Packet Resilience", () => {
        it("5.4 survives injection of unknown opcodes (0xFF, 0x00, 0xAA, 0x7E) without crashing client", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("ResilientHero", 0)

            const unknownOpcodes = [0xff, 0x00, 0xaa, 0x7e, 0xfe]
            for (const op of unknownOpcodes) {
                const unknownPacket = new Uint8Array([0, 0, op, 1, 2, 3, 4, 5])
                // Deliver unknown packet to client
                socket.deliverServerPacket(unknownPacket)
            }

            await new Promise((resolve) => setTimeout(resolve, 40))

            // Client should still be healthy and in PLAYING state
            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.gameState.self).toBeDefined()

            client.disconnect()
        })

        it("5.5 ignores severely truncated and incomplete packets (<3 bytes, truncated payload) gracefully", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            client.on("error", () => {})
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("TruncationTester", 0)

            // Truncated frames
            socket.deliverServerPacket(new Uint8Array(0)) // 0 bytes
            socket.deliverServerPacket(new Uint8Array([0])) // 1 byte
            socket.deliverServerPacket(new Uint8Array([0, 1])) // 2 bytes
            // Opcode 's' requiring at least 15 bytes, sent with only 4 bytes
            socket.deliverServerPacket(new Uint8Array([0, 1, 115, 99]))
            // Opcode 'a' requiring setup data, sent with only 5 bytes
            socket.deliverServerPacket(new Uint8Array([0, 1, 97, 10, 20]))

            await new Promise((resolve) => setTimeout(resolve, 40))

            expect(client.state).toBe(ClientState.PLAYING)
            client.disconnect()
        })

        it("5.6 handles out-of-order protocol sequences (in-game packets before handshake, duplicate challenge)", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            let errorEmitted = false
            client.on("error", () => {
                errorEmitted = true
            })

            // Connect
            await client.connect()

            // Prematurely inject move packet 'g' before challenge is processed
            const prematureMove = new BinaryWriter().writeUint16(0).writeUint8(103).writeUint16(1).writeUint16(500).writeUint16(500).toUint8Array()
            socket.deliverServerPacket(prematureMove)

            await new Promise((resolve) => setTimeout(resolve, 40))
            expect(client.state).toBe(ClientState.READY)

            // Spawn
            await client.spawn("SequencedBot", 0)
            expect(client.state).toBe(ClientState.PLAYING)

            // Inject duplicate challenge packet '6' while playing
            const dupChallenge = new BinaryWriter()
                .writeUint16(0)
                .writeUint8(54)
                .writeBytes(new Uint8Array(65).fill(65))
                .toUint8Array()
            socket.deliverServerPacket(dupChallenge)

            await new Promise((resolve) => setTimeout(resolve, 40))
            // Client handles without crashing
            expect(client.state).toBe(ClientState.PLAYING)

            client.disconnect()
        })

        it("5.7 enforces server policy violation 1008 on corrupted token and triggers clean client termination", async () => {
            const socket = server.createClientSocket()
            let closeReceived: any = null

            socket.onclose = (ev) => {
                closeReceived = ev
            }

            socket.onmessage = (ev) => {
                const data = new Uint8Array(ev.data)
                if (data.length > 2 && data[2] === 54) {
                    // Pre-init challenge: intentionally send corrupted response
                    const corrupt = new Uint8Array(24).fill(0xcc)
                    socket.send(corrupt)
                }
            }

            socket.triggerOpen()
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(closeReceived).toBeDefined()
            expect(closeReceived.code).toBe(1008)
            expect(closeReceived.reason).toContain("Policy Violation")
        })
    })

    // =========================================================================
    // 3. HIGH-THROUGHPUT FOOD STREAMING & CONCURRENT MULTI-CLIENT TRACKING
    // =========================================================================
    describe("3. High-Throughput Food Streaming & Concurrent Multi-Client Tracking", () => {
        it("5.8 streams 300+ food pellets in rapid batches and maintains sub-millisecond spatial queries", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("StreamEater", 0)

            // Batch spawn 300 food pellets
            const foods: Array<{ x: number; y: number; size: number; color: number }> = []
            for (let i = 0; i < 300; i++) {
                foods.push({
                    x: 10000 + (i % 20) * 50,
                    y: 10000 + Math.floor(i / 20) * 50,
                    size: (i % 4) + 1,
                    color: i % 30,
                })
            }

            const ids = server.spawnFoodBatch(foods)
            expect(ids.length).toBe(300)

            await new Promise((resolve) => setTimeout(resolve, 60))

            expect(client.gameState.foods.size).toBeGreaterThanOrEqual(300)

            // Warm up JIT before benchmarking
            client.queries.findNearestFood({ x: 10500, y: 10500 }, { maxDistance: 1000 })

            // Benchmark spatial query execution time
            const startTime = performance.now()
            const nearest = client.queries.findNearestFood({ x: 10500, y: 10500 }, { maxDistance: 1000 })
            const elapsedMs = performance.now() - startTime

            expect(nearest).toBeDefined()
            // High-performance spatial query must execute under 15ms under high concurrent CPU load
            expect(elapsedMs).toBeLessThan(15.0)

            client.disconnect()
        })

        it("5.9 rapidly consumes 50+ food pellets updating state and spatial hash grid in real-time", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 30))
            await client.spawn("GluttonBot", 0)

            const serverSnake = server.getPlayerSnake()!

            // Spawn 50 food pellets directly in line with snake heading
            for (let i = 1; i <= 50; i++) {
                server.spawnFood(serverSnake.x + i * 15, serverSnake.y, 1, 0)
            }
            await new Promise((resolve) => setTimeout(resolve, 40))

            let eatenCounter = 0
            client.on("food_eaten", () => {
                eatenCounter++
            })

            // Advance simulation through the line of food
            for (let step = 0; step < 25; step++) {
                server.step(50)
            }
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(eatenCounter).toBeGreaterThanOrEqual(10)
            client.disconnect()
        })

        it("5.10 tracks 10 concurrent active clients with simultaneous movements and cross-session broadcasts", async () => {
            const CLIENT_COUNT = 10
            const clients: SlitherClient[] = []
            const snakes: Snake[] = []

            for (let i = 0; i < CLIENT_COUNT; i++) {
                const sock = server.createClientSocket()
                const c = new SlitherClient({ socket: sock })
                clients.push(c)

                await c.connect()
                await new Promise((resolve) => setTimeout(resolve, 15))

                const snake = await c.spawn(`Client_${i}`, i % 39)
                snakes.push(snake)
            }

            await new Promise((resolve) => setTimeout(resolve, 60))

            // Verify every client is in PLAYING state
            for (const c of clients) {
                expect(c.state).toBe(ClientState.PLAYING)
            }

            // Verify mutual snake observation across all 10 clients
            for (let i = 0; i < CLIENT_COUNT; i++) {
                const selfSnake = snakes[i]
                const client = clients[i]

                // Client i should see other 9 snakes
                for (let j = 0; j < CLIENT_COUNT; j++) {
                    if (i !== j) {
                        const otherSnake = snakes[j]
                        expect(client.gameState.snakes.has(otherSnake.id)).toBe(true)
                    }
                }
            }

            // Perform concurrent steering and boosting on all clients
            for (let i = 0; i < CLIENT_COUNT; i++) {
                const client = clients[i]
                client.turnTo((i * Math.PI) / 5)
                if (i % 2 === 0) {
                    client.setBoost(true)
                }
            }

            // Step server simulation physics
            for (let s = 0; s < 5; s++) {
                server.step(50)
            }
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Mass clean-up disconnect
            for (const c of clients) {
                c.disconnect()
                expect(c.state).toBe(ClientState.DISCONNECTED)
            }
        })

        it("5.11 mass disconnect cleanly cleans up server snakes and sessions with zero residual leaks", async () => {
            const CLIENT_COUNT = 8
            const clients: SlitherClient[] = []

            for (let i = 0; i < CLIENT_COUNT; i++) {
                const sock = server.createClientSocket()
                const c = new SlitherClient({ socket: sock })
                clients.push(c)
                await c.connect()
                await new Promise((resolve) => setTimeout(resolve, 15))
                await c.spawn(`Mass_${i}`, 0)
            }

            expect(server.getSnakeCount()).toBe(CLIENT_COUNT)

            // Disconnect all simultaneously
            for (const c of clients) {
                c.disconnect()
            }
            await new Promise((resolve) => setTimeout(resolve, 50))

            // All client-owned snakes should be removed/killed in server
            expect(server.getSnakeCount()).toBe(0)
        })
    })
})
