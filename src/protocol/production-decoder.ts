/**
 * @file production-decoder.ts
 * @description Stateful decoder for the official Slither.io server protocol (version >= 15).
 *
 * The official protocol is heavily compressed: many packets omit the snake id (meaning "your own snake"),
 * reuse values from the previous packet (food sector, last angle, ...) and derive head positions from an
 * angle instead of sending coordinates. Decoding therefore needs memory, which this class holds.
 */

import { BinaryReader } from "./binary-reader.js"
import {
    calcFoodId,
    DeathReason,
    FoodRecord,
    InboundPacket,
    LeaderboardEntry,
    Point2D,
    SnakeRemoveReason,
} from "./types.js"

const TWO_PI = Math.PI * 2

interface TrackedSnake {
    x: number
    y: number
    iang: number
    sct: number
    fam: number
}

interface TrackedPrey {
    angle: number
    speed: number
}

/**
 * Builds the segment-length lookup tables used by the official client to turn
 * (segment count, fullness) into a score.
 */
function buildScoreTables(mscps: number): { fmlts: number[]; fpsls: number[] } {
    const fmlts: number[] = []
    const fpsls: number[] = []
    for (let i = 0; i <= mscps; i++) {
        if (i >= mscps) fmlts.push(fmlts[i - 1])
        else fmlts.push(Math.pow(1 - i / mscps, 2.25))
        if (i === 0) fpsls.push(0)
        else fpsls.push(fpsls[i - 1] + 1 / fmlts[i - 1])
    }
    const tailFmlt = fmlts[fmlts.length - 1]
    const tailFpsl = fpsls[fpsls.length - 1]
    for (let i = 0; i < 2048; i++) {
        fmlts.push(tailFmlt)
        fpsls.push(tailFpsl)
    }
    return { fmlts, fpsls }
}

export class ProductionDecoder {
    public protocolVersion = 0
    public sectorSize = 300
    public defaultMsl = 42
    public mscps = 0
    /** Id of the snake controlled by this connection, once its `s` packet was received. */
    public selfId: number | null = null

    private scoreTables: { fmlts: number[]; fpsls: number[] } | null = null
    private readonly snakes = new Map<number, TrackedSnake>()
    private readonly preys = new Map<number, TrackedPrey>()
    private lastFoodSectorX = -1
    private lastFoodSectorY = -1
    private lastFoodColor = 0
    private lastEatenSectorX = -1
    private lastEatenSectorY = -1
    private lastEaterId = -1

    public reset(): void {
        this.selfId = null
        this.snakes.clear()
        this.preys.clear()
        this.lastFoodSectorX = this.lastFoodSectorY = -1
        this.lastEatenSectorX = this.lastEatenSectorY = -1
        this.lastEaterId = -1
        this.lastFoodColor = 0
    }

    /**
     * Calculates the in-game score for a snake segment count and fullness (0..1).
     */
    public calcScore(sct: number, fam: number): number {
        if (!this.scoreTables) return 0
        const { fmlts, fpsls } = this.scoreTables
        const i = Math.max(0, Math.min(fmlts.length - 1, sct))
        return Math.floor((fpsls[i] + fam / fmlts[i] - 1) * 15 - 5)
    }

    /**
     * Decodes one subpacket (opcode byte + payload) into zero or more packets.
     */
    public decode(bytes: Uint8Array): InboundPacket[] {
        if (bytes.length < 1) return []
        const opcode = String.fromCharCode(bytes[0])
        const payload = bytes.subarray(1)
        try {
            return this.decodeOpcode(opcode, bytes, payload)
        } catch {
            return [{ type: "unknown", opcode, timestamp: 0, rawPayload: payload, payload }]
        }
    }

    private decodeOpcode(opcode: string, bytes: Uint8Array, payload: Uint8Array): InboundPacket[] {
        const r = new BinaryReader(payload)
        const dlen = payload.length
        const plen = bytes.length
        const timestamp = 0

        switch (opcode) {
            case "a": {
                const gameRadius = r.readUint24()
                const mscps = r.readUint16()
                const sectorSize = r.readUint16()
                const sectorCount = r.readUint16()
                const spangdv = r.readUint8() / 10
                const nsp1 = r.readUint16() / 100
                const nsp2 = r.readUint16() / 100
                const nsp3 = r.readUint16() / 100
                const mamu = r.readUint16() / 1000
                const mamu2 = r.readUint16() / 1000
                const cst = r.readUint16() / 1000
                const protocolVersion = r.hasRemaining(1) ? r.readUint8() : 11
                const defaultMsl = r.hasRemaining(1) ? r.readUint8() : 42

                this.protocolVersion = protocolVersion
                this.sectorSize = sectorSize
                this.defaultMsl = defaultMsl
                if (mscps !== this.mscps) {
                    this.mscps = mscps
                    this.scoreTables = buildScoreTables(mscps)
                }
                this.reset()

                return [
                    {
                        type: "initial_setup",
                        opcode: "a",
                        timestamp,
                        gameRadius,
                        mscps,
                        sectorSize,
                        sectorCount,
                        spangdv,
                        nsp1,
                        nsp2,
                        nsp3,
                        mamu,
                        mamu2,
                        cst,
                        protocolVersion,
                        defaultMsl,
                    },
                ]
            }

            case "s":
                return this.decodeSnake(r, dlen)

            case "e":
            case "E":
            case "3":
            case "4":
            case "5":
            case "d":
            case "7":
                return this.decodeRotation(opcode, r, dlen, plen)

            case "g":
            case "n":
            case "G":
            case "N":
            case "+":
            case "=":
                return this.decodeMovement(opcode, r, dlen)

            case "h": {
                const snakeId = r.readUint16()
                const fam = r.readUint24() / 16777215
                const snake = this.snakes.get(snakeId)
                if (snake) snake.fam = fam
                return [
                    {
                        type: "snake_fullness",
                        opcode: "h",
                        timestamp,
                        snakeId,
                        fam,
                        score: snake ? this.calcScore(snake.sct, fam) : undefined,
                    },
                ]
            }

            case "r": {
                const snakeId = r.readUint16()
                const snake = this.snakes.get(snakeId)
                if (!snake) return []
                if (dlen >= 4) snake.fam = r.readUint24() / 16777215
                snake.sct = Math.max(0, snake.sct - 1)
                return [
                    {
                        type: "snake_fullness",
                        opcode: "h",
                        timestamp,
                        snakeId,
                        fam: snake.fam,
                        score: this.calcScore(snake.sct, snake.fam),
                        removeTail: true,
                    },
                ]
            }

            case "F": {
                const sectorX = r.readUint8()
                const sectorY = r.readUint8()
                const foods: FoodRecord[] = []
                while (r.remaining >= 4) {
                    const color = r.readUint8()
                    foods.push(this.makeFood(sectorX, sectorY, r.readUint8(), r.readUint8(), color, r.readUint8() / 5))
                }
                return [{ type: "food_batch", opcode: "F", timestamp, foods }]
            }

            case "b":
            case "f": {
                let sx: number
                let sy: number
                if (dlen >= 5) {
                    sx = r.readUint8()
                    sy = r.readUint8()
                    this.lastFoodSectorX = sx
                    this.lastFoodSectorY = sy
                } else {
                    sx = this.lastFoodSectorX
                    sy = this.lastFoodSectorY
                }
                const rx = r.readUint8()
                const ry = r.readUint8()
                let color = this.lastFoodColor
                if (dlen === 4 || dlen === 6) {
                    color = r.readUint8()
                    this.lastFoodColor = color
                }
                const food = this.makeFood(sx, sy, rx, ry, color, r.readUint8() / 5)
                return [
                    {
                        type: "food_spawn",
                        opcode: opcode,
                        timestamp,
                        ...food,
                        isTurbo: opcode === "b",
                    },
                ]
            }

            case "c":
            case "C":
            case "<": {
                let sx: number
                let sy: number
                if ((opcode === "c" && dlen === 2) || (opcode === "<" && dlen === 4) || (opcode === "C" && dlen === 2)) {
                    sx = this.lastEatenSectorX
                    sy = this.lastEatenSectorY
                } else {
                    sx = r.readUint8()
                    sy = r.readUint8()
                    this.lastEatenSectorX = sx
                    this.lastEatenSectorY = sy
                }
                const rx = r.readUint8()
                const ry = r.readUint8()
                let eaterSnakeId: number | undefined
                if (opcode === "<") {
                    this.lastEaterId = r.readUint16()
                    eaterSnakeId = this.lastEaterId
                } else if (opcode === "C") {
                    eaterSnakeId = this.lastEaterId >= 0 ? this.lastEaterId : undefined
                }
                const food = this.makeFood(sx, sy, rx, ry, 0, 0)
                return [
                    { type: "food_eaten", opcode: "c", timestamp, id: food.id, x: food.x, y: food.y, eaterSnakeId },
                ]
            }

            case "y": {
                const preyId = r.readUint16()
                if (dlen === 2) {
                    this.preys.delete(preyId)
                    return [{ type: "prey_remove", opcode: "y", timestamp, preyId }]
                }
                if (dlen === 4) {
                    // Eaten by a snake
                    this.preys.delete(preyId)
                    return [{ type: "prey_remove", opcode: "y", timestamp, preyId }]
                }
                const color = r.readUint8()
                const x = r.readUint24() / 5
                const y = r.readUint24() / 5
                const size = r.readUint8() / 5
                r.readUint8() // dir
                r.readUint24() // wang
                const angle = (r.readUint24() * TWO_PI) / 16777215
                const speed = r.readUint16() / 1000
                this.preys.set(preyId, { angle, speed })
                return [{ type: "prey_add", opcode: "y", timestamp, preyId, color, x, y, size }]
            }

            case "j": {
                const preyId = r.readUint16()
                const x = 1 + r.readUint16() * 3
                const y = 1 + r.readUint16() * 3
                const prey = this.preys.get(preyId) ?? { angle: 0, speed: 0 }
                const readAngle = () => (r.readUint24() * TWO_PI) / 16777215
                switch (dlen) {
                    case 15:
                        r.readUint8()
                        prey.angle = readAngle()
                        r.readUint24()
                        prey.speed = r.readUint16() / 1000
                        break
                    case 11:
                        prey.angle = readAngle()
                        prey.speed = r.readUint16() / 1000
                        break
                    case 12:
                        r.readUint8()
                        r.readUint24()
                        prey.speed = r.readUint16() / 1000
                        break
                    case 13:
                        r.readUint8()
                        prey.angle = readAngle()
                        break
                    case 9:
                        prey.angle = readAngle()
                        break
                    case 8:
                        prey.speed = r.readUint16() / 1000
                        break
                }
                this.preys.set(preyId, prey)
                return [{ type: "prey_update", opcode: "j", timestamp, preyId, x, y, angle: prey.angle, speed: prey.speed }]
            }

            case "l": {
                const myPos = r.readUint8()
                const localRank = r.readUint16()
                const totalSnakes = r.readUint16()
                const entries: LeaderboardEntry[] = []
                while (r.remaining >= 7) {
                    const sct = r.readUint16()
                    const fam = r.readUint24() / 16777215
                    r.readUint8() // color
                    const nickLen = r.readUint8()
                    const nickname = r.hasRemaining(nickLen) ? r.readString(nickLen) : ""
                    entries.push({
                        rank: entries.length + 1,
                        score: this.calcScore(sct, fam),
                        fam,
                        nickname,
                    })
                }
                return [
                    {
                        type: "leaderboard",
                        opcode: "l",
                        timestamp,
                        localPlayerInTop10: myPos > 0 && myPos <= 10,
                        localRank,
                        totalSnakes,
                        entries,
                    },
                ]
            }

            case "v": {
                const reasonByte = r.hasRemaining(1) ? r.readUint8() : 0
                const reason: DeathReason =
                    reasonByte === 1 ? DeathReason.NEW_HIGH_SCORE : reasonByte === 2 ? DeathReason.DISCONNECTED : DeathReason.NORMAL
                this.selfId = null
                return [
                    {
                        type: "death",
                        opcode: "v",
                        timestamp,
                        reason,
                        reasonText: reasonByte === 1 ? "new_high_score" : reasonByte === 2 ? "disconnected" : "normal",
                    },
                ]
            }

            case "k": {
                const snakeId = r.readUint16()
                const kills = r.readUint24()
                return [{ type: "kill_stats", opcode: "k", timestamp, kills, snakeId }]
            }

            case "p":
                return [{ type: "pong", opcode: "p", timestamp }]

            case "W":
                return [{ type: "sector_add", opcode: "W", timestamp, sectorX: r.readUint8(), sectorY: r.readUint8() }]

            case "w":
                return [{ type: "sector_remove", opcode: "w", timestamp, sectorX: r.readUint8(), sectorY: r.readUint8() }]

            default:
                return [{ type: "unknown", opcode, timestamp, rawPayload: payload, payload }]
        }
    }

    private makeFood(
        sx: number,
        sy: number,
        rx: number,
        ry: number,
        color: number,
        size: number,
    ): FoodRecord {
        const x = sx * this.sectorSize + (rx * this.sectorSize) / 256
        const y = sy * this.sectorSize + (ry * this.sectorSize) / 256
        return { id: ((sx << 24) | (sy << 16) | (rx << 8) | ry) >>> 0, color, x, y, size }
    }

    private decodeSnake(r: BinaryReader, dlen: number): InboundPacket[] {
        const snakeId = r.readUint16()

        if (dlen <= 6) {
            const isKill = r.readUint8() === 1
            this.snakes.delete(snakeId)
            return [
                {
                    type: "snake_remove",
                    opcode: "s",
                    timestamp: 0,
                    snakeId,
                    reason: isKill ? SnakeRemoveReason.DIED : SnakeRemoveReason.LEFT_VIEWPORT,
                    status: isKill ? "died" : "left",
                },
            ]
        }

        const angle = (r.readUint24() * TWO_PI) / 16777215
        r.readUint8() // dir
        const wantedAngle = (r.readUint24() * TWO_PI) / 16777215
        const speed = r.readUint16() / 1000
        const fam = r.readUint24() / 16777215
        const skinId = r.readUint8()
        const headX = r.readUint24() / 5
        const headY = r.readUint24() / 5
        const nickLen = r.readUint8()
        const nickname = r.hasRemaining(nickLen) ? r.readString(nickLen) : ""
        if (this.protocolVersion >= 11) {
            const skinLen = r.readUint8()
            if (skinLen > 0) r.skip(skinLen)
        }
        if (this.protocolVersion >= 12) r.readUint8() // cosmetic

        // Body is listed tail -> head: one absolute point, then half-unit deltas; the final point of
        // protocol >= 15 is encoded as an angle step from the previous one.
        const points: Point2D[] = []
        let x = 0
        let y = 0
        let iang = Math.round((angle / TWO_PI) * 65536) & 0xffff
        let first = true
        while (r.remaining > 0) {
            if (first) {
                x = r.readUint24() / 5
                y = r.readUint24() / 5
                first = false
            } else if (r.remaining === 2 && this.protocolVersion >= 15) {
                iang = r.readUint16()
                const a = (iang * TWO_PI) / 65536
                x += Math.cos(a) * this.defaultMsl
                y += Math.sin(a) * this.defaultMsl
            } else {
                x += (r.readUint8() - 127) / 2
                y += (r.readUint8() - 127) / 2
            }
            points.push({ x, y })
        }

        const head = points.length > 0 ? points[points.length - 1] : { x: headX, y: headY }
        const sct = Math.max(points.length, 1)
        this.snakes.set(snakeId, { x: head.x, y: head.y, iang, sct, fam })

        if (this.selfId === null) this.selfId = snakeId

        return [
            {
                type: "snake_add",
                opcode: "s",
                timestamp: 0,
                snakeId,
                skinId,
                skin: skinId,
                x: head.x,
                y: head.y,
                angle,
                wantedAngle,
                speed,
                fam,
                nickname,
                name: nickname,
                bodyParts: points.slice().reverse(),
                score: this.calcScore(sct, fam),
            },
        ]
    }

    private decodeRotation(opcode: string, r: BinaryReader, dlen: number, plen: number): InboundPacket[] {
        const isSelf = opcode === "d" || opcode === "7" || dlen <= 2
        let snakeId: number
        if (isSelf) {
            if (this.selfId === null) return []
            snakeId = this.selfId
        } else {
            snakeId = r.readUint16()
        }

        const byteAngle = () => (r.readUint8() * TWO_PI) / 256
        let angle: number | undefined
        let wantedAngle: number | undefined
        let speed: number | undefined

        if (plen === 6) {
            angle = byteAngle()
            wantedAngle = byteAngle()
            speed = r.readUint8() / 18
        } else if (plen === 5 || plen === 3) {
            switch (opcode) {
                case "e":
                    angle = byteAngle()
                    speed = r.readUint8() / 18
                    break
                case "E":
                case "4":
                    wantedAngle = byteAngle()
                    speed = r.readUint8() / 18
                    break
                case "3":
                case "5":
                    angle = byteAngle()
                    wantedAngle = byteAngle()
                    break
            }
        } else if (plen === 4 || plen === 2) {
            switch (opcode) {
                case "e":
                    angle = byteAngle()
                    break
                case "E":
                case "4":
                    wantedAngle = byteAngle()
                    break
                case "3":
                    speed = r.readUint8() / 18
                    break
                case "d":
                case "7":
                    angle = byteAngle()
                    wantedAngle = byteAngle()
                    speed = r.readUint8() / 18
                    break
            }
        }

        const tracked = this.snakes.get(snakeId)
        if (tracked && angle !== undefined) tracked.iang = Math.round((angle / TWO_PI) * 65536) & 0xffff

        return [
            {
                type: "snake_rotate",
                opcode: opcode as "e" | "E" | "3" | "4" | "5",
                timestamp: 0,
                snakeId,
                angle,
                wantedAngle,
                speed,
            },
        ]
    }

    private decodeMovement(opcode: string, r: BinaryReader, dlen: number): InboundPacket[] {
        const adding = opcode === "n" || opcode === "N" || opcode === "+"
        const isSelf = opcode === "G" || opcode === "N" || (opcode === "=" && dlen === 6) || (opcode === "+" && dlen === 9)

        let snakeId: number
        if (isSelf) {
            if (this.selfId === null) return []
            snakeId = this.selfId
        } else {
            snakeId = r.readUint16()
        }

        const snake = this.snakes.get(snakeId)
        if (!snake) return []

        let x: number
        let y: number
        if (opcode === "+" || opcode === "=") {
            snake.iang = r.readUint16()
            x = r.readUint16()
            y = r.readUint16()
        } else {
            const hasAngle =
                (opcode === "G" && dlen === 2) ||
                (opcode === "N" && dlen === 5) ||
                (opcode === "g" && dlen === 4) ||
                (opcode === "n" && dlen === 7)
            if (hasAngle) snake.iang = r.readUint16()
            const a = (snake.iang * TWO_PI) / 65536
            x = snake.x + Math.cos(a) * this.defaultMsl
            y = snake.y + Math.sin(a) * this.defaultMsl
        }

        snake.x = x
        snake.y = y

        const packets: InboundPacket[] = []
        if (adding) {
            snake.fam = r.readUint24() / 16777215
            snake.sct++
            packets.push({ type: "snake_grow", opcode: "n", timestamp: 0, snakeId, x, y, fromHead: true })
            packets.push({
                type: "snake_fullness",
                opcode: "h",
                timestamp: 0,
                snakeId,
                fam: snake.fam,
                score: this.calcScore(snake.sct, snake.fam),
            })
        } else {
            packets.push({ type: "snake_move", opcode: "g", timestamp: 0, snakeId, x, y, mode: "absolute", advance: true })
        }
        return packets
    }
}
