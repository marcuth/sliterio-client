import { describe, expect, it } from "vitest"

import {
    ClientState,
    decodePacket,
    decodeSlitherSecret,
    Food,
    GameState,
    main,
    Prey,
    SlitherClient,
    Snake,
    SpatialHashGrid,
    Vector2D,
    WorldQueries,
} from "../src/index.js"

describe("Root Index Exports", () => {
    it("main should be a function", () => {
        expect(typeof main).toBe("function")
    })

    it("re-exports all Milestone 2 math and model classes", () => {
        expect(typeof Vector2D).toBe("function")
        expect(typeof SpatialHashGrid).toBe("function")
        expect(typeof WorldQueries).toBe("function")
        expect(typeof Snake).toBe("function")
        expect(typeof Food).toBe("function")
        expect(typeof Prey).toBe("function")
        expect(typeof GameState).toBe("function")
    })

    it("re-exports high-level client SDK and enums", () => {
        expect(typeof SlitherClient).toBe("function")
        expect(ClientState.DISCONNECTED).toBe("DISCONNECTED")
        expect(ClientState.PLAYING).toBe("PLAYING")
    })

    it("re-exports core protocol decoders and secret resolver", () => {
        expect(typeof decodePacket).toBe("function")
        expect(typeof decodeSlitherSecret).toBe("function")
    })
})
