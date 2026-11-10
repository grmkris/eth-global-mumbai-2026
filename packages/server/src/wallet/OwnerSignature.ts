import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { type AssertionRequest, ChallengeRejected, challengeLifetimeSeconds } from '@ethmumbai/auth'
import { challengeOf, encodeDeleGatorSignature } from '@ethmumbai/chain/DeleGatorSignature'
import { Effect, Option, Result } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import type { Hex } from 'viem'
import { AuthOrigin } from '../auth/Origin.ts'
import { BadRequest, issueChallenge, spendChallenge, verifyStoredAssertion } from '../auth/Routes.ts'
import { accountPasskey } from '../auth/Store.ts'
import { NotFound } from './Errors.ts'

export type OwnerAction = 'grant' | 'revoke' | 'send'

/** `navigator.credentials.get` options for signing `digest` with the account's own passkey (a stored challenge). */
export const ownerSignatureOptions = Effect.fn('EthMumbai.Wallet.ownerSignatureOptions')(function* (
  database: QueryDatabaseClient,
  input: { readonly accountId: string; readonly action: OwnerAction; readonly ref: string; readonly digest: Hex },
) {
  const passkey = yield* accountPasskey(database, input.accountId)
  if (Option.isNone(passkey)) return yield* NotFound.make({ what: 'passkey' })
  const challenge = yield* issueChallenge(
    database,
    { kind: input.action, accountId: input.accountId, ref: input.ref },
    challengeOf(input.digest),
  )
  const { rpId } = yield* AuthOrigin
  return {
    challenge,
    rpId,
    userVerification: 'required',
    timeout: challengeLifetimeSeconds * 1000,
    allowCredentials: [passkey.value.credential_id],
  }
})

const bytes = (text: string) =>
  Result.match(Base64Url.decode(text), {
    onFailure: () => Effect.fail(BadRequest.make({ detail: 'base64url' })),
    onSuccess: (value) => Effect.succeed(value),
  })

/** Verifies the owner's assertion over `digest` exactly like a login (single-use challenge, origin, rp id, UV,
 * counter), then encodes it as the HybridDeleGator's WebAuthn signature (spec §4). */
export const ownerSignature = Effect.fn('EthMumbai.Wallet.ownerSignature')(function* (
  database: QueryDatabaseClient,
  input: {
    readonly accountId: string
    readonly action: OwnerAction
    readonly ref: string
    readonly digest: Hex
    readonly request: AssertionRequest
  },
) {
  const { request } = input
  const spent = yield* spendChallenge(database, request.clientDataJSON, input.action)
  if (spent.ref !== input.ref || spent.accountId !== input.accountId || spent.id !== challengeOf(input.digest))
    return yield* ChallengeRejected.make({})
  const passkey = yield* verifyStoredAssertion(database, request, spent.id)
  if (passkey.account_id !== input.accountId) return yield* BadRequest.make({ detail: 'passkey of another account' })
  const clientDataJSON = new TextDecoder().decode(yield* bytes(request.clientDataJSON))
  const authenticatorData = yield* bytes(request.authenticatorData)
  const signature = yield* bytes(request.signature)
  return yield* Effect.try({
    try: () => encodeDeleGatorSignature({ keyId: passkey.credential_id, authenticatorData, clientDataJSON, signature }),
    catch: () => BadRequest.make({ detail: 'signature encoding' }),
  })
})
