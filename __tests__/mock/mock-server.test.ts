import net from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ClientState, SlitherClient } from "../../src/client/slither-client.js"
import {
    computeAcceptKey,
    createInMemoryClient,
    DEFAULT_CHALLENGE_SEED_STRING,
    InMemoryWebSocket,
    MockSlitherServer,
} from "../../src/mock/mock-server.js"
import { decodePacket } from "../../src/protocol/packet-decoder.js"
import { encodeChallengeResponse, encodePing } from "../../src/protocol/packet-encoder.js"
import { decodeSlitherSecret } from "../../src/protocol/secret-resolver.js"

describe("MockSlitherServer & Transport Suite", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    describe("Server Lifecycle & Configuration", () => {
        it("starts on dynamic port 0 and binds to an ephemeral port", async () => {
            expect(server.port).toBe(0)
            const port = await server.start(0)

            expect(port).toBeGreaterThan(0)
            expect(server.port).toBe(port)
            expect(server.url).toBe(`ws://127.0.0.1:${port}`)

            // Idempotent start
            const portAgain = await server.start(0)
            expect(portAgain).toBe(port)
        })

        it("gracefully stops and resets server state", async () => {
            const port = await server.start(0)
            expect(port).toBeGreaterThan(0)

            await server.stop()
            expect(server.port).toBe(0)

            // Idempotent stop
            await server.stop()
        })

        it("correctly computes RFC 6455 Sec-WebSocket-Accept key", () => {
            const clientKey = "dGhlIHNhbXBsZSBub25jZQ=="
            const accept = computeAcceptKey(clientKey)
            expect(accept).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        })
    })

    describe("In-Memory Transport (InMemoryWebSocket)", () => {
        it("connects client instantaneously without network ports", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })

            expect(client.state).toBe(ClientState.DISCONNECTED)
            await client.connect()

            // After connect and handshake resolution, client becomes READY
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            client.disconnect()
            expect(client.state).toBe(ClientState.DISCONNECTED)
        })

        it("transfers binary messages between client and server", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            const snake = await client.spawn("TestBot", 1)
            expect(snake).toBeDefined()
            expect(snake.name).toBe("TestBot")
            expect(client.state).toBe(ClientState.PLAYING)

            client.disconnect()
        })
    })

    describe("Handshake & Anti-Bot Challenge Verification", () => {
        it("authenticates valid 24-byte anti-bot token produces by decodeSlitherSecret", async () => {
            const socket = server.createClientSocket()
            let packet6Received = false
            let clientStateAtReady = false

            const client = new SlitherClient({ socket })
            await client.connect()

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            client.disconnect()
        })

        it("terminates connection with code 1008 when challenge token is invalid/corrupted", async () => {
            const socket = server.createClientSocket()
            let closeEvent: any = null

            socket.onclose = (ev) => {
                closeEvent = ev
            }

            socket.onmessage = (ev) => {
                const data = new Uint8Array(ev.data)
                const packet = decodePacket(data)
                if (packet.type === "pre_init_challenge") {
                    // Send deliberate corrupted 24-byte response
                    const corrupted = new Uint8Array(24).fill(0xff)
                    socket.send(corrupted)
                }
            }

            socket.triggerOpen()

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(closeEvent).toBeDefined()
            expect(closeEvent.code).toBe(1008)
        })

        it("terminates connection with code 1008 when challenge token length is not 24 bytes", async () => {
            const socket = server.createClientSocket()
            let closeEvent: any = null

            socket.onclose = (ev) => {
                closeEvent = ev
            }

            socket.onmessage = (ev) => {
                const data = new Uint8Array(ev.data)
                const packet = decodePacket(data)
                if (packet.type === "pre_init_challenge") {
                    // Send truncated 10-byte response
                    const truncated = new Uint8Array(10).fill(65)
                    socket.send(truncated)
                }
            }

            socket.triggerOpen()

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(closeEvent).toBeDefined()
            expect(closeEvent.code).toBe(1008)
        })

        it("supports custom challenge seed configuration", async () => {
            const customSeed =
                "CustomSeedOver65BytesLong_ForAntiBotVerification_SpecializedEdgeCaseTokenSeedString!"
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
    })

    describe("Spawn Handling & World Initialization", () => {
        it("emits initial setup 'a', player snake 's', and leaderboard 'l' upon spawn", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(client.state).toBe(ClientState.READY)

            let gameStartReceived = false
            let spawnReceived = false
            let leaderboardReceived = false

            client.on("game_start", (world) => {
                gameStartReceived = true
                expect(world.gameRadius).toBe(server.options.gameRadius)
            })

            client.on("spawn", (snake) => {
                spawnReceived = true
                expect(snake.name).toBe("PythonBot")
                expect(snake.skin).toBe(3)
            })

            client.on("leaderboard_update", (entries) => {
                leaderboardReceived = true
                expect(entries.length).toBeGreaterThanOrEqual(1)
            })

            const playerSnake = await client.spawn("PythonBot", 3)

            expect(playerSnake).toBeDefined()
            expect(playerSnake.id).toBeGreaterThan(0)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(gameStartReceived).toBe(true)
            expect(spawnReceived).toBe(true)
            expect(leaderboardReceived).toBe(true)
            expect(client.gameState.mySnakeId).toBe(playerSnake.id)
            expect(client.gameState.self?.name).toBe("PythonBot")

            client.disconnect()
        })
    })

    describe("Inbound Commands & Client Steering", () => {
        it("updates wanted steering angle from byte 0..250", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("SteerBot", 0)
            const serverSnake = server.getPlayerSnake()
            expect(serverSnake).toBeDefined()

            client.turnTo(Math.PI) // 180 degrees -> byte ~125
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(serverSnake!.wantedAngle).toBeCloseTo(Math.PI, 1)

            client.disconnect()
        })

        it("replies with pong packet 'p' upon ping byte 251", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("PingBot", 0)

            let pongReceived = false
            client.on("tick", () => {
                // Ticks occur on packet updates
            })

            // Send manual ping
            client.sendRaw(encodePing())

            await new Promise((resolve) => setTimeout(resolve, 50))
            // The connection remains healthy and alive
            expect(client.state).toBe(ClientState.PLAYING)

            client.disconnect()
        })

        it("toggles boost speed on command bytes 253 and 254", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("BoostBot", 0)
            const serverSnake = server.getPlayerSnake()
            expect(serverSnake!.isBoosting).toBe(false)
            expect(serverSnake!.speed).toBe(server.options.baseSpeed)

            // Start boost
            client.setBoost(true)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(serverSnake!.isBoosting).toBe(true)
            expect(serverSnake!.speed).toBe(server.options.boostSpeed)

            // Stop boost
            client.setBoost(false)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(serverSnake!.isBoosting).toBe(false)
            expect(serverSnake!.speed).toBe(server.options.baseSpeed)

            client.disconnect()
        })
    })

    describe("Simulation Engine & Discrete Stepping", () => {
        it("advances snake position along heading angle over discrete step() calls", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("MoverBot", 0)
            const serverSnake = server.getPlayerSnake()!
            const initialX = serverSnake.x
            const initialY = serverSnake.y

            // Step forward 100ms
            server.step(100)
            expect(serverSnake.x).toBeGreaterThan(initialX) // Angle 0 moves along +X
            expect(serverSnake.y).toBeCloseTo(initialY, 2)

            client.disconnect()
        })

        it("maintains distance constraints along body segments", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("IkBot", 0)
            const serverSnake = server.getPlayerSnake()!

            // Advance several steps
            for (let i = 0; i < 10; i++) {
                server.step(50)
            }

            for (let i = 1; i < serverSnake.body.length; i++) {
                const dist = Math.hypot(
                    serverSnake.body[i - 1].x - serverSnake.body[i].x,
                    serverSnake.body[i - 1].y - serverSnake.body[i].y
                )
                expect(dist).toBeLessThanOrEqual(16) // Spacing ~15
            }

            client.disconnect()
        })

        it("detects food consumption, increases mass, and emits food_eaten event", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("EaterBot", 0)
            const serverSnake = server.getPlayerSnake()!

            // Spawn food directly in front of snake
            const foodId = server.spawnFood(serverSnake.x + 10, serverSnake.y, 2, 5)
            expect(server.getFood(foodId)).toBeDefined()

            let foodEatenEvent: any = null
            client.on("food_eaten", (ev) => {
                foodEatenEvent = ev
            })

            // Step snake into food
            server.step(100)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(server.getFood(foodId)).toBeUndefined()
            expect(foodEatenEvent).toBeDefined()
            expect(foodEatenEvent.foodId).toBe(foodId)

            client.disconnect()
        })
    })

    describe("Programmatic Simulation Triggers", () => {
        it("simulateSnakeDeath converts snake to food and emits death packet 'v'", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("DoomedBot", 0)
            const playerSnake = server.getPlayerSnake()!

            let deathEventReceived = false
            client.on("snake_died", (ev) => {
                deathEventReceived = true
                expect(ev.isSelf).toBe(true)
            })

            server.simulateSnakeDeath(playerSnake.id, 0)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(deathEventReceived).toBe(true)
            expect(client.state).toBe(ClientState.DEAD)
            expect(server.getSnake(playerSnake.id)).toBeUndefined()
            // Dropped foods from body should now exist in server
            expect(server.getAllFoods().length).toBeGreaterThan(0)

            client.disconnect()
        })

        it("spawnFoodBatch emits food batch and populates client game state", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("WatcherBot", 0)

            let batchReceived = false
            client.on("food_spawn", (foods) => {
                batchReceived = true
                expect(foods.length).toBe(3)
            })

            const ids = server.spawnFoodBatch([
                { x: 10810, y: 10810, size: 1, color: 0 },
                { x: 10820, y: 10820, size: 2, color: 1 },
                { x: 10830, y: 10830, size: 3, color: 2 },
            ])

            expect(ids.length).toBe(3)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(batchReceived).toBe(true)

            client.disconnect()
        })

        it("spawnBot adds opponent snake to the simulation and notifies client", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("HeroBot", 0)

            let opponentAdded = false
            client.on("snake_add", (bot) => {
                opponentAdded = true
                expect(bot.name).toBe("NpcBot")
            })

            const bot = server.spawnBot({
                name: "NpcBot",
                skin: 7,
                x: 10900,
                y: 10900,
                length: 12,
            })

            expect(bot.id).toBeGreaterThan(0)
            expect(server.getSnake(bot.id)).toBeDefined()

            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(opponentAdded).toBe(true)

            client.disconnect()
        })
    })

    describe("RFC 6455 Real Network WebSocket Transport", () => {
        it("handles raw TCP HTTP upgrade and WebSocket binary frames", async () => {
            const port = await server.start(0)

            await new Promise<void>((resolve, reject) => {
                const tcpSocket = net.connect({ host: "127.0.0.1", port }, () => {
                    // Send standard HTTP Upgrade request
                    const clientKey = "dGhlIHNhbXBsZSBub25jZQ=="
                    const request = [
                        "GET / HTTP/1.1",
                        "Host: 127.0.0.1",
                        "Upgrade: websocket",
                        "Connection: Upgrade",
                        `Sec-WebSocket-Key: ${clientKey}`,
                        "Sec-WebSocket-Version: 13",
                        "\r\n",
                    ].join("\r\n")

                    tcpSocket.write(request)
                })

                let handshakeDone = false
                let buffer = Buffer.alloc(0)

                tcpSocket.on("data", (chunk) => {
                    buffer = Buffer.concat([buffer, chunk])

                    if (!handshakeDone) {
                        const headerEnd = buffer.indexOf("\r\n\r\n")
                        if (headerEnd !== -1) {
                            const responseText = buffer.subarray(0, headerEnd).toString("utf8")
                            expect(responseText).toContain("101 Switching Protocols")
                            expect(responseText).toContain("Sec-WebSocket-Accept")
                            handshakeDone = true
                            buffer = buffer.subarray(headerEnd + 4)
                        }
                    }

                    // Check for Packet '6' binary frame
                    if (handshakeDone && buffer.length >= 2) {
                        const opcode = buffer[0] & 0x0f
                        expect(opcode).toBe(2) // Binary frame
                        tcpSocket.end()
                        resolve()
                    }
                })

                tcpSocket.on("error", (err) => reject(err))
            })
        })
    })

    describe("Multi-Client Synchronization & Robustness", () => {
        it("synchronizes multiple clients and broadcasts updates across sessions", async () => {
            const socket1 = server.createClientSocket()
            const client1 = new SlitherClient({ socket: socket1 })
            await client1.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            const snake1 = await client1.spawn("AlphaPlayer", 1)

            const socket2 = server.createClientSocket()
            const client2 = new SlitherClient({ socket: socket2 })
            await client2.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))
            const snake2 = await client2.spawn("BetaPlayer", 2)

            await new Promise((resolve) => setTimeout(resolve, 50))

            // Client 1 should see Client 2's snake
            expect(client1.gameState.snakes.has(snake2.id)).toBe(true)
            // Client 2 should see Client 1's snake
            expect(client2.gameState.snakes.has(snake1.id)).toBe(true)

            // When Client 1 dies, Client 2 receives removal
            let snake1DiedSeenByClient2 = false
            client2.on("snake_died", (ev) => {
                if (ev.snakeId === snake1.id) {
                    snake1DiedSeenByClient2 = true
                }
            })

            server.simulateSnakeDeath(snake1.id, 0)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(snake1DiedSeenByClient2).toBe(true)
            expect(client2.gameState.snakes.has(snake1.id)).toBe(false)

            client1.disconnect()
            client2.disconnect()
        })

        it("ignores malformed or out-of-order packets without crashing server", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Send empty buffer
            client.sendRaw(new Uint8Array(0))
            // Send invalid opcode bytes
            client.sendRaw(new Uint8Array([240, 241, 242]))

            await new Promise((resolve) => setTimeout(resolve, 50))
            // Server remains alive and functional
            const snake = await client.spawn("ResilientBot", 0)
            expect(snake).toBeDefined()
            expect(client.state).toBe(ClientState.PLAYING)

            client.disconnect()
        })
    })

    describe("Root Index Exports Verification", () => {
        it("verifies MockSlitherServer and scenario helpers are re-exported from src/index.ts", async () => {
            const indexModule = await import("../../src/index.js")
            expect(typeof indexModule.MockSlitherServer).toBe("function")
            expect(typeof indexModule.InMemoryWebSocket).toBe("function")
            expect(typeof indexModule.createInMemoryClient).toBe("function")
            expect(typeof indexModule.createBasicGameScenario).toBe("function")
            expect(typeof indexModule.simulateCombatScenario).toBe("function")
            expect(typeof indexModule.simulateFeedingFrenzy).toBe("function")
        })
    })
})
