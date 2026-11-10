import type { RelyingParty } from '@ethmumbai/auth'
import { Context, Effect } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import type * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { jsonError } from '../Respond.ts'

/** The app's origin and WebAuthn rp id, derived from `AUTH_ORIGIN` when the Worker first runs. */
export class AuthOrigin extends Context.Service<AuthOrigin, RelyingParty>()('@ethmumbai/server/auth/AuthOrigin') {}

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Every state-changing request must come from the app's own pages: `Origin` must equal `AUTH_ORIGIN` (else 403).
 * SameSite=Lax already keeps the cookie off cross-site POSTs; this also refuses requests with no Origin at all. */
export const requireSameOrigin = <E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    const { origin } = yield* AuthOrigin
    if (!safeMethods.has(request.method) && request.headers.origin !== origin)
      return yield* jsonError(403, 'origin not allowed')
    return yield* handler
  })
