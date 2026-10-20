/**
 * @file types.ts
 * @description Protocol opcodes, data structures, and tagged union definitions for Slither.io.
 */

/**
 * Inbound packet opcode ASCII characters transmitted by Slither.io servers.
 */
export enum InboundOpcode {
    PRE_INIT_CHALLENGE = "6", // 54 - Anti-bot challenge riddle
    INITIAL_SETUP = "a", // 97 - Arena radius, sector size, physics constants
    SNAKE_ADD_OR_REMOVE = "s", // 115 - Add snake or remove dead/out-of-range snake
    MOVE_SNAKE = "g", // 103 - Short 16-bit snake head movement
    MOVE_SNAKE_EXT = "G", // 71  - Extended 24-bit snake head movement
    ROTATE_SNAKE_CCW = "e", // 101 - Counter-clockwise rotation update
    ROTATE_SNAKE_CW = "4", // 52  - Clockwise rotation update
    ROTATE_SNAKE_CW_ALT = "5", // 53  - Clockwise rotation update (alt)
    ROTATE_SNAKE_CCW_ALT = "3", // 51 - Counter-clockwise rotation update (alt)
    ROTATE_SNAKE_EXT = "E", // 69  - High-precision 16-bit rotation update
    SNAKE_GROW = "n", // 110 - Snake growth with 16-bit coordinates
    SNAKE_GROW_EXT = "N", // 78  - Snake growth with 24-bit coordinates
    UPDATE_FULLNESS = "h", // 104 - Fullness ratio (fam) update
    FOOD_NATURAL = "f", // 102 - Natural food spawn
    FOOD_TURBO = "b", // 98  - Food dropped by boosting/dying snake
    FOOD_BATCH = "F", // 70  - Multi-food batch spawn in viewport
    FOOD_EATEN = "c", // 99  - Food consumed at (x, y)
    PREY_ADD_OR_REMOVE = "y", // 121 - Floating glowing prey spawn or despawn
    PREY_UPDATE = "j", // 106 - Prey position and trajectory update
    LEADERBOARD = "l", // 108 - Server top-10 leaderboard rankings
    DEAD = "v", // 118 - Player death or server disconnect
    KILL_STATS = "k", // 107 - Kill notification / stats
    PONG = "p", // 112 - Heartbeat pong response
    SECTOR_ADD = "W", // 87  - Grid sector activated
    SECTOR_REMOVE = "w", // 119 - Grid sector deactivated
}

/**
 * Outbound command byte identifiers transmitted by the client.
 */
export enum OutboundCommand {
    SPAWN = 115, // 's' - SetUsernameAndSkin packet
    PING = 251, // Protocol >= 5 heartbeat ping
    KEY_STEER = 252, // Keyboard discrete steering
    BOOST_START = 253, // Activate boost mode
    BOOST_STOP = 254, // Deactivate boost mode
}

/**
 * Snake removal reason codes.
 */
export type SnakeRemoveReason = 0 | 1
export const SnakeRemoveReason = {
    LEFT_VIEWPORT: 0 as SnakeRemoveReason,
    DIED: 1 as SnakeRemoveReason,
}

/**
 * Player death reason codes.
 */
export type DeathReason = 0 | 1 | 2
export const DeathReason = {
    NORMAL: 0 as DeathReason,
    NEW_HIGH_SCORE: 1 as DeathReason,
    DISCONNECTED: 2 as DeathReason,
}

/**
 * Discrete keyboard steering direction codes.
 */
export type KeySteerDirection = 0 | 1 | 2
export const KeySteerDirection = {
    STOP: 0 as KeySteerDirection,
    STRAIGHT: 0 as KeySteerDirection,
    LEFT: 1 as KeySteerDirection,
    RIGHT: 2 as KeySteerDirection,
}

/**
 * 2D coordinate point.
 */
export interface Point2D {
    x: number
    y: number
}

/**
 * Snake body segment point.
 */
export interface BodySegment extends Point2D {
    partIndex?: number
}

/**
 * Leaderboard entry record.
 */
export interface LeaderboardEntry {
    rank: number
    score: number
    fam: number
    nickname: string
}

/**
 * Food item record.
 */
export interface FoodRecord {
    id: number
    color: number
    x: number
    y: number
    size: number
}

// ---------------------------------------------------------------------------
// Inbound Packet Definitions
// ---------------------------------------------------------------------------

export interface BaseInboundPacket {
    timestamp: number
    opcode: string
}

export interface PreInitChallengePacket extends BaseInboundPacket {
    type: "pre_init_challenge"
    opcode: "6"
    challenge: Uint8Array
}

export interface InitialSetupPacket extends BaseInboundPacket {
    type: "initial_setup"
    opcode: "a"
    gameRadius: number
    mscps: number
    sectorSize: number
    sectorCount: number
    spangdv: number
    nsp1: number
    nsp2: number
    nsp3: number
    mamu: number
    mamu2: number
    cst: number
    protocolVersion: number
}

export interface SnakeRemovePacket extends BaseInboundPacket {
    type: "snake_remove"
    opcode: "s"
    snakeId: number
    reason: SnakeRemoveReason
    status?: "died" | "left"
}

export interface SnakeAddPacket extends BaseInboundPacket {
    type: "snake_add"
    opcode: "s"
    snakeId: number
    skinId: number
    skin?: number
    x: number
    y: number
    angle: number
    wantedAngle: number
    speed: number
    fam: number
    nickname: string
    name?: string
    bodyParts: Point2D[]
}

export interface SnakeMovePacket extends BaseInboundPacket {
    type: "snake_move"
    opcode: "g"
    snakeId: number
    x: number
    y: number
    mode?: "relative"
}

export interface SnakeMoveExtPacket extends BaseInboundPacket {
    type: "snake_move_ext"
    opcode: "G"
    snakeId: number
    x: number
    y: number
    mode?: "absolute"
}

export interface SnakeRotatePacket extends BaseInboundPacket {
    type: "snake_rotate"
    opcode: "e" | "4" | "5" | "3" | "E"
    snakeId: number
    angle: number
    wantedAngle?: number
    speed?: number
}

export interface SnakeGrowPacket extends BaseInboundPacket {
    type: "snake_grow"
    opcode: "n"
    snakeId: number
    x: number
    y: number
}

export interface SnakeGrowExtPacket extends BaseInboundPacket {
    type: "snake_grow_ext"
    opcode: "N"
    snakeId: number
    x: number
    y: number
}

export interface SnakeFullnessPacket extends BaseInboundPacket {
    type: "snake_fullness"
    opcode: "h"
    snakeId: number
    fam: number
}

export interface FoodSpawnPacket extends BaseInboundPacket {
    type: "food_spawn"
    opcode: "f" | "b"
    id: number
    color: number
    x: number
    y: number
    size: number
    isTurbo: boolean
}

export interface FoodBatchPacket extends BaseInboundPacket {
    type: "food_batch"
    opcode: "F"
    foods: FoodRecord[]
}

export interface FoodEatenPacket extends BaseInboundPacket {
    type: "food_eaten"
    opcode: "c"
    id: number
    x: number
    y: number
    eaterSnakeId?: number
}

export interface PreyAddPacket extends BaseInboundPacket {
    type: "prey_add"
    opcode: "y"
    preyId: number
    color: number
    x: number
    y: number
    size: number
}

export interface PreyRemovePacket extends BaseInboundPacket {
    type: "prey_remove"
    opcode: "y"
    preyId: number
}

export interface PreyUpdatePacket extends BaseInboundPacket {
    type: "prey_update"
    opcode: "j"
    preyId: number
    x: number
    y: number
    angle: number
    speed: number
}

export interface LeaderboardPacket extends BaseInboundPacket {
    type: "leaderboard"
    opcode: "l"
    localPlayerInTop10: boolean
    localRank: number
    totalSnakes: number
    entries: LeaderboardEntry[]
}

export interface DeathPacket extends BaseInboundPacket {
    type: "death"
    opcode: "v"
    reason: DeathReason
    reasonText?: "normal" | "new_high_score" | "disconnected"
}

export interface KillStatsPacket extends BaseInboundPacket {
    type: "kill_stats"
    opcode: "k"
    kills: number
}

export interface PongPacket extends BaseInboundPacket {
    type: "pong"
    opcode: "p"
}

export interface SectorAddPacket extends BaseInboundPacket {
    type: "sector_add"
    opcode: "W"
    sectorX: number
    sectorY: number
}

export interface SectorRemovePacket extends BaseInboundPacket {
    type: "sector_remove"
    opcode: "w"
    sectorX: number
    sectorY: number
}

export interface UnknownInboundPacket extends BaseInboundPacket {
    type: "unknown"
    rawPayload: Uint8Array
    payload: Uint8Array
}

/**
 * Tagged union of all inbound server packets discriminated by `type`.
 */
export type InboundPacket =
    | PreInitChallengePacket
    | InitialSetupPacket
    | SnakeRemovePacket
    | SnakeAddPacket
    | SnakeMovePacket
    | SnakeMoveExtPacket
    | SnakeRotatePacket
    | SnakeGrowPacket
    | SnakeGrowExtPacket
    | SnakeFullnessPacket
    | FoodSpawnPacket
    | FoodBatchPacket
    | FoodEatenPacket
    | PreyAddPacket
    | PreyRemovePacket
    | PreyUpdatePacket
    | LeaderboardPacket
    | DeathPacket
    | KillStatsPacket
    | PongPacket
    | SectorAddPacket
    | SectorRemovePacket
    | UnknownInboundPacket

// ---------------------------------------------------------------------------
// Outbound Packet Definitions
// ---------------------------------------------------------------------------

export interface ChallengeResponsePacket {
    type: "challenge_response"
    token: Uint8Array
}

export interface SpawnCommandPacket {
    type: "spawn"
    nickname: string
    skinId: number
    protocolVersion?: number
}

export interface SteerAnglePacket {
    type: "steer_angle"
    angleByte: number // 0..250
    angleRadians: number
}

export interface KeySteerPacket {
    type: "key_steer"
    direction: KeySteerDirection
}

export interface BoostPacket {
    type: "boost"
    active: boolean // 253 when active, 254 when inactive
}

export interface PingPacket {
    type: "ping"
}

/**
 * Tagged union of all outbound client commands.
 */
export type OutboundPacket =
    ChallengeResponsePacket | SpawnCommandPacket | SteerAnglePacket | KeySteerPacket | BoostPacket | PingPacket

// ---------------------------------------------------------------------------
// Domain Mathematical Helper Functions
// ---------------------------------------------------------------------------

/**
 * Calculates the unique deterministic Food ID hash from its world coordinates.
 *
 * @param x World X coordinate
 * @param y World Y coordinate
 * @param gameRadius Circular arena radius (default 21600)
 * @returns Deterministic integer food ID
 */
export function calcFoodId(x: number, y: number, gameRadius: number = 21600): number {
    return y * gameRadius * 3 + x
}

/**
 * Normalizes a continuous angle in radians to the discrete protocol byte range [0 .. 250].
 *
 * @param radians Heading angle in radians
 * @returns Quantized byte integer between 0 and 250 inclusive
 */
export function angleToByte(radians: number): number {
    if (typeof radians !== "number" || !Number.isFinite(radians)) {
        return 0
    }
    const twoPi = Math.PI * 2
    let normalized = radians % twoPi
    if (normalized < 0) {
        normalized += twoPi
    }
    if (normalized >= twoPi || twoPi - normalized < 2.5e-13) {
        normalized = 0
    }
    const byte = Math.floor((normalized / twoPi) * 250) % 250
    return Math.max(0, byte)
}

/**
 * Converts a protocol discrete angle byte back to continuous radians [0, 2*PI).
 *
 * @param byte Discrete angle byte
 * @param maxSteps Divisor step count (default 250)
 * @returns Angle heading in radians
 */
export function byteToAngle(byte: number, maxSteps: number = 250): number {
    return (byte / maxSteps) * Math.PI * 2
}

/**
 * Converts a 16-bit angle integer [0 .. 65535] to continuous radians [0, 2*PI).
 *
 * @param val High-precision 16-bit angle value
 * @returns Angle heading in radians
 */
export function uint16ToAngle(val: number): number {
    return (val / 65536) * Math.PI * 2
}
