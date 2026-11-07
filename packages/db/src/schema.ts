import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Vitaquack's D1 (spec §3). D1 mirrors chain state; Arc is the only spending authority. Ids are 26-char base32 unless
// noted; `created_at` is epoch milliseconds; other `*_at` columns are unix seconds unless the owning module says
// otherwise (robots.lease_until is milliseconds); uint256 and USDC amounts are decimal text; hashes are 0x hex.
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull()

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    securityRevision: text('security_revision').notNull(),
    smartAccount: text('smart_account').notNull(),
    deploySalt: text('deploy_salt').notNull(),
    eoaOwner: text('eoa_owner'),
    deployStatus: text('deploy_status', { enum: ['counterfactual', 'deploying', 'deployed', 'failed'] }).notNull(),
    deployTx: text('deploy_tx'),
    worldSub: text('world_sub'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('accounts_smart_account').on(table.smartAccount)],
)

export const passkeys = sqliteTable(
  'passkeys',
  {
    credentialId: text('credential_id').primaryKey(),
    accountId: text('account_id').notNull(),
    alg: integer('alg').notNull(),
    spki: text('spki').notNull(),
    x: text('x').notNull(),
    y: text('y').notNull(),
    signCount: integer('sign_count').notNull(),
    createdAt: createdAt(),
    lastUsedAt: integer('last_used_at'),
  },
  (table) => [index('passkeys_account_id').on(table.accountId)],
)

export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['register', 'login', 'grant', 'revoke', 'send'] }).notNull(),
    accountId: text('account_id'),
    ref: text('ref'),
    expiresAt: integer('expires_at').notNull(),
    used: integer('used', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index('auth_challenges_expires_at').on(table.expiresAt)],
)

export const robots = sqliteTable(
  'robots',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id'),
    name: text('name'),
    pairingCode: text('pairing_code'),
    pairingExpiresAt: integer('pairing_expires_at'),
    chipAddress: text('chip_address'),
    chipTokenHash: text('chip_token_hash'),
    pairedAt: integer('paired_at'),
    lastPollAt: integer('last_poll_at'),
    leaseUntil: integer('lease_until'),
    status: text('status', { enum: ['unpaired', 'paired', 'revoked'] }).notNull(),
    // `chip` = a hardware or CLI chip; `sim` = a simulator duck whose software chip runs in the browser at /sim/.
    kind: text('kind', { enum: ['chip', 'sim'] })
      .notNull()
      .default('chip'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('robots_pairing_code').on(table.pairingCode),
    uniqueIndex('robots_chip_address').on(table.chipAddress),
    index('robots_account_id').on(table.accountId),
  ],
)

export const grants = sqliteTable(
  'grants',
  {
    id: text('id').primaryKey(),
    robotId: text('robot_id'),
    accountId: text('account_id'),
    delegationHash: text('delegation_hash').notNull(),
    delegationJson: text('delegation_json'),
    dailyCap: text('daily_cap'),
    perPaymentCap: text('per_payment_cap'),
    allowlistJson: text('allowlist_json'),
    startAt: integer('start_at'),
    expiresAt: integer('expires_at'),
    status: text('status', { enum: ['unsigned', 'active', 'revoking', 'revoked', 'expired'] }).notNull(),
    revokeTx: text('revoke_tx'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('grants_delegation_hash').on(table.delegationHash),
    index('grants_robot_status').on(table.robotId, table.status),
  ],
)

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id'),
    itemId: text('item_id'),
    payTo: text('pay_to'),
    asset: text('asset'),
    amount: text('amount'),
    expiresAt: integer('expires_at'),
    linesHash: text('lines_hash'),
    rulesHash: text('rules_hash'),
    invoiceHash: text('invoice_hash').notNull(),
    restricted: integer('restricted', { mode: 'boolean' }),
    status: text('status', { enum: ['pending', 'paid', 'used', 'expired'] }).notNull(),
    paidTx: text('paid_tx'),
    usedAt: integer('used_at'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('invoices_invoice_hash').on(table.invoiceHash)],
)

export const payments = sqliteTable(
  'payments',
  {
    invoiceHash: text('invoice_hash').primaryKey(),
    invoiceId: text('invoice_id'),
    robotId: text('robot_id'),
    episodeId: text('episode_id'),
    payer: text('payer'),
    delegationManager: text('delegation_manager'),
    contextSha256: text('context_sha256'),
    approvalId: text('approval_id'),
    status: text('status', { enum: ['verifying', 'settling', 'settled', 'failed'] }).notNull(),
    txHash: text('tx_hash'),
    gasUsed: text('gas_used'),
    failReason: text('fail_reason'),
    createdAt: createdAt(),
    settledAt: integer('settled_at'),
  },
  (table) => [index('payments_episode_id').on(table.episodeId)],
)

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id'),
    robotId: text('robot_id'),
    episodeId: text('episode_id'),
    invoiceId: text('invoice_id'),
    invoiceHash: text('invoice_hash'),
    payee: text('payee'),
    amount: text('amount'),
    expiry: integer('expiry'),
    nonce: text('nonce').notNull(),
    oidcState: text('oidc_state').notNull(),
    oidcNonce: text('oidc_nonce').notNull(),
    status: text('status', {
      enum: ['requested', 'opened', 'approved', 'denied', 'expired', 'consumed'],
    }).notNull(),
    jti: text('jti'),
    sub: text('sub'),
    authTime: integer('auth_time'),
    amrJson: text('amr_json'),
    signature: text('signature'),
    error: text('error'),
    createdAt: createdAt(),
    decidedAt: integer('decided_at'),
  },
  (table) => [
    uniqueIndex('approvals_nonce').on(table.nonce),
    uniqueIndex('approvals_oidc_state').on(table.oidcState),
    uniqueIndex('approvals_jti').on(table.jti),
  ],
)

export const episodes = sqliteTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    robotId: text('robot_id'),
    accountId: text('account_id'),
    item: text('item'),
    invoiceId: text('invoice_id'),
    state: text('state', {
      enum: [
        'queued',
        'deciding',
        'awaiting_approval',
        'signing',
        'settling',
        'paid',
        'walked_away',
        'safe_stop',
        'denied',
        'refused',
        'failed',
        'expired',
      ],
    }).notNull(),
    decisionCount: integer('decision_count'),
    result: text('result'),
    requestIdsHash: text('request_ids_hash'),
    stateChangedAt: integer('state_changed_at'),
    // The 0G model the owner picked for this errand (ZG_MODEL or an allowlisted alternative); null = ZG_MODEL.
    // What each call actually used is `decisions.model`.
    model: text('model'),
    createdAt: createdAt(),
  },
  (table) => [index('episodes_robot_created').on(table.robotId, table.createdAt)],
)

export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    episodeId: text('episode_id'),
    step: integer('step'),
    model: text('model'),
    requestId: text('request_id'),
    chatId: text('chat_id'),
    provider: text('provider'),
    latencyMs: integer('latency_ms'),
    promptSha256: text('prompt_sha256'),
    inputJson: text('input_json'),
    action: text('action', { enum: ['pay', 'ask_human', 'walk_away', 'safe_stop'] }).notNull(),
    reason: text('reason'),
    outcome: text('outcome', {
      enum: ['paid', 'approved', 'denied', 'refused', 'failed', 'walked_away', 'safe_stop'],
    }),
    outcomeRef: text('outcome_ref'),
    error: text('error'),
    // The 0G TeeML proof of this decision, JSON of protocol `TeeProof` (signer, signed text, signature, signing address,
    // service url, fetchedAt ms, verified); null for providers without one and for decisions made before capture.
    teeJson: text('tee_json'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('decisions_episode_step').on(table.episodeId, table.step)],
)

export const evidenceUploads = sqliteTable(
  'evidence_uploads',
  {
    episodeId: text('episode_id').primaryKey(),
    status: text('status', { enum: ['pending', 'uploading', 'uploaded', 'failed'] }).notNull(),
    payloadJson: text('payload_json'),
    requestIdsHash: text('request_ids_hash'),
    rootHash: text('root_hash'),
    storageTx: text('storage_tx'),
    logTx: text('log_tx'),
    attempts: integer('attempts'),
    claimedAt: integer('claimed_at'),
    uploadedAt: integer('uploaded_at'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [index('evidence_uploads_status').on(table.status)],
)

export const chipRequests = sqliteTable(
  'chip_requests',
  {
    id: text('id').primaryKey(),
    robotId: text('robot_id'),
    episodeId: text('episode_id'),
    kind: text('kind', { enum: ['sign-invoice'] }).notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['queued', 'delivered', 'signed', 'refused', 'expired'] }).notNull(),
    expiresAt: integer('expires_at'),
    deliveredAt: integer('delivered_at'),
    respondedAt: integer('responded_at'),
    signature: text('signature'),
    leafHash: text('leaf_hash'),
    refusalCode: text('refusal_code'),
    createdAt: createdAt(),
  },
  (table) => [
    index('chip_requests_robot_status').on(table.robotId, table.status),
    uniqueIndex('chip_requests_episode_id').on(table.episodeId),
  ],
)

export const relayerTxs = sqliteTable(
  'relayer_txs',
  {
    key: text('key').primaryKey(),
    kind: text('kind', { enum: ['settle', 'revoke', 'deploy', 'send'] }),
    nonce: integer('nonce'),
    toAddress: text('to_address'),
    dataSha256: text('data_sha256'),
    txHash: text('tx_hash'),
    status: text('status', { enum: ['pending', 'sent', 'confirmed', 'failed'] }).notNull(),
    gasUsed: text('gas_used'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at'),
  },
  (table) => [uniqueIndex('relayer_txs_nonce').on(table.nonce)],
)

export const usedNonces = sqliteTable('used_nonces', {
  nonce: text('nonce').primaryKey(),
  kind: text('kind', { enum: ['approval', 'jti'] }),
  ref: text('ref'),
  createdAt: createdAt(),
})

// A chip-signed scan (packages/protocol Scan.ts): the JPEG crop of the invoice QR the robot read, kept in R2 under
// `r2_key` (`observations/<robotId>/<episodeId>/<sha256>.jpg`, the fast copy; the uploader also puts it on 0G Storage).
// One scan per robot and invoice; `captured_at` is unix milliseconds as the chip signed it; `frame_sha256` is 0x + 64
// lowercase hex; `chip_sig` the 65-byte EIP-191 signature.
export const observations = sqliteTable(
  'observations',
  {
    id: text('id').primaryKey(),
    robotId: text('robot_id').notNull(),
    episodeId: text('episode_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    frameSha256: text('frame_sha256').notNull(),
    bytes: integer('bytes').notNull(),
    capturedAt: integer('captured_at').notNull(),
    chipSig: text('chip_sig').notNull(),
    r2Key: text('r2_key').notNull(),
    // The same bytes on 0G Storage (proof of the robot's work, public): the Merkle root and the flow submission tx the
    // evidence uploader reported; null until it has uploaded the frame.
    zgRootHash: text('zg_root_hash'),
    zgStorageTx: text('zg_storage_tx'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('observations_robot_invoice').on(table.robotId, table.invoiceId),
    index('observations_episode_id').on(table.episodeId),
  ],
)

// The robot's live camera view (Kris, 6 Nov): only the latest chip-signed frame per robot, its JPEG in R2 at
// `live/<robotId>.jpg`. `received_at` (unix ms, the Worker's clock) caps the write rate per robot; `captured_at` is the
// chip's signed capture time. Frames here are never evidence and never 0G decision input.
export const liveFrames = sqliteTable('live_frames', {
  robotId: text('robot_id').primaryKey(),
  frameSha256: text('frame_sha256').notNull(),
  bytes: integer('bytes').notNull(),
  capturedAt: integer('captured_at').notNull(),
  receivedAt: integer('received_at').notNull(),
})

/**
 * An owner's Telegram chat (spec §14). `chat_id` is null until the bot sees `/start <code>`; the code itself is never
 * stored, only its sha256, and it is single-use and lives 10 minutes. `linked_at` and `code_expires_at` are seconds.
 */
export const telegramLinks = sqliteTable(
  'telegram_links',
  {
    accountId: text('account_id').primaryKey(),
    chatId: text('chat_id'),
    username: text('username'),
    codeHash: text('code_hash'),
    codeExpiresAt: integer('code_expires_at'),
    linkedAt: integer('linked_at'),
  },
  (table) => [
    index('telegram_links_chat_id').on(table.chatId),
    uniqueIndex('telegram_links_code_hash').on(table.codeHash),
  ],
)

/**
 * The Telegram outbox (spec §14): one row per event, unique per (kind, subject) so an event is delivered once. Rows
 * are written by the event's own writer and sent after the response; a failure here never touches a payment.
 * `claimed_at` and `sent_at` are seconds.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    kind: text('kind', {
      enum: [
        'approval_needed',
        'payment_settled',
        'approval_denied',
        'approval_expired',
        'grant_revoked',
        'funds_received',
      ],
    }).notNull(),
    subjectId: text('subject_id').notNull(),
    payloadJson: text('payload_json'),
    status: text('status', { enum: ['pending', 'sending', 'sent', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull(),
    lastError: text('last_error'),
    claimedAt: integer('claimed_at'),
    createdAt: createdAt(),
    sentAt: integer('sent_at'),
  },
  (table) => [
    uniqueIndex('notifications_kind_subject').on(table.kind, table.subjectId),
    index('notifications_status_created').on(table.status, table.createdAt),
  ],
)

// An owner's errand intent (packages/protocol Intent.ts): one instruction for one robot. A scan by that robot claims
// the open intent (`episode_id`), so the 0G decision sees what the owner asked for. For a simulator robot it is also the
// 0G navigation session; `turn` is the next step and the in-flight lock (a conditional UPDATE).
export const intents = sqliteTable(
  'intents',
  {
    id: text('id').primaryKey(),
    robotId: text('robot_id').notNull(),
    accountId: text('account_id').notNull(),
    instruction: text('instruction').notNull(),
    instructionSha256: text('instruction_sha256').notNull(),
    item: text('item'),
    state: text('state', { enum: ['running', 'scanned', 'finished', 'stopped', 'expired'] }).notNull(),
    turn: integer('turn').notNull().default(0),
    busyUntil: integer('busy_until'),
    episodeId: text('episode_id'),
    reason: text('reason'),
    // The 0G model the owner picked with this message: its navigation turns and the errand its scan starts use it;
    // null = ZG_MODEL. What each turn actually used is `nav_turns.model`.
    model: text('model'),
    createdAt: createdAt(),
    endedAt: integer('ended_at'),
  },
  (table) => [index('intents_robot_created').on(table.robotId, table.createdAt)],
)

// One 0G navigation turn of an intent: the model's tool calls and the results the sim (or, for scans, the Worker)
// answered them with. No prompt text: `prompt_sha256` only; `tee_json` as for decisions.
export const navTurns = sqliteTable(
  'nav_turns',
  {
    id: text('id').primaryKey(),
    intentId: text('intent_id').notNull(),
    step: integer('step').notNull(),
    model: text('model').notNull(),
    requestId: text('request_id'),
    chatId: text('chat_id'),
    provider: text('provider'),
    latencyMs: integer('latency_ms'),
    promptSha256: text('prompt_sha256').notNull(),
    // The assistant message as 0G returned it (tool calls with ids), JSON; replayed into the next turn's prompt.
    callsJson: text('calls_json').notNull(),
    reasoning: text('reasoning'),
    // The tool results for this turn's calls, JSON, filled in by the next turn.
    resultsJson: text('results_json'),
    error: text('error'),
    teeJson: text('tee_json'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('nav_turns_intent_step').on(table.intentId, table.step)],
)

/**
 * What the café's counter screen (the ESP32) shows (spec §7): the one invoice the till last put on display, per
 * merchant. Only `POST /api/merchants/:id/counter` writes it, so invoices minted through `POST …/invoices` (the sim's
 * stalls, the web gate) never take over the screen. `set_at` is seconds.
 */
/**
 * The last USDC balance (base units) the minute sweep read on Arc for a wallet with a linked Telegram chat; a higher
 * read queues `funds_received`. A mirror for the message only: Arc holds the money.
 */
export const walletBalances = sqliteTable('wallet_balances', {
  accountId: text('account_id').primaryKey(),
  units: text('units').notNull(),
  observedAt: integer('observed_at').notNull(),
})

export const counterDisplay = sqliteTable('counter_display', {
  merchantId: text('merchant_id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  setAt: integer('set_at').notNull(),
})

// The shop (vitaquack.com/shop/): preorders and reservations paid in USDC on Arc. An order asks for an exact amount
// (the price plus a few millionths that make it unique among open orders); a USDC transfer of that amount to the shop
// address marks it paid. `shop_payments` records every transfer seen once, `shop_cursor` the last Arc block read.
export const shopOrders = sqliteTable(
  'shop_orders',
  {
    id: text('id').primaryKey(),
    kit: text('kit', { enum: ['full', 'dev'] }).notNull(),
    pay: text('pay', { enum: ['full', 'reserve'] }).notNull(),
    founding: integer('founding', { mode: 'boolean' }).notNull(),
    amount: text('amount').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    country: text('country').notNull(),
    status: text('status', { enum: ['pending', 'paid', 'expired'] }).notNull(),
    paidTx: text('paid_tx'),
    paidAt: integer('paid_at'),
    expiresAt: integer('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('shop_orders_amount').on(table.amount),
    index('shop_orders_kit_status').on(table.kit, table.status),
  ],
)

export const shopPayments = sqliteTable('shop_payments', {
  id: text('id').primaryKey(),
  txHash: text('tx_hash').notNull(),
  fromAddress: text('from_address').notNull(),
  amount: text('amount').notNull(),
  block: integer('block').notNull(),
  orderId: text('order_id'),
  seenAt: integer('seen_at').notNull(),
})

export const shopCursor = sqliteTable('shop_cursor', {
  id: text('id').primaryKey(),
  block: integer('block').notNull(),
})

export const appSchema = {
  accounts,
  passkeys,
  authChallenges,
  robots,
  grants,
  invoices,
  payments,
  approvals,
  episodes,
  decisions,
  evidenceUploads,
  chipRequests,
  relayerTxs,
  usedNonces,
  observations,
  liveFrames,
  telegramLinks,
  notifications,
  intents,
  navTurns,
  counterDisplay,
  walletBalances,
  shopOrders,
  shopPayments,
  shopCursor,
}
