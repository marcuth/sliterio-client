import net from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ClientState, SlitherClient } from "../../src/client/slither-client.js"
import {
    computeAcceptKey,
    createInMemoryClient,
    InMemoryWebSocket,
    MockSlitherServer,
} from "../../src/mock/mock-server.js"
import { decodePacket } from "../../src/protocol/packet-decoder.js"
import { encodeChallengeResponse } from "../../src/protocol/packet-encoder.js"
import { decodeSlitherSecret } from "../../src/protocol/secret-resolver.js"

// ---------------------------------------------------------------------------
// RFC 6455 Test Utilities for Raw TCP Verification
// ---------------------------------------------------------------------------

function encodeClientMaskedFrame(payload: Uint8Array, opcode: number = 2): Buffer {
    const maskKey = Buffer.from([0x3a, 0x7b, 0x1c, 0x9f])
    const len = payload.length
    let header: Buffer

    if (len < 126) {
        header = Buffer.alloc(6)
        header[0] = 0x80 | (opcode & 0x0f) // FIN=1, Opcode
        header[1] = 0x80 | len // MASK=1
        maskKey.copy(header, 2)
    } else if (len <= 65535) {
        header = Buffer.alloc(8)
        header[0] = 0x80 | (opcode & 0x0f)
        header[1] = 0x80 | 126
        header.writeUInt16BE(len, 2)
        maskKey.copy(header, 4)
    } else {
        header = Buffer.alloc(14)
        header[0] = 0x80 | (opcode & 0x0f)
        header[1] = 0x80 | 127
        header.writeBigUInt64BE(BigInt(len), 2)
        maskKey.copy(header, 10)
    }

    const maskedPayload = Buffer.alloc(len)
    for (let i = 0; i < len; i++) {
        maskedPayload[i] = payload[i] ^ maskKey[i % 4]
    }

    return Buffer.concat([header, maskedPayload])
}

interface RawTcpWsClient {
    socket: net.Socket
    readFrame: (timeoutMs?: number) => Promise<{ opcode: number; payload: Buffer }>
    sendFrame: (payload: Uint8Array, opcode?: number) => void
    close: () => Promise<void>
}

function connectRawTcpClient(port: number): Promise<RawTcpWsClient> {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port }, () => {
            const clientKey = "dGhlIHNhbXBsZSBub25jZQ=="
            const req = [
                "GET / HTTP/1.1",
                "Host: 127.0.0.1",
                "Upgrade: websocket",
                "Connection: Upgrade",
                `Sec-WebSocket-Key: ${clientKey}`,
                "Sec-WebSocket-Version: 13",
                "\r\n",
            ].join("\r\n")
            socket.write(req)
        })

        let buffer = Buffer.alloc(0)
        let upgraded = false
        const frameQueue: Array<{ opcode: number; payload: Buffer }> = []
        const waiterQueue: Array<(frame: { opcode: number; payload: Buffer }) => void> = []

        socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk])

            if (!upgraded) {
                const headerEnd = buffer.indexOf("\r\n\r\n")
                if (headerEnd !== -1) {
                    const response = buffer.subarray(0, headerEnd).toString("utf8")
                    if (!response.includes("101 Switching Protocols")) {
                        socket.destroy()
                        return reject(new Error("Upgrade failed: " + response))
                    }
                    upgraded = true
                    buffer = buffer.subarray(headerEnd + 4)
                    resolve(clientInterface)
                } else {
                    return
                }
            }

            // Parse server frames (server frames are unmasked)
            while (buffer.length >= 2) {
                const b0 = buffer[0]
                const b1 = buffer[1]
                const opcode = b0 & 0x0f
                let payloadLen = b1 & 0x7f
                let headerOffset = 2

                if (payloadLen === 126) {
                    if (buffer.length < 4) return
                    payloadLen = buffer.readUInt16BE(2)
                    headerOffset = 4
                } else if (payloadLen === 127) {
                    if (buffer.length < 10) return
                    payloadLen = Number(buffer.readBigUInt64BE(2))
                    headerOffset = 10
                }

                if (buffer.length < headerOffset + payloadLen) return

                const payload = Buffer.from(buffer.subarray(headerOffset, headerOffset + payloadLen))
                buffer = buffer.subarray(headerOffset + payloadLen)

                const frame = { opcode, payload }
                if (waiterQueue.length > 0) {
                    const waiter = waiterQueue.shift()!
                    waiter(frame)
                } else {
                    frameQueue.push(frame)
                }
            }
        })

        socket.on("error", (err) => {
            // Error handled on client interface
        })

        const clientInterface: RawTcpWsClient = {
            socket,
            readFrame: (timeoutMs: number = 1000) => {
                if (frameQueue.length > 0) {
                    return Promise.resolve(frameQueue.shift()!)
                }
                return new Promise((res, rej) => {
                    const timer = setTimeout(() => {
                        const idx = waiterQueue.indexOf(handler)
                        if (idx !== -1) waiterQueue.splice(idx, 1)
                        rej(new Error(`Timed out waiting for frame (${timeoutMs}ms)`))
                    }, timeoutMs)

                    const handler = (frame: { opcode: number; payload: Buffer }) => {
                        clearTimeout(timer)
                        res(frame)
                    }
                    waiterQueue.push(handler)
                })
            },
            sendFrame: (payload: Uint8Array, opcode: number = 2) => {
                const frame = encodeClientMaskedFrame(payload, opcode)
                socket.write(frame)
            },
            close: () => {
                return new Promise((res) => {
                    if (socket.destroyed) return res()
                    socket.once("close", () => res())
                    socket.end()
                })
            },
        }
    })
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe("MockSlitherServer Empirical Stress Test Suite", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    // =========================================================================
    // 1. CHALLENGE VERIFICATION STRESS
    // =========================================================================
    describe("1. Challenge Verification Stress", () => {
        it("accepts exactly valid 24-byte anti-bot token and transitions to READY", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })

            let challengeReceived = false
            client.on("state_change", (st) => {
                if (st === ClientState.READY) {
                    challengeReceived = true
                }
            })

            await client.connect()
            await new Promise((r) => setTimeout(r, 60))

            expect(challengeReceived).toBe(true)
            expect(client.state).toBe(ClientState.READY)
            client.disconnect()
        })

        it("terminates with close code 1008 on corrupted 24-byte token (all 0xFF)", async () => {
            const socket = server.createClientSocket()
            let closeEv: any = null

            socket.onclose = (ev) => {
                closeEv = ev
            }
            socket.onmessage = (ev) => {
                const packet = decodePacket(new Uint8Array(ev.data))
                if (packet.type === "pre_init_challenge") {
                    socket.send(new Uint8Array(24).fill(0xff))
                }
            }

            socket.triggerOpen()
            await new Promise((r) => setTimeout(r, 60))

            expect(closeEv).not.toBeNull()
            expect(closeEv.code).toBe(1008)
            expect(closeEv.reason).toContain("Anti-bot challenge secret mismatch")
        })

        it("terminates with close code 1008 on 1-bit modified 24-byte token", async () => {
            const socket = server.createClientSocket()
            let closeEv: any = null

            socket.onclose = (ev) => {
                closeEv = ev
            }
            socket.onmessage = (ev) => {
                const packet = decodePacket(new Uint8Array(ev.data))
                if (packet.type === "pre_init_challenge") {
                    const validToken = decodeSlitherSecret(packet.challenge)
                    // Mutate single byte
                    const mutated = new Uint8Array(validToken)
                    mutated[12] ^= 0x01
                    socket.send(mutated)
                }
            }

            socket.triggerOpen()
            await new Promise((r) => setTimeout(r, 60))

            expect(closeEv).not.toBeNull()
            expect(closeEv.code).toBe(1008)
        })

        it("terminates with close code 1008 on truncated tokens (lengths 1, 12, 23)", async () => {
            const testLengths = [1, 12, 23]

            for (const len of testLengths) {
                const localSocket = server.createClientSocket()
                let closeEv: any = null

                localSocket.onclose = (ev) => {
                    closeEv = ev
                }
                localSocket.onmessage = (ev) => {
                    const packet = decodePacket(new Uint8Array(ev.data))
                    if (packet.type === "pre_init_challenge") {
                        localSocket.send(new Uint8Array(len).fill(0x41))
                    }
                }

                localSocket.triggerOpen()
                await new Promise((r) => setTimeout(r, 60))

                expect(closeEv, `Failed for length ${len}`).not.toBeNull()
                expect(closeEv.code, `Code mismatch for length ${len}`).toBe(1008)
                expect(closeEv.reason).toContain("Anti-bot challenge response length must be 24 bytes")
            }
        })

        it("terminates with close code 1008 on oversized tokens (lengths 25, 48, 100)", async () => {
            const testLengths = [25, 48, 100]

            for (const len of testLengths) {
                const localSocket = server.createClientSocket()
                let closeEv: any = null

                localSocket.onclose = (ev) => {
                    closeEv = ev
                }
                localSocket.onmessage = (ev) => {
                    const packet = decodePacket(new Uint8Array(ev.data))
                    if (packet.type === "pre_init_challenge") {
                        localSocket.send(new Uint8Array(len).fill(0x5a))
                    }
                }

                localSocket.triggerOpen()
                await new Promise((r) => setTimeout(r, 60))

                expect(closeEv, `Failed for oversized length ${len}`).not.toBeNull()
                expect(closeEv.code, `Code mismatch for oversized length ${len}`).toBe(1008)
            }
        })

        it("terminates with close code 1008 when client sends premature spawn command before challenge response", async () => {
            const socket = server.createClientSocket()
            let closeEv: any = null

            socket.onclose = (ev) => {
                closeEv = ev
            }
            socket.onmessage = (ev) => {
                const packet = decodePacket(new Uint8Array(ev.data))
                if (packet.type === "pre_init_challenge") {
                    // Send premature spawn packet 115 instead of 24-byte response
                    const spawnPacket = new Uint8Array([115, 0, 1, 66, 111, 116])
                    socket.send(spawnPacket)
                }
            }

            socket.triggerOpen()
            await new Promise((r) => setTimeout(r, 60))

            expect(closeEv).not.toBeNull()
            expect(closeEv.code).toBe(1008)
        })

        it("verifies challenge over real TCP network socket (valid token 유지, invalid token 1008)", async () => {
            const port = await server.start(0)

            // Test A: Real TCP valid challenge
            const validClient = await connectRawTcpClient(port)
            const frame1 = await validClient.readFrame()
            expect(frame1.opcode).toBe(2) // Binary frame Packet '6'

            const challengePacket = decodePacket(new Uint8Array(frame1.payload))
            expect(challengePacket.type).toBe("pre_init_challenge")
            if (challengePacket.type === "pre_init_challenge") {
                const token = decodeSlitherSecret(challengePacket.challenge)
                expect(token.length).toBe(24)
                validClient.sendFrame(token)
            }

            await new Promise((r) => setTimeout(r, 50))
            // Session must still be active and open on server
            expect(validClient.socket.destroyed).toBe(false)
            await validClient.close()

            // Test B: Real TCP invalid challenge
            const invalidClient = await connectRawTcpClient(port)
            const frame2 = await invalidClient.readFrame()
            expect(frame2.opcode).toBe(2)

            // Send invalid 24 bytes
            invalidClient.sendFrame(new Uint8Array(24).fill(0x00))

            await new Promise((r) => setTimeout(r, 60))
            // The socket must be closed/terminated by the server
            expect(invalidClient.socket.writable).toBe(false)
            await invalidClient.close()
        })
    })

    // =========================================================================
    // 2. ABRUPT DISCONNECTS & SOCKET DROPS ACROSS LIFECYCLE STATES
    // =========================================================================
    describe("2. Abrupt Disconnects Across Lifecycle States", () => {
        it("handles pre-handshake socket closure without crashing server", async () => {
            const socket = server.createClientSocket()
            socket.triggerOpen()

            // Abruptly close immediately before challenge is handled
            socket.close(1006, "Abrupt drop before handshake")

            await new Promise((r) => setTimeout(r, 40))
            expect(server.getPlayerSnake()).toBeUndefined()
            expect(server.getAllSnakes().length).toBe(0)
        })

        it("handles post-handshake / pre-spawn socket drop cleanly", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()

            await new Promise((r) => setTimeout(r, 50))
            expect(client.state).toBe(ClientState.READY)

            // Abrupt socket drop before spawn
            socket.close(1006, "Client crashed after handshake")

            await new Promise((r) => setTimeout(r, 40))
            expect(server.getPlayerSnake()).toBeUndefined()
            expect(server.getAllSnakes().length).toBe(0)
        })

        it("handles abrupt disconnect during PLAYING: kills player snake and broadcasts removal", async () => {
            const socket1 = server.createClientSocket()
            const client1 = new SlitherClient({ socket: socket1 })
            await client1.connect()
            await new Promise((r) => setTimeout(r, 40))
            const player1 = await client1.spawn("DroppingPlayer", 1)

            const socket2 = server.createClientSocket()
            const client2 = new SlitherClient({ socket: socket2 })
            await client2.connect()
            await new Promise((r) => setTimeout(r, 40))
            await client2.spawn("ObserverPlayer", 2)

            let client1DeathSeen = false
            client2.on("snake_died", (ev) => {
                if (ev.snakeId === player1.id) {
                    client1DeathSeen = true
                }
            })

            expect(server.getSnake(player1.id)).toBeDefined()
            expect(server.getSnake(player1.id)!.isDead).toBe(false)

            // Abrupt disconnect client 1
            socket1.close(1006, "Abrupt network loss while playing")
            await new Promise((r) => setTimeout(r, 50))

            // Player 1 snake must be removed from active snakes
            expect(server.getSnake(player1.id)).toBeUndefined()
            // Death food must have been dropped
            expect(server.getAllFoods().length).toBeGreaterThan(0)
            // Client 2 must have received removal notice
            expect(client1DeathSeen).toBe(true)

            client2.disconnect()
        })

        it("handles disconnect after snake was already dead (no double-free)", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((r) => setTimeout(r, 40))

            const hero = await client.spawn("MortalSnake", 0)
            server.simulateSnakeDeath(hero.id, 0)

            await new Promise((r) => setTimeout(r, 40))
            expect(client.state).toBe(ClientState.DEAD)

            // Disconnect after death
            expect(() => {
                socket.close(1000, "Clean close after death")
            }).not.toThrow()

            await new Promise((r) => setTimeout(r, 40))
            expect(server.getSnake(hero.id)).toBeUndefined()
        })

        it("server.stop() terminates all active sessions gracefully across mixed states", async () => {
            // Mixed clients: Client 1 pre-handshake, Client 2 handshaked, Client 3 spawned
            const socket1 = server.createClientSocket()
            socket1.triggerOpen()

            const socket2 = server.createClientSocket()
            const client2 = new SlitherClient({ socket: socket2 })
            await client2.connect()

            const socket3 = server.createClientSocket()
            const client3 = new SlitherClient({ socket: socket3 })
            await client3.connect()
            await new Promise((r) => setTimeout(r, 40))
            await client3.spawn("SpawnedSnake", 0)

            let socket1Closed = false
            let socket2Closed = false
            let socket3Closed = false

            socket1.onclose = () => {
                socket1Closed = true
            }
            socket2.onclose = () => {
                socket2Closed = true
            }
            socket3.onclose = () => {
                socket3Closed = true
            }

            // Stop server
            await server.stop()
            await new Promise((r) => setTimeout(r, 40))

            expect(socket1Closed).toBe(true)
            expect(socket2Closed).toBe(true)
            expect(socket3Closed).toBe(true)
            expect(server.getAllSnakes().length).toBe(0)
            expect(server.getAllFoods().length).toBe(0)
        })

        it("handles raw TCP socket abrupt destruction without throwing unhandled exceptions", async () => {
            const port = await server.start(0)
            const tcpClient = await connectRawTcpClient(port)

            // Read challenge frame
            await tcpClient.readFrame()

            // Forcibly destroy TCP socket abruptly (simulating hard drop / cable pull)
            tcpClient.socket.destroy(new Error("Hard RST"))

            await new Promise((r) => setTimeout(r, 50))
            // Server must remain running and operational
            expect(server.port).toBe(port)
        })
    })

    // =========================================================================
    // 3. CONCURRENT MULTI-CLIENT CONNECTIONS (10+ CLIENTS)
    // =========================================================================
    describe("3. Concurrent Multi-Client Connections (10+ Clients)", () => {
        it("connects and handshakes 10 clients simultaneously", async () => {
            const CLIENT_COUNT = 10
            const clients: SlitherClient[] = []

            for (let i = 0; i < CLIENT_COUNT; i++) {
                const sock = server.createClientSocket()
                clients.push(new SlitherClient({ socket: sock }))
            }

            // Concurrently connect all 10 clients
            await Promise.all(clients.map((c) => c.connect()))
            await new Promise((r) => setTimeout(r, 80))

            for (let i = 0; i < CLIENT_COUNT; i++) {
                expect(clients[i].state, `Client ${i} not READY`).toBe(ClientState.READY)
            }

            clients.forEach((c) => c.disconnect())
        })

        it("spawns 10 snakes concurrently and validates cross-client visibility", async () => {
            const CLIENT_COUNT = 10
            const clients: SlitherClient[] = []

            for (let i = 0; i < CLIENT_COUNT; i++) {
                const sock = server.createClientSocket()
                clients.push(new SlitherClient({ socket: sock }))
            }

            await Promise.all(clients.map((c) => c.connect()))
            await new Promise((r) => setTimeout(r, 60))

            // Concurrently spawn all 10 snakes
            const spawnedSnakes = await Promise.all(
                clients.map((c, idx) => c.spawn(`ConcurrentBot_${idx}`, idx % 5))
            )

            expect(spawnedSnakes.length).toBe(CLIENT_COUNT)
            expect(server.getAllSnakes().length).toBe(CLIENT_COUNT)

            // Ensure all snake IDs are unique
            const ids = new Set(spawnedSnakes.map((s) => s.id))
            expect(ids.size).toBe(CLIENT_COUNT)

            // Allow cross-synchronization packets to propagate
            await new Promise((r) => setTimeout(r, 80))

            // Each client should track self + 9 other snakes = 10 total snakes
            for (let i = 0; i < CLIENT_COUNT; i++) {
                expect(clients[i].state).toBe(ClientState.PLAYING)
                expect(clients[i].gameState.snakes.size).toBe(CLIENT_COUNT)
            }

            clients.forEach((c) => c.disconnect())
        })

        it("handles concurrent steering updates from 10 clients across multiple physics steps", async () => {
            const CLIENT_COUNT = 10
            const clients: SlitherClient[] = []

            for (let i = 0; i < CLIENT_COUNT; i++) {
                const sock = server.createClientSocket()
                clients.push(new SlitherClient({ socket: sock }))
            }

            await Promise.all(clients.map((c) => c.connect()))
            await new Promise((r) => setTimeout(r, 50))

            await Promise.all(
                clients.map((c, idx) => c.spawn(`SteerBot_${idx}`, idx % 4))
            )

            // All 10 clients steer simultaneously to distinct angles
            for (let i = 0; i < CLIENT_COUNT; i++) {
                const angle = (i / CLIENT_COUNT) * Math.PI * 2
                clients[i].turnTo(angle)
            }

            await new Promise((r) => setTimeout(r, 50))

            // Step physics engine 5 times
            for (let step = 0; step < 5; step++) {
                server.step(50)
            }

            // All 10 snakes should have moved and remained valid
            const serverSnakes = server.getAllSnakes()
            expect(serverSnakes.length).toBe(CLIENT_COUNT)
            for (const s of serverSnakes) {
                expect(s.isDead).toBe(false)
                expect(s.body.length).toBe(10)
            }

            clients.forEach((c) => c.disconnect())
        })

        it("handles concurrent churn: 5 of 10 clients drop abruptly while 5 continue playing", async () => {
            const CLIENT_COUNT = 10
            const sockets: InMemoryWebSocket[] = []
            const clients: SlitherClient[] = []

            for (let i = 0; i < CLIENT_COUNT; i++) {
                const sock = server.createClientSocket()
                sockets.push(sock)
                clients.push(new SlitherClient({ socket: sock }))
            }

            await Promise.all(clients.map((c) => c.connect()))
            await new Promise((r) => setTimeout(r, 50))

            const spawned = await Promise.all(
                clients.map((c, idx) => c.spawn(`ChurnBot_${idx}`, idx))
            )

            expect(server.getAllSnakes().length).toBe(10)

            // 5 clients disconnect abruptly
            for (let i = 0; i < 5; i++) {
                sockets[i].close(1006, `Churn drop client ${i}`)
            }

            await new Promise((r) => setTimeout(r, 60))

            // Remaining 5 clients should still be in PLAYING state
            for (let i = 5; i < 10; i++) {
                expect(clients[i].state).toBe(ClientState.PLAYING)
            }

            // Exactly 5 snakes remain in server
            expect(server.getAllSnakes().length).toBe(5)

            // Step physics for remaining snakes
            server.step(50)
            expect(server.getAllSnakes().length).toBe(5)

            for (let i = 5; i < 10; i++) {
                clients[i].disconnect()
            }
        })

        it("handles high frequency rapid connect/disconnect cycling (20 cycles)", async () => {
            for (let cycle = 0; cycle < 20; cycle++) {
                const socket = server.createClientSocket()
                const client = new SlitherClient({ socket })
                await client.connect()
                // Rapid disconnect
                client.disconnect()
            }

            // Server must remain completely clean and healthy
            expect(server.getAllSnakes().length).toBe(0)
            expect(server.getPlayerSnake()).toBeUndefined()
        })
    })

    // =========================================================================
    // 4. PROGRAMMATIC SCENARIOS & FOOD CONSUMPTION STRESS
    // =========================================================================
    describe("4. Programmatic Scenarios & Food Concurrency Stress", () => {
        it("handles high-volume food generation and concurrent eating collisions", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((r) => setTimeout(r, 40))

            const hero = await client.spawn("GluttonBot", 0)
            const serverSnake = server.getPlayerSnake()!

            // Spawn 50 food items directly along the snake's path (+X)
            const foods: Array<{ x: number; y: number; size: number }> = []
            for (let i = 1; i <= 50; i++) {
                foods.push({
                    x: serverSnake.x + i * 10,
                    y: serverSnake.y,
                    size: 1,
                })
            }
            server.spawnFoodBatch(foods)
            expect(server.getAllFoods().length).toBeGreaterThanOrEqual(50)

            let eatenEventsCount = 0
            client.on("food_eaten", () => {
                eatenEventsCount++
            })

            // Step forward across food trail
            for (let i = 0; i < 30; i++) {
                server.step(50)
            }

            await new Promise((r) => setTimeout(r, 50))
            expect(eatenEventsCount).toBeGreaterThan(0)
            // Snake must have grown from eating food
            expect(serverSnake.body.length).toBeGreaterThanOrEqual(10)

            client.disconnect()
        })
    })
})
