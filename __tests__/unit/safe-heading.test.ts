import { describe, expect, it } from "vitest"

import { SpatialHashGrid, WorldQueries } from "../../src/math/spatial-grid.js"
import { Snake } from "../../src/models/snake.js"

function queries(snakes: Snake[]): WorldQueries {
    return new WorldQueries(
        new SpatialHashGrid(250) as any,
        () => ({ gameRadius: 10000, center: { x: 10000, y: 10000 }, sectorSize: 300, mscps: 430 }),
        () => snakes,
    )
}

function wall(id: number, x: number, fromY: number, toY: number): Snake {
    const body = []
    for (let y = fromY; y <= toY; y += 20) body.push({ x, y })
    return new Snake({ id, head: body[0], body, angle: Math.PI / 2 })
}

describe("WorldQueries.findSafeHeading", () => {
    const from = { x: 10000, y: 10000 }

    it("keeps the desired heading when the way is clear", () => {
        const result = queries([]).findSafeHeading(from, 0)
        expect(result.avoiding).toBe(false)
        expect(result.angle).toBeCloseTo(0)
    })

    it("steers around an enemy body blocking the path", () => {
        const enemy = wall(2, 10200, 9500, 10500)
        const result = queries([enemy]).findSafeHeading(from, 0, { selfSnakeId: 1 })
        expect(result.avoiding).toBe(true)
        expect(result.trapped).toBe(false)
        // The chosen heading must not run into the wall
        const x = from.x + Math.cos(result.angle) * 450
        const y = from.y + Math.sin(result.angle) * 450
        const hitsWall = x > 10150 && y > 9500 && y < 10500
        expect(hitsWall).toBe(false)
    })

    it("ignores its own body near the head but avoids the rest of it", () => {
        const own = wall(1, 10200, 9500, 10500)
        const clear = queries([own]).findSafeHeading(from, 0, { selfSnakeId: 1, selfTailTolerance: 1000 })
        expect(clear.avoiding).toBe(false)
        const blocked = queries([own]).findSafeHeading(from, 0, { selfSnakeId: 1, selfTailTolerance: 0 })
        expect(blocked.avoiding).toBe(true)
    })

    it("turns away from the arena edge", () => {
        const edge = { x: 10000 + 9900, y: 10000 }
        const result = queries([]).findSafeHeading(edge, 0)
        expect(result.avoiding).toBe(true)
        expect(Math.cos(result.angle)).toBeLessThan(0.5)
    })

    it("reports being trapped when every heading is blocked", () => {
        const ring: Snake[] = []
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2
            const x = from.x + Math.cos(a) * 120
            const y = from.y + Math.sin(a) * 120
            ring.push(new Snake({ id: 10 + i, head: { x, y }, body: [{ x, y }, { x: x + 1, y }], angle: 0 }))
        }
        const result = queries(ring).findSafeHeading(from, 0, { selfSnakeId: 1 })
        expect(result.trapped).toBe(true)
    })
})
