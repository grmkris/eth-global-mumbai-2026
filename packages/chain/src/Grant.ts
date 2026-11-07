import { ExecutionMode } from '@metamask/smart-accounts-kit'
import type { SignedApproval } from '@ethmumbai/protocol/Approval'
import { type Delegation, ROOT_AUTHORITY, type UnsignedDelegation } from '@ethmumbai/protocol/Delegation'
import {
  type Address,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
} from 'viem'
import { arcAddresses, PERIOD_SECONDS, USDC } from './Env.ts'
import { toKitDelegation } from './Hashes.ts'

export const delegationManagerAbi = parseAbi([
  'struct Caveat { address enforcer; bytes terms; bytes args; }',
  'struct Delegation { address delegate; address delegator; bytes32 authority; Caveat[] caveats; uint256 salt; bytes signature; }',
  'function redeemDelegations(bytes[] _permissionContexts, bytes32[] _modes, bytes[] _executionCallDatas)',
  'function disableDelegation(Delegation _delegation)',
  'function disabledDelegations(bytes32 _delegationHash) view returns (bool)',
])
const erc20Abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

const POLICY_TERMS = parseAbiParameters('uint256 perPaymentCap, address[] allowlist, address approver')
const APPROVAL_ARGS = parseAbiParameters(
  '(bytes32 invoiceHash, address payee, uint256 amount, uint64 expiry, bytes32 nonce) approval, bytes signature',
)

/** A uint256 salt as the wire's decimal string, derived from a label (grant id, invoice hash, …). */
export const saltOf = (label: string): string => BigInt(keccak256(stringToHex(label))).toString()

/** `RobotPaymentPolicyEnforcer` terms: `abi.encode(uint256 perPaymentCap, address[] allowlist, address approver)`. */
export const policyTerms = (input: { perPaymentCap: bigint; allowlist: readonly Address[]; approver: Address }): Hex =>
  encodeAbiParameters(POLICY_TERMS, [input.perPaymentCap, [...input.allowlist], input.approver])

export const decodePolicyTerms = (terms: Hex) => {
  const [perPaymentCap, allowlist, approver] = decodeAbiParameters(POLICY_TERMS, terms)
  return { perPaymentCap, allowlist, approver }
}

/** The enforcer caveat's `args` for an approved payment: `abi.encode(Approval, bytes signature)`. */
export const approvalArgs = (approval: SignedApproval): Hex =>
  encodeAbiParameters(APPROVAL_ARGS, [
    {
      invoiceHash: approval.invoiceHash,
      payee: approval.payee,
      amount: BigInt(approval.amount),
      expiry: BigInt(approval.expiry),
      nonce: approval.nonce,
    },
    approval.signature,
  ])

export type GrantInput = {
  readonly grantId: string
  readonly owner: Address
  readonly chip: Address
  readonly dailyCap: bigint
  readonly perPaymentCap: bigint
  readonly allowlist: readonly Address[]
  /** Unix seconds; the period enforcer refuses transfers before it. */
  readonly startAt: number
  readonly expiresAt: number
  /** RobotPaymentPolicyEnforcer and its approver; omitted until the enforcer is deployed (stock enforcers only). */
  readonly enforcer?: Address
  readonly approver?: Address
}

const policyCaveat = (input: GrantInput) =>
  input.enforcer === undefined || input.approver === undefined
    ? []
    : [
        {
          enforcer: getAddress(input.enforcer),
          terms: policyTerms({
            perPaymentCap: input.perPaymentCap,
            allowlist: input.allowlist,
            approver: input.approver,
          }),
          args: '0x' as const,
        },
      ]

/**
 * The root grant owner → chip (§5), caveats in order: ValueLte(0) · ERC20PeriodTransfer(USDC, dailyCap, 1 day,
 * startAt) · Timestamp(0, expiresAt) · RobotPaymentPolicyEnforcer(perPaymentCap, allowlist, approver) when configured.
 */
export const buildGrant = (input: GrantInput): UnsignedDelegation => ({
  delegate: getAddress(input.chip),
  delegator: getAddress(input.owner),
  authority: ROOT_AUTHORITY,
  caveats: [
    { enforcer: arcAddresses.valueLte, terms: toHex(0n, { size: 32 }), args: '0x' },
    {
      enforcer: arcAddresses.erc20PeriodTransfer,
      terms: encodePacked(
        ['address', 'uint256', 'uint256', 'uint256'],
        [USDC, input.dailyCap, PERIOD_SECONDS, BigInt(input.startAt)],
      ),
      args: '0x',
    },
    {
      enforcer: arcAddresses.timestamp,
      terms: encodePacked(['uint128', 'uint128'], [0n, BigInt(input.expiresAt)]),
      args: '0x',
    },
    ...policyCaveat(input),
  ],
  salt: saltOf(`grant:${input.grantId}`),
})

/** The grant with the approver's signature injected into the enforcer caveat's args (args are not signed). */
export const withApprovalArgs = (
  grant: Delegation,
  enforcer: Address,
  approval: SignedApproval | null,
): Delegation => ({
  ...grant,
  caveats: grant.caveats.map((caveat) =>
    caveat.enforcer.toLowerCase() === enforcer.toLowerCase()
      ? { ...caveat, args: approval === null ? '0x' : approvalArgs(approval) }
      : caveat,
  ),
})

/** `encodePacked(address target, uint256 value, bytes callData)`, the single-call execution of `redeemDelegations`. */
export const singleExecution = (target: Address, callData: Hex, value = 0n): Hex =>
  encodePacked(['address', 'uint256', 'bytes'], [target, value, callData])

export const transferCall = (payTo: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [payTo, amount] })

/** `redeemDelegations([context], [SingleDefault], [execution])` (selector 0xcef6d209). */
export const redeemCalldata = (permissionContext: Hex, execution: Hex): Hex =>
  encodeFunctionData({
    abi: delegationManagerAbi,
    functionName: 'redeemDelegations',
    args: [[permissionContext], [ExecutionMode.SingleDefault], [execution]],
  })

export const disableDelegationCalldata = (grant: Delegation): Hex => {
  const kit = toKitDelegation(grant)
  return encodeFunctionData({
    abi: delegationManagerAbi,
    functionName: 'disableDelegation',
    args: [{ ...kit, salt: BigInt(kit.salt) }],
  })
}

/**
 * The owner's one-time revoke: owner → relayer, ExactExecution(DM, 0, disableDelegation(grant)) · LimitedCalls(1).
 * The owner signs it with the passkey; the relayer redeems it.
 */
export const buildRevoke = (input: { grantId: string; grant: Delegation; relayer: Address }): UnsignedDelegation => ({
  delegate: getAddress(input.relayer),
  delegator: getAddress(input.grant.delegator),
  authority: ROOT_AUTHORITY,
  caveats: [
    {
      enforcer: arcAddresses.exactExecution,
      terms: singleExecution(arcAddresses.delegationManager, disableDelegationCalldata(input.grant)),
      args: '0x',
    },
    { enforcer: arcAddresses.limitedCalls, terms: toHex(1n, { size: 32 }), args: '0x' },
  ],
  salt: saltOf(`revoke:${input.grantId}`),
})

/** The execution a revoke redeems (equal to its ExactExecution term). */
export const revokeExecution = (grant: Delegation): Hex =>
  singleExecution(arcAddresses.delegationManager, disableDelegationCalldata(grant))

/** The execution a send redeems: the owner's account calls `USDC.transfer(to, amount)` (equal to its ExactExecution term). */
export const sendExecution = (to: Address, amount: bigint): Hex =>
  singleExecution(USDC, transferCall(getAddress(to), amount))

/**
 * The owner's one-time send: owner → relayer, ExactExecution(USDC, 0, transfer(to, amount)) · LimitedCalls(1).
 * The owner signs it with the passkey; the relayer redeems it, so the account itself moves its USDC (no allowance,
 * no other call). Deterministic from (sendId, to, amount), so options and sign rebuild the same digest.
 */
export const buildSend = (input: {
  sendId: string
  owner: Address
  relayer: Address
  to: Address
  amount: bigint
}): UnsignedDelegation => ({
  delegate: getAddress(input.relayer),
  delegator: getAddress(input.owner),
  authority: ROOT_AUTHORITY,
  caveats: [
    { enforcer: arcAddresses.exactExecution, terms: sendExecution(input.to, input.amount), args: '0x' },
    { enforcer: arcAddresses.limitedCalls, terms: toHex(1n, { size: 32 }), args: '0x' },
  ],
  salt: saltOf(`send:${input.sendId}`),
})
