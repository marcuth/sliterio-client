import { angleToByte } from "../protocol/types.js"

/**
 * @file vector.ts
 * @description 2D vector geometry, coordinate scaling, angle normalization, and spatial distance math.
 */

export const TWO_PI = Math.PI * 2
export const PROTOCOL_ANGLE_STEPS = 250
export const COORDINATE_SCALE = 5.0

/**
 * Normalizes an angle in radians to the canonical interval [0, 2π).
 *
 * @param radians Raw angle in radians
 * @returns Normalized angle in range [0, 2π)
 */
export function normalizeAngle(radians: number): number {
    if (!Number.isFinite(radians)) {
        return 0
    }
    const remainder = radians % TWO_PI
    let norm = remainder < 0 ? remainder + TWO_PI : remainder
    if (norm >= TWO_PI || TWO_PI - norm < 1e-9) {
        norm = 0
    }
    return norm
}

/**
 * Computes the signed shortest angular difference from current angle to target angle in [-π, π].
 *
 * @param targetAngle Target heading in radians
 * @param currentAngle Current heading in radians
 * @returns Shortest angle difference in [-π, π]
 */
export function angleDifference(targetAngle: number, currentAngle: number): number {
    let diff = (targetAngle - currentAngle) % TWO_PI
    if (diff < -Math.PI) {
        diff += TWO_PI
    } else if (diff > Math.PI) {
        diff -= TWO_PI
    }
    return diff
}

/**
 * Converts radians to degrees [0, 360).
 */
export function radiansToDegrees(radians: number): number {
    return (normalizeAngle(radians) * 180) / Math.PI
}

/**
 * Converts degrees to normalized radians [0, 2π).
 */
export function degreesToRadians(degrees: number): number {
    return normalizeAngle((degrees * Math.PI) / 180)
}

/**
 * Maps continuous angle in radians [0, 2π) to Slither's discrete protocol byte [0..250].
 * Angle 0 points along the positive X-axis (right), increasing clockwise.
 *
 * @param radians Angle in radians
 * @returns Integer byte value in range [0, 250]
 */
export function radiansToProtocolByte(radians: number): number {
    return angleToByte(radians)
}

/**
 * Converts Slither's discrete protocol byte [0..250] back to continuous radians [0, 2π).
 *
 * @param byte Protocol angle byte
 * @returns Heading in radians
 */
export function protocolByteToRadians(byte: number): number {
    const clamped = Math.max(0, Math.min(PROTOCOL_ANGLE_STEPS, byte))
    return (clamped * TWO_PI) / PROTOCOL_ANGLE_STEPS
}

/**
 * Computes the heading angle in radians from source point to destination point.
 *
 * @param from Source coordinate
 * @param to Destination coordinate
 * @returns Normalized angle in radians [0, 2π)
 */
export function directionTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
    const dx = to.x - from.x
    const dy = to.y - from.y
    return normalizeAngle(Math.atan2(dy, dx))
}

/**
 * Computes Euclidean distance between two 2D points.
 */
export function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

/**
 * Computes squared Euclidean distance between two 2D points (avoids square root).
 */
export function distanceSquared(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return dx * dx + dy * dy
}

/**
 * Calculates the shortest Euclidean distance from a point P to a line segment AB.
 * Used for capsule collision detection against snake body segments.
 *
 * @param p Point P
 * @param a Segment start A
 * @param b Segment end B
 * @returns Minimum distance from P to segment AB
 */
export function distanceToSegment(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    const l2 = distanceSquared(a, b)
    if (l2 === 0) {
        return distance(p, a)
    }

    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
    const projection = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
    }

    return distance(p, projection)
}

/**
 * Computes remaining distance from a point to the circular arena boundary.
 *
 * @param point Current point
 * @param center Arena center (usually { x: 21600, y: 21600 } or { x: 0, y: 0 })
 * @param radius Arena boundary radius
 * @returns Distance to boundary (0 if outside)
 */
export function distanceToBoundary(
    point: { x: number; y: number },
    center: { x: number; y: number },
    radius: number,
): number {
    const distFromCenter = distance(point, center)
    return Math.max(0, radius - distFromCenter)
}

/**
 * Converts raw protocol coordinate to scaled world coordinate (x / 5).
 */
export function protocolToWorld(protocolCoord: number): number {
    return protocolCoord / COORDINATE_SCALE
}

/**
 * Converts scaled world coordinate to raw protocol coordinate (x * 5).
 */
export function worldToProtocol(worldCoord: number): number {
    return Math.round(worldCoord * COORDINATE_SCALE)
}

/**
 * Immutable 2D vector class supporting geometric vector operations.
 */
export class Vector2D {
    public readonly x: number
    public readonly y: number

    constructor(x: number = 0, y: number = 0) {
        this.x = x
        this.y = y
    }

    public add(other: { x: number; y: number }): Vector2D {
        return new Vector2D(this.x + other.x, this.y + other.y)
    }

    public sub(other: { x: number; y: number }): Vector2D {
        return new Vector2D(this.x - other.x, this.y - other.y)
    }

    public scale(scalar: number): Vector2D {
        return new Vector2D(this.x * scalar, this.y * scalar)
    }

    public dot(other: { x: number; y: number }): number {
        return this.x * other.x + this.y * other.y
    }

    public cross(other: { x: number; y: number }): number {
        return this.x * other.y - this.y * other.x
    }

    public length(): number {
        return Math.hypot(this.x, this.y)
    }

    public lengthSquared(): number {
        return this.x * this.x + this.y * this.y
    }

    public normalize(): Vector2D {
        const len = this.length()
        if (len === 0) {
            return new Vector2D(0, 0)
        }
        return new Vector2D(this.x / len, this.y / len)
    }

    public distance(other: { x: number; y: number }): number {
        return distance(this, other)
    }

    public distanceSquared(other: { x: number; y: number }): number {
        return distanceSquared(this, other)
    }

    public angle(): number {
        return normalizeAngle(Math.atan2(this.y, this.x))
    }

    public clone(): Vector2D {
        return new Vector2D(this.x, this.y)
    }

    public toObject(): { x: number; y: number } {
        return { x: this.x, y: this.y }
    }

    public static fromAngle(radians: number, length: number = 1): Vector2D {
        return new Vector2D(Math.cos(radians) * length, Math.sin(radians) * length)
    }

    public static fromObject(obj: { x: number; y: number }): Vector2D {
        return new Vector2D(obj.x, obj.y)
    }

    public static distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
        return distance(a, b)
    }

    public static distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
        return distanceSquared(a, b)
    }

    public static lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number): Vector2D {
        const clampedT = Math.max(0, Math.min(1, t))
        return new Vector2D(a.x + (b.x - a.x) * clampedT, a.y + (b.y - a.y) * clampedT)
    }
}
