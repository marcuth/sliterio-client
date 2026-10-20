/**
 * @file packet-encoder.ts
 * @description Outbound WebSocket command encoder for Slither.io binary protocol.
 */

import { angleToByte, KeySteerDirection, OutboundCommand, OutboundPacket } from "./types.js"

export class PacketEncodeError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "PacketEncodeError"
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/**
 * Encodes continuous steering heading in radians into a single protocol angle byte [0..250].
 *
 * @param radians Angle heading in radians
 * @returns 1-byte Uint8Array payload
 */
export function encodeAngle(radians: number): Uint8Array {
    if (typeof radians !== "number" || !Number.isFinite(radians)) {
        throw new PacketEncodeError(`Invalid angle radians: ${radians}. Must be a finite number.`)
    }
    const byte = angleToByte(radians)
    return new Uint8Array([byte])
}

/**
 * Encodes speed boost state command.
 *
 * @param active True to activate boost (byte 253), false to deactivate boost (byte 254)
 * @returns 1-byte Uint8Array payload
 */
export function encodeBoost(active: boolean): Uint8Array {
    const opcode = active ? OutboundCommand.BOOST_START : OutboundCommand.BOOST_STOP
    return new Uint8Array([opcode])
}

/**
 * Encodes heartbeat ping packet.
 *
 * @param protocolVersion Target protocol version (default 11). Protocol versions < 5 use ASCII 'p' (112).
 * @returns 1-byte Uint8Array payload
 */
export function encodePing(protocolVersion: number = 11): Uint8Array {
    const opcode = protocolVersion >= 5 ? OutboundCommand.PING : 112
    return new Uint8Array([opcode])
}

/**
 * Encodes keyboard discrete steering command.
 *
 * @param direction Steering key state (0 = stop, 1 = left, 2 = right, or string equivalent)
 * @returns 2-byte Uint8Array payload [252, direction]
 */
export function encodeKeySteering(direction: KeySteerDirection | "stop" | "left" | "right"): Uint8Array {
    let flag: number
    if (typeof direction === "string") {
        switch (direction) {
            case "left":
                flag = KeySteerDirection.LEFT
                break
            case "right":
                flag = KeySteerDirection.RIGHT
                break
            case "stop":
            default:
                flag = KeySteerDirection.STOP
                break
        }
    } else {
        flag = Math.max(0, Math.min(2, Math.floor(direction)))
    }
    return new Uint8Array([OutboundCommand.KEY_STEER, flag])
}

/**
 * Alias for encodeKeySteering.
 */
export const encodeKeyTurn = encodeKeySteering

/**
 * Universal UTF-8 string byte encoder.
 */
function encodeUtf8(str: string): Uint8Array {
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(str)
    }
    return new Uint8Array(Buffer.from(str, "utf8"))
}

/**
 * Encodes player spawn request (SetUsernameAndSkin).
 *
 * Framing layout:
 * - [0] Opcode 115 ('s')
 * - [1] Protocol version minus 1 (e.g. 10 for Protocol 11)
 * - [2] Skin ID (0..38)
 * - [3..N] UTF-8 encoded nickname bytes (max 24 characters)
 *
 * @param nickname Player display nickname (truncated to 24 characters maximum)
 * @param skinId Skin identifier (0..38, default 0)
 * @param protocolVersion Protocol version (default 11)
 * @returns Serialized Uint8Array spawn command frame
 */
export function encodeSpawn(nickname: string = "", skinId: number = 0, protocolVersion: number = 11): Uint8Array {
    const sanitizedNick = (typeof nickname === "string" ? nickname : "").slice(0, 24)
    const nickBytes = encodeUtf8(sanitizedNick)

    const versionByte = Math.max(0, protocolVersion - 1) & 0xff
    const skinByte = Math.max(0, skinId) & 0xff

    const packet = new Uint8Array(3 + nickBytes.length)
    packet[0] = OutboundCommand.SPAWN
    packet[1] = versionByte
    packet[2] = skinByte
    packet.set(nickBytes, 3)

    return packet
}

/**
 * Encodes anti-bot verification challenge token response.
 *
 * @param token 24-byte verification token produced by decodeSlitherSecret()
 * @returns Exact 24-byte Uint8Array ready for WebSocket transmission
 */
export function encodeChallengeResponse(token: Uint8Array | number[] | Buffer): Uint8Array {
    if (!token || token.length !== 24) {
        throw new PacketEncodeError(`Challenge response token must be exactly 24 bytes, received ${token?.length ?? 0}`)
    }
    return token instanceof Uint8Array ? token : new Uint8Array(token)
}

/**
 * Encodes an OutboundPacket discriminated union command into raw binary bytes.
 *
 * @param command Outbound command object
 * @returns Encoded Uint8Array packet
 */
export function encodePacket(command: OutboundPacket): Uint8Array {
    switch (command.type) {
        case "steer_angle":
            return encodeAngle(command.angleRadians)
        case "boost":
            return encodeBoost(command.active)
        case "ping":
            return encodePing()
        case "key_steer":
            return encodeKeySteering(command.direction)
        case "spawn":
            return encodeSpawn(command.nickname, command.skinId, command.protocolVersion)
        case "challenge_response":
            return encodeChallengeResponse(command.token)
        default: {
            const exhaustiveCheck: never = command
            throw new PacketEncodeError(`Unhandled outbound command type: ${(exhaustiveCheck as any)?.type}`)
        }
    }
}
