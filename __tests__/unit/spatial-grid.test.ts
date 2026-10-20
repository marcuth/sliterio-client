import { describe, expect, it } from "vitest"

import { SpatialHashGrid, WorldQueries } from "../../src/math/spatial-grid.js"
import {
    angleDifference,
    COORDINATE_SCALE,
    degreesToRadians,
    directionTo,
    distance,
    distanceSquared,
    distanceToBoundary,
    distanceToSegment,
    normalizeAngle,
    PROTOCOL_ANGLE_STEPS,
    protocolByteToRadians,
    protocolToWorld,
    radiansToDegrees,
    radiansToProtocolByte,
    TWO_PI,
    Vector2D,
    worldToProtocol,
} from "../../src/math/vector.js"
import { Food } from "../../src/models/food.js"
import { Snake } from "../../src/models/snake.js"

describe("Vector Math & Geometry Utilities", () => {
    describe("Angle Normalization & Conversions", () => {
        it("normalizes angles into [0, 2π) range", () => {
            expect(normalizeAngle(0)).toBe(0)
            expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 6)
            expect(normalizeAngle(TWO_PI)).toBeCloseTo(0, 6)
            expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 6)
            expect(normalizeAngle(-TWO_PI)).toBeCloseTo(0, 6)
            expect(normalizeAngle(3 * TWO_PI + 1)).toBeCloseTo(1, 6)
            expect(normalizeAngle(NaN)).toBe(0)
            expect(normalizeAngle(Infinity)).toBe(0)
        })

        it("computes shortest angular difference in [-π, π]", () => {
            expect(angleDifference(Math.PI, Math.PI)).toBeCloseTo(0, 6)
            expect(angleDifference(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 6)
            expect(angleDifference(0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6)
            // Wrapping over 0 / 2π seam
            const nearZero = 0.1
            const nearTwoPi = TWO_PI - 0.1
            expect(angleDifference(nearZero, nearTwoPi)).toBeCloseTo(0.2, 5)
            expect(angleDifference(nearTwoPi, nearZero)).toBeCloseTo(-0.2, 5)
        })

        it("converts between radians and degrees", () => {
            expect(radiansToDegrees(0)).toBe(0)
            expect(radiansToDegrees(Math.PI)).toBeCloseTo(180, 5)
            expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90, 5)
            expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 5)
            expect(degreesToRadians(360)).toBeCloseTo(0, 5)
            expect(degreesToRadians(45)).toBeCloseTo(Math.PI / 4, 5)
        })

        it("maps continuous radians to discrete protocol bytes [0..250]", () => {
            expect(radiansToProtocolByte(0)).toBe(0)
            expect(radiansToProtocolByte(Math.PI / 2)).toBe(62)
            expect(radiansToProtocolByte(Math.PI)).toBe(125)
            expect(radiansToProtocolByte((3 * Math.PI) / 2)).toBe(187)
            expect(radiansToProtocolByte(TWO_PI - 0.0001)).toBe(249)

            // Byte to radians
            expect(protocolByteToRadians(0)).toBe(0)
            expect(protocolByteToRadians(125)).toBeCloseTo(Math.PI, 5)
            expect(protocolByteToRadians(250)).toBeCloseTo(TWO_PI, 5)
        })
    })

    describe("Spatial Distance & Heading Math", () => {
        it("computes directionTo heading angles", () => {
            // Heading towards +X (right) -> 0
            expect(directionTo({ x: 100, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(0, 6)
            // Heading towards +Y (down in canvas) -> π/2
            expect(directionTo({ x: 100, y: 100 }, { x: 100, y: 200 })).toBeCloseTo(Math.PI / 2, 6)
            // Heading towards -X (left) -> π
            expect(directionTo({ x: 100, y: 100 }, { x: 0, y: 100 })).toBeCloseTo(Math.PI, 6)
            // Heading towards -Y (up) -> 3π/2
            expect(directionTo({ x: 100, y: 100 }, { x: 100, y: 0 })).toBeCloseTo((3 * Math.PI) / 2, 6)
        })

        it("computes Euclidean distance and squared distance", () => {
            const p1 = { x: 10, y: 20 }
            const p2 = { x: 13, y: 24 } // dx=3, dy=4 -> 5
            expect(distance(p1, p2)).toBe(5)
            expect(distanceSquared(p1, p2)).toBe(25)
        })

        it("computes point-to-segment distance for capsule collision", () => {
            const segA = { x: 0, y: 0 }
            const segB = { x: 100, y: 0 }

            // Point projecting onto middle of segment
            expect(distanceToSegment({ x: 50, y: 20 }, segA, segB)).toBeCloseTo(20, 5)
            // Point projecting before start of segment (clamps to A)
            expect(distanceToSegment({ x: -10, y: 0 }, segA, segB)).toBeCloseTo(10, 5)
            // Point projecting past end of segment (clamps to B)
            expect(distanceToSegment({ x: 115, y: 0 }, segA, segB)).toBeCloseTo(15, 5)
            // Degenerate zero-length segment
            expect(distanceToSegment({ x: 5, y: 12 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(13, 5)
        })

        it("computes distanceToBoundary correctly", () => {
            const center = { x: 1000, y: 1000 }
            const radius = 500

            expect(distanceToBoundary({ x: 1000, y: 1000 }, center, radius)).toBe(500)
            expect(distanceToBoundary({ x: 1300, y: 1000 }, center, radius)).toBe(200)
            expect(distanceToBoundary({ x: 1500, y: 1000 }, center, radius)).toBe(0)
            expect(distanceToBoundary({ x: 1600, y: 1000 }, center, radius)).toBe(0)
        })

        it("converts between world and protocol coordinates", () => {
            expect(protocolToWorld(100)).toBe(20)
            expect(worldToProtocol(20)).toBe(100)
            expect(COORDINATE_SCALE).toBe(5.0)
            expect(PROTOCOL_ANGLE_STEPS).toBe(250)
        })
    })

    describe("Vector2D Class Primitives", () => {
        it("supports vector arithmetic and methods", () => {
            const v1 = new Vector2D(3, 4)
            expect(v1.length()).toBe(5)
            expect(v1.lengthSquared()).toBe(25)

            const v2 = new Vector2D(1, 2)
            const sum = v1.add(v2)
            expect(sum.x).toBe(4)
            expect(sum.y).toBe(6)

            const diff = v1.sub(v2)
            expect(diff.x).toBe(2)
            expect(diff.y).toBe(2)

            const scaled = v1.scale(2)
            expect(scaled.x).toBe(6)
            expect(scaled.y).toBe(8)

            const norm = v1.normalize()
            expect(norm.length()).toBeCloseTo(1, 6)
            expect(norm.x).toBeCloseTo(0.6, 6)
            expect(norm.y).toBeCloseTo(0.8, 6)

            const zero = new Vector2D(0, 0).normalize()
            expect(zero.x).toBe(0)
            expect(zero.y).toBe(0)

            expect(v1.dot(v2)).toBe(3 * 1 + 4 * 2)
            expect(v1.cross(v2)).toBe(3 * 2 - 4 * 1)
            expect(v1.distance(new Vector2D(0, 0))).toBe(5)

            const angleVec = Vector2D.fromAngle(0, 10)
            expect(angleVec.x).toBeCloseTo(10, 5)
            expect(angleVec.y).toBeCloseTo(0, 5)

            const lerpVec = Vector2D.lerp(new Vector2D(0, 0), new Vector2D(100, 200), 0.5)
            expect(lerpVec.x).toBe(50)
            expect(lerpVec.y).toBe(100)
        })
    })
})

describe("SpatialHashGrid & Proximity Indexing", () => {
    it("handles O(1) insertion, retrieval, and removal", () => {
        const grid = new SpatialHashGrid<Food>(200)
        expect(grid.cellSize).toBe(200)
        expect(grid.size).toBe(0)

        const f1 = new Food(1, 100, 100, 2, 5)
        const f2 = new Food(2, 500, 500, 3, 2)

        grid.insert(f1)
        grid.insert(f2)
        expect(grid.size).toBe(2)
        expect(grid.has(1)).toBe(true)
        expect(grid.has(2)).toBe(true)
        expect(grid.has(999)).toBe(false)

        expect(grid.get(1)).toBe(f1)
        expect(grid.get(2)).toBe(f2)
        expect(grid.get(999)).toBeUndefined()

        // Remove f1
        const removed = grid.remove(1)
        expect(removed).toBe(true)
        expect(grid.size).toBe(1)
        expect(grid.has(1)).toBe(false)
        expect(grid.get(1)).toBeUndefined()

        // Removing already-removed item returns false
        expect(grid.remove(1)).toBe(false)
    })

    it("correctly updates item positions across grid cell boundaries", () => {
        const grid = new SpatialHashGrid<Food>(200)
        const f1 = new Food(10, 50, 50, 1, 0)
        grid.insert(f1)

        // Initial cell query around (50, 50)
        let found = grid.queryRadius(50, 50, 100)
        expect(found.length).toBe(1)
        expect(found[0].id).toBe(10)

        // Move to cell (600, 600)
        const updatedFood = new Food(10, 600, 600, 1, 0)
        grid.update(updatedFood)
        expect(grid.size).toBe(1)

        // Old cell no longer has item
        found = grid.queryRadius(50, 50, 100)
        expect(found.length).toBe(0)

        // New cell has item
        found = grid.queryRadius(600, 600, 100)
        expect(found.length).toBe(1)
        expect(found[0].id).toBe(10)
    })

    it("performs accurate circular neighborhood queries via queryRadius", () => {
        const grid = new SpatialHashGrid<Food>(100)
        // Insert 10 items at varying distances from (0, 0)
        for (let i = 0; i < 10; i++) {
            grid.insert(new Food(i, i * 30, 0, 1, 0)) // distances: 0, 30, 60, 90, 120, ...
        }

        const within70 = grid.queryRadius(0, 0, 70)
        // Should contain 0, 30, 60 -> 3 items
        expect(within70.length).toBe(3)
        const ids = within70.map((f) => f.id).sort((a, b) => a - b)
        expect(ids).toEqual([0, 1, 2])

        // Empty query with 0 radius
        expect(grid.queryRadius(0, 0, 0).length).toBe(0)
    })

    it("queries items within bounding box via queryBounds", () => {
        const grid = new SpatialHashGrid<Food>(100)
        grid.insert(new Food(1, 50, 50, 1, 0))
        grid.insert(new Food(2, 150, 150, 1, 0))
        grid.insert(new Food(3, 250, 250, 1, 0))

        const boundsResult = grid.queryBounds(0, 0, 180, 180)
        expect(boundsResult.length).toBe(2)
        expect(boundsResult.map((f) => f.id).sort()).toEqual([1, 2])
    })

    it("finds closest item via queryNearest with optional filter and max distance", () => {
        const grid = new SpatialHashGrid<Food>(100)
        grid.insert(new Food(1, 100, 0, 1, 0)) // dist = 100
        grid.insert(new Food(2, 50, 0, 1, 0)) // dist = 50
        grid.insert(new Food(3, 20, 0, 1, 0)) // dist = 20

        const nearest = grid.queryNearest(0, 0)
        expect(nearest).not.toBeNull()
        expect(nearest!.item.id).toBe(3)
        expect(nearest!.distance).toBe(20)

        // Filter out item 3
        const nearestFiltered = grid.queryNearest(0, 0, Infinity, (item) => item.id !== 3)
        expect(nearestFiltered!.item.id).toBe(2)
        expect(nearestFiltered!.distance).toBe(50)

        // Max distance constraint
        const nearestBounded = grid.queryNearest(0, 0, 10)
        expect(nearestBounded).toBeNull()

        // Fallback when all items in 4-cell radius fail filter
        const gridFallback = new SpatialHashGrid<Food>(100)
        gridFallback.insert(new Food(10, 50, 0, 1, 0)) // dist 50, inside 400px search radius
        gridFallback.insert(new Food(20, 1000, 0, 1, 0)) // dist 1000, outside search radius
        const fallbackResult = gridFallback.queryNearest(0, 0, Infinity, (item) => item.id === 20)
        expect(fallbackResult).not.toBeNull()
        expect(fallbackResult!.item.id).toBe(20)
        expect(fallbackResult!.distance).toBe(1000)
    })

    it("clears all entries cleanly", () => {
        const grid = new SpatialHashGrid<Food>(100)
        grid.insert(new Food(1, 10, 10, 1, 0))
        grid.insert(new Food(2, 20, 20, 1, 0))
        expect(grid.size).toBe(2)

        grid.clear()
        expect(grid.size).toBe(0)
        expect(grid.get(1)).toBeUndefined()
        expect(grid.queryRadius(0, 0, 500).length).toBe(0)
    })
})

describe("WorldQueries Proximity & Bot Navigation Functions", () => {
    it("finds the nearest food taking size and ejected status into account", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const queries = new WorldQueries(grid)

        // Pellet 1: close but tiny
        grid.insert(new Food(1, 100, 0, 1, 0))
        // Pellet 2: slightly further but ejected and large
        grid.insert(new Food(2, 110, 0, 5, 0, true))

        // Normal query without preference picks closest
        const nearestNormal = queries.findNearestFood({ x: 0, y: 0 }, { preferEjected: false })
        expect(nearestNormal).not.toBeNull()
        expect(nearestNormal!.id).toBe(1)

        // Query with preferEjected gives priority to the large ejected food
        const nearestEjected = queries.findNearestFood({ x: 0, y: 0 }, { preferEjected: true })
        expect(nearestEjected).not.toBeNull()
        expect(nearestEjected!.id).toBe(2)

        // MinSize filter
        const nearestMinSize = queries.findNearestFood({ x: 0, y: 0 }, { minSize: 3 })
        expect(nearestMinSize!.id).toBe(2)

        // Out of max distance returns null
        const outOfRange = queries.findNearestFood({ x: 10000, y: 10000 }, { maxDistance: 100 })
        expect(outOfRange).toBeNull()
    })

    it("detects and ranks high-density food clusters", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const queries = new WorldQueries(grid)

        // Cluster A around (500, 500) with 5 foods
        for (let i = 0; i < 5; i++) {
            grid.insert(new Food(i + 1, 500 + i * 10, 500 + i * 10, 4, 1))
        }

        // Cluster B around (2000, 2000) with 4 foods
        for (let i = 0; i < 4; i++) {
            grid.insert(new Food(i + 10, 2000 + i * 10, 2000 + i * 10, 2, 2))
        }

        const clusters = queries.findFoodClusters({ x: 0, y: 0 }, 3000, 200)
        expect(clusters.length).toBeGreaterThanOrEqual(1)
        // Top cluster should be Cluster A (higher total value)
        expect(clusters[0].x).toBeCloseTo(520, 0)
        expect(clusters[0].y).toBeCloseTo(520, 0)
    })

    it("detects enemy snake heads and body obstacles", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const enemy = new Snake({
            id: 2,
            head: { x: 300, y: 0 },
            body: [
                { x: 300, y: 0 },
                { x: 350, y: 0 },
                { x: 400, y: 0 },
            ],
            speed: 5,
        })

        const self = new Snake({
            id: 1,
            head: { x: 0, y: 0 },
            body: [
                { x: 0, y: 0 },
                { x: -50, y: 0 },
                { x: -100, y: 0 },
                { x: -150, y: 0 },
                { x: -200, y: 0 },
                { x: -250, y: 0 },
            ],
        })

        const queries = new WorldQueries(
            grid,
            () => ({
                gameRadius: 1000,
                center: { x: 0, y: 0 },
                sectorSize: 100,
                mscps: 400,
            }),
            () => [self, enemy]
        )

        // Scan around (100, 0)
        const obstacles = queries.findNearbyObstacles({ x: 100, y: 0 }, 400, {
            snakes: [self, enemy],
            selfSnakeId: 1,
            worldCenter: { x: 0, y: 0 },
            worldRadius: 1000,
        })

        expect(obstacles.length).toBeGreaterThan(0)
        // Should find enemy head at distance 200
        const enemyHead = obstacles.find((o) => o.type === "snake_head")
        expect(enemyHead).toBeDefined()
        expect(enemyHead!.snakeId).toBe(2)
        expect(enemyHead!.distance).toBeCloseTo(200, 5)
    })

    it("calculates safe steering angles using potential repulsion fields", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const queries = new WorldQueries(grid)

        const from = { x: 0, y: 0 }
        const target = { x: 1000, y: 0 } // Desired heading: 0 radians (right)

        // Without obstacles, heading is directly towards target
        const clearAngle = queries.getSafeSteeringAngle(from, target, 500, {
            snakes: [],
            worldRadius: 50000,
        })
        expect(clearAngle).toBeCloseTo(0, 5)

        // With an obstacle directly in the line of sight at (200, 0)
        const blockingSnake = new Snake({
            id: 99,
            head: { x: 200, y: 0 },
            body: [
                { x: 200, y: 0 },
                { x: 200, y: 50 },
            ],
        })

        const deflectedAngle = queries.getSafeSteeringAngle(from, target, 400, {
            snakes: [blockingSnake],
            selfSnakeId: 1,
            worldRadius: 50000,
        })

        // Angle should be repelled away from 0
        expect(deflectedAngle).not.toBeCloseTo(0, 1)
    })
})
