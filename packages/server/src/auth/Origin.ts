import { relyingPartyFromOrigin, type RelyingParty } from '@ethmumbai/auth'
import { Context, Effect } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import type * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { jsonError } from '../Respond.ts'

/** The app's origin and WebAuthn rp id, derived from `AUTH_ORIGIN` when the Worker first runs. */
export class AuthOrigin extends Context.Service<AuthOrigin, RelyingParty>()('@ethmumbai/server/auth/AuthOrigin') {}

/**
 * Earlier origins of the same Worker, keyed by the current `AUTH_ORIGIN`. Until 6 Nov ≈ 15:00 UTC stage `main` ran on
 * its workers.dev URL, and passkeys made then are bound to that host. The workers.dev URL still serves this Worker, so
 * accepting it trusts no new code: it lets those owners sign in and sign (Send) again. Recovery only (10 Nov).
 */
export const LEGACY_ORIGINS: Readonly<Record<string, readonly string[]>> = {
  'https://vitaquack.com': ['https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev'],
}

/** The relying party of this request: a legacy origin when the request comes from one, else `AUTH_ORIGIN`. */
export const requestRelyingParty = Effect.gen(function* () {
  const primary = yield* AuthOrigin
  const request = yield* HttpServerRequest
  const origin = request.headers.origin
  return origin !== undefined && (LEGACY_ORIGINS[primary.origin] ?? []).includes(origin)
    ? relyingPartyFromOrigin(origin)
    : primary
})

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Every state-changing request must come from the app's own pages: `Origin` must equal `AUTH_ORIGIN` or one of its
 * `LEGACY_ORIGINS` (else 403). SameSite=Lax already keeps the cookie off cross-site POSTs; this also refuses requests
 * with no Origin at all. */
export const requireSameOrigin = <E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    const { origin } = yield* requestRelyingParty
    if (!safeMethods.has(request.method) && request.headers.origin !== origin)
      return yield* jsonError(403, 'origin not allowed')
    return yield* handler
  })
