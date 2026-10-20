import { describe, expect, it } from "vitest"

import { BinaryCodecError, BinaryReader, BufferUnderflowError } from "../../src/protocol/binary-reader.js"
import { BinaryWriter } from "../../src/protocol/binary-writer.js"
import { angleToByte, byteToAngle, calcFoodId, uint16ToAngle } from "../../src/protocol/types.js"

describe("BinaryCodec - Reader and Writer Symmetry", () => {
    it("should round-trip Uint8 and Int8 values", () => {
        const writer = new BinaryWriter()
        writer.writeUint8(0).writeUint8(255).writeInt8(-128).writeInt8(127)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readUint8()).toBe(0)
        expect(reader.readUint8()).toBe(255)
        expect(reader.readInt8()).toBe(-128)
        expect(reader.readInt8()).toBe(127)
    })

    it("should round-trip Uint16 and Int16 values (Big-Endian)", () => {
        const writer = new BinaryWriter()
        writer.writeUint16(0).writeUint16(65535).writeInt16(-32768).writeInt16(32767)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readUint16()).toBe(0)
        expect(reader.readUint16()).toBe(65535)
        expect(reader.readInt16()).toBe(-32768)
        expect(reader.readInt16()).toBe(32767)
    })

    it("should round-trip Uint24 boundary values", () => {
        const writer = new BinaryWriter()
        writer.writeUint24(0).writeUint24(16777215).writeUint24(8388607).writeUint24(8388608)
        writer.writeUint24(21600).writeUint24(54000)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readUint24()).toBe(0)
        expect(reader.readUint24()).toBe(16777215)
        expect(reader.readUint24()).toBe(8388607)
        expect(reader.readUint24()).toBe(8388608)
        expect(reader.readUint24()).toBe(21600)
        expect(reader.readUint24()).toBe(54000)
    })

    it("verifies exact Big-Endian byte layout for Uint24", () => {
        const writer = new BinaryWriter()
        writer.writeUint24(0x123456)
        const buf = writer.toUint8Array()
        expect(buf[0]).toBe(0x12)
        expect(buf[1]).toBe(0x34)
        expect(buf[2]).toBe(0x56)
    })

    it("should round-trip Int24 signed values with two's complement sign extension", () => {
        const writer = new BinaryWriter()
        writer.writeInt24(-8388608).writeInt24(8388607).writeInt24(-1).writeInt24(0).writeInt24(100)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readInt24()).toBe(-8388608)
        expect(reader.readInt24()).toBe(8388607)
        expect(reader.readInt24()).toBe(-1)
        expect(reader.readInt24()).toBe(0)
        expect(reader.readInt24()).toBe(100)
    })

    it("should round-trip Uint32 and Int32 boundary values", () => {
        const writer = new BinaryWriter()
        writer.writeUint32(0).writeUint32(4294967295).writeInt32(-2147483648).writeInt32(2147483647)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readUint32()).toBe(0)
        expect(reader.readUint32()).toBe(4294967295)
        expect(reader.readInt32()).toBe(-2147483648)
        expect(reader.readInt32()).toBe(2147483647)
    })

    it("should round-trip Float32 and Float64 values", () => {
        const writer = new BinaryWriter()
        writer.writeFloat32(12.345000267028809).writeFloat32(-98.76000213623047)
        writer.writeFloat64(12345.6789).writeFloat64(-98765.4321)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readFloat32()).toBeCloseTo(12.345, 3)
        expect(reader.readFloat32()).toBeCloseTo(-98.76, 3)
        expect(reader.readFloat64()).toBeCloseTo(12345.6789, 4)
        expect(reader.readFloat64()).toBeCloseTo(-98765.4321, 4)
    })

    it("should encode and decode UTF-8 strings with multi-byte emoji and accents", () => {
        const testString = "🐍 SlitherBot 🚀 100% São Paulo 東京"
        const writer = new BinaryWriter()
        writer.writeString8(testString)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readString8()).toBe(testString)
    })

    it("handles writeString16 and readString16 correctly", () => {
        const str = "Medium length string test"
        const writer = new BinaryWriter()
        writer.writeString16(str)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readString16()).toBe(str)
    })

    it("handles readRemainingBytes and readRemainingString", () => {
        const writer = new BinaryWriter()
        writer.writeUint8(10).writeString("RemainingContent")
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readUint8()).toBe(10)
        expect(reader.readRemainingString()).toBe("RemainingContent")
    })

    it("should throw BufferUnderflowError on EOF read", () => {
        const reader = new BinaryReader(new Uint8Array([1, 2]))
        expect(() => reader.readUint24()).toThrow(BufferUnderflowError)
        expect(() => reader.readUint32()).toThrow(BufferUnderflowError)
        expect(() => reader.readFloat32()).toThrow(BufferUnderflowError)
    })

    it("should throw RangeError when writeString8 exceeds 255 bytes", () => {
        const writer = new BinaryWriter()
        const oversized = "a".repeat(256)
        expect(() => writer.writeString8(oversized)).toThrow(RangeError)
    })

    it("tracks offset, cursor, length, remaining, and hasRemaining accurately", () => {
        const writer = new BinaryWriter()
        writer.writeUint16(500).writeUint8(25)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.length).toBe(3)
        expect(reader.offset).toBe(0)
        expect(reader.cursor).toBe(0)
        expect(reader.remaining).toBe(3)
        expect(reader.hasRemaining(3)).toBe(true)
        expect(reader.hasBytes(4)).toBe(false)

        reader.readUint16()
        expect(reader.offset).toBe(2)
        expect(reader.cursor).toBe(2)
        expect(reader.remaining).toBe(1)

        reader.readUint8()
        expect(reader.offset).toBe(3)
        expect(reader.remaining).toBe(0)
    })

    it("supports peekUint8, skip, seek, and reset", () => {
        const writer = new BinaryWriter()
        writer.writeUint8(1).writeUint8(2).writeUint8(3)
        const reader = new BinaryReader(writer.toUint8Array())

        expect(reader.peekUint8()).toBe(1)
        expect(reader.peekUint8(0)).toBe(1)
        expect(reader.peekUint8(1)).toBe(2)
        expect(reader.peekUint8(2)).toBe(3)
        expect(() => reader.peekUint8(3)).toThrow()
        expect(reader.offset).toBe(0)

        reader.skip(1)
        expect(reader.offset).toBe(1)
        expect(reader.readUint8()).toBe(2)

        reader.seek(0)
        expect(reader.offset).toBe(0)
        expect(reader.readUint8()).toBe(1)

        reader.reset()
        expect(reader.offset).toBe(0)
    })

    it("supports initial offset and sliced views with byteOffset", () => {
        const full = new Uint8Array([10, 20, 30, 40, 50])
        const sliced = full.subarray(2, 5) // [30, 40, 50]
        const reader = new BinaryReader(sliced)
        expect(reader.length).toBe(3)
        expect(reader.readUint8()).toBe(30)
        expect(reader.readUint8()).toBe(40)
        expect(reader.readUint8()).toBe(50)
    })

    it("throws on invalid constructor inputs or out-of-bounds offsets", () => {
        // @ts-expect-error testing invalid input
        expect(() => new BinaryReader("invalid")).toThrow(BinaryCodecError)
        expect(() => new BinaryReader(new Uint8Array(5), -1)).toThrow(RangeError)
        expect(() => new BinaryReader(new Uint8Array(5), 10)).toThrow(RangeError)
    })

    it("dynamically expands BinaryWriter capacity on multiple writes", () => {
        const writer = new BinaryWriter(4)
        expect(writer.capacity).toBe(4)
        writer.writeUint32(0x11223344)
        expect(writer.length).toBe(4)
        writer.writeUint32(0x55667788)
        expect(writer.capacity).toBeGreaterThanOrEqual(8)
        expect(writer.length).toBe(8)
        const reader = new BinaryReader(writer.toUint8Array())
        expect(reader.readUint32()).toBe(0x11223344)
        expect(reader.readUint32()).toBe(0x55667788)
    })

    it("returns buffer copy by default from toUint8Array and toBuffer", () => {
        const writer = new BinaryWriter()
        writer.writeUint8(1).writeUint8(2)
        const b1 = writer.toUint8Array()
        const b2 = writer.toBuffer()
        expect(b1).toEqual(b2)
        b1[0] = 99
        expect(writer.toUint8Array()[0]).toBe(1)
    })
})

describe("Protocol Types - Mathematical Utilities", () => {
    it("should convert continuous angles to discrete protocol bytes [0..250]", () => {
        expect(angleToByte(0)).toBe(0)
        expect(angleToByte(Math.PI)).toBe(125)
        expect(angleToByte(Math.PI * 2)).toBe(0)
        expect(angleToByte(-Math.PI / 2)).toBe(187) // 3*PI/2 = 250 * 0.75 = 187.5 -> 187
        expect(angleToByte(Math.PI / 2)).toBe(62)
        expect(angleToByte(2 * Math.PI - 0.0001)).toBe(249)
        expect(angleToByte(NaN)).toBe(0)
        expect(angleToByte(Infinity)).toBe(0)
    })

    it("should convert discrete bytes back to angles", () => {
        expect(byteToAngle(0)).toBe(0)
        expect(byteToAngle(125)).toBeCloseTo(Math.PI, 4)
        expect(byteToAngle(250)).toBeCloseTo(Math.PI * 2, 4)
    })

    it("should convert uint16 angles to continuous radians", () => {
        expect(uint16ToAngle(0)).toBe(0)
        expect(uint16ToAngle(32768)).toBeCloseTo(Math.PI, 4)
        expect(uint16ToAngle(65536)).toBeCloseTo(Math.PI * 2, 4)
    })

    it("should compute deterministic Food IDs", () => {
        const id = calcFoodId(100, 200, 21600)
        expect(id).toBe(200 * 21600 * 3 + 100)
    })
})
