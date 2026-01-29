/**
 * Authentication Middleware
 *
 * Validates API requests using API Key + HMAC-SHA256 signature.
 * Protects all /projects routes from unauthorized access.
 */

import { createMiddleware } from 'hono/factory';
import type { Context, Next } from 'hono';
import {
  generateSignature,
  verifySignature,
  isTimestampValid,
} from '../lib/signature';

const FLY_API_KEY = process.env.FLY_API_KEY || '';
const FLY_API_SECRET = process.env.FLY_API_SECRET || '';

// Time tolerance for request timestamps (5 minutes)
const TIMESTAMP_TOLERANCE_SECONDS = 300;

interface AuthError {
  success: false;
  error: string;
  code: string;
}

function authError(message: string, code: string): AuthError {
  return {
    success: false,
    error: message,
    code,
  };
}

/**
 * Authentication middleware for API routes
 *
 * Validates:
 * 1. Required headers exist (X-API-Key, X-Timestamp, X-Signature)
 * 2. API key matches configured value
 * 3. Timestamp is within acceptable range (prevents replay attacks)
 * 4. Signature is valid (ensures request integrity and authenticity)
 */
export const authMiddleware = createMiddleware(async (c: Context, next: Next) => {
  // Skip auth if credentials are not configured (development mode)
  if (!FLY_API_KEY || !FLY_API_SECRET) {
    console.warn('[Auth] API credentials not configured, skipping authentication');
    await next();
    return;
  }

  const apiKey = c.req.header('X-API-Key');
  const timestampStr = c.req.header('X-Timestamp');
  const signature = c.req.header('X-Signature');

  // 1. Verify required headers exist
  if (!apiKey || !timestampStr || !signature) {
    console.warn('[Auth] Missing authentication headers');
    return c.json(
      authError('Missing authentication headers', 'AUTH_MISSING_HEADERS'),
      401
    );
  }

  // 2. Verify API key
  if (apiKey !== FLY_API_KEY) {
    console.warn('[Auth] Invalid API key');
    return c.json(authError('Invalid API key', 'AUTH_INVALID_KEY'), 401);
  }

  // 3. Verify timestamp
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    console.warn('[Auth] Invalid timestamp format');
    return c.json(
      authError('Invalid timestamp format', 'AUTH_INVALID_TIMESTAMP'),
      401
    );
  }

  if (!isTimestampValid(timestamp, TIMESTAMP_TOLERANCE_SECONDS)) {
    console.warn(
      `[Auth] Timestamp expired or invalid: ${timestamp} (current: ${Math.floor(Date.now() / 1000)})`
    );
    return c.json(
      authError('Request timestamp expired', 'AUTH_TIMESTAMP_EXPIRED'),
      401
    );
  }

  // 4. Verify signature
  // We need to read the body for signature verification
  const url = new URL(c.req.url);
  const body = await c.req.text();

  const isValid = verifySignature(
    {
      method: c.req.method,
      path: url.pathname,
      body: body || undefined,
      timestamp,
    },
    signature,
    FLY_API_SECRET
  );

  if (!isValid) {
    console.warn('[Auth] Invalid signature');
    return c.json(authError('Invalid signature', 'AUTH_INVALID_SIGNATURE'), 401);
  }

  // Store raw body for later use (since we already consumed it)
  c.set('rawBody', body);

  // Authentication successful
  await next();
});

/**
 * Helper middleware to parse JSON body from stored raw body
 * Use this after authMiddleware when you need to access the request body
 */
export const parseBodyMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const rawBody = c.get('rawBody');

  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      c.set('parsedBody', parsed);
    } catch {
      // Body is not valid JSON, that's okay for some requests
    }
  }

  await next();
});

/**
 * Get parsed body from context
 * Use this in route handlers after authMiddleware
 */
export function getParsedBody<T>(c: Context): T | undefined {
  return c.get('parsedBody') as T | undefined;
}

/**
 * Get raw body from context
 */
export function getRawBody(c: Context): string | undefined {
  return c.get('rawBody') as string | undefined;
}
