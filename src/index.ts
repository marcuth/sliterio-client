/**
 * @file index.ts
 * @description Main public entry point for @marcuth/slitherio client and SDK.
 */

// Math & Spatial Geometry
export {
    TWO_PI,
    PROTOCOL_ANGLE_STEPS,
    COORDINATE_SCALE,
    normalizeAngle,
    angleDifference,
    radiansToDegrees,
    degreesToRadians,
    radiansToProtocolByte,
    protocolByteToRadians,
    directionTo,
    distance,
    distanceSquared,
    distanceToSegment,
    distanceToBoundary,
    protocolToWorld,
    worldToProtocol,
    Vector2D,
} from "./math/vector.js"
export { SpatialHashGrid, WorldQueries } from "./math/spatial-grid.js"
export type {
    SpatialItem,
    NearestFoodOptions,
    FoodCluster,
    Obstacle,
    ObstacleScanOptions,
} from "./math/spatial-grid.js"

// Domain Models
export type { Point, Vector, Color, Entity, WorldInfo } from "./models/entity.js"
export { Food } from "./models/food.js"
export type { FoodOptions } from "./models/food.js"
export { Prey } from "./models/prey.js"
export type { PreyOptions } from "./models/prey.js"
export { Snake } from "./models/snake.js"
export type { SnakeData } from "./models/snake.js"
export type { LeaderboardEntry, LeaderboardState } from "./models/leaderboard.js"
export { GameState } from "./models/game-state.js"
export type { GameEvent } from "./models/game-state.js"

// Client SDK & Events
export { SlitherClient, ClientState } from "./client/slither-client.js"
export type { SlitherClientOptions, WebSocketLike } from "./client/slither-client.js"
export { TypedEventEmitter } from "./client/events.js"
export type {
    SlitherClientEvents,
    DisconnectInfo,
    SnakeUpdateEvent,
    SnakeDiedEvent,
    FoodEatenEvent,
    PreyEatenEvent,
} from "./client/events.js"

// Binary Stream Codecs
export { BinaryCodecError, BufferUnderflowError, BinaryReader } from "./protocol/binary-reader.js"
export { BinaryWriter } from "./protocol/binary-writer.js"

// Packet Framing Codecs
export { PacketDecodeError, decodePacket } from "./protocol/packet-decoder.js"
export {
    PacketEncodeError,
    encodeAngle,
    encodeBoost,
    encodePing,
    encodeKeySteering,
    encodeKeyTurn,
    encodeSpawn,
    encodeChallengeResponse,
    encodePacket,
} from "./protocol/packet-encoder.js"

// Anti-Bot Challenge Resolver
export { decodeSlitherSecret } from "./protocol/secret-resolver.js"

// Protocol Types & Enums
export {
    InboundOpcode,
    OutboundCommand,
    SnakeRemoveReason,
    DeathReason,
    KeySteerDirection,
    calcFoodId,
    angleToByte,
    byteToAngle,
    uint16ToAngle,
} from "./protocol/types.js"
export type {
    Point2D,
    BodySegment,
    FoodRecord,
    BaseInboundPacket,
    PreInitChallengePacket,
    InitialSetupPacket,
    SnakeRemovePacket,
    SnakeAddPacket,
    SnakeMovePacket,
    SnakeMoveExtPacket,
    SnakeRotatePacket,
    SnakeGrowPacket,
    SnakeGrowExtPacket,
    SnakeFullnessPacket,
    FoodSpawnPacket,
    FoodBatchPacket,
    FoodEatenPacket,
    PreyAddPacket,
    PreyRemovePacket,
    PreyUpdatePacket,
    LeaderboardPacket,
    DeathPacket,
    KillStatsPacket,
    PongPacket,
    SectorAddPacket,
    SectorRemovePacket,
    UnknownInboundPacket,
    InboundPacket,
    ChallengeResponsePacket,
    SpawnCommandPacket,
    SteerAnglePacket,
    KeySteerPacket,
    BoostPacket,
    PingPacket,
    OutboundPacket,
    LeaderboardEntry as ProtocolLeaderboardEntry,
} from "./protocol/types.js"

// Mock WebSocket Server & Test Harness
export {
    DEFAULT_CHALLENGE_SEED_STRING,
    MockServerSession,
    InMemoryWebSocket,
    createInMemoryClient,
    MockSlitherServer,
} from "./mock/mock-server.js"
export type {
    MockServerOptions,
    SimulatedSnake,
    SimulatedFood,
    SimulatedPrey,
    SessionState,
} from "./mock/mock-server.js"

// Mock Scenarios
export {
    createBasicGameScenario,
    simulateCombatScenario,
    simulateFeedingFrenzy,
} from "./mock/mock-scenarios.js"
export type {
    BasicScenarioOptions,
    BasicScenarioResult,
    CombatScenarioOptions,
    CombatScenarioResult,
    FeedingFrenzyOptions,
    FeedingFrenzyResult,
} from "./mock/mock-scenarios.js"

/**
 * CLI / Library initialization helper.
 */
export function main(): void {
    // Library entrypoint placeholder
}
