/**
 * @file m2-remediation-stress.test.ts
 * @description Comprehensive empirical boundary, stress, and edge-case verification harness
 * for Milestone 2 Remediation. Authored by Challenger M2-3-2.
 */

import { describe, expect, it, vi } from "vitest"

import { ClientState, SlitherClient, WebSocketLike } from "../../src/client/slither-client.js"
import { SpatialHashGrid } from "../../src/math/spatial-grid.js"
import {
    degreesToRadians,
    normalizeAngle,
    radiansToProtocolByte,
    TWO_PI,
} from "../../src/math/vector.js"
import { Food } from "../../src/models/food.js"
import { Snake } from "../../src/models/snake.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { angleToByte } from "../../src/protocol/types.js"

class MockWebSocketHarness implements WebSocketLike {
    public readyState: number = 0 // 0 = CONNECTING, 1 = OPEN, 3 = CLOSED
    public binaryType?: string = "arraybuffer"
    public sentData: Uint8Array[] = []
    public closeCount: number = 0
    public onopen: ((event?: any) => void) | null = null
    public onclose: ((event?: any) => void) | null = null
    public onmessage: ((event: { data: any }) => void) | null = null
    public onerror: ((event: any) => void) | null = null

    public send(data: any): void {
        if (data instanceof Uint8Array) {
            this.sentData.push(data)
        } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
            this.sentData.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        }
    }

    public close(code: number = 1000, reason: string = "Normal Closure"): void {
        this.readyState = 3
        this.closeCount++
        if (this.onclose) {
            this.onclose({ code, reason, wasClean: true })
        }
    }

    public triggerOpen(): void {
        this.readyState = 1
        if (this.onopen) {
            this.onopen()
        }
    }

    public triggerMessage(buffer: Uint8Array): void {
        if (this.onmessage) {
            this.onmessage({ data: buffer })
        }
    }

    public triggerError(err: any): void {
        if (this.onerror) {
            this.onerror(err)
        }
    }
}

describe("Milestone 2 Remediation Empirical Stress & Boundary Suite (Challenger M2-3-2)", () => {
    describe("1. SpatialHashGrid Removal & queryNearest Boundary & Fallback Stress", () => {
        it("handles removal with wild coordinate mismatches and preserves index consistency", () => {
            const grid = new SpatialHashGrid<Food>(200)

            // Insert 500 items at known locations
            for (let i = 1; i <= 500; i++) {
                grid.insert(new Food(i, (i * 37) % 5000, (i * 41) % 5000, 2, 1))
            }
            expect(grid.size).toBe(500)

            // Remove items with intentionally incorrect coordinates (offset by +10,000, -10,000)
            for (let i = 1; i <= 250; i++) {
                const removed = grid.remove(i, 99999 + i, -88888 - i)
                expect(removed).toBe(true)
                expect(grid.has(i)).toBe(false)
                expect(grid.get(i)).toBeUndefined()
            }

            expect(grid.size).toBe(250)

            // Verify remaining 250 items are still present and queryable
            for (let i = 251; i <= 500; i++) {
                expect(grid.has(i)).toBe(true)
                const food = grid.get(i)
                expect(food).toBeDefined()
                expect(food!.id).toBe(i)
            }

            // Remove non-existent items with mismatched coordinates: must return false without corrupting grid
            for (let i = 9000; i < 9100; i++) {
                expect(grid.remove(i, 500, 500)).toBe(false)
            }
            expect(grid.size).toBe(250)

            // Remove remaining items without passing coordinates at all
            for (let i = 251; i <= 500; i++) {
                const removed = grid.remove(i)
                expect(removed).toBe(true)
            }
            expect(grid.size).toBe(0)
        })

        it("cleans up empty cells when items are removed across grid coordinates", () => {
            const grid = new SpatialHashGrid<Food>(100)
            const item = new Food(42, 55, 55, 1, 0) // Cell "0:0"
            grid.insert(item)

            expect(grid.size).toBe(1)
            expect(grid.queryRadius(55, 55, 20).length).toBe(1)

            // Remove item
            const removed = grid.remove(42)
            expect(removed).toBe(true)
            expect(grid.size).toBe(0)

            // Radius query should immediately return 0 elements
            expect(grid.queryRadius(55, 55, 100).length).toBe(0)

            // Double remove
            expect(grid.remove(42)).toBe(false)
        })

        it("stress-tests queryNearest unbounded fallback with candidate rejection oracle", () => {
            const grid = new SpatialHashGrid<Food>(250)

            // 1. Cluster of 50 foods close to origin (within cellSize * 4 = 1000px)
            for (let i = 1; i <= 50; i++) {
                grid.insert(new Food(i, i * 15, i * 15, 1, 0)) // distance < 1000px
            }

            // 2. Outlying food far away at (5000, 5000)
            const farFood = new Food(999, 5000, 5000, 5, 0)
            grid.insert(farFood)

            // Query with filter that ONLY accepts farFood (id === 999)
            // Initial 4-cell radius search finds 50 candidates, but ALL fail the filter.
            // Unbounded fallback must scan remaining items and find farFood.
            const nearest = grid.queryNearest(0, 0, Infinity, (f) => f.id === 999)
            expect(nearest).not.toBeNull()
            expect(nearest!.item.id).toBe(999)
            expect(nearest!.distance).toBeCloseTo(Math.hypot(5000, 5000), 1)

            // If maxDistance is bounded to 2000px, fallback should NOT trigger and should return null
            const bounded = grid.queryNearest(0, 0, 2000, (f) => f.id === 999)
            expect(bounded).toBeNull()

            // When no items in the entire grid match filter, returns null
            const noneMatch = grid.queryNearest(0, 0, Infinity, () => false)
            expect(noneMatch).toBeNull()

            // On empty grid, returns null
            grid.clear()
            expect(grid.queryNearest(0, 0, Infinity)).toBeNull()
        })

        it("verifies queryNearest nearest item matches brute-force linear oracle across 300 points", () => {
            const grid = new SpatialHashGrid<Food>(200)
            const foods: Food[] = []

            for (let i = 1; i <= 300; i++) {
                const x = ((i * 12345) % 10000) - 5000
                const y = ((i * 54321) % 10000) - 5000
                const food = new Food(i, x, y, 1, 0)
                grid.insert(food)
                foods.push(food)
            }

            // Test 50 random query centers
            for (let q = 0; q < 50; q++) {
                const qx = ((q * 3333) % 8000) - 4000
                const qy = ((q * 7777) % 8000) - 4000

                const nearestGrid = grid.queryNearest(qx, qy, Infinity)

                // Linear brute force oracle
                let bestOracle: Food | null = null
                let bestDistSq = Infinity
                for (const f of foods) {
                    const dx = f.x - qx
                    const dy = f.y - qy
                    const dSq = dx * dx + dy * dy
                    if (dSq < bestDistSq) {
                        bestDistSq = dSq
                        bestOracle = f
                    }
                }

                expect(nearestGrid).not.toBeNull()
                expect(nearestGrid!.distance).toBeCloseTo(Math.sqrt(bestDistSq), 3)
                expect(nearestGrid!.item.id).toBe(bestOracle!.id)
            }
        })
    })

    describe("2. Rapid Disconnect/Reconnect & Socket Listener Lifecycle Stress", () => {
        it("handles 50 rapid connect/disconnect cycles with zero listener or timer accumulation", async () => {
            const CYCLES = 50
            for (let i = 0; i < CYCLES; i++) {
                const mockWs = new MockWebSocketHarness()
                const client = new SlitherClient({
                    socket: mockWs,
                    pingIntervalMs: 15,
                })

                const connectPromise = client.connect("ws://127.0.0.1:8080")
                mockWs.triggerOpen()
                await connectPromise

                expect(client.state).toBe(ClientState.HANDSHAKING)

                // Add state data to verify clear on disconnect
                client.gameState.snakes.set(1, new Snake({ id: 1 }))
                client.gameState.foods.set(1, new Food(1, 10, 10, 1, 0))

                client.disconnect()

                expect(client.state).toBe(ClientState.DISCONNECTED)
                expect(client.gameState.snakes.size).toBe(0)
                expect(client.gameState.foods.size).toBe(0)
                expect(client.gameState.spatialGrid.size).toBe(0)

                // Socket must be detached
                expect(mockWs.onopen).toBeNull()
                expect(mockWs.onmessage).toBeNull()
                expect(mockWs.onerror).toBeNull()
                expect(mockWs.onclose).toBeNull()
                expect(mockWs.closeCount).toBe(1)
            }
        })

        it("prevents duplicate disconnect events when native socket triggers asynchronous close", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            let disconnectEvents = 0
            client.on("disconnect", () => {
                disconnectEvents++
            })

            // Store ref to socket before disconnect
            const wsRef = mockWs

            // Client initiates disconnect
            client.disconnect()
            expect(disconnectEvents).toBe(1)

            // Simulate delayed asynchronous native close callback from WebSocket implementation
            if (wsRef.onclose) {
                wsRef.onclose({ code: 1000, reason: "Delayed Native Close", wasClean: true })
            }

            // Must NOT fire a second disconnect event!
            expect(disconnectEvents).toBe(1)
        })

        it("aborts in-flight spawn requests upon abrupt socket closure", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Solve challenge to enter READY
            const chalPacket = new BinaryWriter()
                .writeUint16(1)
                .writeUint8(54)
                .writeBytes(new Uint8Array(65).fill(42))
                .toUint8Array()
            mockWs.triggerMessage(chalPacket)
            expect(client.state).toBe(ClientState.READY)

            // Trigger spawn
            const spawnPromise = client.spawn("HeroBot")

            // Abrupt close before server sends snake_add
            mockWs.close(1006, "Abnormal TCP Drop")

            await expect(spawnPromise).rejects.toThrow(/Connection closed before spawn completed/)
            expect(client.state).toBe(ClientState.DISCONNECTED)
        })

        it("clears entity state when calling connect() consecutively", async () => {
            const mockWs1 = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs1 })
            const connectPromise1 = client.connect("ws://server1")
            mockWs1.triggerOpen()
            await connectPromise1

            client.gameState.addFood(new Food(10, 100, 100, 2, 1))
            expect(client.gameState.foods.size).toBe(1)

            // Connect to server2 without explicit disconnect() call first
            const mockWs2 = new MockWebSocketHarness()
            client.options.socket = mockWs2
            const connectPromise2 = client.connect("ws://server2")
            expect(client.gameState.foods.size).toBe(0) // State cleared at start of connect()

            mockWs2.triggerOpen()
            await connectPromise2
            expect(client.state).toBe(ClientState.HANDSHAKING)

            client.disconnect()
        })
    })

    describe("3. Angle Quantization Dirty-Checking & Boost Idempotency Stress", () => {
        it("suppresses redundant micro-steering packets (>90% suppression ratio)", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = [] // clear ping/connect traffic

            const NUM_STEPS = 20000
            // Step size 0.0005 rad (~50 microsteps per discrete protocol step)
            for (let i = 0; i < NUM_STEPS; i++) {
                client.turnTo(i * 0.0005)
            }

            const anglePackets = mockWs.sentData.filter((pkt) => pkt.length === 1 && pkt[0] <= 250)
            const suppressedCount = NUM_STEPS - anglePackets.length
            const suppressionRatio = suppressedCount / NUM_STEPS

            // Expected: ~98% suppression
            expect(suppressionRatio).toBeGreaterThan(0.9)
            expect(suppressionRatio).toBeGreaterThan(0.95)

            client.disconnect()
        })

        it("verifies mathematical agreement between radiansToProtocolByte and angleToByte across full circle", () => {
            const SAMPLES = 2500
            for (let i = 0; i < SAMPLES; i++) {
                const rad = (i / SAMPLES) * TWO_PI
                const byteA = radiansToProtocolByte(rad)
                const byteB = angleToByte(rad)
                // Both must yield identical discrete byte values
                expect(byteA).toBe(byteB)
                expect(byteA).toBeGreaterThanOrEqual(0)
                expect(byteA).toBeLessThanOrEqual(250)
            }
        })

        it("ensures angle wrap-around at 2π boundaries transmits correct discrete bytes", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = []

            // Alternate between 0 (byte 0) and 2π - 0.001 (byte 249)
            for (let i = 0; i < 50; i++) {
                client.turnTo(0)
                client.turnTo(TWO_PI - 0.001)
            }

            const packets = mockWs.sentData.filter((pkt) => pkt.length === 1 && pkt[0] <= 250)
            expect(packets.length).toBe(100)
            for (let i = 0; i < 100; i += 2) {
                expect(packets[i][0]).toBe(0)
                expect(packets[i + 1][0]).toBe(249)
            }

            client.disconnect()
        })

        it("guarantees 100% boost idempotency and strict protocol packet alternation", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = []

            // 1,000 duplicate boost() calls
            for (let i = 0; i < 1000; i++) {
                client.boost()
            }
            expect(mockWs.sentData.length).toBe(1)
            expect(mockWs.sentData[0][0]).toBe(253)
            expect(client.isBoosting).toBe(true)

            // 1,000 duplicate stopBoost() calls
            for (let i = 0; i < 1000; i++) {
                client.stopBoost()
            }
            expect(mockWs.sentData.length).toBe(2)
            expect(mockWs.sentData[1][0]).toBe(254)
            expect(client.isBoosting).toBe(false)

            // Fuzz test: 2,000 random toggles
            mockWs.sentData = []
            let active = false
            for (let i = 0; i < 2000; i++) {
                if (Math.random() < 0.3) {
                    active = !active
                }
                client.setBoost(active)
            }

            const boostPackets = mockWs.sentData.filter(
                (pkt) => pkt.length === 1 && (pkt[0] === 253 || pkt[0] === 254)
            )

            for (let j = 1; j < boostPackets.length; j++) {
                // Must strictly alternate: never duplicate consecutive byte
                expect(boostPackets[j][0]).not.toBe(boostPackets[j - 1][0])
            }

            client.disconnect()
        })

        it("resets boosting state upon disconnection and player death", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            client.setBoost(true)
            expect(client.isBoosting).toBe(true)

            // Death packet 'v'
            const deathPacket = new BinaryWriter().writeUint16(10).writeUint8(118).writeUint8(0).toUint8Array()
            mockWs.triggerMessage(deathPacket)

            expect(client.state).toBe(ClientState.DEAD)
            expect(client.isBoosting).toBe(false)

            client.disconnect()
            expect(client.isBoosting).toBe(false)
        })
    })

    describe("4. Enemy Snake Hijacking & Death Event Remediation Proofs", () => {
        it("verifies unspawned client in READY state rejects enemy snake adoption", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Solve challenge
            const challenge = new Uint8Array(65).fill(111)
            const chalPacket = new BinaryWriter().writeUint16(1).writeUint8(54).writeBytes(challenge).toUint8Array()
            mockWs.triggerMessage(chalPacket)
            expect(client.state).toBe(ClientState.READY)

            // Multiple enemy snakes arrive
            for (let enemyId = 101; enemyId <= 105; enemyId++) {
                const enemyPacket = new BinaryWriter()
                    .writeUint16(5)
                    .writeUint8(115)
                    .writeUint16(enemyId)
                    .writeUint24(0)
                    .writeUint8(0)
                    .writeUint24(0)
                    .writeUint16(500)
                    .writeUint24(0)
                    .writeUint8(1)
                    .writeUint24(2000)
                    .writeUint24(2000)
                    .writeString(`Enemy_${enemyId}`, "utf8", true)
                    .toUint8Array()
                mockWs.triggerMessage(enemyPacket)
            }

            // Client must remain READY and not adopt any enemy
            expect(client.state).toBe(ClientState.READY)
            expect(client.gameState.mySnakeId).toBeNull()
            expect(client.gameState.snakes.size).toBe(5)

            // Calling spawn() now must succeed
            const spawnPromise = client.spawn("HeroBot")
            expect(client.state).toBe(ClientState.READY)

            // Server responds with hero snake_add
            const heroPacket = new BinaryWriter()
                .writeUint16(6)
                .writeUint8(115)
                .writeUint16(777)
                .writeUint24(0)
                .writeUint8(0)
                .writeUint24(0)
                .writeUint16(500)
                .writeUint24(0)
                .writeUint8(0)
                .writeUint24(1000)
                .writeUint24(1000)
                .writeString("HeroBot", "utf8", true)
                .toUint8Array()
            mockWs.triggerMessage(heroPacket)

            const heroSnake = await spawnPromise
            expect(heroSnake.id).toBe(777)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.gameState.mySnakeId).toBe(777)
            expect(client.gameState.self?.id).toBe(777)

            client.disconnect()
        })

        it("dispatches snake_died event to listeners when receiving packet 'v'", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            client.gameState.mySnakeId = 99

            const diedEvents: any[] = []
            client.on("snake_died", (e) => {
                diedEvents.push(e)
            })

            const deathPacket = new BinaryWriter().writeUint16(99).writeUint8(118).writeUint8(1).toUint8Array()
            mockWs.triggerMessage(deathPacket)

            expect(client.state).toBe(ClientState.DEAD)
            expect(diedEvents.length).toBe(1)
            expect(diedEvents[0]).toEqual({
                snakeId: 99,
                isSelf: true,
                reason: 1,
            })

            client.disconnect()
        })
    })
})
