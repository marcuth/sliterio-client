/**
 * @file secret-resolver.ts
 * @description Authentic 24-byte anti-bot challenge response solver for Slither.io (Packet '6').
 */

/**
 * Decodes the Slither.io anti-bot secret challenge received in Packet '6'.
 *
 * @param secret Raw challenge byte payload (minimum 65 bytes).
 * @returns 24-byte verification token Uint8Array.
 * @throws Error if secret length is less than 65 bytes or falsy.
 */
export function decodeSlitherSecret(secret: Uint8Array | number[] | Buffer): Uint8Array {
    if (!secret || secret.length < 65) {
        const len = secret ? secret.length : 0
        throw new Error(`Invalid secret length: expected at least 65 bytes, got ${len}`)
    }

    const result = new Uint8Array(24)
    let globalValue = 0

    for (let i = 0; i < 24; i++) {
        // 1. Extract first byte of pair i
        let value1 = secret[17 + i * 2]
        if (value1 <= 96) {
            value1 += 32 // Normalize uppercase ASCII to lowercase
        }
        value1 = (value1 - 98 - i * 34) % 26
        if (value1 < 0) {
            value1 += 26 // Remap negative modulo remainder into positive residue ring [0, 25]
        }

        // 2. Extract second byte of pair i
        let value2 = secret[18 + i * 2]
        if (value2 <= 96) {
            value2 += 32 // Normalize uppercase ASCII to lowercase
        }
        value2 = (value2 - 115 - i * 34) % 26
        if (value2 < 0) {
            value2 += 26 // Remap negative modulo remainder into positive residue ring [0, 25]
        }

        // 3. Combine nibbles
        let interimResult = (value1 << 4) | value2
        const offset = interimResult >= 97 ? 97 : 65
        interimResult -= offset

        // 4. Seed accumulator on initial iteration
        if (i === 0) {
            globalValue = 2 + interimResult
        }

        // 5. Compute deterministic ASCII character byte
        let charVal = (interimResult + globalValue) % 26
        if (charVal < 0) {
            charVal += 26
        }
        result[i] = (charVal + offset) & 0xff

        // 6. Advance rolling accumulator
        globalValue += 3 + interimResult
    }

    return result
}
