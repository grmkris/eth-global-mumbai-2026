import { relyingPartyFromOrigin } from '@ethmumbai/auth'
import { Effect } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { describe, expect, test } from 'vitest'
import { AuthOrigin, requestRelyingParty, requireSameOrigin } from '../src/auth/Origin.ts'

const apex = 'https://vitaquack.com'
const legacy = 'https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev'

const run = <A, E>(effect: Effect.Effect<A, E, AuthOrigin | HttpServerRequest.HttpServerRequest>, origin?: string) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(AuthOrigin, relyingPartyFromOrigin(apex)),
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request(`${apex}/api/x`, { method: 'POST', headers: origin === undefined ? {} : { origin } }),
        ),
      ),
    ),
  )

const guarded = requireSameOrigin(HttpServerResponse.json({ ok: true }).pipe(Effect.orDie))

describe('legacy workers.dev origin (recovery of passkeys made before the vitaquack.com cutover)', () => {
  test('a request from the legacy origin gets its own rp id; the apex and strangers get the apex', async () => {
    expect(await run(requestRelyingParty, legacy)).toEqual({ origin: legacy, rpId: new URL(legacy).hostname })
    expect(await run(requestRelyingParty, apex)).toEqual({ origin: apex, rpId: 'vitaquack.com' })
    expect(await run(requestRelyingParty, 'https://evil.invalid')).toEqual({ origin: apex, rpId: 'vitaquack.com' })
  })

  test('the Origin guard passes the apex and the legacy origin, and refuses others or none', async () => {
    expect((await run(guarded, apex)).status).toBe(200)
    expect((await run(guarded, legacy)).status).toBe(200)
    expect((await run(guarded, 'https://evil.invalid')).status).toBe(403)
    expect((await run(guarded, 'https://other.kristjan-grm11775.workers.dev')).status).toBe(403)
    expect((await run(guarded)).status).toBe(403)
  })
})
