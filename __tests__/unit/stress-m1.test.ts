/**
 * @file stress-m1.test.ts
 * @description Empirical Challenger M1-1 Stress Test Suite:
 * 1. Property-based fuzzing and edge cases for 24-bit integer codec (BinaryReader & BinaryWriter).
 * 2. Exhaustive stress testing and boundary validation for decodeSlitherSecret.
 */

import { describe, expect, it } from "vitest"
import { BinaryReader, BufferUnderflowError } from "../../src/protocol/binary-reader.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { decodeSlitherSecret } from "../../src/protocol/secret-resolver.js"

describe("Challenger M1-1: 24-bit Integer Codec Empirical Fuzzing", () => {
    describe("Mandatory Boundary Values & Two's Complement Verification", () => {
        const testCases: Array<{ name: string; val: number; expectedBytes: [number, number, number] }> = [
            { name: "zero (0)", val: 0, expectedBytes: [0x00, 0x00, 0x00] },
            { name: "positive one (1)", val: 1, expectedBytes: [0x00, 0x00, 0x01] },
            { name: "negative one (-1)", val: -1, expectedBytes: [0xff, 0xff, 0xff] },
            { name: "max signed 24-bit (8388607)", val: 8388607, expectedBytes: [0x7f, 0xff, 0xff] },
            { name: "min signed 24-bit (-8388608)", val: -8388608, expectedBytes: [0x80, 0x00, 0x00] },
            { name: "positive two (2)", val: 2, expectedBytes: [0x00, 0x00, 0x02] },
            { name: "negative two (-2)", val: -2, expectedBytes: [0xff, 0xff, 0xfe] },
            { name: "negative min+1 (-8388607)", val: -8388607, expectedBytes: [0x80, 0x00, 0x01] },
            { name: "positive max-1 (8388606)", val: 8388606, expectedBytes: [0x7f, 0xff, 0xfe] },
        ]

        for (const tc of testCases) {
            it(`round-trips ${tc.name} with exact Big-Endian byte layout`, () => {
                const writer = new BinaryWriter(3)
                writer.writeInt24(tc.val)
                const buf = writer.toUint8Array()

                expect(buf.length).toBe(3)
                expect(buf[0]).toBe(tc.expectedBytes[0])
                expect(buf[1]).toBe(tc.expectedBytes[1])
                expect(buf[2]).toBe(tc.expectedBytes[2])

                const reader = new BinaryReader(buf)
                const decoded = reader.readInt24()
                expect(decoded).toBe(tc.val)
                expect(reader.remaining).toBe(0)
            })
        }

        it("verifies unsigned 24-bit boundaries (0 to 16777215)", () => {
            const unsignedCases = [
                { val: 0, bytes: [0x00, 0x00, 0x00] },
                { val: 1, bytes: [0x00, 0x00, 0x01] },
                { val: 8388607, bytes: [0x7f, 0xff, 0xff] },
                { val: 8388608, bytes: [0x80, 0x00, 0x00] },
                { val: 16777214, bytes: [0xff, 0xff, 0xfe] },
                { val: 16777215, bytes: [0xff, 0xff, 0xff] },
            ]

            for (const tc of unsignedCases) {
                const writer = new BinaryWriter()
                writer.writeUint24(tc.val)
                const buf = writer.toUint8Array()
                expect(buf[0]).toBe(tc.bytes[0])
                expect(buf[1]).toBe(tc.bytes[1])
                expect(buf[2]).toBe(tc.bytes[2])

                const reader = new BinaryReader(buf)
                expect(reader.readUint24()).toBe(tc.val)
                expect(reader.remaining).toBe(0)
            }
        })
    })

    describe("Generative Property-Based Fuzzing", () => {
        it("fuzzes 5,000 random signed Int24 values in [-8388608, 8388607]", () => {
            const writer = new BinaryWriter()
            const values: number[] = []

            for (let i = 0; i < 5000; i++) {
                // Generate random integer in [-8388608, 8388607]
                const val = Math.floor(Math.random() * 16777216) - 8388608
                values.push(val)
                writer.writeInt24(val)
            }

            const buf = writer.toUint8Array()
            expect(buf.length).toBe(5000 * 3)

            const reader = new BinaryReader(buf)
            for (let i = 0; i < 5000; i++) {
                const decoded = reader.readInt24()
                expect(decoded).toBe(values[i])
            }
            expect(reader.remaining).toBe(0)
        })

        it("fuzzes 5,000 random unsigned Uint24 values in [0, 16777215]", () => {
            const writer = new BinaryWriter()
            const values: number[] = []

            for (let i = 0; i < 5000; i++) {
                const val = Math.floor(Math.random() * 16777216)
                values.push(val)
                writer.writeUint24(val)
            }

            const buf = writer.toUint8Array()
            expect(buf.length).toBe(5000 * 3)

            const reader = new BinaryReader(buf)
            for (let i = 0; i < 5000; i++) {
                const decoded = reader.readUint24()
                expect(decoded).toBe(values[i])
            }
            expect(reader.remaining).toBe(0)
        })
    })

    describe("Sign Extension & Two's Complement Invariants", () => {
        it("strictly preserves sign extension on negative Int24 values", () => {
            // Test stepped negative numbers from -1 down to -8388608
            for (let val = -1; val >= -8388608; val = val < -1000 ? Math.floor(val * 1.5) : val - 50) {
                const writer = new BinaryWriter(3)
                writer.writeInt24(val)
                const reader = new BinaryReader(writer.toUint8Array())
                const result = reader.readInt24()

                // Check value equality
                expect(result).toBe(val)
                // Check negative sign
                expect(result < 0).toBe(true)
                // Check bit 23 in raw buffer is 1
                expect(writer.toUint8Array()[0] & 0x80).toBe(0x80)
            }
        })

        it("strictly prevents sign pollution on positive Int24 values", () => {
            for (let val = 0; val <= 8388607; val = val > 1000 ? Math.floor(val * 1.5) : val + 50) {
                const writer = new BinaryWriter(3)
                writer.writeInt24(val)
                const reader = new BinaryReader(writer.toUint8Array())
                const result = reader.readInt24()

                expect(result).toBe(val)
                expect(result >= 0).toBe(true)
                // Check bit 23 in raw buffer is 0
                expect(writer.toUint8Array()[0] & 0x80).toBe(0)
            }
        })
    })

    describe("Overflow, Truncation & Bitmasking Behavior", () => {
        it("masks out-of-range positive integers to lower 24 bits in writeUint24", () => {
            const testCases = [
                { input: 16777216, expectedMasked: 0 }, // 2^24
                { input: 16777217, expectedMasked: 1 }, // 2^24 + 1
                { input: 0x12345678, expectedMasked: 0x345678 },
                { input: 0xffffffff, expectedMasked: 0xffffff },
            ]

            for (const tc of testCases) {
                const writer = new BinaryWriter(3)
                writer.writeUint24(tc.input)
                const reader = new BinaryReader(writer.toUint8Array())
                expect(reader.readUint24()).toBe(tc.expectedMasked)
            }
        })

        it("masks negative numbers to 24-bit unsigned representation in writeUint24", () => {
            const writer = new BinaryWriter(3)
            writer.writeUint24(-1)
            const reader = new BinaryReader(writer.toUint8Array())
            expect(reader.readUint24()).toBe(16777215) // 0xFFFFFF
        })

        it("wraps overflow in writeInt24 consistently with two's complement", () => {
            const writer = new BinaryWriter(3)
            writer.writeInt24(8388608) // 0x800000 -> sign bit 23 is 1 -> -8388608
            const reader = new BinaryReader(writer.toUint8Array())
            expect(reader.readInt24()).toBe(-8388608)
        })

        it("handles fractional numbers by truncating to integer via bitwise coercion", () => {
            const writer = new BinaryWriter(6)
            writer.writeUint24(12345.678)
            writer.writeInt24(-54321.99)
            const reader = new BinaryReader(writer.toUint8Array())
            expect(reader.readUint24()).toBe(12345)
            expect(reader.readInt24()).toBe(-54321)
        })

        it("handles NaN and Infinity safely as 0", () => {
            const writer = new BinaryWriter(6)
            writer.writeUint24(NaN)
            writer.writeInt24(Infinity)
            const reader = new BinaryReader(writer.toUint8Array())
            expect(reader.readUint24()).toBe(0)
            expect(reader.readInt24()).toBe(0)
        })
    })

    describe("Sequential Streaming & Mixed Codec Alignment", () => {
        it("preserves stream alignment across mixed 8, 16, 24, 32 bit writes", () => {
            const writer = new BinaryWriter()
            writer.writeUint8(0xaa)
            writer.writeInt24(-123456)
            writer.writeUint16(0xbbcc)
            writer.writeUint24(789101)
            writer.writeInt32(-999999)
            writer.writeUint8(0xdd)

            // Length: 1 + 3 + 2 + 3 + 4 + 1 = 14 bytes
            expect(writer.length).toBe(14)

            const reader = new BinaryReader(writer.toUint8Array())
            expect(reader.length).toBe(14)
            expect(reader.readUint8()).toBe(0xaa)
            expect(reader.readInt24()).toBe(-123456)
            expect(reader.readUint16()).toBe(0xbbcc)
            expect(reader.readUint24()).toBe(789101)
            expect(reader.readInt32()).toBe(-999999)
            expect(reader.readUint8()).toBe(0xdd)
            expect(reader.remaining).toBe(0)
        })
    })

    describe("Buffer Underflow & Boundary Protection", () => {
        it("throws BufferUnderflowError for buffers smaller than 3 bytes", () => {
            for (let len = 0; len < 3; len++) {
                const buf = new Uint8Array(len)
                const readerU = new BinaryReader(buf)
                expect(() => readerU.readUint24()).toThrow(BufferUnderflowError)

                const readerI = new BinaryReader(buf)
                expect(() => readerI.readInt24()).toThrow(BufferUnderflowError)
            }
        })

        it("verifies BufferUnderflowError carries accurate debug metadata", () => {
            const buf = new Uint8Array([1, 2])
            const reader = new BinaryReader(buf)
            try {
                reader.readUint24()
                expect.unreachable()
            } catch (err) {
                expect(err).toBeInstanceOf(BufferUnderflowError)
                const bErr = err as BufferUnderflowError
                expect(bErr.requestedBytes).toBe(3)
                expect(bErr.availableBytes).toBe(2)
                expect(bErr.currentOffset).toBe(0)
                expect(bErr.totalLength).toBe(2)
            }
        })
    })
})

describe("Challenger M1-1: decodeSlitherSecret Empirical Stress Testing", () => {
    describe("Length Boundaries (0 through 1,000+ bytes)", () => {
        it("strictly rejects all buffers of length 0 through 64", () => {
            for (let len = 0; len < 65; len++) {
                const buf = new Uint8Array(len).fill(97)
                expect(() => decodeSlitherSecret(buf)).toThrow(/Invalid secret length.*expected at least 65 bytes/)
            }
        })

        it("succeeds for exact boundary length of 65 bytes", () => {
            const buf = new Uint8Array(65).fill(97)
            const token = decodeSlitherSecret(buf)
            expect(token).toBeInstanceOf(Uint8Array)
            expect(token.length).toBe(24)
        })

        it("succeeds for length 66 (boundary + 1)", () => {
            const buf = new Uint8Array(66).fill(97)
            const token = decodeSlitherSecret(buf)
            expect(token.length).toBe(24)
        })

        it("succeeds across random lengths from 65 to 500 bytes", () => {
            for (let trial = 0; trial < 100; trial++) {
                const len = 65 + Math.floor(Math.random() * 436) // [65, 500]
                const buf = new Uint8Array(len)
                for (let i = 0; i < len; i++) {
                    buf[i] = 32 + Math.floor(Math.random() * 95) // printable ASCII [32, 126]
                }
                const token = decodeSlitherSecret(buf)
                expect(token).toBeInstanceOf(Uint8Array)
                expect(token.length).toBe(24)
            }
        })

        it("succeeds on large 1,000-byte buffers", () => {
            for (let trial = 0; trial < 20; trial++) {
                const buf = new Uint8Array(1000)
                for (let i = 0; i < 1000; i++) {
                    buf[i] = Math.floor(Math.random() * 256)
                }
                const token = decodeSlitherSecret(buf)
                expect(token.length).toBe(24)
            }
        })

        it("succeeds on extreme 10,000-byte buffer", () => {
            const buf = new Uint8Array(10000).fill(107) // 'k'
            const token = decodeSlitherSecret(buf)
            expect(token.length).toBe(24)
        })
    })

    describe("ASCII Invariant & Character Set Verification", () => {
        it("guarantees every byte of the 24-byte token is valid ASCII letter [A-Za-z]", () => {
            // Test 500 random challenge buffers with arbitrary bytes [0, 255]
            for (let trial = 0; trial < 500; trial++) {
                const buf = new Uint8Array(70)
                for (let i = 0; i < 70; i++) {
                    buf[i] = Math.floor(Math.random() * 256)
                }
                const token = decodeSlitherSecret(buf)
                expect(token.length).toBe(24)

                for (let i = 0; i < 24; i++) {
                    const byte = token[i]
                    const isUpper = byte >= 65 && byte <= 90
                    const isLower = byte >= 97 && byte <= 122
                    expect(isUpper || isLower).toBe(true)
                }
            }
        })
    })

    describe("Case Normalization Stress Testing", () => {
        it("fuzzes 1,000 randomized letter challenges verifying case invariance", () => {
            for (let trial = 0; trial < 1000; trial++) {
                const lowerBuf = new Uint8Array(70)
                const upperBuf = new Uint8Array(70)
                const mixedBuf = new Uint8Array(70)

                for (let i = 0; i < 70; i++) {
                    const charCode = 97 + Math.floor(Math.random() * 26) // 'a'-'z'
                    lowerBuf[i] = charCode
                    upperBuf[i] = charCode - 32 // 'A'-'Z'
                    mixedBuf[i] = Math.random() < 0.5 ? charCode : charCode - 32
                }

                const tokenLower = decodeSlitherSecret(lowerBuf)
                const tokenUpper = decodeSlitherSecret(upperBuf)
                const tokenMixed = decodeSlitherSecret(mixedBuf)

                expect(tokenLower).toEqual(tokenUpper)
                expect(tokenLower).toEqual(tokenMixed)
            }
        })
    })

    describe("Tail & Header Byte Isolation (Indifference)", () => {
        it("verifies bytes 0..16 and bytes 65..N do NOT affect the resolved token", () => {
            const base = new Uint8Array(100)
            for (let i = 0; i < 100; i++) {
                base[i] = 97 + (i % 26)
            }
            const expectedToken = decodeSlitherSecret(base)

            // Randomize bytes 0..16 and 65..99
            for (let trial = 0; trial < 50; trial++) {
                const modified = new Uint8Array(base)
                // Randomize prefix [0, 16]
                for (let i = 0; i <= 16; i++) {
                    modified[i] = Math.floor(Math.random() * 256)
                }
                // Randomize suffix [65, 99]
                for (let i = 65; i < 100; i++) {
                    modified[i] = Math.floor(Math.random() * 256)
                }

                const token = decodeSlitherSecret(modified)
                expect(token).toEqual(expectedToken)
            }
        })
    })

    describe("Polymorphic Types & Stability", () => {
        it("processes number[] and Buffer identically to Uint8Array on random vectors", () => {
            for (let trial = 0; trial < 20; trial++) {
                const raw: number[] = []
                for (let i = 0; i < 80; i++) {
                    raw.push(Math.floor(Math.random() * 256))
                }
                const uint8 = new Uint8Array(raw)
                const buf = Buffer.from(raw)

                const tokenFromArr = decodeSlitherSecret(raw)
                const tokenFromUint8 = decodeSlitherSecret(uint8)
                const tokenFromBuf = decodeSlitherSecret(buf)

                expect(tokenFromArr).toEqual(tokenFromUint8)
                expect(tokenFromArr).toEqual(tokenFromBuf)
            }
        })

        it("does not mutate input array across 100 runs", () => {
            const original = new Uint8Array(75)
            for (let i = 0; i < 75; i++) original[i] = (i * 7) % 256
            const copy = new Uint8Array(original)

            for (let i = 0; i < 100; i++) {
                decodeSlitherSecret(original)
            }

            expect(original).toEqual(copy)
        })
    })
})
