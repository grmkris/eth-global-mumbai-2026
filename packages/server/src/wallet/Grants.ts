import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { AssertionRequest } from '@ethmumbai/auth'
import { buildGrant } from '@ethmumbai/chain/Grant'
import { idFromBytes16 } from '@ethmumbai/protocol/Base32'
import { delegationDigest, delegationHash, type UnsignedDelegation } from '@ethmumbai/protocol/Delegation'
import { Address } from '@ethmumbai/protocol/Hex'
import { Clock, Effect, Layer, Option, Schedule, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { getAddress } from 'viem'
import { decodeBody } from '../auth/Routes.ts'
import { CurrentSession, requireSession, type SessionAccount } from '../auth/Session.ts'
import { readRobot } from '../chip/Lease.ts'
import { json, nowSeconds, randomBytes } from '../Respond.ts'
import { GrantRow } from '../robot/Budget.ts'
import { changes, firstRow } from '../Sql.ts'
import { ensureDeployed, verifyOwnerSignature } from './Account.ts'
import type { WalletDeps } from './Deps.ts'
import { answerWalletErrors, Conflict, NotFound, required } from './Errors.ts'
import { ownerSignature, ownerSignatureOptions } from './OwnerSignature.ts'

/** Arc is mainnet with real USDC: a grant's daily cap is at most 10 USDC (AGENTS.md: keep caps tiny). */
export const MAX_DAILY_CAP = 10_000_000n
const MAX_GRANT_SECONDS = 30 * 86_400
const START_SLACK_SECONDS = 60

/** A USDC amount as typed by the owner ("0.30"), at most 6 decimals. */
export const UsdcText = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/))
export const usdcBaseUnits = (text: string): bigint => {
  const [whole = '0', fraction = ''] = text.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

const GrantOptionsRequest = Schema.Struct({
  robotId: Schema.String,
  dailyCap: UsdcText,
  perPaymentCap: UsdcText,
  allowlist: Schema.Array(Address).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  expiresAt: Schema.Int,
})
const GrantPath = Schema.Struct({ id: Schema.String })
const Allowlist = Schema.fromJsonString(Schema.Array(Address))

export const readGrant = Effect.fn('EthMumbai.Wallet.readGrant')(function* (
  database: QueryDatabaseClient,
  session: SessionAccount,
  grantId: string,
) {
  const row = yield* firstRow(
    database.prepare('SELECT * FROM grants WHERE id = ? AND account_id = ?').bind(grantId, session.accountId),
    GrantRow,
  )
  if (Option.isNone(row)) return yield* NotFound.make({ what: 'grant' })
  return row.value
})

/** The owner's paired robot: the grant's delegate is its chip. */
const pairedChip = Effect.fn('EthMumbai.Wallet.pairedChip')(function* (
  database: QueryDatabaseClient,
  session: SessionAccount,
  robotId: string,
) {
  const robot = yield* readRobot(database, robotId)
  if (Option.isNone(robot) || robot.value.account_id !== session.accountId)
    return yield* NotFound.make({ what: 'robot' })
  if (robot.value.status !== 'paired' || robot.value.chip_address === null)
    return yield* Conflict.make({ detail: 'pair the robot before granting it a budget' })
  return robot.value.chip_address
})

/** Rebuilds the exact unsigned grant from its row (buildGrant is deterministic) and checks it still hashes the same. */
const unsignedGrant = Effect.fn('EthMumbai.Wallet.unsignedGrant')(function* (
  deps: WalletDeps,
  session: SessionAccount,
  row: GrantRow,
) {
  const enforcer = yield* required(deps.enforcer, 'ENFORCER_ADDRESS')
  const approver = yield* required(deps.approver, 'APPROVER_PRIVATE_KEY')
  const chip = yield* pairedChip(deps.database, session, row.robot_id)
  const allowlist = yield* Schema.decodeUnknownEffect(Allowlist)(row.allowlist_json).pipe(Effect.orDie)
  const grant = buildGrant({
    grantId: row.id,
    owner: getAddress(session.smartAccount),
    chip,
    dailyCap: BigInt(row.daily_cap),
    perPaymentCap: BigInt(row.per_payment_cap),
    allowlist,
    startAt: row.start_at,
    expiresAt: row.expires_at,
    enforcer,
    approver,
  })
  if (delegationHash(grant) !== row.delegation_hash)
    return yield* Conflict.make({ detail: 'the grant terms changed since its options; request new options' })
  return grant
})

/** `POST /api/wallet/grants/options` → the unsigned grant stored `unsigned`, and the passkey prompt for its digest. */
const grantOptions = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const { database } = deps
    const session = yield* CurrentSession
    const input = yield* decodeBody(GrantOptionsRequest)
    const enforcer = yield* required(deps.enforcer, 'ENFORCER_ADDRESS')
    const approver = yield* required(deps.approver, 'APPROVER_PRIVATE_KEY')
    yield* required(deps.relayer, 'RELAYER_PRIVATE_KEY')
    const dailyCap = usdcBaseUnits(input.dailyCap)
    const perPaymentCap = usdcBaseUnits(input.perPaymentCap)
    const now = yield* nowSeconds
    if (dailyCap <= 0n || dailyCap > MAX_DAILY_CAP || perPaymentCap <= 0n || perPaymentCap > dailyCap)
      return yield* Conflict.make({ detail: 'caps must satisfy 0 < per-payment ≤ daily ≤ 10 USDC' })
    if (input.expiresAt <= now || input.expiresAt > now + MAX_GRANT_SECONDS)
      return yield* Conflict.make({ detail: 'the grant must expire within 30 days' })
    const chip = yield* pairedChip(database, session, input.robotId)
    const active = yield* firstRow(
      database
        .prepare("SELECT * FROM grants WHERE robot_id = ? AND status IN ('active', 'revoking')")
        .bind(input.robotId),
      GrantRow,
    )
    if (Option.isSome(active)) return yield* Conflict.make({ detail: 'revoke the active grant first' })
    const grantId = idFromBytes16(yield* randomBytes(16))
    const allowlist = input.allowlist.map((address) => getAddress(address))
    const grant: UnsignedDelegation = buildGrant({
      grantId,
      owner: getAddress(session.smartAccount),
      chip,
      dailyCap,
      perPaymentCap,
      allowlist,
      // ERC20PeriodTransferEnforcer reverts `transfer-not-started` before startDate; a minute of slack covers a
      // Worker clock ahead of Arc's block time.
      startAt: now - START_SLACK_SECONDS,
      expiresAt: input.expiresAt,
      enforcer,
      approver,
    })
    const hash = delegationHash(grant)
    yield* database
      .prepare(
        `INSERT INTO grants (id, robot_id, account_id, delegation_hash, daily_cap, per_payment_cap, allowlist_json,
          start_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unsigned', ?)`,
      )
      .bind(
        grantId,
        input.robotId,
        session.accountId,
        hash,
        dailyCap.toString(),
        perPaymentCap.toString(),
        JSON.stringify(allowlist),
        now - START_SLACK_SECONDS,
        input.expiresAt,
        yield* Clock.currentTimeMillis,
      )
      .run()
    const prompt = yield* ownerSignatureOptions(database, {
      accountId: session.accountId,
      action: 'grant',
      ref: grantId,
      digest: delegationDigest(grant),
    })
    return yield* json({ grantId, delegationHash: hash, ...prompt }, 201)
  })

/** `POST /api/wallet/grants/:id/sign`: verifies the passkey over the grant digest, deploys the account on the first
 * grant, checks ERC-1271 on Arc, then marks the grant `active` with its signed delegation. */
const grantSign = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const { database } = deps
    const session = yield* CurrentSession
    const { id } = yield* HttpRouter.schemaPathParams(GrantPath).pipe(Effect.orDie)
    const request = yield* decodeBody(AssertionRequest)
    const relayer = yield* required(deps.relayer, 'RELAYER_PRIVATE_KEY')
    const arc = yield* required(deps.arc, 'ARC_RPC_URL')
    const row = yield* readGrant(database, session, id)
    if (row.status !== 'unsigned') return yield* Conflict.make({ detail: `grant is ${row.status}` })
    if (row.expires_at <= (yield* nowSeconds)) return yield* Conflict.make({ detail: 'grant expired before signing' })
    const grant = yield* unsignedGrant(deps, session, row)
    const digest = delegationDigest(grant)
    const signature = yield* ownerSignature(database, {
      accountId: session.accountId,
      action: 'grant',
      ref: row.id,
      digest,
      request,
    })
    const deployTx = yield* ensureDeployed({ database, arc, relayer }, session.accountId)
    // Right after the deploy receipt a load-balanced RPC node may not see the code yet: re-ask a few times.
    yield* verifyOwnerSignature(arc, session.smartAccount, digest, signature).pipe(
      Effect.retry({ times: 4, schedule: Schedule.spaced('2 seconds') }),
    )
    const won = yield* changes(
      database
        .prepare(
          `UPDATE grants SET status = 'active', delegation_json = ? WHERE id = ? AND status = 'unsigned'
            AND NOT EXISTS (SELECT 1 FROM grants other WHERE other.robot_id = ? AND other.status IN ('active', 'revoking'))`,
        )
        .bind(JSON.stringify({ ...grant, signature }), row.id, row.robot_id),
    )
    if (won !== 1) return yield* Conflict.make({ detail: 'another grant became active for this robot' })
    yield* Effect.logInfo('grant active').pipe(Effect.annotateLogs({ grantId: row.id, robotId: row.robot_id }))
    return yield* json({
      grantId: row.id,
      status: 'active',
      delegationHash: row.delegation_hash,
      deployTx: Option.getOrNull(deployTx),
    })
  })

export const grantsRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    HttpRouter.add('POST', '/api/wallet/grants/options', requireSession(answerWalletErrors(grantOptions(deps)))),
    HttpRouter.add('POST', '/api/wallet/grants/:id/sign', requireSession(answerWalletErrors(grantSign(deps)))),
  )
