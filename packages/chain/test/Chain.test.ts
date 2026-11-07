import { createDelegation, Implementation, ScopeType, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit'
import { hashDelegation } from '@metamask/smart-accounts-kit/utils'
import { approvalDigest, approvalNonce } from '@ethmumbai/protocol/Approval'
import {
  ARC_DELEGATION_MANAGER,
  buildLeaf,
  DELEGATION_TYPES,
  delegationDigest,
  delegationDomain,
  delegationHash,
  delegationMessage,
  LEAF_ENFORCERS,
} from '@ethmumbai/protocol/Delegation'
import { hashTypedData as protocolTypedData } from '@ethmumbai/protocol/Eip712'
import { INVOICE_DOMAIN, INVOICE_TYPE } from '@ethmumbai/protocol/Invoice'
import { keccak256 as protocolKeccak } from '@ethmumbai/protocol/Keccak'
import { Effect } from 'effect'
import {
  decodeAbiParameters,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  recoverAddress,
  toHex,
  zeroAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import {
  approvalArgs,
  arcAddresses,
  arcEnvironment,
  buildGrant,
  buildRevoke,
  buildSend,
  counterfactualAccount,
  decodePermissionContext,
  decodePolicyTerms,
  delegationHashOf,
  encodePermissionContext,
  isSignedBy,
  makeApprover,
  sendExecution,
  signLeaf,
  toKitDelegation,
  transferCall,
  USDC,
} from '../src/index.ts'
import { offlineClient } from './OfflineClient.ts'

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
const randomBytes = (size: number) => toHex(crypto.getRandomValues(new Uint8Array(size)))
const randomAddress = () => privateKeyToAccount(generatePrivateKey()).address

const grantInput = (owner = randomAddress()) => ({
  grantId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  owner,
  chip: randomAddress(),
  dailyCap: 1_000_000n,
  perPaymentCap: 300_000n,
  allowlist: [randomAddress()],
  startAt: 1_794_000_000,
  expiresAt: 1_794_086_400,
  enforcer: randomAddress(),
  approver: randomAddress(),
})

describe('deployment registry', () => {
  test('the chip pins in @ethmumbai/protocol equal the kit environment for chain 5042', () => {
    expect(ARC_DELEGATION_MANAGER).toBe(arcEnvironment.DelegationManager)
    for (const [name, address] of Object.entries(LEAF_ENFORCERS))
      expect(arcEnvironment.caveatEnforcers[name]).toBe(address)
  })

  test('the addresses spec §5 lists', () => {
    expect(arcAddresses).toMatchObject({
      delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
      hybridDeleGator: '0x48dBe696A4D990079e039489bA2053B36E8FFEC4',
      simpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c',
      valueLte: '0x92Bf12322527cAA612fd31a0e810472BBB106A8F',
      erc20PeriodTransfer: '0x474e3Ae7E169e940607cC624Da8A15Eb120139aB',
      timestamp: '0x1046bb45C8d673d4ea75321280DB34899413c069',
      id: '0xC8B5D93463c893401094cc70e66A206fb5987997',
      exactExecution: '0x146713078D39eCC1F5338309c28405ccf85Abfbb',
      redeemer: '0xE144b0b2618071B4E56f746313528a669c7E65c5',
    })
  })
})

describe('protocol hashes against viem and the kit (random inputs)', () => {
  test.each(Array.from({ length: 8 }, (_, index) => index))(
    'keccak, invoice EIP-712, approval, delegation #%i',
    (round) => {
      const data = randomBytes(round * 37)
      expect(protocolKeccak(hexToBytes(data))).toBe(keccak256(data))
      const invoice = {
        merchantId: keccak256(randomBytes(4)),
        invoiceId: randomBytes(16),
        payTo: randomAddress(),
        asset: USDC,
        amount: BigInt(randomBytes(12)),
        expiresAt: BigInt(randomBytes(4)),
        linesHash: keccak256(randomBytes(8)),
        rulesHash: keccak256(randomBytes(8)),
      }
      expect(protocolTypedData(INVOICE_DOMAIN, INVOICE_TYPE, invoice)).toBe(
        hashTypedData({
          domain: INVOICE_DOMAIN,
          primaryType: 'Invoice',
          types: { Invoice: INVOICE_TYPE.fields.map((field) => ({ ...field })) },
          message: invoice,
        }),
      )
      const grant = buildGrant(grantInput())
      expect(delegationHash(grant)).toBe(delegationHashOf(grant))
      expect(delegationDigest(grant)).toBe(
        hashTypedData({
          domain: delegationDomain(),
          types: DELEGATION_TYPES,
          primaryType: 'Delegation',
          message: delegationMessage(grant),
        }),
      )
    },
  )
})

describe('grant, revoke and leaf builders', () => {
  test('grant caveats are the kit builders’ terms in spec order', () => {
    const input = grantInput()
    const grant = buildGrant(input)
    const kit = createDelegation({
      environment: arcEnvironment,
      from: input.owner,
      to: input.chip,
      scope: {
        type: ScopeType.Erc20PeriodTransfer,
        tokenAddress: USDC,
        periodAmount: input.dailyCap,
        periodDuration: 86_400,
        startDate: input.startAt,
      },
      caveats: [{ type: 'timestamp', afterThreshold: 0, beforeThreshold: input.expiresAt }],
    })
    const kitTerms = (enforcer: string) => kit.caveats.find((caveat) => caveat.enforcer === enforcer)?.terms
    expect(grant.caveats.map((caveat) => caveat.enforcer)).toEqual([
      arcAddresses.valueLte,
      arcAddresses.erc20PeriodTransfer,
      arcAddresses.timestamp,
      input.enforcer,
    ])
    for (const caveat of grant.caveats.slice(0, 3)) expect(caveat.terms).toBe(kitTerms(caveat.enforcer))
    expect(decodePolicyTerms(grant.caveats[3]?.terms ?? '0x')).toEqual({
      perPaymentCap: input.perPaymentCap,
      allowlist: input.allowlist,
      approver: input.approver,
    })
    expect(buildGrant({ ...input, grantId: 'bbbbbbbbbbbbbbbbbbbbbbbbba' }).salt).not.toBe(grant.salt)
    const { enforcer: _enforcer, approver: _approver, ...stockOnly } = input
    expect(buildGrant(stockOnly).caveats.map((caveat) => caveat.enforcer)).toEqual(
      grant.caveats.slice(0, 3).map((caveat) => caveat.enforcer),
    )
  })

  test('leaf: signed by the chip, round-trips through the permission context, hash equals the kit', async () => {
    const chip = privateKeyToAccount(generatePrivateKey())
    const relayer = randomAddress()
    const grant = { ...buildGrant(grantInput()), signature: randomBytes(64) }
    const leaf = buildLeaf({
      chip: chip.address,
      grantHash: delegationHashOf(grant),
      relayer,
      invoiceHash: keccak256(randomBytes(32)),
      payTo: randomAddress(),
      amount: 100_000n,
      expiresAt: 1_794_000_600,
    })
    const signed = await run(signLeaf(chip, leaf))
    expect(await run(isSignedBy(signed, chip.address))).toBe(true)
    expect(await run(isSignedBy(signed, relayer))).toBe(false)
    expect(hashDelegation(toKitDelegation(signed))).toBe(delegationHash(leaf))
    const decoded = decodePermissionContext(encodePermissionContext([signed, grant]))
    expect(decoded.map(delegationHashOf)).toEqual([delegationHash(leaf), delegationHash(grant)])
    expect(decoded.map((delegation) => delegation.signature)).toEqual([signed.signature, grant.signature])
  })

  test('revoke is a one-time owner → relayer delegation of disableDelegation(grant)', () => {
    const grant = { ...buildGrant(grantInput()), signature: randomBytes(64) }
    const relayer = randomAddress()
    const revoke = buildRevoke({ grantId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', grant, relayer })
    expect(revoke.delegate).toBe(relayer)
    expect(revoke.delegator).toBe(grant.delegator)
    expect(revoke.caveats.map((caveat) => caveat.enforcer)).toEqual([
      arcAddresses.exactExecution,
      arcAddresses.limitedCalls,
    ])
    expect(revoke.caveats[0]?.terms.slice(0, 42).toLowerCase()).toBe(arcAddresses.delegationManager.toLowerCase())
  })

  test('send is a one-time owner → relayer delegation of exactly USDC.transfer(to, amount), bound to its id', () => {
    const owner = randomAddress()
    const relayer = randomAddress()
    const to = randomAddress()
    const input = { sendId: 'bbbbbbbbbbbbbbbbbbbbbbbbbb', owner, relayer, to, amount: 1_500_000n }
    const send = buildSend(input)
    expect(send.delegate).toBe(relayer)
    expect(send.delegator).toBe(owner)
    expect(send.caveats.map((caveat) => caveat.enforcer)).toEqual([
      arcAddresses.exactExecution,
      arcAddresses.limitedCalls,
    ])
    // The ExactExecution term is the very execution the relayer redeems: USDC, value 0, transfer(to, 1.50).
    expect(send.caveats[0]?.terms).toBe(sendExecution(to, 1_500_000n))
    expect(send.caveats[0]?.terms.slice(0, 42).toLowerCase()).toBe(USDC.toLowerCase())
    expect(send.caveats[0]?.terms.endsWith(transferCall(to, 1_500_000n).slice(2))).toBe(true)
    expect(send.caveats[1]?.terms).toBe(toHex(1n, { size: 32 }))
    // Options and sign rebuild the same digest; any change of terms or id is a different delegation.
    expect(delegationDigest(buildSend(input))).toBe(delegationDigest(send))
    expect(delegationHash(buildSend({ ...input, amount: 1_500_001n }))).not.toBe(delegationHash(send))
    expect(delegationHash(buildSend({ ...input, to: randomAddress() }))).not.toBe(delegationHash(send))
    expect(delegationHash(buildSend({ ...input, sendId: 'cccccccccccccccccccccccccc' }))).not.toBe(delegationHash(send))
  })
})

describe('owner account', () => {
  test('counterfactual address equals the kit’s toMetaMaskSmartAccount (Hybrid, passkey + no EOA)', async () => {
    const key = {
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      keyId: 'credential-1',
      x: '0x65a2fa44daad46eab0278703edb6c4dcf5e30b8a9aec09fdc71a56f52aa392e4',
      y: '0x4a7a9e4604aa36898209997288e902ac544a555e4b5e0a9efef2b59233f3f437',
    }
    const owner = await run(counterfactualAccount(key))
    const kit = await toMetaMaskSmartAccount({
      client: offlineClient,
      implementation: Implementation.Hybrid,
      deployParams: [zeroAddress, [key.keyId], [BigInt(key.x)], [BigInt(key.y)]],
      deploySalt: owner.deploySalt,
      signer: { account: privateKeyToAccount(generatePrivateKey()) },
    })
    expect(owner.smartAccount).toBe(kit.address)
    expect(owner.deploySalt).toBe(keccak256(toHex(key.accountId)))
    expect(await kit.getFactoryArgs()).toEqual({ factory: owner.factory, factoryData: owner.factoryData })
  })
})

describe('approver', () => {
  test('signs the protocol digest; equals viem signTypedData; args decode', async () => {
    const key = generatePrivateKey()
    const approver = makeApprover(key)
    const enforcer = randomAddress()
    const base = {
      invoiceHash: keccak256(randomBytes(8)),
      payee: randomAddress(),
      amount: '500000',
      expiry: 1_794_000_300,
    }
    const approval = { ...base, nonce: approvalNonce(enforcer, base) }
    const signed = await run(approver.sign(enforcer, approval))
    expect(await recoverAddress({ hash: approvalDigest(enforcer, approval), signature: signed.signature })).toBe(
      approver.address,
    )
    const viaViem = await privateKeyToAccount(key).signTypedData({
      domain: { name: 'VitaquackApproval', version: '1', chainId: 5042, verifyingContract: enforcer },
      types: {
        Approval: [
          { name: 'invoiceHash', type: 'bytes32' },
          { name: 'payee', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'expiry', type: 'uint64' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'Approval',
      message: { ...approval, amount: 500_000n, expiry: 1_794_000_300n },
    })
    expect(signed.signature).toBe(viaViem)
    const [decoded, signature] = decodeAbiParameters(
      parseAbiParameters('(bytes32,address,uint256,uint64,bytes32), bytes'),
      approvalArgs(signed),
    )
    expect(decoded).toEqual([approval.invoiceHash, approval.payee, 500_000n, 1_794_000_300n, approval.nonce])
    expect(signature).toBe(signed.signature)
  })
})
