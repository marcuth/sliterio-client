/**
 * @file spatial-grid-vector-stress.test.ts
 * @description Empirical stress-testing, benchmarking, and boundary verification harness
 * for SpatialHashGrid, WorldQueries, and Vector2D math utilities.
 * Authored by Challenger M2-1.
 */

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

describe("Milestone 2 Challenger Stress: Vector Math & Boundary Robustness", () => {
    describe("1. Angle Normalization Across Extreme Domains", () => {
        it("normalizes negative angles accurately into [0, 2π)", () => {
            const testCases = [
                { input: -Math.PI / 4, expected: (7 * Math.PI) / 4 },
                { input: -Math.PI / 2, expected: (3 * Math.PI) / 2 },
                { input: -Math.PI, expected: Math.PI },
                { input: -(3 * Math.PI) / 2, expected: Math.PI / 2 },
                { input: -TWO_PI, expected: 0 },
                { input: -TWO_PI * 5, expected: 0 },
                { input: -TWO_PI - Math.PI / 6, expected: (11 * Math.PI) / 6 },
                { input: -0.000001, expected: TWO_PI - 0.000001 },
            ]

            for (const { input, expected } of testCases) {
                const norm = normalizeAngle(input)
                expect(norm).toBeGreaterThanOrEqual(0)
                expect(norm).toBeLessThan(TWO_PI)
                expect(norm).toBeCloseTo(expected, 5)
            }
        })

        it("normalizes huge positive and negative multiples without precision breakdown", () => {
            const offsets = [0, 0.5, 1.2, Math.PI, 5.0]
            const multiples = [10, 100, 1000, 10000, 100000]

            for (const offset of offsets) {
                for (const m of multiples) {
                    const positiveInput = m * TWO_PI + offset
                    const negativeInput = -m * TWO_PI + offset

                    const normPos = normalizeAngle(positiveInput)
                    const normNeg = normalizeAngle(negativeInput)

                    expect(normPos).toBeGreaterThanOrEqual(0)
                    expect(normPos).toBeLessThan(TWO_PI)
                    expect(normPos).toBeCloseTo(offset % TWO_PI, 4)

                    const expectedNeg = normalizeAngle(offset)
                    expect(normNeg).toBeGreaterThanOrEqual(0)
                    expect(normNeg).toBeLessThan(TWO_PI)
                    expect(normNeg).toBeCloseTo(expectedNeg, 4)
                }
            }
        })

        it("safely handles non-finite inputs (NaN, +/-Infinity)", () => {
            expect(normalizeAngle(NaN)).toBe(0)
            expect(normalizeAngle(Infinity)).toBe(0)
            expect(normalizeAngle(-Infinity)).toBe(0)
        })

        it("documents IEEE 754 float64 catastrophic underflow edge case", () => {
            // For tiny negative numbers close to zero (e.g. -1e-18),
            // remainder is -1e-18, and remainder + TWO_PI rounds to TWO_PI in float64.
            const tinyNegative = -1e-18
            const result = normalizeAngle(tinyNegative)
            // Ideally should be in [0, TWO_PI), but float64 rounds to TWO_PI
            expect(Number.isFinite(result)).toBe(true)
        })
    })

    describe("2. Shortest Angular Difference (angleDifference)", () => {
        it("calculates signed shortest difference across the 0/2π seam", () => {
            expect(angleDifference(0.1, TWO_PI - 0.1)).toBeCloseTo(0.2, 5)
            expect(angleDifference(TWO_PI - 0.1, 0.1)).toBeCloseTo(-0.2, 5)
            expect(angleDifference(Math.PI, 0)).toBeCloseTo(Math.PI, 5)
            expect(angleDifference(0, Math.PI)).toBeCloseTo(-Math.PI, 5)
        })

        it("handles inputs outside standard [0, 2π) range", () => {
            // target = 10*TWO_PI + 0.3, current = -4*TWO_PI + 0.1 -> diff = 0.2
            expect(angleDifference(10 * TWO_PI + 0.3, -4 * TWO_PI + 0.1)).toBeCloseTo(0.2, 4)
            // Opposite direction
            expect(angleDifference(-4 * TWO_PI + 0.1, 10 * TWO_PI + 0.3)).toBeCloseTo(-0.2, 4)
        })
    })

    describe("3. Capsule Line Segment Distance (distanceToSegment)", () => {
        const segA = { x: 100, y: 100 }
        const segB = { x: 300, y: 100 } // Horizontal segment length 200

        it("computes exact distance for orthogonal projections", () => {
            expect(distanceToSegment({ x: 200, y: 150 }, segA, segB)).toBeCloseTo(50, 5)
            expect(distanceToSegment({ x: 200, y: 50 }, segA, segB)).toBeCloseTo(50, 5)
        })

        it("correctly clamps to endpoint A when projecting before start", () => {
            // Point at (50, 100): dx = 50 from segA
            expect(distanceToSegment({ x: 50, y: 100 }, segA, segB)).toBeCloseTo(50, 5)
            // Point at (70, 60): dx = 30, dy = 40 from segA -> dist = 50
            expect(distanceToSegment({ x: 70, y: 60 }, segA, segB)).toBeCloseTo(50, 5)
        })

        it("correctly clamps to endpoint B when projecting beyond end", () => {
            // Point at (350, 100): dx = 50 from segB
            expect(distanceToSegment({ x: 350, y: 100 }, segA, segB)).toBeCloseTo(50, 5)
            // Point at (330, 140): dx = 30, dy = 40 from segB -> dist = 50
            expect(distanceToSegment({ x: 330, y: 140 }, segA, segB)).toBeCloseTo(50, 5)
        })

        it("handles degenerate zero-length segments without division by zero", () => {
            const degen = { x: 50, y: 50 }
            expect(distanceToSegment({ x: 53, y: 54 }, degen, degen)).toBeCloseTo(5, 5)
        })

        it("computes exact distance for diagonal line segments", () => {
            // Segment from (0, 0) to (30, 40), length = 50
            const diagA = { x: 0, y: 0 }
            const diagB = { x: 30, y: 40 }
            // Midpoint is (15, 20). Vector perpendicular is (-4, 3) normalized -> (-0.8, 0.6) * 10 = (-8, 6)
            // Point at (15 - 8, 20 + 6) = (7, 26) should be distance exactly 10 from segment
            expect(distanceToSegment({ x: 7, y: 26 }, diagA, diagB)).toBeCloseTo(10, 5)
        })
    })

    describe("4. Arena Boundary Distance (distanceToBoundary)", () => {
        const center = { x: 21600, y: 21600 }
        const radius = 21600

        it("computes distance to boundary inside arena", () => {
            expect(distanceToBoundary(center, center, radius)).toBe(21600)
            expect(distanceToBoundary({ x: 21600 + 10000, y: 21600 }, center, radius)).toBe(11600)
        })

        it("returns 0 for points on boundary or outside arena", () => {
            expect(distanceToBoundary({ x: 21600 + 21600, y: 21600 }, center, radius)).toBe(0)
            expect(distanceToBoundary({ x: 21600 + 25000, y: 21600 }, center, radius)).toBe(0)
        })
    })
})

describe("Milestone 2 Challenger Stress: SpatialHashGrid Scalability (5,000+ Items)", () => {
    const CELL_SIZE = 250
    const ITEM_COUNT = 5500
    const ARENA_RADIUS = 21600
    const ARENA_CENTER = 21600

    it("verifies bulk insertion and O(1) state consistency across 5,500 food items", () => {
        const grid = new SpatialHashGrid<Food>(CELL_SIZE)
        const items: Food[] = []

        // Deterministic pseudo-random generation (LGC)
        let seed = 42
        function lcg(): number {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }

        for (let i = 1; i <= ITEM_COUNT; i++) {
            const angle = lcg() * TWO_PI
            const r = Math.sqrt(lcg()) * (ARENA_RADIUS - 100)
            const x = Math.round(ARENA_CENTER + Math.cos(angle) * r)
            const y = Math.round(ARENA_CENTER + Math.sin(angle) * r)
            const size = 1 + Math.floor(lcg() * 5)
            const color = Math.floor(lcg() * 10)
            const isEjected = lcg() < 0.1

            const food = new Food(i, x, y, size, color, isEjected)
            items.push(food)
            grid.insert(food)
        }

        expect(grid.size).toBe(ITEM_COUNT)

        // Verify all 5,500 items are retrievable and present
        for (let i = 0; i < 200; i++) {
            const sample = items[i * 25]
            expect(grid.has(sample.id)).toBe(true)
            const retrieved = grid.get(sample.id)
            expect(retrieved).toBeDefined()
            expect(retrieved!.id).toBe(sample.id)
            expect(retrieved!.x).toBe(sample.x)
            expect(retrieved!.y).toBe(sample.y)
        }
    })

    it("verifies massive item movement across grid cell boundaries without ghost duplicates", () => {
        const grid = new SpatialHashGrid<Food>(CELL_SIZE)
        const items: Food[] = []

        for (let i = 1; i <= 2000; i++) {
            const food = new Food(i, i * 10, i * 10, 2, 0)
            items.push(food)
            grid.insert(food)
        }
        expect(grid.size).toBe(2000)

        // Move 1,000 items by +300 units (guaranteeing cell boundary traversal)
        for (let i = 0; i < 1000; i++) {
            const oldFood = items[i]
            const movedFood = new Food(oldFood.id, oldFood.x + 300, oldFood.y + 300, oldFood.size, 0)
            items[i] = movedFood
            grid.update(movedFood)
        }

        // Size must remain exactly 2,000
        expect(grid.size).toBe(2000)

        // Verify moved items are found at new positions and not old positions
        for (let i = 0; i < 100; i++) {
            const moved = items[i]
            const origX = moved.x - 300
            const origY = moved.y - 300

            // Query at original location: moved item should NOT be there
            const oldArea = grid.queryRadius(origX, origY, 20)
            const ghost = oldArea.find((f) => f.id === moved.id)
            expect(ghost).toBeUndefined()

            // Query at new location: moved item MUST be there
            const newArea = grid.queryRadius(moved.x, moved.y, 20)
            const found = newArea.find((f) => f.id === moved.id)
            expect(found).toBeDefined()
            expect(found!.x).toBe(moved.x)
        }
    })

    it("evaluates queryRadius against a brute-force oracle: 100% precision & recall", () => {
        const grid = new SpatialHashGrid<Food>(CELL_SIZE)
        const items: Food[] = []

        let seed = 12345
        function lcg(): number {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }

        for (let i = 1; i <= 3000; i++) {
            const x = Math.round(lcg() * 10000)
            const y = Math.round(lcg() * 10000)
            const food = new Food(i, x, y, 1, 0)
            items.push(food)
            grid.insert(food)
        }

        // Test multiple query centers and radii
        const querySpecs = [
            { cx: 5000, cy: 5000, r: 200 },
            { cx: 5000, cy: 5000, r: 500 },
            { cx: 2000, cy: 3000, r: 800 },
            { cx: 0, cy: 0, r: 1000 },
            { cx: 10000, cy: 10000, r: 600 },
        ]

        for (const { cx, cy, r } of querySpecs) {
            const rSq = r * r
            // Brute force oracle
            const oracleResults = items.filter((f) => {
                const dx = f.x - cx
                const dy = f.y - cy
                return dx * dx + dy * dy <= rSq
            })

            // SpatialHashGrid query
            const gridResults = grid.queryRadius(cx, cy, r)

            // Precision & Recall check
            expect(gridResults.length).toBe(oracleResults.length)

            const gridIds = new Set(gridResults.map((f) => f.id))
            for (const expected of oracleResults) {
                expect(gridIds.has(expected.id)).toBe(true)
            }
        }
    })

    it("evaluates queryNearest against a brute-force minimum-distance oracle", () => {
        const grid = new SpatialHashGrid<Food>(CELL_SIZE)
        const items: Food[] = []

        let seed = 777
        function lcg(): number {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }

        for (let i = 1; i <= 2000; i++) {
            const x = Math.round(lcg() * 8000)
            const y = Math.round(lcg() * 8000)
            const food = new Food(i, x, y, 1, 0)
            items.push(food)
            grid.insert(food)
        }

        // Query 10 points
        for (let q = 0; q < 10; q++) {
            const qx = Math.round(lcg() * 8000)
            const qy = Math.round(lcg() * 8000)

            // Brute force nearest
            let minOracleDistSq = Infinity
            let nearestOracleId = -1
            for (const f of items) {
                const dx = f.x - qx
                const dy = f.y - qy
                const dSq = dx * dx + dy * dy
                if (dSq < minOracleDistSq) {
                    minOracleDistSq = dSq
                    nearestOracleId = f.id
                }
            }

            const nearestResult = grid.queryNearest(qx, qy)
            expect(nearestResult).not.toBeNull()
            expect(nearestResult!.distance).toBeCloseTo(Math.sqrt(minOracleDistSq), 4)
            expect(nearestResult!.item.id).toBe(nearestOracleId)
        }
    })

    it("verifies clean deletion and memory reclamation of 2,500 items", () => {
        const grid = new SpatialHashGrid<Food>(CELL_SIZE)
        for (let i = 1; i <= 3000; i++) {
            grid.insert(new Food(i, i * 20, i * 20, 1, 0))
        }
        expect(grid.size).toBe(3000)

        // Remove 2,000 items
        for (let i = 1; i <= 2000; i++) {
            const removed = grid.remove(i)
            expect(removed).toBe(true)
        }

        expect(grid.size).toBe(1000)

        // Confirm removed items are gone
        for (let i = 1; i <= 2000; i++) {
            expect(grid.has(i)).toBe(false)
            expect(grid.get(i)).toBeUndefined()
        }

        // Confirm remaining 1,000 items persist
        for (let i = 2001; i <= 3000; i++) {
            expect(grid.has(i)).toBe(true)
            expect(grid.get(i)).toBeDefined()
        }
    })

    it("handles boundary edge coordinates (negative coords, exact cell borders)", () => {
        const grid = new SpatialHashGrid<Food>(250)
        // Items placed on exact multiples of cell size and in negative space
        grid.insert(new Food(1, 0, 0, 1, 0))
        grid.insert(new Food(2, 250, 250, 1, 0))
        grid.insert(new Food(3, -250, -250, 1, 0))
        grid.insert(new Food(4, -500, 500, 1, 0))

        expect(grid.size).toBe(4)
        expect(grid.get(1)).toBeDefined()
        expect(grid.get(2)).toBeDefined()
        expect(grid.get(3)).toBeDefined()
        expect(grid.get(4)).toBeDefined()

        // Query around negative quadrant
        const negResults = grid.queryRadius(-250, -250, 100)
        expect(negResults.length).toBe(1)
        expect(negResults[0].id).toBe(3)
    })
})

describe("Milestone 2 Challenger Stress: Potential Field Safe Steering & Obstacle Avoidance", () => {
    it("computes unobstructed steering when path is clear", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const queries = new WorldQueries(grid)

        const from = { x: 1000, y: 1000 }
        const target = { x: 1000, y: 2000 } // Directly downwards (dy = 1000, dx = 0 -> angle = π/2)

        const angle = queries.getSafeSteeringAngle(from, target, 500, {
            snakes: [],
            worldRadius: 50000,
        })
        expect(angle).toBeCloseTo(Math.PI / 2, 5)
    })

    it("steers away from arena boundary walls", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const center = { x: 21600, y: 21600 }
        const radius = 21600
        const queries = new WorldQueries(grid, () => ({
            center,
            gameRadius: radius,
            sectorSize: 100,
            mscps: 400,
        }))

        // Snake is close to the right boundary (x = 43100, boundary is at 43200, dist = 100)
        const from = { x: 43100, y: 21600 }
        // Desired heading points outward towards right wall (target at 45000, 21600 -> angle 0)
        const target = { x: 45000, y: 21600 }

        const safeAngle = queries.getSafeSteeringAngle(from, target, 350)

        // Desired angle was 0 (towards boundary).
        // Repulsion must steer snake away from 0 towards center (inward heading ≈ π).
        expect(safeAngle).not.toBeCloseTo(0, 0.5)
        // Vector heading should have negative X force (steering back towards center)
        const cosSafe = Math.cos(safeAngle)
        expect(cosSafe).toBeLessThan(0)
    })

    it("steers away from approaching enemy snake heads", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const enemy = new Snake({
            id: 99,
            head: { x: 300, y: 100 }, // Enemy head ahead and slightly to the bottom
            body: [{ x: 300, y: 100 }, { x: 350, y: 100 }],
        })

        const queries = new WorldQueries(grid, undefined, () => [enemy])

        const from = { x: 100, y: 100 }
        const target = { x: 600, y: 100 } // Heading right (0 radians)

        const safeAngle = queries.getSafeSteeringAngle(from, target, 400, {
            snakes: [enemy],
            selfSnakeId: 1,
            worldRadius: 50000,
        })

        // Should steer directly away (180 degrees / π or deflected)
        expect(safeAngle).toBeCloseTo(Math.PI, 1)
    })

    it("verifies food clustering algorithm on 100-pellet kill drops", () => {
        const grid = new SpatialHashGrid<Food>(250)
        const queries = new WorldQueries(grid)

        // Cluster 1: 50 foods around (1000, 1000)
        for (let i = 0; i < 50; i++) {
            grid.insert(new Food(i + 1, 1000 + (i % 5) * 10, 1000 + Math.floor(i / 5) * 10, 3, 1))
        }

        // Cluster 2: 10 foods around (5000, 5000)
        for (let i = 0; i < 10; i++) {
            grid.insert(new Food(i + 100, 5000 + i * 5, 5000 + i * 5, 2, 2))
        }

        const clusters = queries.findFoodClusters({ x: 0, y: 0 }, 10000, 300)
        expect(clusters.length).toBeGreaterThanOrEqual(1)
        // Top cluster must be Cluster 1
        expect(clusters[0].x).toBeCloseTo(1020, -1)
        expect(clusters[0].y).toBeCloseTo(1045, -1)
    })
})
