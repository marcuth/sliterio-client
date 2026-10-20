/**
 * @file mock-server.ts
 * @description Standalone RFC 6455 WebSocket mock server & in-memory test harness for Slither.io.
 */

import { createHash, randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import http from "node:http"
import net from "node:net"

import { WebSocketLike } from "../client/slither-client.js"
import { angleDifference, normalizeAngle } from "../math/vector.js"
import { BinaryWriter } from "../protocol/binary-writer.js"
import { decodeSlitherSecret } from "../protocol/secret-resolver.js"
import { calcFoodId, OutboundCommand } from "../protocol/types.js"

const RFC6455_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

export const DEFAULT_CHALLENGE_SEED_STRING =
    "SlitherProtocol11_AntiBotChallengeRiddleSeed_DeterministicMockVerificationToken!"

export interface MockServerOptions {
    /** Tick duration in milliseconds for auto-ticking (default: 50 ms = 20 Hz) */
    tickIntervalMs?: number
    /** Whether to automatically run the tick timer on start (default: true) */
    autoTick?: boolean
    /** Circular arena radius (default: 21600) */
    gameRadius?: number
    /** Milliseconds per cycle physics scale (default: 411) */
    mscps?: number
    /** Angular turn speed in radians per second (default: 3.5 rad/s) */
    turnSpeed?: number
    /** Base cruising speed in world units per second (default: 115.6 units/s) */
    baseSpeed?: number
    /** Boost acceleration speed in world units per second (default: 230 units/s) */
    boostSpeed?: number
    /** Custom anti-bot challenge seed string (minimum 65 bytes) */
    challengeSeed?: string
}

export interface SimulatedSnake {
    id: number
    name: string
    skin: number
    x: number
    y: number
    angle: number
    wantedAngle: number
    speed: number
    speedByte: number
    isBoosting: boolean
    isDead: boolean
    fullness: number
    body: Array<{ x: number; y: number }>
    boostTimer: number
    ownerSession?: MockServerSession
}

export interface SimulatedFood {
    id: number
    x: number
    y: number
    size: number
    color: number
    isTurbo: boolean
}

export interface SimulatedPrey {
    id: number
    x: number
    y: number
    color: number
    size: number
    speed: number
    angle: number
}

// ---------------------------------------------------------------------------
// Binary Packet Encoders for Mock Server Broadcasts
// ---------------------------------------------------------------------------

function createPacketWriter(opcode: string, timeDelta: number = 0): BinaryWriter {
    return new BinaryWriter().writeUint16(timeDelta & 0xffff).writeUint8(opcode.charCodeAt(0))
}

export function encodeInitialSetup(radius: number = 21600, mscps: number = 411, sectorSize: number = 300): Uint8Array {
    return createPacketWriter("a", 0)
        .writeUint24(radius)
        .writeUint16(mscps)
        .writeUint16(sectorSize)
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
}

export function encodeSnakeAdd(snake: SimulatedSnake, timeDelta: number = 0): Uint8Array {
    const angleByte = Math.floor((normalizeAngle(snake.angle) / (Math.PI * 2)) * 256) & 0xff
    const wantedByte = Math.floor((normalizeAngle(snake.wantedAngle) / (Math.PI * 2)) * 256) & 0xff

    const writer = createPacketWriter("s", timeDelta)
        .writeUint16(snake.id)
        .writeUint8(snake.skin)
        .writeUint24(Math.round(snake.x * 5) & 0xffffff)
        .writeUint24(Math.round(snake.y * 5) & 0xffffff)
        .writeString8(snake.name)
        .writeUint8(angleByte)
        .writeUint8(wantedByte)
        .writeUint8(snake.speedByte & 0xff)
        .writeUint16(Math.round(snake.fullness) & 0xffff)

    for (let i = 1; i < snake.body.length; i++) {
        writer.writeUint16(Math.round(snake.body[i].x) & 0xffff)
        writer.writeUint16(Math.round(snake.body[i].y) & 0xffff)
    }

    return writer.toUint8Array()
}

export function encodeSnakeRemove(snakeId: number, died: boolean = true, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("s", timeDelta)
        .writeUint16(snakeId)
        .writeUint8(died ? 1 : 0)
        .toUint8Array()
}

export function encodeMoveSnake(snakeId: number, x: number, y: number, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("g", timeDelta)
        .writeUint16(snakeId)
        .writeUint16(Math.round(x) & 0xffff)
        .writeUint16(Math.round(y) & 0xffff)
        .toUint8Array()
}

export function encodeRotateSnake(
    snakeId: number,
    angle: number,
    wantedAngle: number,
    speed: number,
    timeDelta: number = 0,
): Uint8Array {
    const angleByte = Math.floor((normalizeAngle(angle) / (Math.PI * 2)) * 256) & 0xff
    const wantedByte = Math.floor((normalizeAngle(wantedAngle) / (Math.PI * 2)) * 256) & 0xff
    return createPacketWriter("e", timeDelta)
        .writeUint16(snakeId)
        .writeUint8(angleByte)
        .writeUint8(wantedByte)
        .writeUint8(Math.round(speed) & 0xff)
        .toUint8Array()
}

export function encodeSnakeGrow(snakeId: number, x: number, y: number, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("n", timeDelta)
        .writeUint16(snakeId)
        .writeUint16(Math.round(x) & 0xffff)
        .writeUint16(Math.round(y) & 0xffff)
        .toUint8Array()
}

export function encodeSnakeFullness(snakeId: number, fam: number, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("h", timeDelta)
        .writeUint16(snakeId)
        .writeUint16(Math.round(fam) & 0xffff)
        .toUint8Array()
}

export function encodeFoodSpawnNatural(food: SimulatedFood, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("f", timeDelta)
        .writeUint8(food.color & 0xff)
        .writeUint16(Math.round(food.x))
        .writeUint16(Math.round(food.y))
        .writeUint8(food.size & 0xff)
        .toUint8Array()
}

export function encodeFoodSpawnTurbo(food: SimulatedFood, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("b", timeDelta)
        .writeUint8(food.color & 0xff)
        .writeUint16(Math.round(food.x))
        .writeUint16(Math.round(food.y))
        .writeUint8(food.size & 0xff)
        .toUint8Array()
}

export function encodeFoodBatch(foods: SimulatedFood[], timeDelta: number = 0): Uint8Array {
    const writer = createPacketWriter("F", timeDelta)
    for (const food of foods) {
        writer
            .writeUint8(food.color & 0xff)
            .writeUint16(Math.round(food.x))
            .writeUint16(Math.round(food.y))
            .writeUint8(food.size & 0xff)
    }
    return writer.toUint8Array()
}

export function encodeFoodEaten(x: number, y: number, eaterSnakeId?: number, timeDelta: number = 0): Uint8Array {
    const writer = createPacketWriter("c", timeDelta).writeUint16(Math.round(x)).writeInt16(Math.round(y))
    if (eaterSnakeId !== undefined) {
        writer.writeUint16(eaterSnakeId & 0xffff)
    }
    return writer.toUint8Array()
}

export function encodePreyAdd(prey: SimulatedPrey, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("y", timeDelta)
        .writeUint16(prey.id)
        .writeUint8(prey.color & 0xff)
        .writeUint16(Math.round(prey.x))
        .writeUint16(Math.round(prey.y))
        .writeUint8(prey.size & 0xff)
        .toUint8Array()
}

export function encodePreyUpdate(
    preyId: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    timeDelta: number = 0,
): Uint8Array {
    const angleByte = Math.floor((normalizeAngle(angle) / (Math.PI * 2)) * 256) & 0xff
    return createPacketWriter("j", timeDelta)
        .writeUint16(preyId)
        .writeUint16(Math.round(x))
        .writeUint16(Math.round(y))
        .writeUint8(angleByte)
        .writeUint8(Math.round(speed) & 0xff)
        .toUint8Array()
}

export function encodePreyRemove(preyId: number, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("y", timeDelta).writeUint16(preyId).toUint8Array()
}

export function encodeLeaderboard(
    entries: Array<{ rank: number; score: number; fam: number; nickname: string }>,
    localInTop10: boolean = true,
    localRank: number = 1,
    totalSnakes: number = 1,
    timeDelta: number = 0,
): Uint8Array {
    const writer = createPacketWriter("l", timeDelta)
        .writeUint8(localInTop10 ? 1 : 0)
        .writeUint16(localRank)
        .writeUint16(totalSnakes)

    for (const entry of entries) {
        writer
            .writeUint16(entry.score)
            .writeUint8(entry.fam & 0xff)
            .writeString8(entry.nickname)
    }

    return writer.toUint8Array()
}

export function encodePlayerDeath(reason: number = 0, timeDelta: number = 0): Uint8Array {
    return createPacketWriter("v", timeDelta)
        .writeUint8(reason & 0xff)
        .toUint8Array()
}

export function encodePong(timeDelta: number = 0): Uint8Array {
    return createPacketWriter("p", timeDelta).toUint8Array()
}

// ---------------------------------------------------------------------------
// RFC 6455 Frame & Transport Utilities
// ---------------------------------------------------------------------------

export function computeAcceptKey(clientKey: string): string {
    return createHash("sha1")
        .update(clientKey + RFC6455_MAGIC_GUID)
        .digest("base64")
}

/**
 * Low-level RFC 6455 socket connection wrapper over Node.js net.Socket.
 */
export class WebSocketConnection extends EventEmitter {
    private socket: net.Socket
    private buffer: Buffer = Buffer.alloc(0)
    private isClosed: boolean = false

    constructor(socket: net.Socket) {
        super()
        this.socket = socket
        this.socket.on("data", (chunk: Buffer) => this.onData(chunk))
        this.socket.on("end", () => {
            this.socket.end()
        })
        this.socket.on("close", () => {
            if (!this.isClosed) {
                this.isClosed = true
                this.emit("close", { code: 1006, reason: "Abrupt closure", wasClean: false })
            }
        })
        this.socket.on("error", (err: Error) => {
            if (this.listenerCount("error") > 0) {
                this.emit("error", err)
            }
        })
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk])

        while (this.buffer.length >= 2) {
            const b0 = this.buffer[0]
            const b1 = this.buffer[1]

            const opcode = b0 & 0x0f
            const isMasked = (b1 & 0x80) !== 0
            let payloadLen = b1 & 0x7f
            let headerOffset = 2

            if (payloadLen === 126) {
                if (this.buffer.length < 4) return
                payloadLen = this.buffer.readUInt16BE(2)
                headerOffset = 4
            } else if (payloadLen === 127) {
                if (this.buffer.length < 10) return
                payloadLen = Number(this.buffer.readBigUInt64BE(2))
                headerOffset = 10
            }

            let maskKey: Buffer | null = null
            if (isMasked) {
                if (this.buffer.length < headerOffset + 4) return
                maskKey = this.buffer.subarray(headerOffset, headerOffset + 4)
                headerOffset += 4
            }

            const totalFrameLen = headerOffset + payloadLen
            if (this.buffer.length < totalFrameLen) {
                return
            }

            const rawPayload = this.buffer.subarray(headerOffset, totalFrameLen)
            const payload = Buffer.allocUnsafe(payloadLen)

            if (isMasked && maskKey) {
                for (let i = 0; i < payloadLen; i++) {
                    payload[i] = rawPayload[i] ^ maskKey[i % 4]
                }
            } else {
                rawPayload.copy(payload)
            }

            this.buffer = this.buffer.subarray(totalFrameLen)
            this.handleFrame(opcode, payload)
        }
    }

    private handleFrame(opcode: number, payload: Buffer): void {
        switch (opcode) {
            case 0x1: // Text Frame
            case 0x2: // Binary Frame
                this.emit("message", new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
                break

            case 0x8: {
                // Close Frame
                let code = 1000
                let reason = ""
                if (payload.length >= 2) {
                    code = payload.readUInt16BE(0)
                    if (payload.length > 2) {
                        reason = payload.subarray(2).toString("utf8")
                    }
                }
                this.sendCloseFrame(code, reason)
                this.isClosed = true
                this.socket.end()
                this.emit("close", { code, reason, wasClean: true })
                break
            }

            case 0x9: // Ping Frame
                this.sendPongFrame(payload)
                break

            case 0xa: // Pong Frame
                this.emit("pong", payload)
                break

            default:
                break
        }
    }

    public sendBinary(data: Uint8Array): void {
        if (this.isClosed || !this.socket.writable) return

        const len = data.length
        let header: Buffer

        if (len < 126) {
            header = Buffer.alloc(2)
            header[0] = 0x82 // FIN = 1, Opcode = 2
            header[1] = len // MASK = 0
        } else if (len <= 65535) {
            header = Buffer.alloc(4)
            header[0] = 0x82
            header[1] = 126
            header.writeUInt16BE(len, 2)
        } else {
            header = Buffer.alloc(10)
            header[0] = 0x82
            header[1] = 127
            header.writeBigUInt64BE(BigInt(len), 2)
        }

        this.socket.write(Buffer.concat([header, Buffer.from(data)]))
    }

    public sendCloseFrame(code: number = 1000, reason: string = ""): void {
        if (!this.socket.writable) return

        const reasonBuf = Buffer.from(reason, "utf8")
        const payloadLen = 2 + reasonBuf.length
        let header: Buffer

        if (payloadLen < 126) {
            header = Buffer.alloc(2)
            header[0] = 0x88 // FIN = 1, Opcode = 8
            header[1] = payloadLen
        } else {
            header = Buffer.alloc(4)
            header[0] = 0x88
            header[1] = 126
            header.writeUInt16BE(payloadLen, 2)
        }

        const payload = Buffer.alloc(payloadLen)
        payload.writeUInt16BE(code, 0)
        if (reasonBuf.length > 0) {
            reasonBuf.copy(payload, 2)
        }

        this.socket.write(Buffer.concat([header, payload]))
    }

    public sendPongFrame(payload: Buffer): void {
        if (!this.socket.writable) return
        const header = Buffer.from([0x8a, payload.length])
        this.socket.write(Buffer.concat([header, payload]))
    }

    public terminate(code: number = 1008, reason: string = "Policy Violation"): void {
        if (this.isClosed) return
        this.isClosed = true
        this.sendCloseFrame(code, reason)
        this.socket.destroy()
        this.emit("close", { code, reason, wasClean: false })
    }

    public destroy(): void {
        this.isClosed = true
        this.socket.destroy()
    }
}

// ---------------------------------------------------------------------------
// In-Memory WebSocket Adapter
// ---------------------------------------------------------------------------

export class InMemoryWebSocket implements WebSocketLike {
    public readyState: number = 0 // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
    public binaryType: string = "arraybuffer"
    private _onopen: ((event?: any) => void) | null = null
    public onclose: ((event?: any) => void) | null = null
    public onmessage: ((event: { data: any }) => void) | null = null
    public onerror: ((event: any) => void) | null = null

    private _session: MockServerSession | null = null

    public get onopen(): ((event?: any) => void) | null {
        return this._onopen
    }

    public set onopen(callback: ((event?: any) => void) | null) {
        this._onopen = callback
        if (callback && this.readyState === 0) {
            queueMicrotask(() => {
                if (this.readyState === 0) {
                    this.triggerOpen()
                }
            })
        }
    }

    public bindSession(session: MockServerSession): void {
        this._session = session
    }

    public send(data: any): void {
        if (this.readyState !== 1) {
            return
        }
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
        if (this._session) {
            this._session.handleClientMessage(bytes)
        }
    }

    public close(code: number = 1000, reason: string = "Normal Closure"): void {
        if (this.readyState === 3) return
        this.readyState = 3
        if (this._session) {
            this._session.handleClientClose(code, reason)
        }
        queueMicrotask(() => {
            if (this.onclose) {
                this.onclose({ code, reason, wasClean: true })
            }
        })
    }

    public deliverServerPacket(packet: Uint8Array): void {
        if (this.readyState === 1 && this.onmessage) {
            const ab = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength)
            queueMicrotask(() => {
                if (this.readyState === 1 && this.onmessage) {
                    this.onmessage({ data: ab })
                }
            })
        }
    }

    public serverTerminate(code: number, reason: string): void {
        this.readyState = 3
        queueMicrotask(() => {
            if (this.onclose) {
                this.onclose({ code, reason, wasClean: false })
            }
        })
    }

    public triggerOpen(): void {
        if (this.readyState === 3) return
        this.readyState = 1
        if (this._session) {
            this._session.onConnectionOpen()
        }
        if (this._onopen) {
            this._onopen()
        }
    }
}

/**
 * Creates an instantaneous in-memory WebSocket client attached to the given MockSlitherServer.
 */
export function createInMemoryClient(server: MockSlitherServer): InMemoryWebSocket {
    return server.createClientSocket()
}

// ---------------------------------------------------------------------------
// Server Session Layer (Unified State Machine for Network and In-Memory)
// ---------------------------------------------------------------------------

export type SessionState = "AWAITING_CHALLENGE" | "HANDSHAKE_VERIFIED" | "PLAYING" | "DEAD" | "CLOSED"

export class MockServerSession {
    public readonly id: number
    public readonly server: MockSlitherServer
    public state: SessionState = "AWAITING_CHALLENGE"
    public playerSnake?: SimulatedSnake

    private networkConn?: WebSocketConnection
    private inMemoryWs?: InMemoryWebSocket
    private expectedToken: Uint8Array

    constructor(
        id: number,
        server: MockSlitherServer,
        transport: { networkConn?: WebSocketConnection; inMemoryWs?: InMemoryWebSocket },
    ) {
        this.id = id
        this.server = server
        this.networkConn = transport.networkConn
        this.inMemoryWs = transport.inMemoryWs

        // Compute expected token from server challenge seed
        const seedBytes = Buffer.from(this.server.challengeSeed, "utf8")
        this.expectedToken = decodeSlitherSecret(seedBytes)

        if (this.networkConn) {
            this.networkConn.on("message", (msg: Uint8Array) => this.handleClientMessage(msg))
            this.networkConn.on("close", (ev: { code: number; reason: string }) =>
                this.handleClientClose(ev.code, ev.reason),
            )
        }
    }

    public onConnectionOpen(): void {
        // Immediately transmit Packet '6' (Anti-Bot Challenge)
        const seedBytes = Buffer.from(this.server.challengeSeed, "utf8")
        const packet = new Uint8Array(3 + seedBytes.length)
        packet[0] = 0 // Timestamp high
        packet[1] = 0 // Timestamp low
        packet[2] = 54 // Opcode '6'
        packet.set(seedBytes, 3)

        this.sendPacket(packet)
    }

    public sendPacket(packet: Uint8Array): void {
        if (this.state === "CLOSED") return

        if (this.inMemoryWs) {
            this.inMemoryWs.deliverServerPacket(packet)
        } else if (this.networkConn) {
            this.networkConn.sendBinary(packet)
        }
    }

    public terminate(code: number, reason: string): void {
        this.state = "CLOSED"
        if (this.inMemoryWs) {
            this.inMemoryWs.serverTerminate(code, reason)
        } else if (this.networkConn) {
            this.networkConn.terminate(code, reason)
        }
        this.server.removeSession(this.id)
    }

    public handleClientClose(_code: number, _reason: string): void {
        this.state = "CLOSED"
        if (this.playerSnake && !this.playerSnake.isDead) {
            this.server.simulateSnakeDeath(this.playerSnake.id, 2)
        }
        this.server.removeSession(this.id)
    }

    public handleClientMessage(data: Uint8Array): void {
        if (this.state === "CLOSED" || data.length === 0) return

        // 1. Anti-bot Challenge Validation Phase
        if (this.state === "AWAITING_CHALLENGE") {
            if (data.length !== 24) {
                this.terminate(1008, "Policy Violation: Anti-bot challenge response length must be 24 bytes")
                return
            }

            for (let i = 0; i < 24; i++) {
                if (data[i] !== this.expectedToken[i]) {
                    this.terminate(1008, "Policy Violation: Anti-bot challenge secret mismatch")
                    return
                }
            }

            this.state = "HANDSHAKE_VERIFIED"
            return
        }

        const firstByte = data[0]

        // 2. Player Spawn Packet 115 ('s')
        if (firstByte === OutboundCommand.SPAWN) {
            const skinId = data.length >= 3 ? data[2] : 0
            const nickname = data.length > 3 ? Buffer.from(data.subarray(3)).toString("utf8") : "slither-bot"

            this.handleSpawn(nickname, skinId)
            return
        }

        // 3. In-Game Inbound Commands
        if (this.state === "PLAYING" && this.playerSnake && !this.playerSnake.isDead) {
            // Steering Angle: 0..250
            if (firstByte <= 250) {
                this.playerSnake.wantedAngle = (firstByte / 250) * Math.PI * 2
                return
            }

            // Ping: 251 -> Pong 'p'
            if (firstByte === OutboundCommand.PING) {
                this.sendPacket(encodePong())
                return
            }

            // Key Steer: 252
            if (firstByte === OutboundCommand.KEY_STEER && data.length >= 2) {
                const flag = data[1]
                if (flag === 0) {
                    this.playerSnake.wantedAngle = this.playerSnake.angle
                } else if (flag === 1) {
                    this.playerSnake.wantedAngle = normalizeAngle(this.playerSnake.angle - Math.PI / 2)
                } else if (flag === 2) {
                    this.playerSnake.wantedAngle = normalizeAngle(this.playerSnake.angle + Math.PI / 2)
                }
                return
            }

            // Boost Start: 253
            if (firstByte === OutboundCommand.BOOST_START) {
                if (!this.playerSnake.isBoosting && this.playerSnake.body.length > 2) {
                    this.playerSnake.isBoosting = true
                    this.playerSnake.speed = this.server.options.boostSpeed!
                    this.playerSnake.speedByte = 115
                    this.server.broadcast(
                        encodeRotateSnake(
                            this.playerSnake.id,
                            this.playerSnake.angle,
                            this.playerSnake.wantedAngle,
                            this.playerSnake.speedByte,
                        ),
                    )
                }
                return
            }

            // Boost Stop: 254
            if (firstByte === OutboundCommand.BOOST_STOP) {
                if (this.playerSnake.isBoosting) {
                    this.playerSnake.isBoosting = false
                    this.playerSnake.speed = this.server.options.baseSpeed!
                    this.playerSnake.speedByte = 58
                    this.server.broadcast(
                        encodeRotateSnake(
                            this.playerSnake.id,
                            this.playerSnake.angle,
                            this.playerSnake.wantedAngle,
                            this.playerSnake.speedByte,
                        ),
                    )
                }
                return
            }
        }
    }

    private handleSpawn(nickname: string, skinId: number): void {
        const snakeId = this.server.getNextSnakeId()
        const startX = this.server.options.gameRadius! / 2
        const startY = this.server.options.gameRadius! / 2

        const body: Array<{ x: number; y: number }> = []
        for (let i = 0; i < 10; i++) {
            body.push({ x: startX - i * 15, y: startY })
        }

        const snake: SimulatedSnake = {
            id: snakeId,
            name: nickname || "slither-bot",
            skin: skinId,
            x: startX,
            y: startY,
            angle: 0,
            wantedAngle: 0,
            speed: this.server.options.baseSpeed!,
            speedByte: 58,
            isBoosting: false,
            isDead: false,
            fullness: 0,
            body,
            boostTimer: 0,
            ownerSession: this,
        }

        this.playerSnake = snake
        this.server.addSnake(snake)
        this.state = "PLAYING"

        // 1. Initial Setup Packet 'a'
        this.sendPacket(encodeInitialSetup(this.server.options.gameRadius, this.server.options.mscps))

        // 2. Add Player Snake Packet 's'
        this.sendPacket(encodeSnakeAdd(snake))

        // 3. Initial Leaderboard Packet 'l'
        this.sendPacket(
            encodeLeaderboard(
                [{ rank: 1, score: 100, fam: 0, nickname: snake.name }],
                true,
                1,
                this.server.getSnakeCount(),
            ),
        )

        // 4. Synchronize all other existing snakes to this new client
        for (const other of this.server.getAllSnakes()) {
            if (other.id !== snakeId && !other.isDead) {
                this.sendPacket(encodeSnakeAdd(other))
            }
        }

        // 5. Synchronize existing foods to this new client
        const allFoods = this.server.getAllFoods()
        if (allFoods.length > 5) {
            this.sendPacket(encodeFoodBatch(allFoods))
        } else {
            for (const food of allFoods) {
                this.sendPacket(encodeFoodSpawnNatural(food))
            }
        }

        // 6. Broadcast this new player snake to all other clients
        this.server.broadcastExcept(encodeSnakeAdd(snake), this.id)
    }
}

// ---------------------------------------------------------------------------
// MockSlitherServer Main Class
// ---------------------------------------------------------------------------

export class MockSlitherServer {
    public readonly options: Required<MockServerOptions>
    public readonly challengeSeed: string

    private httpServer: http.Server | null = null
    private boundPort: number = 0
    private sessions: Map<number, MockServerSession> = new Map()
    private nextSessionId: number = 1
    private nextSnakeIdCounter: number = 1
    private nextPreyIdCounter: number = 1
    private snakes: Map<number, SimulatedSnake> = new Map()
    private foods: Map<number, SimulatedFood> = new Map()
    private preys: Map<number, SimulatedPrey> = new Map()
    private tickTimer: NodeJS.Timeout | null = null
    private isRunning: boolean = false

    constructor(options: MockServerOptions = {}) {
        this.challengeSeed = options.challengeSeed ?? DEFAULT_CHALLENGE_SEED_STRING
        this.options = {
            tickIntervalMs: options.tickIntervalMs ?? 50,
            autoTick: options.autoTick ?? true,
            gameRadius: options.gameRadius ?? 21600,
            mscps: options.mscps ?? 411,
            turnSpeed: options.turnSpeed ?? 3.5,
            baseSpeed: options.baseSpeed ?? 115.6,
            boostSpeed: options.boostSpeed ?? 230,
            challengeSeed: this.challengeSeed,
        }
    }

    public get url(): string {
        return `ws://127.0.0.1:${this.boundPort}`
    }

    public get port(): number {
        return this.boundPort
    }

    public getNextSnakeId(): number {
        return this.nextSnakeIdCounter++
    }

    public getNextPreyId(): number {
        return this.nextPreyIdCounter++
    }

    public addSnake(snake: SimulatedSnake): void {
        this.snakes.set(snake.id, snake)
    }

    public getSnake(snakeId: number): SimulatedSnake | undefined {
        return this.snakes.get(snakeId)
    }

    public getAllSnakes(): SimulatedSnake[] {
        return Array.from(this.snakes.values())
    }

    public getSnakeCount(): number {
        return this.snakes.size
    }

    public getFood(foodId: number): SimulatedFood | undefined {
        return this.foods.get(foodId)
    }

    public getAllFoods(): SimulatedFood[] {
        return Array.from(this.foods.values())
    }

    public getPlayerSnake(sessionIdOrSocket?: any): SimulatedSnake | undefined {
        if (typeof sessionIdOrSocket === "number") {
            return this.sessions.get(sessionIdOrSocket)?.playerSnake
        }
        for (const session of this.sessions.values()) {
            if (session.playerSnake) {
                return session.playerSnake
            }
        }
        return undefined
    }

    public removeSession(sessionId: number): void {
        this.sessions.delete(sessionId)
    }

    // -----------------------------------------------------------------------
    // Transport & Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Creates an in-memory client socket connected to this mock server.
     */
    public createClientSocket(): InMemoryWebSocket {
        const inMemoryWs = new InMemoryWebSocket()
        const sessionId = this.nextSessionId++
        const session = new MockServerSession(sessionId, this, { inMemoryWs })
        inMemoryWs.bindSession(session)
        this.sessions.set(sessionId, session)

        if (this.options.autoTick && !this.isRunning) {
            this.startTickLoop()
        }

        return inMemoryWs
    }

    /**
     * Starts the RFC 6455 WebSocket HTTP server on a specified port (default 0 = ephemeral dynamic port).
     */
    public start(port: number = 0): Promise<number> {
        return new Promise((resolve, reject) => {
            if (this.httpServer) {
                return resolve(this.boundPort)
            }

            const server = http.createServer((_req, res) => {
                res.writeHead(200, { "Content-Type": "text/plain" })
                res.end("Slither.io Mock WebSocket Server")
            })

            server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket) => {
                const upgrade = req.headers.upgrade
                if (!upgrade || upgrade.toLowerCase() !== "websocket") {
                    socket.destroy()
                    return
                }

                const clientKey = req.headers["sec-websocket-key"]
                if (!clientKey) {
                    socket.destroy()
                    return
                }

                const acceptKey = computeAcceptKey(clientKey)
                const responseHeaders = [
                    "HTTP/1.1 101 Switching Protocols",
                    "Upgrade: websocket",
                    "Connection: Upgrade",
                    `Sec-WebSocket-Accept: ${acceptKey}`,
                    "\r\n",
                ].join("\r\n")

                socket.write(responseHeaders)

                const conn = new WebSocketConnection(socket)
                const sessionId = this.nextSessionId++
                const session = new MockServerSession(sessionId, this, { networkConn: conn })
                this.sessions.set(sessionId, session)

                session.onConnectionOpen()
            })

            server.on("error", (err: Error) => {
                reject(err)
            })

            server.listen(port, "127.0.0.1", () => {
                const addr = server.address()
                if (addr && typeof addr === "object") {
                    this.boundPort = addr.port
                } else {
                    this.boundPort = port
                }
                this.httpServer = server
                this.isRunning = true

                if (this.options.autoTick) {
                    this.startTickLoop()
                }

                resolve(this.boundPort)
            })
        })
    }

    /**
     * Stops the mock server, closes all sessions and timers.
     */
    public stop(): Promise<void> {
        this.stopTickLoop()

        // Terminate all sessions
        for (const session of Array.from(this.sessions.values())) {
            session.terminate(1000, "Server shutdown")
        }
        this.sessions.clear()
        this.snakes.clear()
        this.foods.clear()
        this.preys.clear()

        return new Promise((resolve) => {
            if (!this.httpServer) {
                this.isRunning = false
                return resolve()
            }

            this.httpServer.close(() => {
                this.httpServer = null
                this.boundPort = 0
                this.isRunning = false
                resolve()
            })
        })
    }

    // -----------------------------------------------------------------------
    // Broadcasting Helpers
    // -----------------------------------------------------------------------

    public broadcast(packet: Uint8Array): void {
        for (const session of this.sessions.values()) {
            session.sendPacket(packet)
        }
    }

    public broadcastExcept(packet: Uint8Array, excludeSessionId: number): void {
        for (const session of this.sessions.values()) {
            if (session.id !== excludeSessionId) {
                session.sendPacket(packet)
            }
        }
    }

    public broadcastLeaderboard(): void {
        const sortedSnakes = Array.from(this.snakes.values())
            .filter((s) => !s.isDead)
            .sort((a, b) => b.body.length * 10 + b.fullness - (a.body.length * 10 + a.fullness))

        const entries = sortedSnakes.slice(0, 10).map((s, idx) => ({
            rank: idx + 1,
            score: s.body.length * 10 + Math.floor(s.fullness / 10),
            fam: Math.floor(s.fullness),
            nickname: s.name,
        }))

        for (const session of this.sessions.values()) {
            const playerSnake = session.playerSnake
            let localRank = 1
            let localInTop10 = false
            if (playerSnake) {
                const pIdx = sortedSnakes.findIndex((s) => s.id === playerSnake.id)
                if (pIdx !== -1) {
                    localRank = pIdx + 1
                    localInTop10 = localRank <= 10
                }
            }
            session.sendPacket(encodeLeaderboard(entries, localInTop10, localRank, sortedSnakes.length))
        }
    }

    // -----------------------------------------------------------------------
    // Programmatic Simulation & Control APIs
    // -----------------------------------------------------------------------

    /**
     * Advances simulation physics by dtMs milliseconds.
     */
    public step(dtMs: number = this.options.tickIntervalMs): void {
        const dtSec = dtMs / 1000

        // 1. Update Snakes
        for (const snake of Array.from(this.snakes.values())) {
            if (snake.isDead) continue

            // Heading interpolation
            if (snake.angle !== snake.wantedAngle) {
                const diff = angleDifference(snake.wantedAngle, snake.angle)
                const maxTurn = this.options.turnSpeed * dtSec
                if (Math.abs(diff) <= maxTurn) {
                    snake.angle = snake.wantedAngle
                } else {
                    snake.angle = normalizeAngle(snake.angle + Math.sign(diff) * maxTurn)
                }

                this.broadcast(encodeRotateSnake(snake.id, snake.angle, snake.wantedAngle, snake.speedByte))
            }

            // Head position update
            const vx = snake.speed * Math.cos(snake.angle)
            const vy = snake.speed * Math.sin(snake.angle)
            snake.x += vx * dtSec
            snake.y += vy * dtSec
            snake.body[0] = { x: snake.x, y: snake.y }

            // Body segments following (IK constraint spacing ~15)
            const spacing = 15
            for (let i = 1; i < snake.body.length; i++) {
                const prev = snake.body[i - 1]
                const curr = snake.body[i]
                const dx = prev.x - curr.x
                const dy = prev.y - curr.y
                const dist = Math.hypot(dx, dy)
                if (dist > spacing) {
                    const ratio = spacing / dist
                    curr.x = prev.x - dx * ratio
                    curr.y = prev.y - dy * ratio
                }
            }

            // Broadcast movement packet 'g'
            this.broadcast(encodeMoveSnake(snake.id, snake.x, snake.y))

            // Boost mass shedding
            if (snake.isBoosting) {
                snake.boostTimer += dtMs
                if (snake.boostTimer >= 200) {
                    snake.boostTimer = 0
                    const tail = snake.body[snake.body.length - 1]
                    const droppedFood = this.createFoodEntity(
                        Math.round(tail.x),
                        Math.round(tail.y),
                        1,
                        snake.skin % 30,
                        true,
                    )
                    this.foods.set(droppedFood.id, droppedFood)
                    this.broadcast(encodeFoodSpawnTurbo(droppedFood))

                    snake.fullness -= 25
                    if (snake.fullness < 0) {
                        if (snake.body.length > 2) {
                            snake.body.pop()
                            snake.fullness += 100
                            this.broadcast(encodeSnakeFullness(snake.id, snake.fullness))
                        }
                        if (snake.body.length <= 2) {
                            // At minimum length, automatically cancel boost
                            snake.isBoosting = false
                            snake.speed = this.options.baseSpeed
                            snake.speedByte = 58
                            this.broadcast(encodeRotateSnake(snake.id, snake.angle, snake.wantedAngle, snake.speedByte))
                        }
                    }
                }
            }

            // Food eating collision detection
            const headRadius = 25
            for (const food of Array.from(this.foods.values())) {
                const dist = Math.hypot(snake.x - food.x, snake.y - food.y)
                if (dist <= headRadius + food.size * 2) {
                    this.foods.delete(food.id)
                    this.broadcast(encodeFoodEaten(food.x, food.y, snake.id))

                    snake.fullness += food.size * 25
                    if (snake.fullness >= 100) {
                        const last = snake.body[snake.body.length - 1]
                        snake.body.push({ x: last.x, y: last.y })
                        snake.fullness -= 100
                        this.broadcast(encodeSnakeGrow(snake.id, snake.x, snake.y))
                    }
                    this.broadcast(encodeSnakeFullness(snake.id, snake.fullness))

                    const entries = Array.from(this.snakes.values())
                        .map((s, idx) => ({
                            rank: idx + 1,
                            score: s.body.length * 10 + Math.round(s.fullness),
                            fam: Math.round(s.fullness) & 0xff,
                            nickname: s.name,
                        }))
                        .slice(0, 10)
                    this.broadcast(encodeLeaderboard(entries, true, 1, this.getSnakeCount()))
                }
            }
        }

        // 2. Update Preys
        for (const prey of Array.from(this.preys.values())) {
            prey.x += prey.speed * Math.cos(prey.angle) * dtSec
            prey.y += prey.speed * Math.sin(prey.angle) * dtSec
            this.broadcast(encodePreyUpdate(prey.id, prey.x, prey.y, prey.angle, prey.speed))
        }
    }

    private startTickLoop(): void {
        if (this.tickTimer) return
        this.tickTimer = setInterval(() => {
            this.step(this.options.tickIntervalMs)
        }, this.options.tickIntervalMs)
        if (typeof this.tickTimer.unref === "function") {
            this.tickTimer.unref()
        }
    }

    private stopTickLoop(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer)
            this.tickTimer = null
        }
    }

    /**
     * Programmatically kills a snake, drops death food along its body, and broadcasts death/removal.
     */
    public simulateSnakeDeath(snakeId: number, reason: number = 0): void {
        const snake = this.snakes.get(snakeId)
        if (!snake || snake.isDead) {
            return
        }

        snake.isDead = true

        // 1. Drop body segments as food
        const droppedFoods: SimulatedFood[] = []
        for (const seg of snake.body) {
            const food = this.createFoodEntity(Math.round(seg.x), Math.round(seg.y), 3, snake.skin % 30, true)
            this.foods.set(food.id, food)
            droppedFoods.push(food)
        }

        if (droppedFoods.length > 5) {
            this.broadcast(encodeFoodBatch(droppedFoods))
        } else {
            for (const f of droppedFoods) {
                this.broadcast(encodeFoodSpawnTurbo(f))
            }
        }

        // 2. If client-owned snake, notify client with death packet 'v'
        if (snake.ownerSession) {
            snake.ownerSession.sendPacket(encodePlayerDeath(reason))
            snake.ownerSession.state = "DEAD"
        }

        // 3. Broadcast snake remove packet 's' (died = true)
        this.broadcast(encodeSnakeRemove(snake.id, true))

        // 4. Remove from active snakes
        this.snakes.delete(snake.id)
    }

    /**
     * Spawns a natural food entity in the arena.
     */
    public spawnFood(x: number, y: number, size: number = 1, color: number = 0): number {
        const food = this.createFoodEntity(Math.round(x), Math.round(y), size, color, false)
        this.foods.set(food.id, food)
        this.broadcast(encodeFoodSpawnNatural(food))
        return food.id
    }

    /**
     * Spawns a batch of food entities in the arena.
     */
    public spawnFoodBatch(foods: Array<{ x: number; y: number; size?: number; color?: number }>): number[] {
        const list: SimulatedFood[] = []
        const ids: number[] = []

        for (const f of foods) {
            const food = this.createFoodEntity(Math.round(f.x), Math.round(f.y), f.size ?? 1, f.color ?? 0, false)
            this.foods.set(food.id, food)
            list.push(food)
            ids.push(food.id)
        }

        if (list.length > 0) {
            this.broadcast(encodeFoodBatch(list))
        }

        return ids
    }

    /**
     * Spawns an NPC bot snake in the arena.
     */
    public spawnBot(
        options: {
            id?: number
            name?: string
            skin?: number
            x?: number
            y?: number
            angle?: number
            length?: number
        } = {},
    ): SimulatedSnake {
        const id = options.id ?? this.getNextSnakeId()
        const name = options.name ?? `Bot_${id}`
        const skin = options.skin ?? id % 39
        const x = options.x ?? this.options.gameRadius / 2
        const y = options.y ?? this.options.gameRadius / 2
        const angle = options.angle ?? 0
        const length = options.length ?? 8

        const body: Array<{ x: number; y: number }> = []
        for (let i = 0; i < length; i++) {
            body.push({
                x: x - Math.cos(angle) * i * 15,
                y: y - Math.sin(angle) * i * 15,
            })
        }

        const botSnake: SimulatedSnake = {
            id,
            name,
            skin,
            x,
            y,
            angle,
            wantedAngle: angle,
            speed: this.options.baseSpeed,
            speedByte: 58,
            isBoosting: false,
            isDead: false,
            fullness: 0,
            body,
            boostTimer: 0,
        }

        this.snakes.set(id, botSnake)
        this.broadcast(encodeSnakeAdd(botSnake))
        return botSnake
    }

    /**
     * Spawns a glowing floating prey entity.
     */
    public spawnPrey(
        options: {
            id?: number
            x?: number
            y?: number
            color?: number
            size?: number
            speed?: number
            angle?: number
        } = {},
    ): number {
        const id = options.id ?? this.getNextPreyId()
        const x = options.x ?? this.options.gameRadius / 2
        const y = options.y ?? this.options.gameRadius / 2
        const color = options.color ?? 0
        const size = options.size ?? 2
        const speed = options.speed ?? 120
        const angle = options.angle ?? 0

        const prey: SimulatedPrey = { id, x, y, color, size, speed, angle }
        this.preys.set(id, prey)
        this.broadcast(encodePreyAdd(prey))
        return id
    }

    public updatePrey(preyId: number, x: number, y: number, angle: number, speed: number): void {
        const prey = this.preys.get(preyId)
        if (prey) {
            prey.x = x
            prey.y = y
            prey.angle = angle
            prey.speed = speed
        }
        this.broadcast(encodePreyUpdate(preyId, x, y, angle, speed))
    }

    public removePrey(preyId: number): void {
        this.preys.delete(preyId)
        this.broadcast(encodePreyRemove(preyId))
    }

    private createFoodEntity(x: number, y: number, size: number, color: number, isTurbo: boolean): SimulatedFood {
        const id = calcFoodId(x, y, this.options.gameRadius)
        return { id, x, y, size, color, isTurbo }
    }
}
