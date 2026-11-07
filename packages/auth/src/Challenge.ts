import { Effect, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

/** What a stored challenge may be spent on; a challenge of one kind never satisfies another. */
export const ChallengeKind = Schema.Literals(['register', 'login', 'grant', 'revoke', 'send'])
export type ChallengeKind = typeof ChallengeKind.Type

/** Every challenge is single-use and lives five minutes (spec §4). */
export const challengeLifetimeSeconds = 300

export class ChallengeRejected extends Schema.TaggedError<ChallengeRejected>()('ChallengeRejected', {}) {}

/** Cryptographically random bytes from Web Crypto, which Workers, Bun and browsers all provide. */
export const secureRandomBytes = (size: number) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(size)))

/** A fresh 32-byte login or registration challenge, base64url without padding (43 characters). */
export const newChallenge = Effect.map(secureRandomBytes(32), (bytes) => Base64Url.encode(bytes))
