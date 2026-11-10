import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import {
  AssertionRequest,
  authPaths,
  ChallengeRejected,
  type ChallengeKind,
  challengeLifetimeSeconds,
  clientChallenge,
  es256,
  newChallenge,
  type PasskeyRejected,
  RegisterOptionsRequest,
  RegistrationRequest,
  secureRandomBytes,
  verifyAssertion,
  verifyRegistration,
} from '@ethmumbai/auth'
import { idFromBytes16 } from '@ethmumbai/protocol'
import { Clock, Effect, Layer, Option, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { json, jsonError, nowSeconds } from '../Respond.ts'
import { signup } from '../wallet/Signup.ts'
import { AuthOrigin, requireSameOrigin } from './Origin.ts'
import { currentAccount, SessionAuth, withoutSessionCookie, withSessionCookie } from './Session.ts'
import { advanceSignCount, consumeChallenge, findAccount, findPasskey, insertChallenge } from './Store.ts'

export class BadRequest extends Schema.TaggedError<BadRequest>()('BadRequest', { detail: Schema.String }) {}

/** Untrusted JSON bodies are decoded at the boundary; anything malformed is a 400 without echoing the input. */
export const decodeBody = <A, I>(schema: Schema.Codec<A, I>) =>
  HttpServerRequest.schemaBodyJson(schema).pipe(Effect.mapError(() => BadRequest.make({ detail: 'body' })))

/** Refusals are logged with their reason (never the payload) and answered 400. */
export const answerRejections = <R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, BadRequest | ChallengeRejected | PasskeyRejected, R>,
) =>
  handler.pipe(
    Effect.catchTags({
      BadRequest: ({ detail }) => jsonError(400, 'invalid request', { detail }),
      ChallengeRejected: () => jsonError(400, 'challenge expired or already used'),
      PasskeyRejected: ({ reason, detail }) =>
        Effect.logWarning('passkey rejected', { reason, detail }).pipe(
          Effect.andThen(jsonError(400, 'passkey rejected', { reason })),
        ),
    }),
  )

/** Stores a fresh single-use challenge (or a given one: a grant's delegation hash) and returns it. */
export const issueChallenge = Effect.fn('EthMumbai.Auth.issueChallenge')(function* (
  database: QueryDatabaseClient,
  input: { readonly kind: ChallengeKind; readonly accountId: string | null; readonly ref: string | null },
  challenge?: string,
) {
  const id = challenge ?? (yield* newChallenge)
  const now = yield* nowSeconds
  yield* insertChallenge(database, {
    id,
    kind: input.kind,
    accountId: input.accountId,
    ref: input.ref,
    expiresAt: now + challengeLifetimeSeconds,
    now,
    nowMillis: yield* Clock.currentTimeMillis,
  })
  return id
})

/** Spends the challenge the client signed; a second use, an expired or a foreign-kind challenge fails. */
export const spendChallenge = Effect.fn('EthMumbai.Auth.spendChallenge')(function* (
  database: QueryDatabaseClient,
  clientDataJSON: string,
  kind: ChallengeKind,
) {
  const id = yield* clientChallenge(clientDataJSON)
  const spent = yield* consumeChallenge(database, { id, kind, now: yield* nowSeconds })
  if (Option.isNone(spent)) return yield* ChallengeRejected.make({})
  return { id, accountId: spent.value.account_id, ref: spent.value.ref }
})

const signedIn = (account: {
  readonly accountId: string
  readonly smartAccount: string
  readonly securityRevision: string
}) =>
  Effect.gen(function* () {
    const token = yield* (yield* SessionAuth).issue(account)
    const response = yield* json({ accountId: account.accountId, smartAccount: account.smartAccount })
    return yield* withSessionCookie(response, token)
  })

const registerOptions = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const { displayName } = yield* decodeBody(RegisterOptionsRequest)
    const { rpId } = yield* AuthOrigin
    const accountId = idFromBytes16(yield* secureRandomBytes(16))
    const challenge = yield* issueChallenge(database, { kind: 'register', accountId, ref: displayName })
    return yield* json({
      challenge,
      rp: { id: rpId, name: 'Vitaquack' },
      user: { id: Base64Url.encode(accountId), name: displayName },
      pubKeyCredParams: [{ type: 'public-key', alg: es256 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
      timeout: challengeLifetimeSeconds * 1000,
    })
  })

const registerVerify = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* decodeBody(RegistrationRequest)
    const spent = yield* spendChallenge(database, request.clientDataJSON, 'register')
    if (spent.accountId === null || spent.ref === null) return yield* ChallengeRejected.make({})
    const passkey = yield* verifyRegistration({
      request,
      expectedChallenge: spent.id,
      relyingParty: yield* AuthOrigin,
    })
    const account = yield* signup(database, { accountId: spent.accountId, displayName: spent.ref, passkey })
    return yield* signedIn(account)
  })

const loginOptions = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const { rpId } = yield* AuthOrigin
    const challenge = yield* issueChallenge(database, { kind: 'login', accountId: null, ref: null })
    return yield* json({ challenge, rpId, userVerification: 'required', timeout: challengeLifetimeSeconds * 1000 })
  })

/** Verifies an assertion against the stored passkey and moves its counter; shared by login and grant signing. */
export const verifyStoredAssertion = Effect.fn('EthMumbai.Auth.verifyStoredAssertion')(function* (
  database: QueryDatabaseClient,
  request: AssertionRequest,
  expectedChallenge: string,
) {
  const stored = yield* findPasskey(database, request.credentialId)
  if (Option.isNone(stored)) return yield* BadRequest.make({ detail: 'unknown passkey' })
  const passkey = stored.value
  const { signCount } = yield* verifyAssertion({
    request,
    expectedChallenge,
    relyingParty: yield* AuthOrigin,
    passkey: { credentialId: passkey.credential_id, x: passkey.x, y: passkey.y, signCount: passkey.sign_count },
  })
  const advanced = yield* advanceSignCount(database, {
    credentialId: passkey.credential_id,
    from: passkey.sign_count,
    to: signCount,
    now: yield* nowSeconds,
  })
  if (!advanced) return yield* BadRequest.make({ detail: 'concurrent use of the passkey' })
  return passkey
})

const loginVerify = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* decodeBody(AssertionRequest)
    const spent = yield* spendChallenge(database, request.clientDataJSON, 'login')
    const passkey = yield* verifyStoredAssertion(database, request, spent.id)
    const account = yield* findAccount(database, passkey.account_id).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.orDie,
    )
    return yield* signedIn({
      accountId: account.id,
      smartAccount: account.smart_account,
      securityRevision: account.security_revision,
    })
  })

const session = Effect.gen(function* () {
  const account = yield* currentAccount
  return yield* Option.match(account, { onNone: () => jsonError(401, 'not signed in'), onSome: (value) => json(value) })
})

const logout = Effect.gen(function* () {
  const account = yield* currentAccount
  if (Option.isSome(account)) yield* (yield* SessionAuth).revokeAll(account.value.accountId)
  return yield* withoutSessionCookie(HttpServerResponse.empty({ status: 204 }))
})

/** `POST /api/passkeys/{register,login}/{options,verify}`, `GET /api/auth/session`, `POST /api/auth/logout` (spec §4). */
export const authRoutes = (database: QueryDatabaseClient) =>
  Layer.mergeAll(
    HttpRouter.add('POST', authPaths.registerOptions, requireSameOrigin(answerRejections(registerOptions(database)))),
    HttpRouter.add('POST', authPaths.registerVerify, requireSameOrigin(answerRejections(registerVerify(database)))),
    HttpRouter.add('POST', authPaths.loginOptions, requireSameOrigin(loginOptions(database))),
    HttpRouter.add('POST', authPaths.loginVerify, requireSameOrigin(answerRejections(loginVerify(database)))),
    HttpRouter.add('GET', authPaths.session, session),
    HttpRouter.add('POST', authPaths.logout, requireSameOrigin(logout)),
  )
