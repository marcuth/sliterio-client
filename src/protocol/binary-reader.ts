/**
 * @file binary-reader.ts
 * @description High-performance Big-Endian binary stream deserializer with 24-bit integer support and bounds verification.
 */

export class BinaryCodecError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "BinaryCodecError"
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

export class BufferUnderflowError extends BinaryCodecError {
    public readonly requestedBytes: number
    public readonly availableBytes: number
    public readonly currentOffset: number
    public readonly totalLength: number

    constructor(requestedBytes: number, availableBytes: number, currentOffset: number, totalLength: number) {
        super(
            `Buffer underflow: requested ${requestedBytes} byte(s) at offset ${currentOffset}, but only ${availableBytes} byte(s) remain (total buffer length: ${totalLength})`,
        )
        this.name = "BufferUnderflowError"
        this.requestedBytes = requestedBytes
        this.availableBytes = availableBytes
        this.currentOffset = currentOffset
        this.totalLength = totalLength
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/**
 * Universal UTF-8 decoder supporting both browser TextDecoder and Node.js Buffer.
 */
function decodeUtf8(bytes: Uint8Array): string {
    if (bytes.length === 0) {
        return ""
    }
    if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8").decode(bytes)
    }
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8")
}

export class BinaryReader {
    private readonly buffer: Uint8Array
    private readonly dataView: DataView
    private currentOffset: number

    constructor(input: Uint8Array | ArrayBuffer | Buffer, initialOffset: number = 0) {
        if (input instanceof ArrayBuffer) {
            this.buffer = new Uint8Array(input)
            this.dataView = new DataView(input)
        } else if (ArrayBuffer.isView(input)) {
            this.buffer = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            this.dataView = new DataView(input.buffer, input.byteOffset, input.byteLength)
        } else {
            throw new BinaryCodecError("Invalid input: expected Uint8Array, ArrayBuffer, or Buffer")
        }

        if (initialOffset < 0 || initialOffset > this.buffer.length) {
            throw new RangeError(`Initial offset ${initialOffset} out of bounds [0, ${this.buffer.length}]`)
        }

        this.currentOffset = initialOffset
    }

    // ---------------------------------------------------------------------------
    // Boundary & Cursor Accessors
    // ---------------------------------------------------------------------------

    public get cursor(): number {
        return this.currentOffset
    }

    public get offset(): number {
        return this.currentOffset
    }

    public get length(): number {
        return this.buffer.length
    }

    public get remaining(): number {
        return this.buffer.length - this.currentOffset
    }

    public hasRemaining(count: number = 1): boolean {
        return this.remaining >= count
    }

    public hasBytes(count: number): boolean {
        return this.remaining >= count
    }

    private assertRemaining(bytes: number): void {
        if (this.currentOffset + bytes > this.buffer.length) {
            throw new BufferUnderflowError(bytes, this.remaining, this.currentOffset, this.buffer.length)
        }
    }

    // ---------------------------------------------------------------------------
    // Integer Reading (Big-Endian)
    // ---------------------------------------------------------------------------

    public readUint8(): number {
        this.assertRemaining(1)
        return this.buffer[this.currentOffset++]
    }

    public readInt8(): number {
        this.assertRemaining(1)
        const byte = this.buffer[this.currentOffset++]
        return (byte << 24) >> 24
    }

    public readUint16(): number {
        this.assertRemaining(2)
        const b0 = this.buffer[this.currentOffset++]
        const b1 = this.buffer[this.currentOffset++]
        return (b0 << 8) | b1
    }

    public readInt16(): number {
        this.assertRemaining(2)
        const b0 = this.buffer[this.currentOffset++]
        const b1 = this.buffer[this.currentOffset++]
        return (((b0 << 8) | b1) << 16) >> 16
    }

    public readUint24(): number {
        this.assertRemaining(3)
        const b0 = this.buffer[this.currentOffset++]
        const b1 = this.buffer[this.currentOffset++]
        const b2 = this.buffer[this.currentOffset++]
        return ((b0 << 16) | (b1 << 8) | b2) >>> 0
    }

    public readInt24(): number {
        this.assertRemaining(3)
        const b0 = this.buffer[this.currentOffset++]
        const b1 = this.buffer[this.currentOffset++]
        const b2 = this.buffer[this.currentOffset++]
        const u24 = (b0 << 16) | (b1 << 8) | b2
        return (u24 << 8) >> 8
    }

    public readUint32(): number {
        this.assertRemaining(4)
        const b0 = this.buffer[this.currentOffset++]
        const b1 = this.buffer[this.currentOffset++]
        const b2 = this.buffer[this.currentOffset++]
        const b3 = this.buffer[this.currentOffset++]
        return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0
    }

    public readInt32(): number {
        this.assertRemaining(4)
        const b0 = this.buffer[this.currentOffset++]
        const b1 = this.buffer[this.currentOffset++]
        const b2 = this.buffer[this.currentOffset++]
        const b3 = this.buffer[this.currentOffset++]
        return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
    }

    // ---------------------------------------------------------------------------
    // Floating Point Reading (IEEE-754 Big-Endian)
    // ---------------------------------------------------------------------------

    public readFloat32(): number {
        this.assertRemaining(4)
        const val = this.dataView.getFloat32(this.currentOffset, false)
        this.currentOffset += 4
        return val
    }

    public readFloat64(): number {
        this.assertRemaining(8)
        const val = this.dataView.getFloat64(this.currentOffset, false)
        this.currentOffset += 8
        return val
    }

    // ---------------------------------------------------------------------------
    // Byte Array Reading
    // ---------------------------------------------------------------------------

    public readBytes(length: number, copy: boolean = false): Uint8Array {
        if (length < 0) {
            throw new RangeError(`Length cannot be negative: ${length}`)
        }
        this.assertRemaining(length)
        const slice = copy
            ? this.buffer.slice(this.currentOffset, this.currentOffset + length)
            : this.buffer.subarray(this.currentOffset, this.currentOffset + length)
        this.currentOffset += length
        return slice
    }

    public readRemainingBytes(copy: boolean = false): Uint8Array {
        return this.readBytes(this.remaining, copy)
    }

    // ---------------------------------------------------------------------------
    // UTF-8 String Reading
    // ---------------------------------------------------------------------------

    public readString(length: number): string {
        const bytes = this.readBytes(length, false)
        return decodeUtf8(bytes)
    }

    public readString8(): string {
        const len = this.readUint8()
        return this.readString(len)
    }

    public readString16(): string {
        const len = this.readUint16()
        return this.readString(len)
    }

    public readRemainingString(): string {
        return this.readString(this.remaining)
    }

    // ---------------------------------------------------------------------------
    // Cursor Navigation
    // ---------------------------------------------------------------------------

    public peekUint8(offset: number = 0): number {
        if (offset < 0) {
            throw new RangeError(`Offset cannot be negative: ${offset}`)
        }
        this.assertRemaining(offset + 1)
        return this.buffer[this.currentOffset + offset]
    }

    public skip(count: number): this {
        if (count < 0) {
            throw new RangeError(`Skip count cannot be negative: ${count}`)
        }
        this.assertRemaining(count)
        this.currentOffset += count
        return this
    }

    public seek(newOffset: number): this {
        if (newOffset < 0 || newOffset > this.buffer.length) {
            throw new RangeError(`Seek offset ${newOffset} out of bounds [0, ${this.buffer.length}]`)
        }
        this.currentOffset = newOffset
        return this
    }

    public reset(): this {
        this.currentOffset = 0
        return this
    }
}
