/**
 * @file binary-writer.ts
 * @description Dynamic auto-resizing Big-Endian binary buffer serializer for Slither.io client frames.
 */

/**
 * Universal UTF-8 encoder supporting both browser TextEncoder and Node.js Buffer.
 */
function encodeUtf8(str: string): Uint8Array {
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(str)
    }
    return new Uint8Array(Buffer.from(str, "utf8"))
}

export class BinaryWriter {
    private buffer: Uint8Array
    private dataView: DataView
    private currentOffset: number

    constructor(initialCapacity: number = 64) {
        const capacity = initialCapacity <= 0 ? 64 : initialCapacity
        this.buffer = new Uint8Array(capacity)
        this.dataView = new DataView(this.buffer.buffer)
        this.currentOffset = 0
    }

    // ---------------------------------------------------------------------------
    // Buffer Sizing & Capacity Management
    // ---------------------------------------------------------------------------

    public get length(): number {
        return this.currentOffset
    }

    public get offset(): number {
        return this.currentOffset
    }

    public get capacity(): number {
        return this.buffer.length
    }

    public ensureCapacity(required: number): void {
        if (required <= this.buffer.length) {
            return
        }
        const newCap = Math.max(this.buffer.length * 2, required)
        const newBuf = new Uint8Array(newCap)
        newBuf.set(this.buffer.subarray(0, this.currentOffset))
        this.buffer = newBuf
        this.dataView = new DataView(this.buffer.buffer)
    }

    // ---------------------------------------------------------------------------
    // Integer Serialization (Big-Endian)
    // ---------------------------------------------------------------------------

    public writeUint8(value: number): this {
        this.ensureCapacity(this.currentOffset + 1)
        this.buffer[this.currentOffset++] = value & 0xff
        return this
    }

    public writeInt8(value: number): this {
        this.ensureCapacity(this.currentOffset + 1)
        this.buffer[this.currentOffset++] = value & 0xff
        return this
    }

    public writeUint16(value: number): this {
        this.ensureCapacity(this.currentOffset + 2)
        this.buffer[this.currentOffset++] = (value >> 8) & 0xff
        this.buffer[this.currentOffset++] = value & 0xff
        return this
    }

    public writeInt16(value: number): this {
        return this.writeUint16(value)
    }

    public writeUint24(value: number): this {
        this.ensureCapacity(this.currentOffset + 3)
        this.buffer[this.currentOffset++] = (value >> 16) & 0xff
        this.buffer[this.currentOffset++] = (value >> 8) & 0xff
        this.buffer[this.currentOffset++] = value & 0xff
        return this
    }

    public writeInt24(value: number): this {
        return this.writeUint24(value)
    }

    public writeUint32(value: number): this {
        this.ensureCapacity(this.currentOffset + 4)
        this.buffer[this.currentOffset++] = (value >>> 24) & 0xff
        this.buffer[this.currentOffset++] = (value >>> 16) & 0xff
        this.buffer[this.currentOffset++] = (value >>> 8) & 0xff
        this.buffer[this.currentOffset++] = value & 0xff
        return this
    }

    public writeInt32(value: number): this {
        return this.writeUint32(value)
    }

    // ---------------------------------------------------------------------------
    // Floating Point Serialization (IEEE-754 Big-Endian)
    // ---------------------------------------------------------------------------

    public writeFloat32(value: number): this {
        this.ensureCapacity(this.currentOffset + 4)
        this.dataView.setFloat32(this.currentOffset, value, false)
        this.currentOffset += 4
        return this
    }

    public writeFloat64(value: number): this {
        this.ensureCapacity(this.currentOffset + 8)
        this.dataView.setFloat64(this.currentOffset, value, false)
        this.currentOffset += 8
        return this
    }

    // ---------------------------------------------------------------------------
    // Byte Array Serialization
    // ---------------------------------------------------------------------------

    public writeBytes(bytes: Uint8Array | number[] | Buffer): this {
        const len = bytes.length
        if (len === 0) {
            return this
        }
        this.ensureCapacity(this.currentOffset + len)
        if (bytes instanceof Uint8Array) {
            this.buffer.set(bytes, this.currentOffset)
        } else {
            for (let i = 0; i < len; i++) {
                this.buffer[this.currentOffset + i] = bytes[i] & 0xff
            }
        }
        this.currentOffset += len
        return this
    }

    // ---------------------------------------------------------------------------
    // UTF-8 String Serialization
    // ---------------------------------------------------------------------------

    public writeString(str: string, _encoding?: string, lengthPrefix?: boolean): this {
        const encoded = encodeUtf8(str)
        if (lengthPrefix) {
            this.writeUint8(encoded.length)
        }
        return this.writeBytes(encoded)
    }

    public writeString8(str: string): this {
        const encoded = encodeUtf8(str)
        if (encoded.length > 255) {
            throw new RangeError(`UTF-8 string length (${encoded.length} bytes) exceeds 1-byte limit (255)`)
        }
        this.writeUint8(encoded.length)
        return this.writeBytes(encoded)
    }

    public writeString16(str: string): this {
        const encoded = encodeUtf8(str)
        if (encoded.length > 65535) {
            throw new RangeError(`UTF-8 string length (${encoded.length} bytes) exceeds 2-byte limit (65535)`)
        }
        this.writeUint16(encoded.length)
        return this.writeBytes(encoded)
    }

    // ---------------------------------------------------------------------------
    // Output & Serialization
    // ---------------------------------------------------------------------------

    public toUint8Array(copy: boolean = true): Uint8Array {
        if (copy) {
            return this.buffer.slice(0, this.currentOffset)
        }
        return this.buffer.subarray(0, this.currentOffset)
    }

    public toBuffer(): Uint8Array {
        return this.toUint8Array(true)
    }

    public reset(): this {
        this.currentOffset = 0
        return this
    }
}
