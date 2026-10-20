import { describe, expect, it } from "vitest"

import { ClientState, SlitherClient, WebSocketLike } from "../../src/client/slither-client.js"
import { Snake } from "../../src/models/snake.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"

class MockWebSocket implements WebSocketLike {
    public readyState: number = 0 // 0 = CONNECTING, 1 = OPEN, 3 = CLOSED
    public binaryType?: string = "arraybuffer"
    public sentData: Uint8Array[] = []
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

describe("SlitherClient SDK Suite", () => {
    describe("Lifecycle State Machine & Handshake", () => {
        it("progresses through DISCONNECTED -> CONNECTING -> HANDSHAKING upon open", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({
                socket: mockWs,
            })

            expect(client.state).toBe(ClientState.DISCONNECTED)

            const connectPromise = client.connect("ws://127.0.0.1:8080")
            expect(client.state).toBe(ClientState.CONNECTING)

            mockWs.triggerOpen()
            await connectPromise

            expect(client.state).toBe(ClientState.HANDSHAKING)
            client.disconnect()
            expect(client.state).toBe(ClientState.DISCONNECTED)
        })

        it("automatically solves packet '6' anti-bot challenge and enters READY state", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })

            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Server sends Packet '6' (challenge)
            const challengeBytes = new Uint8Array(65).fill(100) // 65 bytes >= 65
            const challengePacket = new BinaryWriter()
                .writeUint16(20) // timestamp
                .writeUint8(54) // '6'
                .writeBytes(challengeBytes)
                .toUint8Array()

            mockWs.triggerMessage(challengePacket)

            // Client should have transitioned to READY
            expect(client.state).toBe(ClientState.READY)
            // Client should have transmitted challenge response (24 byte decoded secret)
            expect(mockWs.sentData.length).toBeGreaterThanOrEqual(1)
            const response = mockWs.sentData[0]
            expect(response.length).toBe(24)

            client.disconnect()
        })
    })

    describe("Player Spawn & Playing State", () => {
        it("rejects spawn if client is not in READY or DEAD state", async () => {
            const client = new SlitherClient()
            expect(client.state).toBe(ClientState.DISCONNECTED)

            await expect(client.spawn("TestBot")).rejects.toThrow(/Cannot spawn while in state: DISCONNECTED/)
        })

        it("transmits spawn packet and transitions to PLAYING once snake_add is received", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })

            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Send challenge to become READY
            const challengePacket = new BinaryWriter()
                .writeUint16(20)
                .writeUint8(54)
                .writeBytes(new Uint8Array(65).fill(98))
                .toUint8Array()
            mockWs.triggerMessage(challengePacket)
            expect(client.state).toBe(ClientState.READY)

            // Trigger spawn()
            const spawnPromise = client.spawn("SuperSnake", 5)
            expect(mockWs.sentData.length).toBe(2) // 1 for challenge response, 1 for spawn

            // Server responds with snake_add (packet 's' with length > 3)
            const snakeAddPacket = new BinaryWriter()
                .writeUint16(30)
                .writeUint8(115) // 's'
                .writeUint16(1234) // snakeId
                .writeUint24(Math.floor((Math.PI * 16777215) / (2 * Math.PI))) // angle
                .writeUint8(0) // unused
                .writeUint24(Math.floor((Math.PI * 16777215) / (2 * Math.PI))) // wantedAngle
                .writeUint16(580) // speed = 5.8 * 100
                .writeUint24(0) // fam
                .writeUint8(5) // skin
                .writeUint24(5000) // headX = 1000 * 5
                .writeUint24(5000) // headY = 1000 * 5
                .writeString("SuperSnake", "utf8", true) // nickname with length prefix
                .toUint8Array()

            let spawnEventFired = false
            client.once("spawn", (snake) => {
                spawnEventFired = true
                expect(snake.id).toBe(1234)
                expect(snake.name).toBe("SuperSnake")
            })

            mockWs.triggerMessage(snakeAddPacket)

            const spawnedSnake = await spawnPromise
            expect(spawnedSnake.id).toBe(1234)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(spawnEventFired).toBe(true)

            client.disconnect()
        })

        it("does not hijack enemy snake in READY state before spawn is invoked", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })

            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Send challenge to become READY
            const challengePacket = new BinaryWriter()
                .writeUint16(20)
                .writeUint8(54)
                .writeBytes(new Uint8Array(65).fill(98))
                .toUint8Array()
            mockWs.triggerMessage(challengePacket)
            expect(client.state).toBe(ClientState.READY)

            // Server broadcasts external snake in viewport
            const enemyPacket = new BinaryWriter()
                .writeUint16(25)
                .writeUint8(115) // 's'
                .writeUint16(9999) // snakeId
                .writeUint24(0)
                .writeUint8(0)
                .writeUint24(0)
                .writeUint16(500)
                .writeUint24(0)
                .writeUint8(2)
                .writeUint24(5000)
                .writeUint24(5000)
                .writeString("Enemy", "utf8", true)
                .toUint8Array()

            mockWs.triggerMessage(enemyPacket)

            // Must NOT adopt mySnakeId and must NOT transition to PLAYING
            expect(client.state).toBe(ClientState.READY)
            expect(client.gameState.mySnakeId).toBeNull()
            expect(client.gameState.self).toBeUndefined()
            expect(client.gameState.snakes.has(9999)).toBe(true)

            client.disconnect()
        })
    })

    describe("Steering & Discrete Angle Dirty Checking", () => {
        it("suppresses redundant steering packets when discrete angle byte is unchanged", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Clear sent packets (pings, etc.)
            mockWs.sentData = []

            // Heading 0 rad -> byte 0
            client.turnTo(0)
            expect(mockWs.sentData.length).toBe(1)
            expect(mockWs.sentData[0][0]).toBe(0)

            // Very small change that maps to the SAME protocol byte
            // 2π / 250 = ~0.02513. A change of 0.005 stays within byte 0!
            client.turnTo(0.005)
            expect(mockWs.sentData.length).toBe(1) // NOT transmitted!

            // Meaningful change: π rad -> byte 125
            client.turnTo(Math.PI)
            expect(mockWs.sentData.length).toBe(2)
            expect(mockWs.sentData[1][0]).toBe(125)

            // Duplicate π rad again
            client.turnTo(Math.PI)
            expect(mockWs.sentData.length).toBe(2) // NOT transmitted!

            // turnToDegrees helper
            client.turnToDegrees(270) // ~187 byte
            expect(mockWs.sentData.length).toBe(3)
            expect(mockWs.sentData[2][0]).toBe(187)

            client.disconnect()
        })

        it("moveTo computes heading and distance to coordinate", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            // Without snake, moveTo throws
            expect(() => client.moveTo({ x: 100, y: 100 })).toThrow(/Cannot moveTo/)

            // Setup self snake at (100, 100)
            client.gameState.mySnakeId = 1
            client.gameState.snakes.set(
                1,
                new Snake({
                    id: 1,
                    head: { x: 100, y: 100 },
                })
            )

            mockWs.sentData = []
            // Move toward (200, 100) -> angle 0 (right), distance 100
            const res = client.moveTo({ x: 200, y: 100 })
            expect(res.angle).toBeCloseTo(0, 5)
            expect(res.distance).toBe(100)
            expect(mockWs.sentData.length).toBe(1)
            expect(mockWs.sentData[0][0]).toBe(0)

            client.disconnect()
        })
    })

    describe("Boost Control Idempotency", () => {
        it("suppresses redundant boost packets when state is unchanged", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = []

            // Activate boost -> byte 253
            client.setBoost(true)
            expect(client.isBoosting).toBe(true)
            expect(mockWs.sentData.length).toBe(1)
            expect(mockWs.sentData[0][0]).toBe(253)

            // Idempotent duplicate boost -> no packet
            client.boost()
            expect(mockWs.sentData.length).toBe(1)

            // Deactivate boost -> byte 254
            client.stopBoost()
            expect(client.isBoosting).toBe(false)
            expect(mockWs.sentData.length).toBe(2)
            expect(mockWs.sentData[1][0]).toBe(254)

            // Idempotent duplicate stopBoost -> no packet
            client.setBoost(false)
            expect(mockWs.sentData.length).toBe(2)

            client.disconnect()
        })
    })

    describe("Heartbeat Ping Loop", () => {
        it("transmits periodic ping packet 251 while connected", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({
                socket: mockWs,
                pingIntervalMs: 50,
            })

            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            mockWs.sentData = []

            // Wait 200ms for at least 2 ping intervals (50ms interval)
            await new Promise((resolve) => setTimeout(resolve, 200))

            const pingPackets = mockWs.sentData.filter((pkt) => pkt.length === 1 && pkt[0] === 251)
            expect(pingPackets.length).toBeGreaterThanOrEqual(2)

            client.disconnect()
        })
    })

    describe("Player Death and Disconnect Handlers", () => {
        it("transitions to DEAD state and emits snake_died when receiving server death packet 'v'", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            client.gameState.mySnakeId = 55
            let diedEvent: any = null
            client.on("snake_died", (e) => {
                diedEvent = e
            })

            // Send death packet 'v'
            const deathPacket = new BinaryWriter().writeUint16(40).writeUint8(118).writeUint8(0).toUint8Array()

            mockWs.triggerMessage(deathPacket)
            expect(client.state).toBe(ClientState.DEAD)
            expect(diedEvent).toEqual({ snakeId: 55, isSelf: true, reason: 0 })

            client.disconnect()
        })

        it("emits disconnect event when socket is closed", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            let disconnectFired = false
            client.once("disconnect", (info) => {
                disconnectFired = true
                expect(info?.code).toBe(1006)
            })

            mockWs.close(1006, "Abnormal")
            expect(disconnectFired).toBe(true)
            expect(client.state).toBe(ClientState.DISCONNECTED)
        })

        it("clears GameState entities on disconnect and connect", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            client.gameState.snakes.set(1, new Snake({ id: 1 }))
            expect(client.gameState.snakes.size).toBe(1)

            client.disconnect()
            expect(client.gameState.snakes.size).toBe(0)
        })

        it("detaches socket listeners on disconnect to prevent duplicate events", async () => {
            const mockWs = new MockWebSocket()
            const client = new SlitherClient({ socket: mockWs })
            const connectPromise = client.connect("ws://127.0.0.1:8080")
            mockWs.triggerOpen()
            await connectPromise

            let disconnectCount = 0
            client.on("disconnect", () => {
                disconnectCount++
            })

            client.disconnect()
            expect(disconnectCount).toBe(1)
            expect(mockWs.onclose).toBeNull()
        })
    })
})
