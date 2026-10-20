/**
 * @file slither-client.ts
 * @description Ergonomic, event-driven Slither.io client SDK with automated handshake and bot steering abstractions.
 */

import { WorldQueries } from "../math/spatial-grid.js"
import { directionTo, distance, normalizeAngle, radiansToProtocolByte } from "../math/vector.js"
import { GameState } from "../models/game-state.js"
import { Snake } from "../models/snake.js"
import { decodePacket } from "../protocol/packet-decoder.js"
import {
    encodeAngle,
    encodeBoost,
    encodeChallengeResponse,
    encodePing,
    encodeSpawn,
} from "../protocol/packet-encoder.js"
import { decodeSlitherSecret } from "../protocol/secret-resolver.js"
import { ClientState, SlitherClientEvents, TypedEventEmitter } from "./events.js"

export { ClientState }

export interface WebSocketLike {
    binaryType?: string
    readyState: number
    send(data: any): void
    close(code?: number, reason?: string): void
    onopen?: ((event?: any) => void) | null
    onclose?: ((event?: any) => void) | null
    onmessage?: ((event: { data: any }) => void) | null
    onerror?: ((event: any) => void) | null
    addEventListener?(event: string, listener: (...args: any[]) => void): void
    removeEventListener?(event: string, listener: (...args: any[]) => void): void
}

export interface SlitherClientOptions {
    /** Target server WebSocket URL (e.g. ws://127.0.0.1:8080) */
    serverUrl?: string
    /** Heartbeat ping interval in milliseconds (default: 250) */
    pingIntervalMs?: number
    /** Default player nickname for spawn() (default: 'slither-bot') */
    defaultNickname?: string
    /** Default skin ID for spawn() (default: 0) */
    defaultSkin?: number
    /** Optional custom WebSocket factory */
    webSocketFactory?: (url: string) => WebSocketLike
    /** Optional pre-constructed socket instance */
    socket?: WebSocketLike
    /** Custom logger */
    logger?: (level: "debug" | "info" | "warn" | "error", message: string, meta?: unknown) => void
    /** Whether target server is an official production server */
    isProduction?: boolean
}

/**
 * High-level programmatic Slither.io client.
 */
export class SlitherClient extends TypedEventEmitter<SlitherClientEvents> {
    public readonly gameState: GameState
    public readonly options: SlitherClientOptions

    private _state: ClientState = ClientState.DISCONNECTED
    private _socket: WebSocketLike | null = null
    private _pingTimer: any = null
    private _lastAngleByte: number | null = null
    private _isBoosting: boolean = false
    private _pendingConnectResolve: (() => void) | null = null
    private _pendingConnectReject: ((err: Error) => void) | null = null
    private _pendingSpawnResolve: ((snake: Snake) => void) | null = null
    private _pendingSpawnReject: ((err: Error) => void) | null = null
    private _pendingSpawnNickname: string | null = null
    private _spawnSetupReceived: boolean = false
    private _pendingSpawnTimeout: any = null
    private _isProduction: boolean = false

    constructor(options: SlitherClientOptions = {}) {
        super()
        this.options = {
            pingIntervalMs: 250,
            defaultNickname: "slither-bot",
            defaultSkin: 0,
            ...options,
        }
        this.gameState = new GameState()
        this._isProduction = options.isProduction ?? false
    }

    private setState(newState: ClientState): void {
        if (this._state === newState) {
            return
        }
        this._state = newState
        this.emit("state_change", newState)
    }

    /**
     * Current client connection lifecycle state.
     */
    public get state(): ClientState {
        return this._state
    }

    /**
     * Spatial queries helper bound to the client's live game state.
     */
    public get queries(): WorldQueries {
        return this.gameState.queries
    }

    /**
     * Whether the snake is actively boosting.
     */
    public get isBoosting(): boolean {
        return this._isBoosting
    }

    /**
     * Connects to a Slither.io WebSocket server.
     *
     * @param url WebSocket endpoint URL (defaults to options.serverUrl)
     */
    public connect(url?: string): Promise<void> {
        this.gameState.clear()
        const targetUrl = url ?? this.options.serverUrl
        if (!targetUrl && !this.options.socket) {
            return Promise.reject(new Error("No server URL provided to connect() and no socket pre-configured."))
        }

        if (this._state !== ClientState.DISCONNECTED) {
            this.disconnect()
        }

        this.setState(ClientState.CONNECTING)

        return new Promise<void>((resolve, reject) => {
            this._pendingConnectResolve = resolve
            this._pendingConnectReject = reject
            let socket: WebSocketLike

            try {
                if (this.options.socket) {
                    socket = this.options.socket
                } else if (this.options.webSocketFactory && targetUrl) {
                    socket = this.options.webSocketFactory(targetUrl)
                } else if (typeof globalThis !== "undefined" && (globalThis as any).WebSocket && targetUrl) {
                    const WS = (globalThis as any).WebSocket
                    socket = new WS(targetUrl)
                } else {
                    throw new Error(
                        "No WebSocket implementation available. Provide options.webSocketFactory or options.socket.",
                    )
                }
            } catch (err: any) {
                this.setState(ClientState.DISCONNECTED)
                this._pendingConnectResolve = null
                this._pendingConnectReject = null
                return reject(err)
            }

            this._socket = socket
            try {
                socket.binaryType = "arraybuffer"
            } catch {
                // Ignore if read-only
            }

            let openHandled = false

            socket.onopen = () => {
                openHandled = true
                this.setState(ClientState.HANDSHAKING)
                if (this._isProduction) {
                    this.sendRaw(new Uint8Array([1]))
                    this.sendRaw(new Uint8Array([99, 0]))
                } else {
                    this.startPingLoop()
                }
                this.emit("connect")
                if (this._pendingConnectResolve) {
                    const res = this._pendingConnectResolve
                    this._pendingConnectResolve = null
                    this._pendingConnectReject = null
                    res()
                }
            }

            socket.onmessage = (event: { data: any }) => {
                this.handleIncomingData(event.data)
            }

            socket.onerror = (err: any) => {
                const error = err instanceof Error ? err : new Error(`WebSocket error: ${String(err)}`)
                if (!openHandled && this._pendingConnectReject) {
                    this.setState(ClientState.DISCONNECTED)
                    const rej = this._pendingConnectReject
                    this._pendingConnectResolve = null
                    this._pendingConnectReject = null
                    rej(error)
                }
                this.emit("error", error)
            }

            socket.onclose = (event?: any) => {
                this.cleanupSocket()
                this.setState(ClientState.DISCONNECTED)
                this.emit("disconnect", {
                    code: event?.code,
                    reason: event?.reason,
                    wasClean: event?.wasClean,
                })
            }
        })
    }

    /**
     * Disconnects and resets client state.
     */
    public disconnect(): void {
        this.cleanupSocket()
        this.gameState.clear()
        this.setState(ClientState.DISCONNECTED)
        this.emit("disconnect", { wasClean: true })
    }

    /**
     * Spawns a snake in the game world with specified nickname and skin.
     *
     * @param nickname Player display name (up to 24 characters)
     * @param skinId Skin identifier (0..38)
     * @returns Promise resolving with the spawned Snake instance
     */
    public spawn(nickname?: string, skinId?: number): Promise<Snake> {
        if (this._state === ClientState.PLAYING && this.gameState.self) {
            return Promise.resolve(this.gameState.self)
        }
        if (this._isProduction && this.gameState.self) {
            return Promise.resolve(this.gameState.self)
        }
        if (this._state !== ClientState.READY && this._state !== ClientState.DEAD) {
            return Promise.reject(
                new Error(`Cannot spawn while in state: ${this._state}. Must be in READY or DEAD state.`),
            )
        }

        const name = (nickname ?? this.options.defaultNickname ?? "slither-bot").slice(0, 24)
        const skin = skinId ?? this.options.defaultSkin ?? 0

        return new Promise<Snake>((resolve, reject) => {
            this._pendingSpawnResolve = resolve
            this._pendingSpawnReject = reject
            this._pendingSpawnNickname = name
            this._spawnSetupReceived = false

            this._pendingSpawnTimeout = setTimeout(() => {
                if (this._pendingSpawnReject) {
                    this._pendingSpawnReject(new Error("Spawn request timed out after 5000ms"))
                    this._pendingSpawnResolve = null
                    this._pendingSpawnReject = null
                    this._pendingSpawnNickname = null
                    this._spawnSetupReceived = false
                }
            }, 5000)

            if (!this._isProduction || this._state === ClientState.DEAD) {
                const packet = this._isProduction ? this.encodeProductionSpawn(name, skin) : encodeSpawn(name, skin)
                this.sendRaw(packet)
            }
        })
    }

    /**
     * Turns the snake heading to the specified angle in radians.
     * Incorporates discrete angle dirty-checking (0..250 mapping) to avoid packet flooding.
     *
     * @param angleRadians Target heading in radians [0, 2π)
     */
    public turnTo(angleRadians: number): void {
        const norm = normalizeAngle(angleRadians)
        const discreteByte = radiansToProtocolByte(norm)

        // Dirty-check: only send if the discrete protocol byte changed
        if (discreteByte === this._lastAngleByte) {
            return
        }

        this._lastAngleByte = discreteByte
        const packet = encodeAngle(norm)
        this.sendRaw(packet)
    }

    /**
     * Convenience method to steer the snake using degrees [0..360].
     */
    public turnToDegrees(degrees: number): void {
        this.turnTo((degrees * Math.PI) / 180)
    }

    /**
     * Directs the snake head toward a target world coordinate { x, y }.
     *
     * @param target Target point { x, y }
     * @returns Calculated heading angle and Euclidean distance to the target
     */
    public moveTo(target: { x: number; y: number }): { angle: number; distance: number } {
        const selfSnake = this.gameState.self
        if (!selfSnake) {
            throw new Error("Cannot moveTo: player snake has not spawned yet")
        }

        const angle = directionTo(selfSnake.head, target)
        const dist = distance(selfSnake.head, target)

        this.turnTo(angle)
        return { angle, distance: dist }
    }

    /**
     * Enables or disables boost mode.
     * Incorporates idempotency check: redundant calls are ignored without sending network packets.
     *
     * @param active True to boost, false to travel at normal speed
     */
    public setBoost(active: boolean): void {
        if (this._isBoosting === active) {
            return
        }

        this._isBoosting = active
        const packet = encodeBoost(active)
        this.sendRaw(packet)
    }

    /** Convenience alias to start boosting */
    public boost(): void {
        this.setBoost(true)
    }

    /** Convenience alias to stop boosting */
    public stopBoost(): void {
        this.setBoost(false)
    }

    /**
     * Internal method to dispatch raw bytes to the underlying WebSocket.
     */
    public sendRaw(bytes: Uint8Array): void {
        if (!this._socket || this._socket.readyState !== 1) {
            return
        }
        try {
            this._socket.send(bytes)
        } catch (err: any) {
            this.emit("error", err instanceof Error ? err : new Error(String(err)))
        }
    }

    private handleIncomingData(rawData: any): void {
        const buffer = this.toUint8Array(rawData)
        if (buffer.length === 0) {
            return
        }

        if (this._isProduction) {
            // Check for pre-init challenge (1-byte opcode '6' = 54)
            if (buffer[0] === 54) {
                try {
                    const packet = decodePacket(buffer, true)
                    if (packet.type === "pre_init_challenge") {
                        this.handlePreInitChallenge(packet.challenge)
                    }
                } catch (err: any) {
                    if (this.listenerCount("error") > 0) {
                        this.emit("error", err instanceof Error ? err : new Error(String(err)))
                    }
                }
                return
            }

            // Unpack framed subpackets according to official Slither.io protocol
            const subpackets: Uint8Array[] = []
            let m = 0
            if (buffer[m] < 32) {
                const l = buffer.length
                while (m < l) {
                    let len = 0
                    if (buffer[m] < 32) {
                        len = (buffer[m] << 8) | buffer[m + 1]
                        m += 2
                    } else {
                        len = buffer[m] - 32
                        m++
                    }
                    if (m + len > l) break
                    subpackets.push(buffer.subarray(m, m + len))
                    m += len
                }
            } else {
                subpackets.push(buffer.subarray(m))
            }

            for (const sp of subpackets) {
                this.processDecodedBuffer(sp, true)
            }
        } else {
            if (buffer.length < 3) return
            this.processDecodedBuffer(buffer, false)
        }
    }

    private handlePreInitChallenge(challenge: Uint8Array): void {
        if (this._state === ClientState.HANDSHAKING || this._state === ClientState.CONNECTING) {
            const idba = this.solveProductionChallenge(challenge)
            this.sendRaw(idba)

            const defaultNick = this.options.defaultNickname ?? "slither-bot"
            const defaultSkin = this.options.defaultSkin ?? 0
            const spawnPkt = this.encodeProductionSpawn(defaultNick, defaultSkin)
            this.sendRaw(spawnPkt)
            this._pendingSpawnNickname = defaultNick.slice(0, 24)

            this.setState(ClientState.READY)
            this.startPingLoop()
        }
    }

    private processDecodedBuffer(buffer: Uint8Array, isProd: boolean): void {
        try {
            const packet = decodePacket(buffer, isProd)

            // 0. Initial Setup Handling
            if (packet.type === "initial_setup") {
                this._spawnSetupReceived = true
            }

            // 1. Automated Anti-Bot Challenge Handling
            if (packet.type === "pre_init_challenge") {
                if (this._state === ClientState.HANDSHAKING || this._state === ClientState.CONNECTING) {
                    let response: Uint8Array
                    if (this._isProduction) {
                        this.handlePreInitChallenge(packet.challenge)
                    } else {
                        const token = decodeSlitherSecret(packet.challenge)
                        response = encodeChallengeResponse(token)
                        this.sendRaw(response)
                        this.setState(ClientState.READY)
                    }
                }
                return
            }

            // 2. Spawn Handling
            if (packet.type === "snake_add") {
                const isOurSnake =
                    (this._isProduction && this._spawnSetupReceived && this.gameState.mySnakeId === null) ||
                    (this._pendingSpawnResolve !== null &&
                        (this._spawnSetupReceived ||
                            (this._pendingSpawnNickname !== null &&
                                (packet.nickname === this._pendingSpawnNickname ||
                                    packet.name === this._pendingSpawnNickname)) ||
                            (!this._spawnSetupReceived && !packet.nickname && !packet.name)))

                if (isOurSnake) {
                    this.gameState.mySnakeId = packet.snakeId
                    this.setState(ClientState.PLAYING)
                    if (this._isProduction) {
                        this.startPingLoop()
                    }
                    this._spawnSetupReceived = false
                    this._pendingSpawnNickname = null

                    const events = this.gameState.updateFromPacket(packet)
                    const selfSnake = this.gameState.self

                    if (this._pendingSpawnTimeout) {
                        clearTimeout(this._pendingSpawnTimeout)
                        this._pendingSpawnTimeout = null
                    }

                    const resolve = this._pendingSpawnResolve
                    this._pendingSpawnResolve = null
                    this._pendingSpawnReject = null
                    if (selfSnake && resolve) {
                        resolve(selfSnake)
                    }

                    this.dispatchGameEvents(events)
                    this.emit("tick", this.gameState)
                    return
                }
            }

            // 3. Death Handling
            if (packet.type === "death") {
                this.setState(ClientState.DEAD)
                this._isBoosting = false
            }

            // 4. Update GameState
            const events = this.gameState.updateFromPacket(packet)

            // Check if player died via snake_remove
            for (const ev of events) {
                if (ev.type === "snake_died" && ev.isSelf) {
                    this.setState(ClientState.DEAD)
                    this._isBoosting = false
                }
            }

            // 5. Emit Events & Tick
            this.dispatchGameEvents(events)
            this.emit("tick", this.gameState)
        } catch (err: any) {
            if (this.listenerCount("error") > 0) {
                this.emit("error", err instanceof Error ? err : new Error(String(err)))
            } else if (this.options.logger) {
                this.options.logger("warn", `Ingestion error: ${err.message}`)
            }
        }
    }

    private dispatchGameEvents(events: ReturnType<GameState["updateFromPacket"]>): void {
        for (const ev of events) {
            switch (ev.type) {
                case "game_start":
                    this.emit("game_start", ev.world)
                    break
                case "spawn":
                    this.emit("spawn", ev.snake)
                    break
                case "snake_add":
                    this.emit("snake_add", ev.snake)
                    break
                case "snake_update":
                    this.emit("snake_update", {
                        snake: ev.snake,
                        type: ev.updateType,
                    })
                    break
                case "snake_died":
                    this.emit("snake_died", {
                        snakeId: ev.snakeId,
                        isSelf: ev.isSelf,
                        reason: ev.reason,
                    })
                    break
                case "death":
                    this.emit("snake_died", {
                        snakeId: ev.snakeId ?? 0,
                        isSelf: true,
                        reason: ev.reason as any,
                    })
                    break
                case "food_spawn":
                    this.emit("food_spawn", ev.foods)
                    break
                case "food_eaten":
                    this.emit("food_eaten", {
                        foodId: ev.foodId,
                        x: ev.x,
                        y: ev.y,
                        eaterSnakeId: ev.eaterSnakeId,
                    })
                    break
                case "prey_spawn":
                    this.emit("prey_spawn", ev.prey)
                    break
                case "prey_update":
                    this.emit("prey_update", ev.prey)
                    break
                case "prey_eaten":
                    this.emit("prey_eaten", {
                        preyId: ev.preyId,
                        eaterSnakeId: ev.eaterSnakeId,
                    })
                    break
                case "leaderboard_update":
                    this.emit("leaderboard_update", ev.entries)
                    break
                default:
                    break
            }
        }
    }

    private startPingLoop(): void {
        this.stopPingLoop()
        const interval = this.options.pingIntervalMs ?? 250
        this._pingTimer = setInterval(() => {
            if (this._socket && this._socket.readyState === 1) {
                this.sendRaw(encodePing())
            }
        }, interval)
    }

    private stopPingLoop(): void {
        if (this._pingTimer) {
            clearInterval(this._pingTimer)
            this._pingTimer = null
        }
    }

    private cleanupSocket(): void {
        this.stopPingLoop()
        if (this._pendingConnectReject) {
            this._pendingConnectReject(new Error("Connection closed before established"))
            this._pendingConnectResolve = null
            this._pendingConnectReject = null
        }
        if (this._pendingSpawnTimeout) {
            clearTimeout(this._pendingSpawnTimeout)
            this._pendingSpawnTimeout = null
        }
        if (this._pendingSpawnReject) {
            this._pendingSpawnReject(new Error("Connection closed before spawn completed"))
            this._pendingSpawnResolve = null
            this._pendingSpawnReject = null
            this._pendingSpawnNickname = null
            this._spawnSetupReceived = false
        }
        if (this._socket) {
            const ws = this._socket
            this._socket = null
            ws.onopen = null
            ws.onmessage = null
            ws.onerror = null
            ws.onclose = null
            try {
                ws.close()
            } catch {
                // Ignore
            }
        }
        this._lastAngleByte = null
        this._isBoosting = false
    }

    private toUint8Array(data: any): Uint8Array {
        if (data instanceof Uint8Array) {
            return data
        }
        if (data instanceof ArrayBuffer) {
            return new Uint8Array(data)
        }
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        }
        if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        }
        return new Uint8Array(0)
    }

    private solveProductionChallenge(challengeBytes: Uint8Array): Uint8Array {
        const str = Array.from(challengeBytes).map((b) => String.fromCharCode(b)).join("")
        let evalCode = ""
        let d = 0, e_val = 23, f = 0
        for (let g = 0; g < str.length; g++) {
            let b = str.charCodeAt(g)
            if (96 >= b) b += 32
            b = (b - 97 - e_val) % 26
            if (0 > b) b += 26
            d *= 16
            d += b
            e_val += 17
            if (1 === f) {
                evalCode += String.fromCharCode(d)
                f = d = 0
            } else {
                f++
            }
        }
        const idba = new Uint8Array(27)
        try {
            const fn = new Function("idba", evalCode)
            fn(idba)
        } catch {
            return decodeSlitherSecret(challengeBytes)
        }

        // Apply official Slither.io qff9x rotation cipher
        let k = 0
        let av: number, v: number, v3: number
        for (let i = 0; i < idba.length; i++) {
            av = 0x41
            v = idba[i]
            if (v >= 0x61) {
                av += 0x20
                v -= 0x20
            }
            v -= 0x41
            if (i === 0) {
                k = 3 + v
            }
            v3 = v + k
            v3 %= 26
            k += 4 + v
            idba[i] = v3 + av
        }

        return idba
    }

    private encodeProductionSpawn(nickname: string, skinId: number): Uint8Array {
        const client_version = 291
        const cpw = [54, 206, 204, 169, 97, 178, 74, 136, 124, 117, 14, 210, 106, 236, 8, 208, 136, 213, 140, 111]
        const s = (nickname ?? "slither-bot").slice(0, 24)
        const ba = new Uint8Array(8 + 20 + s.length)
        ba[0] = 115
        ba[1] = 30
        ba[2] = (client_version >> 8) & 255
        ba[3] = client_version & 255
        for (let i = 0; i < 20; i++) ba[4 + i] = cpw[i]
        ba[24] = skinId
        ba[25] = s.length
        let m = 26
        for (let i = 0; i < s.length; i++) ba[m++] = s.charCodeAt(i)
        ba[m++] = 0
        ba[m++] = 255
        return ba
    }
}
