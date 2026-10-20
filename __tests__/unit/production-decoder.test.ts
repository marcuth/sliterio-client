import { describe, expect, it } from "vitest"

import { GameState } from "../../src/models/game-state.js"
import { ProductionDecoder } from "../../src/protocol/production-decoder.js"

function u24(v: number): number[] {
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function u16(v: number): number[] {
    return [(v >> 8) & 255, v & 255]
}

/** Initial setup captured from an official server (protocol 19). */
const SETUP = [
    97, 0, 127, 38, 1, 174, 1, 44, 0, 102, 48, 2, 27, 0, 40, 5, 120, 0, 33, 0, 29, 1, 174, 19, 42,
]

function snakePacket(id: number, x: number, y: number, iang: number): Uint8Array {
    return new Uint8Array([
        115,
        ...u16(id),
        ...u24(0),
        48,
        ...u24(0),
        ...u16(5790),
        ...u24(0),
        3,
        ...u24(x * 5),
        ...u24(y * 5),
        2,
        ...Buffer.from("ab"),
        0, // custom skin length
        255, // cosmetic
        ...u24(x * 5 - 100),
        ...u24(y * 5),
        ...u16(iang),
    ])
}

describe("ProductionDecoder", () => {
    it("decodes the initial setup packet with the production field sizes", () => {
        const decoder = new ProductionDecoder()
        const [packet] = decoder.decode(new Uint8Array(SETUP))
        expect(packet).toMatchObject({
            type: "initial_setup",
            gameRadius: 32550,
            mscps: 430,
            sectorSize: 300,
            sectorCount: 102,
            protocolVersion: 19,
            defaultMsl: 42,
        })
        expect(decoder.sectorSize).toBe(300)
    })

    it("places sector-batched food using the sector size", () => {
        const decoder = new ProductionDecoder()
        decoder.decode(new Uint8Array(SETUP))
        const [packet] = decoder.decode(new Uint8Array([70, 104, 113, 5, 128, 64, 10]))
        expect(packet.type).toBe("food_batch")
        if (packet.type !== "food_batch") return
        expect(packet.foods).toHaveLength(1)
        expect(packet.foods[0].x).toBeCloseTo(104 * 300 + (128 * 300) / 256)
        expect(packet.foods[0].y).toBeCloseTo(113 * 300 + (64 * 300) / 256)
        expect(packet.foods[0].size).toBe(2)
    })

    it("reuses the previous sector for short food and eaten packets", () => {
        const decoder = new ProductionDecoder()
        decoder.decode(new Uint8Array(SETUP))
        const [spawn] = decoder.decode(new Uint8Array([102, 10, 20, 4, 3, 7, 10]))
        const [short] = decoder.decode(new Uint8Array([102, 8, 9, 15]))
        expect(spawn.type).toBe("food_spawn")
        expect(short).toMatchObject({ type: "food_spawn", x: 10 * 300 + 8 * (300 / 256) })

        const [eaten] = decoder.decode(new Uint8Array([99, 10, 20, 3, 7]))
        const [eatenShort] = decoder.decode(new Uint8Array([99, 3, 7]))
        expect(eaten.type).toBe("food_eaten")
        if (eaten.type === "food_eaten" && eatenShort.type === "food_eaten") {
            expect(eatenShort.id).toBe(eaten.id)
        }
    })

    it("derives own snake movement from the heading, without coordinates", () => {
        const decoder = new ProductionDecoder()
        decoder.decode(new Uint8Array(SETUP))
        decoder.decode(snakePacket(394, 1000, 2000, 0))
        expect(decoder.selfId).toBe(394)

        // G with an angle (quarter turn): head moves msl (42) along +y
        const [move] = decoder.decode(new Uint8Array([71, ...u16(16384)]))
        expect(move).toMatchObject({ type: "snake_move", snakeId: 394, advance: true })
        if (move.type === "snake_move") {
            expect(move.x).toBeCloseTo(1000 - 20 + 42, 1)
            expect(move.y).toBeCloseTo(2000 + 42, 1)
        }

        // G without payload reuses the last angle
        const [again] = decoder.decode(new Uint8Array([71]))
        if (again.type === "snake_move") {
            expect(again.y).toBeCloseTo(2000 + 84, 1)
        }
    })

    it("treats short rotation packets as the own snake", () => {
        const decoder = new ProductionDecoder()
        decoder.decode(new Uint8Array(SETUP))
        decoder.decode(snakePacket(394, 1000, 2000, 0))
        const [rotate] = decoder.decode(new Uint8Array([101, 64, 36]))
        expect(rotate).toMatchObject({ type: "snake_rotate", snakeId: 394 })
        if (rotate.type === "snake_rotate") {
            expect(rotate.angle).toBeCloseTo(Math.PI / 2)
            expect(rotate.speed).toBeCloseTo(2)
        }
    })

    it("keeps the real body when applied to the game state", () => {
        const decoder = new ProductionDecoder()
        const state = new GameState()
        const feed = (bytes: number[] | Uint8Array) => {
            for (const packet of decoder.decode(new Uint8Array(bytes))) state.updateFromPacket(packet)
        }
        feed(SETUP)
        feed(snakePacket(394, 1000, 2000, 0))
        state.mySnakeId = 394

        const snake = state.snakes.get(394)!
        const length = snake.body.length
        feed([71])
        expect(snake.head.x).toBeCloseTo(1000 - 20 + 84, 1)
        expect(snake.body).toHaveLength(length)
    })

    it("removes snakes and reports kills", () => {
        const decoder = new ProductionDecoder()
        decoder.decode(new Uint8Array(SETUP))
        decoder.decode(snakePacket(212, 500, 500, 0))
        const [removed] = decoder.decode(new Uint8Array([115, ...u16(212), 1]))
        expect(removed).toMatchObject({ type: "snake_remove", snakeId: 212, status: "died" })
    })
})
