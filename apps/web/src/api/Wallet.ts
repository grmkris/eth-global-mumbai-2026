import { AssertionOptions, type AssertionRequest } from '@ethmumbai/auth/config'
import { RobotKind } from '@ethmumbai/protocol/Intent'
import { Schema } from 'effect'
import { getJson, postJson } from './Http.ts'

/** The browser's view of the wallet API (packages/server/src/wallet): only the fields the pages show. */

const Nullable = <S extends Schema.Constraint>(schema: S) => Schema.NullOr(schema)

export const GrantView = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  dailyCap: Schema.String,
  perPaymentCap: Schema.String,
  allowlist: Schema.Array(Schema.String),
  expiresAt: Schema.Number,
  revokeTx: Schema.optionalKey(Nullable(Schema.String)),
  delegationHash: Schema.optionalKey(Schema.String),
  startAt: Schema.optionalKey(Schema.Number),
  /** What the period enforcer's current day has used (base units), and when that day ends (unix s). */
  spentToday: Schema.optionalKey(Schema.String),
  periodEndsAt: Schema.optionalKey(Schema.Number),
})
export type GrantView = typeof GrantView.Type

/** What is left of today's allowance (base units, never below 0), or null when the Worker did not report the day. */
export const leftToday = (grant: { readonly dailyCap: string; readonly spentToday?: string }): string | null => {
  if (grant.spentToday === undefined) return null
  const left = BigInt(grant.dailyCap) - BigInt(grant.spentToday)
  return (left > 0n ? left : 0n).toString()
}

export const WalletView = Schema.Struct({
  account: Schema.Struct({
    accountId: Schema.String,
    displayName: Schema.String,
    smartAccount: Schema.String,
    deployStatus: Schema.String,
    deployTx: Nullable(Schema.String),
  }),
  balance: Nullable(Schema.Struct({ units: Schema.String, usdc: Schema.String })),
  fund: Schema.Struct({ network: Schema.String, asset: Schema.String, address: Schema.String }),
})
export type WalletView = typeof WalletView.Type

export const EpisodeActivity = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  robotName: Schema.String,
  item: Schema.String,
  state: Schema.String,
  createdAt: Schema.Number,
  amount: Nullable(Schema.String),
  txHash: Nullable(Schema.String),
})
export type EpisodeActivity = typeof EpisodeActivity.Type

export const ActivityView = Schema.Struct({
  episodes: Schema.Array(EpisodeActivity),
  grants: Schema.Array(Schema.Struct({ ...GrantView.fields, robotId: Schema.String })),
})
export type ActivityView = typeof ActivityView.Type

export const RobotView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.optionalKey(RobotKind),
  status: Schema.String,
  chipAddress: Nullable(Schema.String),
  pairingCode: Nullable(Schema.String),
  pairingExpiresAt: Nullable(Schema.Number),
  lease: Schema.Struct({ until: Nullable(Schema.Number), online: Schema.Boolean }),
  grant: Nullable(GrantView),
})
export type RobotView = typeof RobotView.Type

export const AddedRobot = Schema.Struct({
  robotId: Schema.String,
  name: Schema.String,
  kind: Schema.optionalKey(RobotKind),
  pairingCode: Schema.String,
  pairingExpiresAt: Schema.Number,
})
export type AddedRobot = typeof AddedRobot.Type

/** A passkey prompt for an owner action: the challenge is the delegation's EIP-712 digest. */
const OwnerPrompt = Schema.Struct({
  ...AssertionOptions.fields,
  grantId: Schema.String,
  allowCredentials: Schema.Array(Schema.String),
})

export const loadWallet = getJson('/api/wallet', WalletView)
export const loadActivity = getJson('/api/wallet/activity', ActivityView)
export const listRobots = getJson('/api/robots', Schema.Struct({ robots: Schema.Array(RobotView) }))
export const addRobot = (name: string, kind: RobotKind) => postJson('/api/robots', { name, kind }, AddedRobot)
/** Give up on a robot still waiting for its chip, so Add robot starts fresh. */
export const cancelPairing = (robotId: string) =>
  postJson(`/api/robots/${encodeURIComponent(robotId)}/cancel`, {}, Schema.Struct({ cancelled: Schema.Boolean }))

export type GrantTerms = {
  readonly robotId: string
  readonly dailyCap: string
  readonly perPaymentCap: string
  readonly allowlist: ReadonlyArray<string>
  readonly expiresAt: number
}
export const grantOptions = (terms: GrantTerms) => postJson('/api/wallet/grants/options', terms, OwnerPrompt)
export const signGrant = (grantId: string, assertion: AssertionRequest) =>
  postJson(
    `/api/wallet/grants/${grantId}/sign`,
    assertion,
    Schema.Struct({ grantId: Schema.String, status: Schema.String, deployTx: Nullable(Schema.String) }),
  )
export const revokeOptions = (grantId: string) =>
  postJson(`/api/wallet/grants/${grantId}/revoke/options`, {}, OwnerPrompt)
export const signRevoke = (grantId: string, assertion: AssertionRequest) =>
  postJson(
    `/api/wallet/grants/${grantId}/revoke/sign`,
    assertion,
    // 200 revoked (with the tx when this request saw it) or 202 still revoking, settled later from Arc.
    Schema.Struct({
      grantId: Schema.String,
      status: Schema.String,
      revokeTx: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  )

/** The owner's own send (spec §4 owner actions): the passkey signs a one-time delegation for exactly this transfer. */
export const sendOptions = (to: string, amount: string) =>
  postJson(
    '/api/wallet/send/options',
    { to, amount },
    Schema.Struct({ ...AssertionOptions.fields, sendId: Schema.String, allowCredentials: Schema.Array(Schema.String) }),
  )
export const signSend = (input: {
  readonly sendId: string
  readonly to: string
  readonly amount: string
  readonly assertion: AssertionRequest
}) =>
  postJson(
    '/api/wallet/send/sign',
    input,
    // 200 sent (with the tx) or 202 broadcast and still pending on Arc (the hash when the relayer has it).
    Schema.Struct({
      sendId: Schema.String,
      status: Schema.Literals(['sent', 'pending']),
      txHash: Nullable(Schema.String),
    }),
  )

export const Catalogue = Schema.Struct({
  merchantId: Schema.String,
  name: Schema.String,
  payTo: Schema.optionalKey(Nullable(Schema.String)),
  items: Schema.Array(
    Schema.Struct({ itemId: Schema.String, name: Schema.String, amount: Schema.String, restricted: Schema.Boolean }),
  ),
})
export type Catalogue = typeof Catalogue.Type
export const loadCatalogue = getJson('/api/merchants/duck-cafe/items', Catalogue)

/** USDC base units (6 dp) as "0.10". */
export const usdc = (units: string): string => {
  const value = BigInt(units)
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${fraction}`
}

/** A catalogue item id as a name (`chai` → `Chai`), where only the id is at hand. */
export const itemName = (item: string) => item.slice(0, 1).toUpperCase() + item.slice(1)

export const explorerTx = (hash: string) => `https://explorer.arc.io/tx/${hash}`

/** "No" to a waiting approval (spec §9): the errand ends `denied`, nothing is signed. */
export const denyApproval = (approvalId: string) =>
  postJson(`/api/approvals/${encodeURIComponent(approvalId)}/deny`, {}, Schema.Struct({ status: Schema.String }))
