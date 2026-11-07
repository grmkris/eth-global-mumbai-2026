import { AssertionRequest } from '@ethmumbai/auth'
import { arcAddresses } from '@ethmumbai/chain/Env'
import { buildSend, redeemCalldata, sendExecution } from '@ethmumbai/chain/Grant'
import { encodePermissionContext } from '@ethmumbai/chain/Hashes'
import { idFromBytes16 } from '@ethmumbai/protocol/Base32'
import { delegationDigest } from '@ethmumbai/protocol/Delegation'
import { Address } from '@ethmumbai/protocol/Hex'
import { Effect, Layer, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { getAddress, zeroAddress } from 'viem'
import { decodeBody } from '../auth/Routes.ts'
import { CurrentSession, requireSession, type SessionAccount } from '../auth/Session.ts'
import { json, randomBytes } from '../Respond.ts'
import { ensureDeployed } from './Account.ts'
import { readUsdcBalance } from './Activity.ts'
import type { WalletDeps } from './Deps.ts'
import { answerWalletErrors, ChainFailed, Conflict, required } from './Errors.ts'
import { UsdcText, usdcBaseUnits } from './Grants.ts'
import { ownerSignature, ownerSignatureOptions } from './OwnerSignature.ts'

/** What the owner sends: an Arc address and a USDC amount as typed ("1.50"). */
const SendTerms = Schema.Struct({ to: Address, amount: UsdcText })
const SendId = Schema.String.check(Schema.isPattern(/^[a-z2-7]{26}$/))
const SendSign = Schema.Struct({ ...SendTerms.fields, sendId: SendId, assertion: AssertionRequest })

/** The one-time send delegation for these terms; the same (sendId, to, amount) always rebuilds the same digest. */
const sendFor = Effect.fn('EthMumbai.Wallet.sendFor')(function* (
  deps: WalletDeps,
  session: SessionAccount,
  input: { readonly sendId: string; readonly to: string; readonly amount: string },
) {
  const relayer = yield* required(deps.relayer, 'RELAYER_PRIVATE_KEY')
  const arc = yield* required(deps.arc, 'ARC_RPC_URL')
  const owner = getAddress(session.smartAccount)
  const to = getAddress(input.to)
  const amount = usdcBaseUnits(input.amount)
  if (amount <= 0n) return yield* Conflict.make({ detail: 'the amount must be more than 0' })
  if (to === owner) return yield* Conflict.make({ detail: 'that is this wallet’s own address' })
  if (to === zeroAddress) return yield* Conflict.make({ detail: 'the zero address cannot receive USDC' })
  // Arc refuses a transfer over the balance anyway; asking first keeps the relayer from paying gas for a revert.
  const balance = yield* readUsdcBalance(arc, owner)
  if (Option.isSome(balance) && amount > balance.value)
    return yield* Conflict.make({ detail: 'the amount is more than the wallet holds' })
  const send = buildSend({ sendId: input.sendId, owner, relayer: relayer.address, to, amount })
  return { relayer, arc, to, amount, send }
})

/** `POST /api/wallet/send/options` → a new send id and the passkey prompt for its delegation's digest. */
const sendOptions = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const terms = yield* decodeBody(SendTerms)
    const sendId = idFromBytes16(yield* randomBytes(16))
    const { send } = yield* sendFor(deps, session, { sendId, ...terms })
    const prompt = yield* ownerSignatureOptions(deps.database, {
      accountId: session.accountId,
      action: 'send',
      ref: sendId,
      digest: delegationDigest(send),
    })
    return yield* json({ sendId, ...prompt })
  })

/**
 * `POST /api/wallet/send/sign`: the passkey signed this exact send (the stored challenge is its digest, single use,
 * bound to the send id), so the relayer deploys the account if it is still counterfactual and redeems the delegation:
 * the account transfers the USDC under the persistent key `send:<sendId>`, at most once.
 */
const sendSign = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const input = yield* decodeBody(SendSign)
    const { relayer, arc, to, amount, send } = yield* sendFor(deps, session, input)
    const signature = yield* ownerSignature(deps.database, {
      accountId: session.accountId,
      action: 'send',
      ref: input.sendId,
      digest: delegationDigest(send),
      request: input.assertion,
    })
    yield* ensureDeployed({ database: deps.database, arc, relayer }, session.accountId)
    const sent = yield* relayer
      .send({
        key: `send:${input.sendId}`,
        kind: 'send',
        to: arcAddresses.delegationManager,
        data: redeemCalldata(encodePermissionContext([{ ...send, signature }]), sendExecution(to, amount)),
      })
      .pipe(
        Effect.map(({ success, txHash }) => ({ status: success ? 'sent' : 'reverted', txHash }) as const),
        Effect.catchTags({
          // Broadcast but no receipt yet (or the store failed after the send): the outcome is unknown, not failed.
          // "pending" keeps the owner from sending the same money twice; Arc settles it and the balance shows it.
          RelayerError: (error) =>
            error.stage === 'receipt'
              ? Effect.succeed({ status: 'pending', txHash: error.txHash ?? null } as const)
              : ChainFailed.make({ stage: 'send', reason: error.message }),
          RelayerStoreError: () => Effect.succeed({ status: 'pending', txHash: null } as const),
          AlreadySubmitted: () => Conflict.make({ detail: 'this send was already submitted' }),
        }),
      )
    if (sent.status === 'reverted') return yield* ChainFailed.make({ stage: 'send', reason: 'send reverted on chain' })
    const { status, txHash } = sent
    yield* Effect.logInfo('owner send').pipe(Effect.annotateLogs({ sendId: input.sendId, status }))
    return yield* json({ sendId: input.sendId, status, txHash }, status === 'sent' ? 200 : 202)
  })

export const sendRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    HttpRouter.add('POST', '/api/wallet/send/options', requireSession(answerWalletErrors(sendOptions(deps)))),
    HttpRouter.add('POST', '/api/wallet/send/sign', requireSession(answerWalletErrors(sendSign(deps)))),
  )
