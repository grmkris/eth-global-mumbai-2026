import { Option } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  label,
  role,
  scene,
  selector,
  submit,
  text,
  type,
  withViewInputs,
} from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import { Animation, Dialog } from '@foldkit/ui'
import { qrDataUri } from '../src/Qr.ts'
import * as Wallet from '../src/pages/Wallet.ts'
import { walletView } from '../src/pages/WalletView.ts'
import { activityRow, address, grant, pairedRobot, summary, txHash } from './Fixtures.ts'

const loadedHome = (value: Wallet.Home) =>
  Wallet.update(Wallet.init().model, Wallet.Message.SucceededLoadWallet({ home: value })).model

const home = (overrides: Partial<Wallet.Home> = {}): Wallet.Home => ({
  wallet: {
    account: {
      accountId: 'a',
      displayName: 'Ana',
      smartAccount: address,
      deployStatus: 'deployed',
      deployTx: txHash,
    },
    balance: { units: '1400000', usdc: '1.40' },
    fund: { network: 'eip155:5042', asset: '0x3600000000000000000000000000000000000000', address },
  },
  activity: { episodes: [activityRow('e1', 'chai', 'paid', '100000', txHash)], grants: [] },
  robots: [{ ...pairedRobot, grant }],
  episodes: [summary('e1', 'chai', 'paid', 'within budget')],
  needsYou: [],
  spentLastDay: '100000',
  maybeTelegramLinked: Option.none(),
  ...overrides,
})
describe('/wallet', () => {
  const view = withViewInputs(walletView, { locale: 'en' })()

  test('shows the balance, what the robots spent, the robots as conversations and the payments', () => {
    scene({ update: Wallet.update, view }, given(Wallet.init().model), expect(role('status')).toHaveText('Loading...'))
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      expect(text('1.40')).toExist(),
      expect(text('Your robots spent 0.10 USDC in the last 24 hours')).toExist(),
      expect(role('button', { name: 'Send' })).toBeEnabled(),
      expect(role('link', { name: 'Add a robot' })).toHaveAttr('href', '/app/wallet/robots'),
      expect(role('link', { name: /Duck/ })).toHaveAttr('href', `/app/robot/${pairedRobot.id}`),
      expect(text('Bought chai')).toExist(),
    )
  })

  test("a payment row opens its errand's proof, and All payment records opens the list", () => {
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      expect(role('link', { name: /Chai/ })).toHaveAttr('href', '/app/wallet/episodes/e1'),
      expect(role('link', { name: 'All payment records' })).toHaveAttr('href', '/app/wallet/episodes'),
    )
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home({ activity: { episodes: [], grants: [] } }))),
      expect(role('link', { name: 'All payment records' })).not.toExist(),
    )
  })

  test("a ready robot's row says what is left of today's allowance", () => {
    scene(
      { update: Wallet.update, view },
      given(
        loadedHome(home({ episodes: [], robots: [{ ...pairedRobot, grant: { ...grant, spentToday: '400000' } }] })),
      ),
      expect(text('0.60 USDC left today')).toExist(),
      expect(text('Chai')).toExist(),
      expect(text('−0.10 USDC')).toExist(),
      expect(text('Paid')).toExist(),
    )
  })

  test('a new owner gets a Getting started card: the next step is one tap away; it goes once all are done', () => {
    const fresh = home({
      wallet: { ...home().wallet, balance: { units: '0', usdc: '0.00' } },
      activity: { episodes: [], grants: [] },
      robots: [],
      episodes: [],
      spentLastDay: '0',
      maybeTelegramLinked: Option.some(false),
    })
    scene(
      { update: Wallet.update, view },
      given(loadedHome(fresh)),
      expect(role('heading', { name: 'Getting started' })).toExist(),
      // Nothing spent: no line about it (the empty Payments list says so).
      expect(text('Your robots spent', { exact: false })).not.toExist(),
      expect(role('link', { name: 'Connect' })).toHaveAttr('href', '/app/welcome'),
      expect(role('link', { name: 'Add' })).not.toExist(),
    )
    // Telegram linked: money is next, through the Receive sheet.
    scene(
      { update: Wallet.update, view },
      given(loadedHome({ ...fresh, maybeTelegramLinked: Option.some(true) })),
      expect(text("Get your robot's messages on Telegram, done")).toExist(),
      expect(text('Add money to the wallet')).toExist(),
      expect(role('link', { name: 'Connect' })).not.toExist(),
    )
    // Funded, no robot yet (no bot on the server: no Telegram step).
    scene(
      { update: Wallet.update, view },
      given(loadedHome({ ...fresh, wallet: home().wallet, maybeTelegramLinked: Option.none() })),
      expect(role('link', { name: 'Add' })).toHaveAttr('href', '/app/wallet/robots'),
    )
    scene({ update: Wallet.update, view }, given(loadedHome(home())), expect(text('Getting started')).not.toExist())
  })

  test('Receive opens a sheet with the address as a QR code, printed whole as wallets print it, and a copy button', () => {
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      click(role('button', { name: 'Receive' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),

      expect(role('heading', { name: 'Receive USDC' })).toExist(),
      // The QR is an EIP-681 payment request on Arc (chain 5042), so a wallet app opens a send on the right network.
      expect(role('img', { name: 'QR code of your wallet address' })).toHaveAttr(
        'src',
        qrDataUri(`ethereum:${address}@5042`),
      ),
      // One unbroken string, so a hand-copied selection pastes as a valid address.
      expect(text(address)).toExist(),
      click(role('button', { name: 'Copy address' })),
      Command.expectExact(Wallet.CopyAddress({ address })),
      Command.resolve(Wallet.CopyAddress, Wallet.Message.CompletedCopyAddress({ copied: true })),
      expect(text('Address copied')).toExist(),
      expect(text('Send only USDC on Arc.')).toExist(),
    )
  })

  const openSend = [
    click(role('button', { name: 'Send' })),
    Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
    Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
    Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
    Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
  ] as const
  const payee = '0x00000000000000000000000000000000000000b0'
  const afterSend = (status: 'sent' | 'pending') => {
    const typed = { ...loadedHome(home()), sendTo: payee, sendAmount: '0.50' }
    return Wallet.update(typed, Wallet.Message.SucceededSend({ status, txHash: null })).model
  }
  const reopen = (status: 'sent' | 'pending') => Wallet.update(afterSend(status), Wallet.Message.ClickedSend()).model

  test('Send: an Arc address and an amount, checked before the passkey; Max sends the whole balance', () => {
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      ...openSend,
      expect(role('heading', { name: 'Send USDC' })).toExist(),
      expect(text('You have 1.40 USDC.')).toExist(),
      expect(text('Only USDC on Arc. A send cannot be undone.')).toExist(),
      expect(role('button', { name: 'Send with passkey' })).toBeDisabled(),
      type(label('To (an address on Arc)'), '0x12'),
      expect(text('An Arc address starts with 0x and has 40 more characters.')).toExist(),
      type(label('To (an address on Arc)'), payee),
      type(label('Amount in USDC'), '2'),
      expect(text('That is more than the wallet holds (1.40 USDC).')).toExist(),
      expect(role('button', { name: 'Send with passkey' })).toBeDisabled(),
      click(role('button', { name: 'Send everything: 1.40 USDC' })),
      expect(role('button', { name: 'Send with passkey' })).toBeEnabled(),
      submit(selector('form')),
      Command.expectExact(Wallet.SendUsdc({ to: payee, amount: '1.40' })),
      expect(role('button', { name: 'Sending on Arc...' })).toBeDisabled(),
      Command.resolve(Wallet.SendUsdc, Wallet.Message.SucceededSend({ status: 'sent', txHash })),
      expect(role('status')).toHaveText(/Sent 1.40 USDC to 0x0000…00b0/),
      expect(role('link', { name: 'view on Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      Command.expectExact(Wallet.LoadWallet({ delayMillis: 0 })),
      Command.resolve(Wallet.LoadWallet, Wallet.Message.SucceededLoadWallet({ home: home() })),
    )
  })

  test('Send: a dismissed passkey says so and keeps what was typed; nothing is sent', () => {
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      ...openSend,
      type(label('To (an address on Arc)'), payee),
      type(label('Amount in USDC'), '0.50'),
      submit(selector('form')),
      Command.expectExact(Wallet.SendUsdc({ to: payee, amount: '0.50' })),
      Command.resolve(Wallet.SendUsdc, Wallet.Message.FailedSend({ failure: { _tag: 'Passkey' } })),
      expect(role('alert')).toHaveText('The passkey step did not finish. Please try again.'),
      expect(label('Amount in USDC')).toHaveValue('0.50'),
      expect(role('button', { name: 'Send with passkey' })).toBeEnabled(),
    )
  })

  test('Send: a send still pending on Arc stays on screen when the sheet opens again, so it is not sent twice', () => {
    vitestExpect(reopen('pending').sendStep).toEqual(Wallet.SendStep.Done({ status: 'pending', txHash: null }))
    vitestExpect(reopen('pending').sendAmount).toBe('0.50')
    vitestExpect(reopen('sent').sendStep).toEqual(Wallet.SendStep.Editing())
    vitestExpect(reopen('sent').sendAmount).toBe('')
  })

  test('a waiting approval is answered on the home: Approve goes to World, No declines it', () => {
    const waiting = home({
      activity: { episodes: [activityRow('e2', 'thali', 'awaiting_approval', '2000000', null)], grants: [] },
      episodes: [summary('e2', 'thali', 'awaiting_approval', 'Over the per-payment cap; the owner asked for it')],
      needsYou: [
        {
          episodeId: 'e2',
          approvalId: 'ap1',
          robotId: pairedRobot.id,
          robotName: 'Duck',
          item: 'thali',
          amount: '2000000',
          reason: 'Over the per-payment cap; the owner asked for it',
        },
      ],
    })
    scene(
      { update: Wallet.update, view },
      given(loadedHome(waiting)),
      expect(role('heading', { name: 'Needs you' })).toExist(),
      expect(text('I want to buy thali for 2.00 USDC, and that needs your OK first.')).toExist(),
      expect(text('0G: “Over the per-payment cap; the owner asked for it”')).toExist(),
      expect(text('Waiting for your answer')).toExist(),
      expect(role('link', { name: 'Approve with World ID' })).toHaveAttr('href', '/api/world/authorize?approval=ap1'),
      click(role('button', { name: 'No' })),
      Command.expectExact(Wallet.DeclineApproval({ approvalId: 'ap1' })),
      expect(role('button', { name: 'Saying no...' })).toBeDisabled(),
      Command.resolve(Wallet.DeclineApproval, Wallet.Message.SucceededDecline()),
      Command.expectExact(Wallet.LoadWallet({ delayMillis: 0 })),
      Command.resolve(Wallet.LoadWallet, Wallet.Message.SucceededLoadWallet({ home: home() })),
      expect(role('heading', { name: 'Needs you' })).not.toExist(),
    )
  })

  test('re-reads every 3 s while an errand runs, and not once everything has ended', () => {
    const running = Wallet.update(
      Wallet.init().model,
      Wallet.Message.SucceededLoadWallet({
        home: home({ episodes: [summary('e3', 'samosa', 'signing', 'within budget')] }),
      }),
    )
    vitestExpect(running.commands?.map((command) => [command.name, command.args])).toEqual([
      ['LoadWallet', { delayMillis: Wallet.POLL_MILLIS }],
    ])
    vitestExpect(
      Wallet.update(Wallet.init().model, Wallet.Message.SucceededLoadWallet({ home: home() })).commands,
    ).toEqual([])
  })

  test('without a session it says to sign in', () => {
    scene(
      { update: Wallet.update, view },
      given(
        Wallet.update(Wallet.init().model, Wallet.Message.FailedLoadWallet({ error: 'not signed in', signedOut: true }))
          .model,
      ),
      expect(role('alert')).toHaveText('Sign in with your passkey to see this page.'),
    )
  })
})
