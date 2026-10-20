import { describe, expect, it } from "vitest"

import { decodeSlitherSecret } from "../../src/protocol/secret-resolver.js"

describe("Secret Resolver (decodeSlitherSecret)", () => {
    describe("Input validation & length boundaries", () => {
        it("throws when input is empty or nullish", () => {
            // @ts-expect-error testing invalid input
            expect(() => decodeSlitherSecret(null)).toThrow(/Invalid secret length/)
            // @ts-expect-error testing invalid input
            expect(() => decodeSlitherSecret(undefined)).toThrow(/Invalid secret length/)
            expect(() => decodeSlitherSecret(new Uint8Array(0))).toThrow(/Invalid secret length/)
        })

        it("throws when input length is strictly less than 65 bytes", () => {
            expect(() => decodeSlitherSecret(new Uint8Array(1))).toThrow(/Invalid secret length.*got 1/)
            expect(() => decodeSlitherSecret(new Uint8Array(17))).toThrow(/Invalid secret length.*got 17/)
            expect(() => decodeSlitherSecret(new Uint8Array(64))).toThrow(/Invalid secret length.*got 64/)
        })

        it("succeeds when input length is exactly 65 bytes", () => {
            const buf = new Uint8Array(65).fill(97) // 'a'
            const token = decodeSlitherSecret(buf)
            expect(token).toBeInstanceOf(Uint8Array)
            expect(token.length).toBe(24)
        })

        it("succeeds with oversized buffers (>= 65 bytes)", () => {
            const buf70 = new Uint8Array(70).fill(97)
            const buf128 = new Uint8Array(128).fill(97)
            const buf256 = new Uint8Array(256).fill(97)
            expect(decodeSlitherSecret(buf70).length).toBe(24)
            expect(decodeSlitherSecret(buf128).length).toBe(24)
            expect(decodeSlitherSecret(buf256).length).toBe(24)
        })
    })

    describe("Deterministic test vectors & ASCII properties", () => {
        it('resolves deterministic vector (all "a", 97) with correct first byte and ASCII codes', () => {
            const buf = new Uint8Array(70).fill(97)
            const token = decodeSlitherSecret(buf)
            expect(token.length).toBe(24)

            // Iteration 0: value1=25, value2=8 -> interimResult=408 -> offset=97 -> interimResult=311
            // globalValue=313 -> (311+313)%26 = 624%26 = 0 -> char = 0 + 97 = 97 ('a')
            expect(token[0]).toBe(97) // 'a'

            // Iteration 1: value1=17, value2=0 -> interimResult=272 -> offset=97 -> interimResult=175
            // globalValue=627 -> (175+627)%26 = 802%26 = 22 -> char = 22 + 97 = 119 ('w')
            expect(token[1]).toBe(119) // 'w'

            // Check all bytes are printable ASCII letters [65..90] or [97..122]
            for (let i = 0; i < 24; i++) {
                const byte = token[i]
                const isLetter = (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
                expect(isLetter).toBe(true)
            }
        })

        it("is idempotent and returns fresh instances", () => {
            const buf = new Uint8Array(70).fill(105)
            const token1 = decodeSlitherSecret(buf)
            const token2 = decodeSlitherSecret(buf)
            expect(token1).toEqual(token2)
            expect(token1).not.toBe(token2)
        })
    })

    describe("ASCII case normalization", () => {
        it("produces identical tokens for uppercase and lowercase challenge inputs", () => {
            const lowerBuf = new Uint8Array(70).fill(97) // 'a'
            const upperBuf = new Uint8Array(70).fill(65) // 'A'
            expect(decodeSlitherSecret(lowerBuf)).toEqual(decodeSlitherSecret(upperBuf))
        })

        it("normalizes mixed-case input identically to lowercase equivalent", () => {
            const lower = new Uint8Array(70)
            const mixed = new Uint8Array(70)
            for (let i = 0; i < 70; i++) {
                lower[i] = 97 + (i % 26)
                mixed[i] = i % 2 === 0 ? 65 + (i % 26) : 97 + (i % 26)
            }
            expect(decodeSlitherSecret(mixed)).toEqual(decodeSlitherSecret(lower))
        })
    })

    describe("Polymorphic input support", () => {
        it("accepts Buffer, Uint8Array, and number[]", () => {
            const arr = new Array(70).fill(98)
            const uint8 = new Uint8Array(arr)
            const nodeBuf = Buffer.from(arr)

            const resArr = decodeSlitherSecret(arr)
            const resUint8 = decodeSlitherSecret(uint8)
            const resNodeBuf = decodeSlitherSecret(nodeBuf)

            expect(resArr).toEqual(resUint8)
            expect(resUint8).toEqual(resNodeBuf)
        })
    })

    describe("Immutability", () => {
        it("does not mutate input buffer", () => {
            const original = new Uint8Array(70).fill(100)
            const copy = new Uint8Array(original)
            decodeSlitherSecret(original)
            expect(original).toEqual(copy)
        })
    })
})
