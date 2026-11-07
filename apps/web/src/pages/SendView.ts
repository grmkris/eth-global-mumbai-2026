import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { explorerTx } from '../api/Wallet.ts'
import { busyLabel } from '../Busy.ts'
import { describedSheet } from '../Sheet.ts'
import { failureText } from './AllowanceView.ts'
import { type Home, Message, type Model, SendStep, type SendProblem, sendProblem } from './Wallet.ts'

/** The wallet's Send sheet: an Arc address, an amount, one passkey prompt for exactly that transfer. */

// STYLES

const sendFormClassName = 'grid gap-3'
const fieldClassName = 'grid gap-1.5'
const fieldLabelClassName = 'text-[0.94rem] font-semibold'
const sendInputClassName =
  'min-h-12 w-full min-w-0 rounded-control border border-rule bg-surface px-3.5 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-error'
const addressInputClassName = `${sendInputClassName} font-mono text-[0.95rem]`
const amountRowClassName = 'grid grid-cols-[1fr_auto] gap-2'
const maxClassName =
  'min-h-12 cursor-pointer rounded-control bg-paper px-4 font-semibold transition-transform active:scale-[0.96] disabled:opacity-60'
const sendHintClassName = 'text-[0.92rem] text-muted'
const sendErrorClassName = 'text-[0.92rem] text-error'
const sendButtonClassName =
  'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control bg-ink px-5 font-semibold text-surface transition-transform active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50'
const sentClassName = 'grid gap-1 rounded-card bg-paid/10 p-4'

// VIEW

/** The address as wallets shorten it, for the confirmation line (0x689c…7C4D). */
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/** After the send: what Arc said, the tx one tap away. */
const sendDone = (
  model: Model,
  done: { status: 'sent' | 'pending'; txHash: string | null },
  locale: Locale,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class(sentClassName), h.Role('status')],
    [
      h.p(
        [h.Class('font-semibold')],
        [
          format(locale, done.status === 'sent' ? 'send.sent' : 'send.pending', {
            amount: model.sendAmount.trim(),
            to: shortAddress(model.sendTo.trim()),
          }),
        ],
      ),
      done.txHash === null
        ? h.empty
        : h.a(
            [
              h.Href(explorerTx(done.txHash)),
              h.Target('_blank'),
              h.Rel('noopener'),
              h.Class('font-semibold underline'),
            ],
            [format(locale, 'approval.viewOnArc', {})],
          ),
    ],
  )

const problemText = (problem: SendProblem, home: Home, locale: Locale): string => {
  if (problem === 'address') return format(locale, 'send.badAddress', {})
  if (problem === 'amount') return format(locale, 'send.badAmount', {})
  return format(locale, 'send.overBalance', { balance: home.wallet.balance?.usdc ?? '0.00' })
}

type FormState = {
  readonly signing: boolean
  /** Said only about a field the owner has started typing. */
  readonly badAddress: boolean
  readonly badAmount: boolean
  readonly shown: string | null
  readonly ready: boolean
}

const formState = (model: Model, home: Home, locale: Locale): FormState => {
  const problem = sendProblem(model.sendTo, model.sendAmount, home.wallet.balance?.units ?? null)
  const badAddress = problem === 'address' && model.sendTo.trim() !== ''
  const badAmount = (problem === 'amount' || problem === 'overBalance') && model.sendAmount.trim() !== ''
  return {
    signing: SendStep.guards.Signing(model.sendStep),
    badAddress,
    badAmount,
    shown: problem !== null && (badAddress || badAmount) ? problemText(problem, home, locale) : null,
    ready: problem === null,
  }
}

const addressField = (model: Model, state: FormState, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(fieldClassName)],
    [
      h.label([h.For('send-to'), h.Class(fieldLabelClassName)], [format(locale, 'send.to', {})]),
      h.input([
        h.Id('send-to'),
        h.Type('text'),
        h.Class(addressInputClassName),
        h.Required(true),
        h.Autocomplete('off'),
        h.Autocapitalize('off'),
        h.Spellcheck(false),
        h.Placeholder('0x…'),
        h.Value(model.sendTo),
        h.Readonly(state.signing),
        h.AriaInvalid(state.badAddress),
        h.AriaDescribedBy('send-hint'),
        h.OnInput((value) => Message.UpdatedSendTo({ value })),
      ]),
    ],
  )

const amountField = (model: Model, home: Home, state: FormState, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const balance = home.wallet.balance
  return h.div(
    [h.Class(fieldClassName)],
    [
      h.label([h.For('send-amount'), h.Class(fieldLabelClassName)], [format(locale, 'send.amount', {})]),
      h.div(
        [h.Class(amountRowClassName)],
        [
          h.input([
            h.Id('send-amount'),
            h.Type('text'),
            h.InputMode('decimal'),
            h.Class(sendInputClassName),
            h.Required(true),
            h.Autocomplete('off'),
            h.Placeholder('0.00'),
            h.Value(model.sendAmount),
            h.Readonly(state.signing),
            h.AriaInvalid(state.badAmount),
            h.AriaDescribedBy('send-hint'),
            h.OnInput((value) => Message.UpdatedSendAmount({ value })),
          ]),
          // Max: the whole balance, for moving everything out of the wallet.
          balance === null
            ? h.empty
            : h.button(
                [
                  h.Type('button'),
                  h.Class(maxClassName),
                  h.Disabled(state.signing),
                  h.AriaLabel(format(locale, 'send.maxLabel', { balance: balance.usdc })),
                  h.OnClick(Message.ClickedSendMax({ amount: balance.usdc })),
                ],
                [format(locale, 'send.max', {})],
              ),
        ],
      ),
    ],
  )
}

/** The Send form: an Arc address, an amount (Max fills the whole balance), one passkey prompt for that transfer. */
const sendForm = (model: Model, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const state = formState(model, home, locale)
  return h.form(
    [h.Class(sendFormClassName), h.OnSubmit(Message.SubmittedSend()), h.AriaBusy(state.signing)],
    [
      addressField(model, state, locale, h),
      amountField(model, home, state, locale, h),
      h.p(
        [
          h.Id('send-hint'),
          h.Class(state.shown === null ? sendHintClassName : sendErrorClassName),
          h.AriaLive('polite'),
        ],
        [state.shown ?? format(locale, 'send.note', { balance: home.wallet.balance?.usdc ?? '—' })],
      ),
      h.button(
        [h.Type('submit'), h.Class(sendButtonClassName), h.Disabled(state.signing || !state.ready)],
        busyLabel(state.signing, format(locale, state.signing ? 'send.signing' : 'send.confirm', {}), h),
      ),
      SendStep.guards.Failed(model.sendStep)
        ? h.p([h.Role('alert'), h.Class('text-error')], [failureText(model.sendStep.failure, locale)])
        : h.empty,
    ],
  )
}

export const sendSheet = (model: Model, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html =>
  describedSheet(
    {
      sheet: model.sendSheet,
      title: format(locale, 'send.title', {}),
      closeLabel: format(locale, 'profile.close', {}),
      content: (description) => [
        h.p([...description, h.Class(sendHintClassName)], [format(locale, 'send.final', {})]),
        SendStep.guards.Done(model.sendStep)
          ? sendDone(model, model.sendStep, locale, h)
          : sendForm(model, home, locale, h),
      ],
      toParentMessage: (message) => Message.GotSendSheetMessage({ message }),
    },
    h,
  )
