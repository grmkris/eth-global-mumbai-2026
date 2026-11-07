import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import { registerEpisodesAcceptance } from './EpisodesAcceptance.ts'
import { makeSoftwareAuthenticator, passkeyCall, registerPasskey, sessionCookie } from './PasskeyFixture.ts'

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

const AddedRobot = Schema.Struct({
  robotId: Schema.String.check(Schema.isPattern(/^[a-z2-7]{26}$/)),
  pairingCode: Schema.String.check(Schema.isPattern(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)),
  pairingExpiresAt: Schema.Finite,
})
/** The wallet API on the native Worker: session + Origin guards, "Add robot" pairing codes, and the grant routes
 * refusing a grant outside its limits (expiry beyond 30 days); then the errand audit view (EpisodesAcceptance.ts). */
export const registerWalletAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) => {
  walletGuards(test, stack)
  registerEpisodesAcceptance(test, stack)
}

/** Cancel a pairing: never a stranger's robot, then gone for the owner; a second cancel finds nothing. */
const cancelPairingChecks = (appUrl: string, cookie: string, strangerCookie: string, keptRobotId: string) =>
  Effect.gen(function* () {
    const call = passkeyCall(appUrl)
    const waiting = yield* Schema.decodeUnknownEffect(AddedRobot)(
      yield* (yield* call('/api/robots', { name: 'Hallway Duck' }, cookie)).json,
    )
    const cancel = `/api/robots/${waiting.robotId}/cancel`
    expect((yield* call(cancel, {})).status).toBe(401)
    expect((yield* call(cancel, {}, strangerCookie)).status).toBe(404)
    const cancelled = yield* call(cancel, {}, cookie)
    expect(cancelled.status).toBe(200)
    expect(yield* cancelled.json).toEqual({ cancelled: true })
    expect((yield* call(cancel, {}, cookie)).status).toBe(404)
    const afterCancel = yield* HttpClient.get(`${appUrl}/api/robots`, { headers: { cookie } })
    const remaining = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ robots: Schema.Array(Schema.Struct({ id: Schema.String })) }),
    )(yield* afterCancel.json)
    expect(remaining.robots.map(({ id }) => id)).toEqual([keptRobotId])
  })

const SendPrompt = Schema.Struct({
  sendId: Schema.String.check(Schema.isPattern(/^[a-z2-7]{26}$/)),
  userVerification: Schema.Literal('required'),
})

/** Send: a session and a well-formed address and amount first. A new wallet holds nothing, so the Worker refuses
 * before any passkey prompt (409) once Arc's public RPC answers the balance; when it does not, Arc stays the final
 * word and the prompt is issued (200). Either way no relayer transaction is attempted. */
const sendChecks = (appUrl: string, cookie: string) =>
  Effect.gen(function* () {
    const call = passkeyCall(appUrl)
    const sendTo = '0x00000000000000000000000000000000000000b0'
    expect((yield* call('/api/wallet/send/options', { to: sendTo, amount: '0.10' })).status).toBe(401)
    expect((yield* call('/api/wallet/send/options', { to: 'nope', amount: '0.10' }, cookie)).status).toBe(400)
    expect((yield* call('/api/wallet/send/options', { to: sendTo, amount: '-1' }, cookie)).status).toBe(400)
    const zero = yield* call('/api/wallet/send/options', { to: sendTo, amount: '0' }, cookie)
    expect(zero.status).toBe(409)
    expect(yield* zero.json).toEqual({ error: 'the amount must be more than 0' })
    const empty = yield* call('/api/wallet/send/options', { to: sendTo, amount: '0.10' }, cookie)
    const body: unknown = yield* empty.json
    if (empty.status === 409) expect(body).toEqual({ error: 'the amount is more than the wallet holds' })
    else {
      expect(empty.status).toBe(200)
      yield* Schema.decodeUnknownEffect(SendPrompt)(body)
    }
    expect((yield* call('/api/wallet/send/sign', { to: sendTo, amount: '0.10', sendId: 'x' }, cookie)).status).toBe(400)
  })

const walletGuards = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'wallet: owner-scoped robots with pairing codes, session and Origin guards, grant limits enforced',
    Effect.gen(function* () {
      const { appUrl } = yield* stack
      const call = passkeyCall(appUrl)
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Wallet Owner')
      const cookie = sessionCookie(response)

      expect((yield* call('/api/robots', { name: 'Duck' })).status).toBe(401)
      expect((yield* HttpClient.post(`${appUrl}/api/robots`, { headers: { cookie } })).status).toBe(403)
      const added = yield* call('/api/robots', { name: '  Duck  ' }, cookie)
      expect(added.status).toBe(201)
      const robot = yield* Schema.decodeUnknownEffect(AddedRobot)(yield* added.json)
      expect((yield* call('/api/robots', { name: '' }, cookie)).status).toBe(400)

      const listed = yield* HttpClient.get(`${appUrl}/api/robots`, { headers: { cookie } })
      expect(listed.status).toBe(200)
      const robots: unknown = yield* listed.json
      expect(robots).toEqual({
        robots: [
          {
            id: robot.robotId,
            name: 'Duck',
            kind: 'chip',
            status: 'unpaired',
            chipAddress: null,
            pairingCode: robot.pairingCode,
            pairingExpiresAt: robot.pairingExpiresAt,
            lease: { until: null, online: false },
            grant: null,
          },
        ],
      })

      const stranger = yield* registerPasskey(appUrl, yield* Effect.promise(() => makeSoftwareAuthenticator()), 'Other')
      const strangers = yield* HttpClient.get(`${appUrl}/api/robots`, {
        headers: { cookie: sessionCookie(stranger.response) },
      })
      expect(yield* strangers.json).toEqual({ robots: [] })

      yield* cancelPairingChecks(appUrl, cookie, sessionCookie(stranger.response), robot.robotId)

      const options = yield* call(
        '/api/wallet/grants/options',
        { robotId: robot.robotId, dailyCap: '1.00', perPaymentCap: '0.30', allowlist: [], expiresAt: 0 },
        cookie,
      )
      expect(options.status).toBe(400)
      const tooLong = yield* call(
        '/api/wallet/grants/options',
        {
          robotId: robot.robotId,
          dailyCap: '1.00',
          perPaymentCap: '0.30',
          allowlist: ['0x000000000000000000000000000000000000c0de'],
          expiresAt: 4_000_000_000,
        },
        cookie,
      )
      expect(tooLong.status).toBe(409)
      expect(yield* tooLong.json).toEqual({ error: 'the grant must expire within 30 days' })
      expect((yield* call('/api/wallet/grants/nope/revoke/options', {}, cookie)).status).toBe(404)
      yield* sendChecks(appUrl, cookie)
      const wallet = yield* HttpClient.get(`${appUrl}/api/wallet`, { headers: { cookie } })
      expect(wallet.status).toBe(200)
      expect(yield* wallet.json).toMatchObject({
        account: { displayName: 'Wallet Owner', deployStatus: 'counterfactual' },
      })
      expect((yield* HttpClient.get(`${appUrl}/api/approvals/nope`, { headers: { cookie } })).status).toBe(404)
      expect((yield* HttpClient.get(`${appUrl}/api/episodes/nope/approval`, { headers: { cookie } })).status).toBe(404)
      expect((yield* HttpClient.get(`${appUrl}/api/episodes/nope/approval`)).status).toBe(401)
      // Approval sign-in for someone else's or a missing approval: 404 before any redirect to the issuer.
      const authorize = yield* HttpClient.get(`${appUrl}/api/world/authorize?approval=nope`, { headers: { cookie } })
      expect(authorize.status).toBe(404)
      expect((yield* HttpClient.get(`${appUrl}/api/world/callback?state=nope&code=x`)).status).toBe(404)
      expect((yield* call('/api/approvals/nope/deny', {}, cookie)).status).toBe(404)
      const activity = yield* HttpClient.get(`${appUrl}/api/wallet/activity`, { headers: { cookie } })
      expect(yield* activity.json).toEqual({ episodes: [], grants: [] })
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 90000 },
  )
