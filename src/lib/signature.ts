/**
 * HMAC Signature Utilities
 *
 * Provides functions for generating and verifying HMAC-SHA256 signatures
 * for secure API communication.
 */

import crypto from 'crypto';

export interface SignatureParams {
  method: string;
  path: string;
  body?: string;
  timestamp: number;
}

/**
 * Generate HMAC-SHA256 signature for request
 *
 * Signature payload format:
 * {timestamp}\n{METHOD}\n{path}\n{bodyHash}
 */
export function generateSignature(
  params: SignatureParams,
  secret: string
): string {
  const bodyHash = params.body
    ? crypto.createHash('sha256').update(params.body).digest('hex')
    : '';

  const signaturePayload = [
    params.timestamp,
    params.method.toUpperCase(),
    params.path,
    bodyHash,
  ].join('\n');

  return crypto
    .createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');
}

/**
 * Verify HMAC-SHA256 signature using timing-safe comparison
 *
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(
  params: SignatureParams,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = generateSignature(params, secret);

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    // Ensure both buffers have the same length
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Check if timestamp is within acceptable range
 *
 * @param timestamp - Unix timestamp in seconds
 * @param toleranceSeconds - Maximum allowed time difference (default: 300 = 5 minutes)
 * @returns true if timestamp is valid, false otherwise
 */
export function isTimestampValid(
  timestamp: number,
  toleranceSeconds = 300
): boolean {
  const currentTime = Math.floor(Date.now() / 1000);
  return Math.abs(currentTime - timestamp) <= toleranceSeconds;
}
