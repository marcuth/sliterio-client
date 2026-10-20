/**
 * @file game-state-client-stress.test.ts
 * @description Empirical stress-testing and adversarial verification of GameState and SlitherClient.
 * Authored by Challenger M2-2.
 */

import { describe, expect, it, vi } from "vitest"

import { ClientState, SlitherClient, WebSocketLike } from "../../src/client/slither-client.js"
import { SpatialHashGrid } from "../../src/math/spatial-grid.js"
import { Food } from "../../src/models/food.js"
import { GameState } from "../../src/models/game-state.js"
import { Snake } from "../../src/models/snake.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import {
    FoodBatchPacket,
    FoodEatenPacket,
    FoodSpawnPacket,
    InitialSetupPacket,
    LeaderboardPacket,
    PreyAddPacket,
    PreyRemovePacket,
    PreyUpdatePacket,
    SectorAddPacket,
    SectorRemovePacket,
    SnakeAddPacket,
    SnakeFullnessPacket,
    SnakeGrowPacket,
    SnakeMovePacket,
    SnakeRemovePacket,
    SnakeRotatePacket,
} from "../../src/protocol/types.js"

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

describe("Empirical Stress Suite: GameState & SlitherClient (Challenger M2-2)", () => {
    describe("1. GameState Massive Inbound Packet Stream Stress", () => {
        it("handles concurrent stream of 100 snakes with 20,000 interleaved updates", () => {
            const state = new GameState()
            const NUM_SNAKES = 100
            const UPDATES_PER_SNAKE = 200 // 20,000 total updates

            // 1. Setup arena
            const setupPacket: InitialSetupPacket = {
                type: "initial_setup",
                opcode: "a",
                timestamp: 1,
                gameRadius: 21600,
                mscps: 411,
                sectorSize: 480,
                sectorCount: 100,
                spangdv: 10,
                nsp1: 1,
                nsp2: 2,
                nsp3: 3,
                mamu: 4,
                mamu2: 5,
                cst: 6,
                protocolVersion: 11,
            }
            state.updateFromPacket(setupPacket)

            // 2. Add 100 snakes
            for (let id = 1; id <= NUM_SNAKES; id++) {
                const addPkt: SnakeAddPacket = {
                    type: "snake_add",
                    opcode: "s",
                    timestamp: 10,
                    snakeId: id,
                    skinId: id % 30,
                    x: 1000 + id * 10,
                    y: 1000 + id * 10,
                    angle: (id * 0.1) % (2 * Math.PI),
                    wantedAngle: (id * 0.1) % (2 * Math.PI),
                    speed: 5.5,
                    fam: 0.1,
                    nickname: `Snake_${id}`,
                    bodyParts: [
                        { x: 1000 + id * 10, y: 1000 + id * 10 },
                        { x: 995 + id * 10, y: 1000 + id * 10 },
                    ],
                }
                const events = state.updateFromPacket(addPkt)
                expect(events.length).toBe(1)
                expect(events[0].type).toBe("snake_add")
            }

            expect(state.snakes.size).toBe(NUM_SNAKES)

            // 3. Interleave 20,000 updates across move, rotate, grow, and fullness
            let totalEventsEmitted = 0
            for (let step = 0; step < UPDATES_PER_SNAKE; step++) {
                for (let id = 1; id <= NUM_SNAKES; id++) {
                    const action = step % 4
                    if (action === 0) {
                        // Move
                        const movePkt: SnakeMovePacket = {
                            type: "snake_move",
                            opcode: "g",
                            timestamp: 20 + step,
                            snakeId: id,
                            x: 1000 + id * 10 + step,
                            y: 1000 + id * 10 + step,
                        }
                        const evs = state.updateFromPacket(movePkt)
                        totalEventsEmitted += evs.length
                    } else if (action === 1) {
                        // Rotate
                        const rotPkt: SnakeRotatePacket = {
                            type: "snake_rotate",
                            opcode: "e",
                            timestamp: 20 + step,
                            snakeId: id,
                            angle: (step * 0.05) % (2 * Math.PI),
                            wantedAngle: (step * 0.05) % (2 * Math.PI),
                            speed: 5.5 + (step % 10) * 0.5,
                        }
                        const evs = state.updateFromPacket(rotPkt)
                        totalEventsEmitted += evs.length
                    } else if (action === 2) {
                        // Grow
                        const growPkt: SnakeGrowPacket = {
                            type: "snake_grow",
                            opcode: "n",
                            timestamp: 20 + step,
                            snakeId: id,
                            x: 990 + id * 10,
                            y: 990 + id * 10,
                        }
                        const evs = state.updateFromPacket(growPkt)
                        totalEventsEmitted += evs.length
                    } else {
                        // Fullness
                        const fullPkt: SnakeFullnessPacket = {
                            type: "snake_fullness",
                            opcode: "h",
                            timestamp: 20 + step,
                            snakeId: id,
                            fam: (step * 0.01) % 1.0,
                        }
                        const evs = state.updateFromPacket(fullPkt)
                        totalEventsEmitted += evs.length
                    }
                }
            }

            expect(totalEventsEmitted).toBe(NUM_SNAKES * UPDATES_PER_SNAKE)

            // Verify snake state consistency
            for (let id = 1; id <= NUM_SNAKES; id++) {
                const snake = state.snakes.get(id)!
                expect(snake).toBeDefined()
                // Each snake experienced 50 grow actions (200 / 4)
                expect(snake.body.length).toBe(2 + 50)
                expect(snake.isDead).toBe(false)
                expect(snake.head.x).toBeGreaterThan(1000 + id * 10)
            }

            // 4. Ingest 5,000 non-existent snake updates (must not crash, must not pollute state)
            for (let phantomId = 90000; phantomId < 95000; phantomId++) {
                const movePkt: SnakeMovePacket = {
                    type: "snake_move",
                    opcode: "g",
                    timestamp: 999,
                    snakeId: phantomId,
                    x: 500,
                    y: 500,
                }
                const evs = state.updateFromPacket(movePkt)
                expect(evs.length).toBe(0)
            }
            expect(state.snakes.size).toBe(NUM_SNAKES)

            // 5. Mass cull: remove 50 snakes
            for (let id = 1; id <= 50; id++) {
                const remPkt: SnakeRemovePacket = {
                    type: "snake_remove",
                    opcode: "s",
                    timestamp: 1000,
                    snakeId: id,
                    reason: 1, // Died
                }
                const evs = state.updateFromPacket(remPkt)
                expect(evs.length).toBe(1)
                expect(evs[0].type).toBe("snake_died")
            }
            expect(state.snakes.size).toBe(50)
        })

        it("stresses food churn: 10,000 spawns, 8,000 consumptions, spatial grid sync", () => {
            const state = new GameState()
            const TOTAL_FOOD = 10000
            const EATEN_FOOD = 8000

            // 1. Ingest via food_batch packet (chunks of 1,000)
            for (let batch = 0; batch < 10; batch++) {
                const foods = []
                for (let i = 0; i < 1000; i++) {
                    const idx = batch * 1000 + i
                    foods.push({
                        id: idx,
                        x: (idx * 17) % 20000,
                        y: (idx * 23) % 20000,
                        size: 5,
                        color: idx % 10,
                    })
                }
                const batchPacket: FoodBatchPacket = {
                    type: "food_batch",
                    opcode: "F",
                    timestamp: 100,
                    foods,
                }
                const evs = state.updateFromPacket(batchPacket)
                expect(evs.length).toBe(1)
                expect(evs[0].type).toBe("food_spawn")
            }

            expect(state.foods.size).toBe(TOTAL_FOOD)
            expect(state.spatialGrid.size).toBe(TOTAL_FOOD)

            // 2. Consume 8,000 foods
            for (let id = 0; id < EATEN_FOOD; id++) {
                const food = state.foods.get(id)!
                const eatenPacket: FoodEatenPacket = {
                    type: "food_eaten",
                    opcode: "c",
                    timestamp: 200,
                    id,
                    x: food.x,
                    y: food.y,
                    eaterSnakeId: 42,
                }
                const evs = state.updateFromPacket(eatenPacket)
                expect(evs.length).toBe(1)
                expect(evs[0].type).toBe("food_eaten")
            }

            expect(state.foods.size).toBe(TOTAL_FOOD - EATEN_FOOD)
            expect(state.spatialGrid.size).toBe(TOTAL_FOOD - EATEN_FOOD)

            // 3. Stale/duplicate food_eaten packets for already-eaten foods
            for (let id = 0; id < 1000; id++) {
                const eatenPacket: FoodEatenPacket = {
                    type: "food_eaten",
                    opcode: "c",
                    timestamp: 300,
                    id,
                    x: 0,
                    y: 0,
                }
                // Must not throw or crash
                const evs = state.updateFromPacket(eatenPacket)
                expect(evs.length).toBe(1)
            }
            expect(state.foods.size).toBe(TOTAL_FOOD - EATEN_FOOD)
            expect(state.spatialGrid.size).toBe(TOTAL_FOOD - EATEN_FOOD)

            // 4. Spatial queries under load
            const nearest = state.findNearestFood({ x: 5000, y: 5000 }, { maxDistance: 10000 })
            expect(nearest).not.toBeNull()
            expect(state.foods.has(nearest!.id)).toBe(true)

            // 5. Clear state
            state.clear()
            expect(state.foods.size).toBe(0)
            expect(state.spatialGrid.size).toBe(0)
        })

        it("stresses sector boundary activation, deactivation, and idempotency", () => {
            const state = new GameState()

            // Activate 1,000 sectors
            for (let x = 0; x < 50; x++) {
                for (let y = 0; y < 20; y++) {
                    const secAdd: SectorAddPacket = {
                        type: "sector_add",
                        opcode: "W",
                        timestamp: 50,
                        sectorX: x,
                        sectorY: y,
                    }
                    state.updateFromPacket(secAdd)
                }
            }
            expect(state.activeSectors.size).toBe(1000)

            // Idempotent duplicate additions
            for (let x = 0; x < 50; x++) {
                const secAdd: SectorAddPacket = {
                    type: "sector_add",
                    opcode: "W",
                    timestamp: 51,
                    sectorX: x,
                    sectorY: 0,
                }
                state.updateFromPacket(secAdd)
            }
            expect(state.activeSectors.size).toBe(1000)

            // Deactivate 500 sectors
            for (let x = 0; x < 25; x++) {
                for (let y = 0; y < 20; y++) {
                    const secRem: SectorRemovePacket = {
                        type: "sector_remove",
                        opcode: "w",
                        timestamp: 52,
                        sectorX: x,
                        sectorY: y,
                    }
                    state.updateFromPacket(secRem)
                }
            }
            expect(state.activeSectors.size).toBe(500)

            // Remove non-existent sectors
            for (let x = 100; x < 200; x++) {
                const secRem: SectorRemovePacket = {
                    type: "sector_remove",
                    opcode: "w",
                    timestamp: 53,
                    sectorX: x,
                    sectorY: 999,
                }
                state.updateFromPacket(secRem)
            }
            expect(state.activeSectors.size).toBe(500)
        })

        it("reconciles prey additions, trajectory updates, and consumption", () => {
            const state = new GameState()

            // Add 100 preys
            for (let id = 1; id <= 100; id++) {
                const preyAdd: PreyAddPacket = {
                    type: "prey_add",
                    opcode: "y",
                    timestamp: 10,
                    preyId: id,
                    x: id * 50,
                    y: id * 50,
                    size: 8,
                    color: id % 5,
                }
                state.updateFromPacket(preyAdd)
            }
            expect(state.preys.size).toBe(100)

            // Update trajectory
            for (let id = 1; id <= 100; id++) {
                const preyUpd: PreyUpdatePacket = {
                    type: "prey_update",
                    opcode: "j",
                    timestamp: 20,
                    preyId: id,
                    x: id * 50 + 10,
                    y: id * 50 + 10,
                    angle: 1.57,
                    speed: 7.2,
                }
                state.updateFromPacket(preyUpd)
                const p = state.preys.get(id)!
                expect(p.x).toBe(id * 50 + 10)
                expect(p.speed).toBe(7.2)
            }

            // Remove 40 preys
            for (let id = 1; id <= 40; id++) {
                const preyRem: PreyRemovePacket = {
                    type: "prey_remove",
                    opcode: "y",
                    timestamp: 30,
                    preyId: id,
                }
                state.updateFromPacket(preyRem)
            }
            expect(state.preys.size).toBe(60)
        })
    })

    describe("2. SlitherClient Angle Throttling & Suppression Verification", () => {
        it("empirically verifies >80% redundant packet suppression during micro-steering", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = [] // reset baseline (pings)

            const TOTAL_COMMANDS = 10000
            // Continuous micro-stepping: 10,000 updates over small arc
            // Angular step size: 0.001 radians (each protocol step is ~0.0251 rad)
            // So ~25 micro-steps per 1 discrete protocol byte
            for (let i = 0; i < TOTAL_COMMANDS; i++) {
                const angle = (i * 0.001) % (2 * Math.PI)
                client.turnTo(angle)
            }

            const packetsSent = mockWs.sentData.filter((pkt) => pkt.length === 1 && pkt[0] <= 250)
            const packetsSuppressed = TOTAL_COMMANDS - packetsSent.length
            const suppressionRatio = packetsSuppressed / TOTAL_COMMANDS

            // Mathematical check: should suppress ~96% of calls
            expect(suppressionRatio).toBeGreaterThan(0.8) // >80% requirement
            expect(suppressionRatio).toBeGreaterThan(0.9) // Actually >90%

            client.disconnect()
        })

        it("verifies 100% duplicate angle suppression and boundary crossing", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = []

            // Send exact same angle 1,000 times
            for (let i = 0; i < 1000; i++) {
                client.turnTo(Math.PI / 2) // ~62
            }

            // Only 1 packet must have been sent
            expect(mockWs.sentData.length).toBe(1)
            expect(mockWs.sentData[0][0]).toBe(62)

            // Rapid alternation between 0 and 2π - ε (0 vs 250 boundary)
            mockWs.sentData = []
            for (let i = 0; i < 100; i++) {
                client.turnTo(0)
                client.turnTo(2 * Math.PI - 0.001)
            }

            // Both angles differ in discrete byte (0 vs 250), so all 200 must transmit
            expect(mockWs.sentData.length).toBe(200)

            client.disconnect()
        })
    })

    describe("3. SlitherClient Boost Idempotency & Toggles", () => {
        it("suppresses 100% of redundant boost calls and strictly alternates protocol bytes", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = []

            // 500 duplicate boost() calls
            for (let i = 0; i < 500; i++) {
                client.boost()
            }
            expect(mockWs.sentData.length).toBe(1)
            expect(mockWs.sentData[0][0]).toBe(253) // BOOST_START
            expect(client.isBoosting).toBe(true)

            // 500 duplicate stopBoost() calls
            for (let i = 0; i < 500; i++) {
                client.stopBoost()
            }
            expect(mockWs.sentData.length).toBe(2)
            expect(mockWs.sentData[1][0]).toBe(254) // BOOST_STOP
            expect(client.isBoosting).toBe(false)

            // 5,000 random toggles: verify output packets strictly alternate between 253 and 254
            mockWs.sentData = []
            let stateDesired = false
            for (let i = 0; i < 5000; i++) {
                const toggle = Math.random() > 0.7
                if (toggle) {
                    stateDesired = !stateDesired
                }
                client.setBoost(stateDesired)
            }

            const boostPackets = mockWs.sentData.filter(
                (p) => p.length === 1 && (p[0] === 253 || p[0] === 254)
            )

            for (let j = 1; j < boostPackets.length; j++) {
                // Must strictly alternate: never two consecutive 253s or two consecutive 254s
                expect(boostPackets[j][0]).not.toBe(boostPackets[j - 1][0])
            }

            client.disconnect()
        })
    })

    describe("4. SlitherClient Connection Lifecycle & Reconnect Stress", () => {
        it("handles rapid sequential connect/disconnect cycles without timer leaks", async () => {
            for (let cycle = 0; cycle < 30; cycle++) {
                const mockWs = new MockWebSocketHarness()
                const client = new SlitherClient({
                    socket: mockWs,
                    pingIntervalMs: 10,
                })

                expect(client.state).toBe(ClientState.DISCONNECTED)
                const p = client.connect("ws://localhost")
                expect(client.state).toBe(ClientState.CONNECTING)
                mockWs.triggerOpen()
                await p
                expect(client.state).toBe(ClientState.HANDSHAKING)

                // Disconnect immediately
                client.disconnect()
                expect(client.state).toBe(ClientState.DISCONNECTED)
                expect(mockWs.closeCount).toBe(1)
            }
        })

        it("aborts pending spawn promise upon abrupt disconnection", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://localhost")
            mockWs.triggerOpen()
            await connectPromise

            // Solve challenge
            const challenge = new Uint8Array(65).fill(100)
            const chalPkt = new BinaryWriter().writeUint16(1).writeUint8(54).writeBytes(challenge).toUint8Array()
            mockWs.triggerMessage(chalPkt)
            expect(client.state).toBe(ClientState.READY)

            // Spawn request
            const spawnPromise = client.spawn("HeroSnake")
            expect(client.state).toBe(ClientState.READY)

            // Socket abruptly drops before snake_add
            mockWs.close(1006, "Abnormal Disconnect")

            await expect(spawnPromise).rejects.toThrow(/Connection closed before spawn completed/)
            expect(client.state).toBe(ClientState.DISCONNECTED)
        })

        it("cleans up ping timer loop upon disconnect", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({
                socket: mockWs,
                pingIntervalMs: 20,
            })
            const connectPromise = client.connect("ws://localhost")
            mockWs.triggerOpen()
            await connectPromise

            // Allow 3 pings
            await new Promise((resolve) => setTimeout(resolve, 70))
            const pingsBefore = mockWs.sentData.filter((p) => p[0] === 251).length
            expect(pingsBefore).toBeGreaterThanOrEqual(2)

            client.disconnect()
            const sentCountAfterDisconnect = mockWs.sentData.length

            // Wait another 70ms: no new pings must be emitted
            await new Promise((resolve) => setTimeout(resolve, 70))
            expect(mockWs.sentData.length).toBe(sentCountAfterDisconnect)
        })
    })

    describe("5. Remediated Anomaly & Edge Case Verification", () => {
        it("REMEDIATION 1: prevents enemy snake hijack in READY state when unspawned", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://localhost")
            mockWs.triggerOpen()
            await connectPromise

            // Challenge -> READY
            const challenge = new Uint8Array(65).fill(100)
            const chalPkt = new BinaryWriter().writeUint16(1).writeUint8(54).writeBytes(challenge).toUint8Array()
            mockWs.triggerMessage(chalPkt)
            expect(client.state).toBe(ClientState.READY)

            // Player has NOT called spawn() yet!
            // Server broadcasts an enemy snake in viewport:
            const enemyAddPkt = new BinaryWriter()
                .writeUint16(10)
                .writeUint8(115) // 's'
                .writeUint16(777) // enemy snakeId
                .writeUint24(0)
                .writeUint8(0)
                .writeUint24(0)
                .writeUint16(500)
                .writeUint24(0)
                .writeUint8(2)
                .writeUint24(5000)
                .writeUint24(5000)
                .writeString("EnemyBot", "utf8", true)
                .toUint8Array()

            mockWs.triggerMessage(enemyAddPkt)

            // Remediated: Client remains in READY state, does NOT hijack enemy snake as self
            expect(client.state).toBe(ClientState.READY)
            expect(client.gameState.mySnakeId).toBeNull()
            expect(client.gameState.self).toBeUndefined()
            expect(client.gameState.snakes.has(777)).toBe(true)

            // Now, player calls spawn() - must succeed and send spawn packet
            const spawnPromise = client.spawn("RealPlayer", 1)
            expect(mockWs.sentData.some((p) => p.length > 2 && p[0] === 115)).toBe(true)

            // Server responds with player's snake_add packet
            const playerAddPkt = new BinaryWriter()
                .writeUint16(20)
                .writeUint8(115)
                .writeUint16(999) // player snakeId
                .writeUint24(0)
                .writeUint8(0)
                .writeUint24(0)
                .writeUint16(500)
                .writeUint24(0)
                .writeUint8(1)
                .writeUint24(6000)
                .writeUint24(6000)
                .writeString("RealPlayer", "utf8", true)
                .toUint8Array()

            mockWs.triggerMessage(playerAddPkt)

            const playerSnake = await spawnPromise
            expect(playerSnake.id).toBe(999)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(client.gameState.mySnakeId).toBe(999)
            expect(client.gameState.self?.name).toBe("RealPlayer")

            client.disconnect()
        })

        it("REMEDIATION 2: cleanses GameState entity state upon disconnect and reconnect", async () => {
            const mockWs1 = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs1 })
            const connectPromise = client.connect("ws://server1")
            mockWs1.triggerOpen()
            await connectPromise

            // Add food and snake to GameState
            client.gameState.addFood(new Food(101, 500, 500, 5, 2))
            expect(client.gameState.foods.size).toBe(1)

            // Disconnect: must clear gameState
            client.disconnect()
            expect(client.state).toBe(ClientState.DISCONNECTED)
            expect(client.gameState.foods.size).toBe(0)
            expect(client.gameState.snakes.size).toBe(0)
            expect(client.gameState.mySnakeId).toBeNull()

            // Reconnecting to new server starts with cleared state
            client.gameState.addFood(new Food(202, 100, 100, 2, 1))
            expect(client.gameState.foods.size).toBe(1)

            const mockWs2 = new MockWebSocketHarness()
            const client2 = new SlitherClient({ socket: mockWs2 })
            const connect2 = client2.connect("ws://server2")
            expect(client2.gameState.foods.size).toBe(0)
            mockWs2.triggerOpen()
            await connect2
            client2.disconnect()
        })

        it("REMEDIATION 3: emits snake_died event when server death packet 'v' arrives", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://localhost")
            mockWs.triggerOpen()
            await connectPromise

            client.gameState.mySnakeId = 88
            const deathListener = vi.fn()
            client.on("snake_died", deathListener)

            // Server sends packet 'v' (opcode 118)
            const deadPacket = new BinaryWriter().writeUint16(50).writeUint8(118).writeUint8(0).toUint8Array()
            mockWs.triggerMessage(deadPacket)

            // State transitioned to DEAD:
            expect(client.state).toBe(ClientState.DEAD)
            // snake_died event listener is invoked with player death info
            expect(deathListener).toHaveBeenCalledTimes(1)
            expect(deathListener).toHaveBeenCalledWith(
                expect.objectContaining({
                    snakeId: 88,
                    isSelf: true,
                    reason: 0,
                })
            )

            client.disconnect()
        })

        it("REMEDIATION 4: detaches socket listeners in cleanupSocket avoiding duplicate disconnect", async () => {
            const mockWs = new MockWebSocketHarness()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://localhost")
            mockWs.triggerOpen()
            await connectPromise

            const disconnectListener = vi.fn()
            client.on("disconnect", disconnectListener)

            client.disconnect()

            expect(disconnectListener).toHaveBeenCalledTimes(1)
            expect(mockWs.onclose).toBeNull()
            expect(mockWs.onopen).toBeNull()
            expect(mockWs.onmessage).toBeNull()
            expect(mockWs.onerror).toBeNull()
        })

        it("REMEDIATION 5: SpatialHashGrid robust remove with coordinate mismatch and queryNearest filter fallback", () => {
            const grid = new SpatialHashGrid<Food>(100)
            const f1 = new Food(1, 50, 50, 2, 1)
            grid.insert(f1)
            expect(grid.size).toBe(1)

            // Remove using completely mismatched coordinates
            const removed = grid.remove(1, 9999, 9999)
            expect(removed).toBe(true)
            expect(grid.size).toBe(0)
            expect(grid.has(1)).toBe(false)
            expect(grid.queryRadius(50, 50, 100).length).toBe(0)

            // Removing non-existent item returns false
            expect(grid.remove(999, 9999, 9999)).toBe(false)

            // queryNearest unbounded fallback when candidates in 4-cell radius fail filter
            const grid2 = new SpatialHashGrid<Food>(100)
            grid2.insert(new Food(10, 50, 50, 1, 0)) // inside 4 cells, fails filter
            grid2.insert(new Food(20, 2000, 2000, 1, 0)) // outside 4 cells, passes filter

            const nearest = grid2.queryNearest(0, 0, Infinity, (item) => item.id === 20)
            expect(nearest).not.toBeNull()
            expect(nearest!.item.id).toBe(20)
            expect(nearest!.distance).toBeCloseTo(Math.hypot(2000, 2000), 1)
        })
    })
})
