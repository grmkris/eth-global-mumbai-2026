import { Effect, Schema } from 'effect'
import { type Address, type Hex, keccak256, sha256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type ArcClient, ArcRpcError, GAS_POLICY, rpc, withHeadroom } from './Arc.ts'
import { ARC_CHAIN_ID } from './Env.ts'

// The relayer EOA submits settlements, revokes, owner sends and account deploys. One key, one nonce sequence: every send is keyed
// (`settle:<invoiceHash>`, `revoke:<delegationHash>`, `send:<sendId>`, `deploy:<smartAccount>`) and claimed in `relayer_txs` first,
// so a second attempt for the same key is refused before anything is signed (the persistent replay guard).
export type RelayerTxKind = 'settle' | 'revoke' | 'deploy' | 'send'
export type RelayerTxStatus = 'pending' | 'sent' | 'confirmed' | 'failed'

export type RelayerTx = {
  readonly key: string
  readonly kind: RelayerTxKind
  readonly to: Address
  readonly dataSha256: Hex
}

export type RelayerTxRecord = {
  readonly key: string
  readonly status: RelayerTxStatus
  readonly txHash: Hex | null
  readonly error: string | null
}

export class RelayerStoreError extends Schema.TaggedError<RelayerStoreError>()('RelayerStoreError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

/** Persistence for `relayer_txs` (D1 in the Worker, memory in tests). */
export interface RelayerStore {
  /** Inserts a `pending` row, or re-claims a `failed` one that never broadcast; otherwise returns the existing row. */
  readonly claim: (
    tx: RelayerTx,
  ) => Effect.Effect<
    { readonly claimed: true } | { readonly claimed: false; readonly existing: RelayerTxRecord },
    RelayerStoreError
  >
  /** Reserves `nonce` for `key`; false when another row holds it (unique `nonce`). */
  readonly reserveNonce: (key: string, nonce: number) => Effect.Effect<boolean, RelayerStoreError>
  readonly markSent: (key: string, txHash: Hex) => Effect.Effect<void, RelayerStoreError>
  readonly markConfirmed: (key: string, gasUsed: bigint) => Effect.Effect<void, RelayerStoreError>
  /** `releaseNonce` when the transaction never reached the network, so the nonce can be reused. */
  readonly markFailed: (key: string, error: string, releaseNonce: boolean) => Effect.Effect<void, RelayerStoreError>
}

export class AlreadySubmitted extends Schema.TaggedError<AlreadySubmitted>()('AlreadySubmitted', {
  key: Schema.String,
  status: Schema.String,
  txHash: Schema.NullOr(Schema.String),
}) {}

export class RelayerError extends Schema.TaggedError<RelayerError>()('RelayerError', {
  key: Schema.String,
  stage: Schema.Literals(['simulate', 'nonce', 'send', 'receipt']),
  message: Schema.String,
  /** Set at stage `receipt`: the transaction was broadcast, so its outcome is unknown, not failed. */
  txHash: Schema.optionalKey(Schema.String),
}) {}

export type SendResult = { readonly txHash: Hex; readonly gasUsed: bigint; readonly success: boolean }

const NONCE_ATTEMPTS = 3

export const dataSha256 = (data: Hex): Hex => sha256(data)

export const makeRelayer = (config: {
  readonly client: ArcClient
  readonly privateKey: Hex
  readonly store: RelayerStore
  /** How long to wait for a receipt before the outcome is reported unknown (default 60 s; tests shorten it). */
  readonly receiptTimeoutMs?: number
}) => {
  const account = privateKeyToAccount(config.privateKey)
  const { client, store } = config

  const reserve = Effect.fn('EthMumbai.Chain.Relayer.reserveNonce')(function* (key: string) {
    let candidate = yield* rpc('getTransactionCount', () =>
      client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    )
    for (let attempt = 0; attempt < NONCE_ATTEMPTS; attempt++) {
      if (yield* store.reserveNonce(key, candidate)) return candidate
      const latest = yield* rpc('getTransactionCount', () =>
        client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      )
      candidate = Math.max(candidate + 1, latest)
    }
    return yield* new RelayerError({ key, stage: 'nonce', message: 'nonce still taken after 3 attempts' })
  })

  const failUnsent = (key: string, stage: 'simulate' | 'nonce' | 'send') => (error: ArcRpcError | RelayerError) =>
    store
      .markFailed(key, error.message, true)
      .pipe(Effect.andThen(Effect.fail(new RelayerError({ key, stage, message: error.message }))))

  /** Claims `key`, simulates from the relayer, reserves a nonce, signs, broadcasts and waits for the receipt. */
  const send = Effect.fn('EthMumbai.Chain.Relayer.send')(function* (tx: {
    readonly key: string
    readonly kind: RelayerTxKind
    readonly to: Address
    readonly data: Hex
  }) {
    const claim = yield* store.claim({ key: tx.key, kind: tx.kind, to: tx.to, dataSha256: dataSha256(tx.data) })
    if (!claim.claimed)
      return yield* new AlreadySubmitted({ key: tx.key, status: claim.existing.status, txHash: claim.existing.txHash })
    const estimate = yield* rpc('estimateGas', () =>
      client.estimateGas({ account: account.address, to: tx.to, data: tx.data }),
    ).pipe(Effect.catchTag('ArcRpcError', failUnsent(tx.key, 'simulate')))
    const nonce = yield* reserve(tx.key).pipe(
      Effect.catchTag(['ArcRpcError', 'RelayerError'], failUnsent(tx.key, 'nonce')),
    )
    const serialized = yield* Effect.promise(() =>
      account.signTransaction({
        chainId: ARC_CHAIN_ID,
        type: 'eip1559',
        nonce,
        to: tx.to,
        data: tx.data,
        value: 0n,
        gas: withHeadroom(estimate),
        ...GAS_POLICY,
      }),
    )
    const txHash = keccak256(serialized)
    yield* rpc('sendRawTransaction', () => client.sendRawTransaction({ serializedTransaction: serialized })).pipe(
      Effect.catchTag('ArcRpcError', failUnsent(tx.key, 'send')),
    )
    yield* store.markSent(tx.key, txHash)
    const receipt = yield* rpc('waitForTransactionReceipt', () =>
      client.waitForTransactionReceipt({
        hash: txHash,
        timeout: config.receiptTimeoutMs ?? 60_000,
        pollingInterval: Math.min(1_000, config.receiptTimeoutMs ?? 1_000),
      }),
    ).pipe(
      Effect.mapError((error) => new RelayerError({ key: tx.key, stage: 'receipt', message: error.message, txHash })),
    )
    const success = receipt.status === 'success'
    yield* success ? store.markConfirmed(tx.key, receipt.gasUsed) : store.markFailed(tx.key, 'reverted on chain', false)
    const result: SendResult = { txHash, gasUsed: receipt.gasUsed, success }
    return result
  })

  return { address: account.address, send }
}
export type Relayer = ReturnType<typeof makeRelayer>

/** An in-process `RelayerStore` (scripts and tests); the Worker uses the D1 store over `relayer_txs`. */
export const makeMemoryRelayerStore = (): RelayerStore => {
  const rows = new Map<string, RelayerTxRecord & { nonce: number | null }>()
  const update = (key: string, patch: Partial<RelayerTxRecord & { nonce: number | null }>) =>
    Effect.sync(() => {
      const row = rows.get(key)
      if (row !== undefined) rows.set(key, { ...row, ...patch })
    })
  return {
    claim: (tx) =>
      Effect.sync(() => {
        const existing = rows.get(tx.key)
        if (existing !== undefined && !(existing.status === 'failed' && existing.txHash === null))
          return { claimed: false as const, existing }
        rows.set(tx.key, { key: tx.key, status: 'pending', txHash: null, error: null, nonce: null })
        return { claimed: true as const }
      }),
    reserveNonce: (key, nonce) =>
      Effect.sync(() => {
        if ([...rows.values()].some((row) => row.nonce === nonce && row.key !== key)) return false
        const row = rows.get(key)
        if (row !== undefined) rows.set(key, { ...row, nonce })
        return true
      }),
    markSent: (key, txHash) => update(key, { status: 'sent', txHash }),
    markConfirmed: (key) => update(key, { status: 'confirmed' }),
    markFailed: (key, error, releaseNonce) =>
      update(key, releaseNonce ? { status: 'failed', error, nonce: null } : { status: 'failed', error }),
  }
}
