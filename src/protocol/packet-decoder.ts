/**
 * @file packet-decoder.ts
 * @description Inbound WebSocket packet parser for Slither.io binary protocol.
 */

import { BinaryReader, BufferUnderflowError } from "./binary-reader.js"
import {
    calcFoodId,
    DeathReason,
    FoodRecord,
    InboundOpcode,
    InboundPacket,
    LeaderboardEntry,
    Point2D,
    SnakeRemoveReason,
} from "./types.js"

export class PacketDecodeError extends Error {
    public readonly opcode?: string
    public readonly rawLength?: number

    constructor(message: string, opcode?: string, rawLength?: number) {
        super(message)
        this.name = "PacketDecodeError"
        this.opcode = opcode
        this.rawLength = rawLength
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/**
 * Normalizes input to Uint8Array.
 */
function toUint8Array(input: Uint8Array | ArrayBuffer | ArrayBufferView | Buffer): Uint8Array {
    if (input instanceof Uint8Array) {
        return input
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input)
    }
    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    }
    throw new PacketDecodeError("Invalid input: expected Uint8Array, ArrayBuffer, or Buffer")
}

/**
 * Decodes a raw Slither.io WebSocket binary message into a strongly typed InboundPacket.
 *
 * @param buffer Raw binary packet received over WebSocket.
 * @param isProduction True if decoding production framed subpackets (1-byte opcode, no timestamp header).
 * @returns Strongly typed InboundPacket discriminated union.
 * @throws PacketDecodeError on truncated headers or malformed frames.
 */
export function decodePacket(
    buffer: Uint8Array | ArrayBuffer | ArrayBufferView | Buffer,
    isProduction: boolean = false,
): InboundPacket {
    const bytes = toUint8Array(buffer)

    let timestamp = 0
    let opcodeChar = ""
    let payload: Uint8Array

    if (isProduction) {
        if (bytes.length < 1) {
            throw new PacketDecodeError("Packet buffer empty: expected at least 1 byte", undefined, 0)
        }
        opcodeChar = String.fromCharCode(bytes[0])
        payload = bytes.subarray(1)
    } else {
        if (bytes.length < 3) {
            throw new PacketDecodeError(
                `Packet buffer too short: expected at least 3-byte header, got ${bytes.length} byte(s)`,
                undefined,
                bytes.length,
            )
        }

        // Support production pre-init challenge (1-byte opcode '6')
        if (bytes[0] === 54 && bytes.length >= 65) {
            return {
                type: "pre_init_challenge",
                opcode: "6",
                timestamp: 0,
                challenge: bytes.subarray(1),
            }
        }

        timestamp = (bytes[0] << 8) | bytes[1]
        opcodeChar = String.fromCharCode(bytes[2])
        payload = bytes.subarray(3)
    }

    const reader = new BinaryReader(payload)

    try {
        switch (opcodeChar) {
            // 1. Pre-init Security Challenge ('6')
            case InboundOpcode.PRE_INIT_CHALLENGE: {
                return {
                    type: "pre_init_challenge",
                    opcode: "6",
                    timestamp,
                    challenge: payload,
                }
            }

            // 2. Initial Setup ('a')
            case InboundOpcode.INITIAL_SETUP: {
                if (payload.length < 24) {
                    throw new PacketDecodeError(
                        `Initial setup packet ('a') too short: expected at least 24 payload bytes, got ${payload.length}`,
                        "a",
                        bytes.length,
                    )
                }
                return {
                    type: "initial_setup",
                    opcode: "a",
                    timestamp,
                    gameRadius: reader.readUint24(),
                    mscps: reader.readUint16(),
                    sectorSize: reader.readUint16(),
                    sectorCount: reader.readUint16(),
                    spangdv: reader.readUint16(),
                    nsp1: reader.readUint16(),
                    nsp2: reader.readUint16(),
                    nsp3: reader.readUint16(),
                    mamu: reader.readUint16(),
                    mamu2: reader.readUint16(),
                    cst: reader.readUint16(),
                    protocolVersion: reader.hasRemaining(1) ? reader.readUint8() : 11,
                }
            }

            // 3. Snake Add or Remove ('s')
            case InboundOpcode.SNAKE_ADD_OR_REMOVE: {
                if (payload.length <= 3) {
                    // Variant A: Remove Snake
                    const snakeId = reader.readUint16()
                    const reasonByte = reader.hasRemaining(1) ? reader.readUint8() : 0
                    return {
                        type: "snake_remove",
                        opcode: "s",
                        timestamp,
                        snakeId,
                        reason: reasonByte === 1 ? SnakeRemoveReason.DIED : SnakeRemoveReason.LEFT_VIEWPORT,
                        status: reasonByte === 1 ? "died" : "left",
                    }
                } else {
                    // Variant B: Add Snake
                    const snakeId = reader.readUint16()

                    const isOfficialLayout =
                        isProduction ||
                        (reader.remaining >= 20 &&
                            reader.peekUint8(3) === 0 &&
                            reader.peekUint8(19) <= 32 &&
                            19 + 1 + reader.peekUint8(19) <= reader.remaining)

                    let skinId: number
                    let rawX: number
                    let rawY: number
                    let nickname: string
                    let angle: number
                    let wantedAngle: number
                    let speed: number
                    let fam: number

                    if (isOfficialLayout) {
                        const rawAngle = reader.readUint24()
                        const _unused = reader.readUint8()
                        const rawWantedAngle = reader.readUint24()
                        const speedVal = reader.readUint16()
                        const rawFam = reader.readUint24()
                        fam = isProduction ? rawFam / 16777215 : rawFam
                        skinId = reader.readUint8()
                        rawX = reader.readUint24()
                        rawY = reader.readUint24()
                        const nickLen = reader.readUint8()
                        nickname = reader.hasRemaining(nickLen) ? reader.readString(nickLen) : ""
                        angle = (rawAngle / 16777215) * Math.PI * 2
                        wantedAngle = (rawWantedAngle / 16777215) * Math.PI * 2
                        speed = speedVal / 10

                        if (isProduction && reader.hasRemaining(1)) {
                            const skl = reader.readUint8()
                            if (skl > 0 && reader.hasRemaining(skl)) {
                                reader.skip(skl)
                            }
                            if (reader.hasRemaining(1)) {
                                reader.readUint8() // cosmetic
                            }
                        }
                    } else {
                        skinId = reader.readUint8()
                        rawX = reader.readUint24()
                        rawY = reader.readUint24()
                        const nickLen = reader.readUint8()
                        nickname = reader.hasRemaining(nickLen) ? reader.readString(nickLen) : ""

                        const angleByte = reader.hasRemaining(1) ? reader.readUint8() : 0
                        const wantedAngleByte = reader.hasRemaining(1) ? reader.readUint8() : angleByte
                        speed = reader.hasRemaining(1) ? reader.readUint8() : 57
                        fam = reader.hasRemaining(2) ? reader.readUint16() : 0

                        angle = (angleByte / 256) * Math.PI * 2
                        wantedAngle = (wantedAngleByte / 256) * Math.PI * 2
                    }

                    // Parse body segments
                    const bodyParts: Point2D[] = []
                    if (isProduction) {
                        let curX = rawX / 5
                        let curY = rawY / 5
                        bodyParts.push({ x: curX, y: curY })
                        while (reader.remaining >= 2) {
                            const dx = (reader.readUint8() - 127) / 2
                            const dy = (reader.readUint8() - 127) / 2
                            curX += dx
                            curY += dy
                            bodyParts.push({ x: curX, y: curY })
                        }
                    } else {
                        while (reader.remaining >= 4) {
                            const bx = reader.readUint16()
                            const by = reader.readUint16()
                            bodyParts.push({ x: bx, y: by })
                        }
                    }

                    return {
                        type: "snake_add",
                        opcode: "s",
                        timestamp,
                        snakeId,
                        skinId,
                        skin: skinId,
                        x: rawX / 5,
                        y: rawY / 5,
                        angle,
                        wantedAngle,
                        speed,
                        fam,
                        nickname,
                        name: nickname,
                        bodyParts,
                    }
                }
            }

            // 4. Snake Movement ('g' / 'G')
            case InboundOpcode.MOVE_SNAKE: {
                const snakeId = reader.readUint16()
                const x = reader.readUint16()
                const y = reader.readUint16()
                return {
                    type: "snake_move",
                    opcode: "g",
                    timestamp,
                    snakeId,
                    x,
                    y,
                    mode: "relative",
                }
            }

            case InboundOpcode.MOVE_SNAKE_EXT: {
                const snakeId = reader.readUint16()
                const rawX = reader.readUint24()
                const rawY = reader.readUint24()
                return {
                    type: "snake_move_ext",
                    opcode: "G",
                    timestamp,
                    snakeId,
                    x: rawX / 5,
                    y: rawY / 5,
                    mode: "absolute",
                }
            }

            // 5. Snake Rotation ('e', '4', '5', '3', 'E')
            case InboundOpcode.ROTATE_SNAKE_CCW:
            case InboundOpcode.ROTATE_SNAKE_CW:
            case InboundOpcode.ROTATE_SNAKE_CW_ALT:
            case InboundOpcode.ROTATE_SNAKE_CCW_ALT: {
                const snakeId = reader.readUint16()
                const rawAngle = reader.readUint8()
                const angle = (rawAngle / 256) * Math.PI * 2

                let wantedAngle: number | undefined
                if (reader.hasRemaining(1)) {
                    wantedAngle = (reader.readUint8() / 256) * Math.PI * 2
                }

                let speed: number | undefined
                if (reader.hasRemaining(1)) {
                    speed = reader.readUint8()
                }

                return {
                    type: "snake_rotate",
                    opcode: opcodeChar as "e" | "4" | "5" | "3",
                    timestamp,
                    snakeId,
                    angle,
                    wantedAngle,
                    speed,
                }
            }

            case InboundOpcode.ROTATE_SNAKE_EXT: {
                const snakeId = reader.readUint16()
                const rawAngle = reader.readUint16()
                const angle = (rawAngle / 65536) * Math.PI * 2

                let wantedAngle: number | undefined
                if (reader.hasRemaining(2)) {
                    wantedAngle = (reader.readUint16() / 65536) * Math.PI * 2
                }

                let speed: number | undefined
                if (reader.hasRemaining(1)) {
                    speed = reader.readUint8()
                }

                return {
                    type: "snake_rotate",
                    opcode: "E",
                    timestamp,
                    snakeId,
                    angle,
                    wantedAngle,
                    speed,
                }
            }

            // 6. Snake Growth ('n' / 'N')
            case InboundOpcode.SNAKE_GROW: {
                const snakeId = reader.readUint16()
                const x = reader.readUint16()
                const y = reader.readUint16()
                return {
                    type: "snake_grow",
                    opcode: "n",
                    timestamp,
                    snakeId,
                    x,
                    y,
                }
            }

            case InboundOpcode.SNAKE_GROW_EXT: {
                const snakeId = reader.readUint16()
                const rawX = reader.readUint24()
                const rawY = reader.readUint24()
                return {
                    type: "snake_grow_ext",
                    opcode: "N",
                    timestamp,
                    snakeId,
                    x: rawX / 5,
                    y: rawY / 5,
                }
            }

            // 7. Fullness Ratio ('h')
            case InboundOpcode.UPDATE_FULLNESS: {
                if (payload.length < 4) {
                    throw new PacketDecodeError(
                        `Update fullness packet ('h') too short: expected at least 4 payload bytes, got ${payload.length}`,
                        "h",
                        bytes.length,
                    )
                }
                const snakeId = reader.readUint16()
                let fam: number
                if (reader.remaining >= 3) {
                    const rawFam = reader.readUint24()
                    fam = isProduction ? rawFam / 16777215 : rawFam
                } else {
                    const rawFam = reader.readUint16()
                    fam = isProduction ? rawFam / 16777215 : rawFam
                }
                return {
                    type: "snake_fullness",
                    opcode: "h",
                    timestamp,
                    snakeId,
                    fam,
                }
            }

            // 8. Food Natural / Turbo ('f' / 'b')
            case InboundOpcode.FOOD_NATURAL:
            case InboundOpcode.FOOD_TURBO: {
                const color = reader.readUint8()
                const x = reader.readInt16()
                const y = reader.readInt16()
                const size = reader.readUint8()
                const id = calcFoodId(x, y)
                return {
                    type: "food_spawn",
                    opcode: opcodeChar as "f" | "b",
                    timestamp,
                    id,
                    color,
                    x,
                    y,
                    size,
                    isTurbo: opcodeChar === "b",
                }
            }

            // 9. Food Batch ('F')
            case InboundOpcode.FOOD_BATCH: {
                const foods: FoodRecord[] = []
                while (reader.remaining >= 6) {
                    const color = reader.readUint8()
                    const x = reader.readInt16()
                    const y = reader.readInt16()
                    const size = reader.readUint8()
                    foods.push({
                        id: calcFoodId(x, y),
                        color,
                        x,
                        y,
                        size,
                    })
                }
                return {
                    type: "food_batch",
                    opcode: "F",
                    timestamp,
                    foods,
                }
            }

            // 10. Food Eaten ('c')
            case InboundOpcode.FOOD_EATEN: {
                const x = reader.readInt16()
                const y = reader.readInt16()
                const id = calcFoodId(x, y)
                const eaterSnakeId = reader.hasRemaining(2) ? reader.readUint16() : undefined
                return {
                    type: "food_eaten",
                    opcode: "c",
                    timestamp,
                    id,
                    x,
                    y,
                    eaterSnakeId,
                }
            }

            // 11. Prey Add or Remove ('y')
            case InboundOpcode.PREY_ADD_OR_REMOVE: {
                const preyId = reader.readUint16()
                if (payload.length <= 2) {
                    return {
                        type: "prey_remove",
                        opcode: "y",
                        timestamp,
                        preyId,
                    }
                }
                const color = reader.readUint8()
                const x = reader.readInt16()
                const y = reader.readInt16()
                const size = reader.hasRemaining(1) ? reader.readUint8() : 1
                return {
                    type: "prey_add",
                    opcode: "y",
                    timestamp,
                    preyId,
                    color,
                    x,
                    y,
                    size,
                }
            }

            // 12. Prey Trajectory Update ('j')
            case InboundOpcode.PREY_UPDATE: {
                const preyId = reader.readUint16()
                const x = reader.readInt16()
                const y = reader.readInt16()
                const rawAngle = reader.readUint8()
                const speed = reader.readUint8()
                return {
                    type: "prey_update",
                    opcode: "j",
                    timestamp,
                    preyId,
                    x,
                    y,
                    angle: (rawAngle / 256) * Math.PI * 2,
                    speed,
                }
            }

            // 13. Leaderboard ('l')
            case InboundOpcode.LEADERBOARD: {
                const localPlayerInTop10 = reader.readUint8() !== 0
                const localRank = reader.readUint16()
                const totalSnakes = reader.readUint16()
                const entries: LeaderboardEntry[] = []
                let rankIdx = 1

                while (reader.remaining >= 4) {
                    const score = reader.readUint16()
                    const fam = reader.readUint8()
                    const nickLen = reader.readUint8()
                    const nickname = reader.hasRemaining(nickLen) ? reader.readString(nickLen) : ""
                    entries.push({
                        rank: rankIdx++,
                        score,
                        fam,
                        nickname,
                    })
                }

                return {
                    type: "leaderboard",
                    opcode: "l",
                    timestamp,
                    localPlayerInTop10,
                    localRank,
                    totalSnakes,
                    entries,
                }
            }

            // 14. Dead / Disconnected ('v')
            case InboundOpcode.DEAD: {
                const reasonByte = reader.hasRemaining(1) ? reader.readUint8() : 0
                let reason: DeathReason = DeathReason.NORMAL
                let reasonText: "normal" | "new_high_score" | "disconnected" = "normal"

                if (reasonByte === 1) {
                    reason = DeathReason.NEW_HIGH_SCORE
                    reasonText = "new_high_score"
                } else if (reasonByte === 2) {
                    reason = DeathReason.DISCONNECTED
                    reasonText = "disconnected"
                }

                return {
                    type: "death",
                    opcode: "v",
                    timestamp,
                    reason,
                    reasonText,
                }
            }

            // 15. Kill Stats ('k')
            case InboundOpcode.KILL_STATS: {
                const kills = reader.hasRemaining(2)
                    ? reader.readUint16()
                    : reader.hasRemaining(1)
                      ? reader.readUint8()
                      : 0
                return {
                    type: "kill_stats",
                    opcode: "k",
                    timestamp,
                    kills,
                }
            }

            // 16. Pong ('p')
            case InboundOpcode.PONG: {
                return {
                    type: "pong",
                    opcode: "p",
                    timestamp,
                }
            }

            // 17. Sector Add ('W') / Remove ('w')
            case InboundOpcode.SECTOR_ADD: {
                return {
                    type: "sector_add",
                    opcode: "W",
                    timestamp,
                    sectorX: reader.readUint8(),
                    sectorY: reader.readUint8(),
                }
            }

            case InboundOpcode.SECTOR_REMOVE: {
                return {
                    type: "sector_remove",
                    opcode: "w",
                    timestamp,
                    sectorX: reader.readUint8(),
                    sectorY: reader.readUint8(),
                }
            }

            // 18. Unknown Opcode Fallback
            default: {
                return {
                    type: "unknown",
                    opcode: opcodeChar,
                    timestamp,
                    rawPayload: payload,
                    payload,
                }
            }
        }
    } catch (err) {
        if (isProduction) {
            return {
                type: "unknown",
                opcode: opcodeChar,
                timestamp,
                rawPayload: payload,
                payload,
            }
        }
        if (err instanceof BufferUnderflowError) {
            throw new PacketDecodeError(
                `Buffer underflow decoding packet '${opcodeChar}': ${err.message}`,
                opcodeChar,
                bytes.length,
            )
        }
        throw err
    }
}
