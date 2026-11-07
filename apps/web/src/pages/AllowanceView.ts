import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { clockTime } from '../api/Episodes.ts'
import { ActionFailure } from '../api/OwnerAction.ts'
import { leftToday, usdc } from '../api/Wallet.ts'
import {
  DAILY_PRESETS,
  exceedsBalance,
  HOUR_PRESETS,
  Message,
  type Model,
  PER_PAYMENT_PRESETS,
  Step,
  Stop,
} from './Allowance.ts'
import { busyLabel } from '../Busy.ts'
import { approvalIcon, clockIcon, placeIcon, receiptIcon } from '../Icons.ts'

// STYLES

const formClassName = 'grid gap-3.5'
const fieldsetClassName = 'grid gap-1.5'
const legendClassName = 'mb-1.5 text-sm font-semibold text-muted'
const segmentsClassName = 'grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-paper p-1'
const segmentClassName =
  'grid min-h-11 cursor-pointer place-items-center rounded-xl font-semibold text-muted has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_1px_3px_rgb(0_0_0/0.1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus'
const payeeClassName = 'flex min-h-11 items-center gap-2 rounded-2xl bg-paper px-3.5 font-semibold'
const summaryClassName = 'rounded-2xl bg-paper px-4 py-3 text-[0.96rem] shadow-[inset_3px_0_0_var(--color-duck)]'
const primaryClassName =
  'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control bg-ink px-4 font-semibold text-surface transition-transform active:scale-[0.96] disabled:cursor-progress disabled:opacity-60'
const secondaryClassName =
  'min-h-12 cursor-pointer rounded-control bg-paper px-4 font-semibold transition-transform active:scale-[0.96]'
const stopClassName =
  'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control bg-error-soft px-4 font-semibold text-error transition-transform active:scale-[0.96] disabled:cursor-progress disabled:opacity-60'
const rulesClassName = 'grid gap-2 [&_li]:flex [&_li]:items-center [&_li]:gap-2.5'
const leftClassName = 'font-display text-4xl leading-none font-extrabold'
const unitClassName = 'ml-1.5 font-sans text-base font-normal text-muted'
/** The day's use as a native meter: paper track, ink fill (WebKit and Firefox pseudo-elements). */
const meterClassName =
  'h-2.5 w-full appearance-none overflow-hidden rounded-full bg-paper [&::-moz-meter-bar]:rounded-full [&::-moz-meter-bar]:bg-ink [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-paper [&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-ink [&::-webkit-meter-optimum-value]:bg-none [&::-webkit-meter-suboptimum-value]:bg-ink [&::-webkit-meter-suboptimum-value]:bg-none [&::-webkit-meter-even-less-good-value]:bg-ink [&::-webkit-meter-even-less-good-value]:bg-none'
const detailsClassName =
  'rounded-2xl bg-paper px-4 text-[0.95rem] [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:py-3 [&_summary]:font-semibold'
const detailListClassName = 'grid gap-0.5 pb-2 [&_dt]:text-sm [&_dt]:text-muted'
const detailValueClassName = 'mb-2 font-mono text-[0.85rem] break-all'
const noteClassName = 'text-center text-sm text-balance text-muted'

// VIEW

/** The grant the robot holds now, as the Worker mirrors it (Arc is the authority). */
type ActiveGrant = Readonly<{
  id: string
  status: string
  dailyCap: string
  perPaymentCap: string
  expiresAt: number
  spentToday?: string
  periodEndsAt?: number
  allowlist?: ReadonlyArray<string>
  delegationHash?: string
}>

/** What identifies the robot on-chain: its chip's address (the grant's delegate) and when it paired. */
type RobotIdentity = Readonly<{ chipAddress: string | null; pairedAt: number | null }>

export type ViewInputs = Readonly<{
  locale: Locale
  timeZone: string
  robotName: string
  payeeName: string
  grant: ActiveGrant | null
  robot: RobotIdentity | null
  /** The wallet's USDC in base units, when the page read it (null or absent: unknown). */
  balanceUnits?: string | null
}>

/** Why an owner action did not finish, in words (also the wallet's Send sheet). */
export const failureText = (failure: ActionFailure, locale: Locale) =>
  ActionFailure.match(failure, {
    Passkey: () => format(locale, 'auth.passkeyFailed', {}),
    Server: ({ error }) => format(locale, 'common.errorDetail', { message: error }),
  })

const segments = (
  name: string,
  legend: string,
  options: ReadonlyArray<string>,
  selected: string,
  label: (value: string) => string,
  toMessage: (value: string) => Message,
  disabled: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.fieldset(
    [h.Class(fieldsetClassName), h.Disabled(disabled)],
    [
      h.legend([h.Class(legendClassName)], [legend]),
      h.div(
        [h.Class(segmentsClassName)],
        options.map((value) =>
          h.keyed('label')(
            value,
            [h.Class(segmentClassName), h.For(`${name}-${value}`)],
            [
              h.input([
                h.Id(`${name}-${value}`),
                h.Type('radio'),
                h.Name(name),
                h.Value(value),
                h.Checked(value === selected),
                h.Class('sr-only'),
                h.OnClick(toMessage(value)),
              ]),
              label(value),
            ],
          ),
        ),
      ),
    ],
  )

/** The chosen daily cap is more than the wallet holds: said before the passkey signs (Arc would only stop payments). */
const overBalance = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const balanceUnits = inputs.balanceUnits ?? null
  if (balanceUnits === null || !exceedsBalance(model, balanceUnits)) return h.empty
  return h.p(
    [h.Role('status'), h.Class('text-[0.95rem] font-semibold text-error')],
    [format(inputs.locale, 'allowance.overBalance', { balance: usdc(balanceUnits), name: inputs.robotName })],
  )
}

const hoursLabel = (hours: string, locale: Locale) => format(locale, 'allowance.hours', { hours: Number(hours) })

const form = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const signing = Step.guards.Signing(model.step)
  return h.div(
    [h.Class(formClassName), h.AriaBusy(signing)],
    [
      segments(
        'daily',
        format(locale, 'allowance.perDay', {}),
        DAILY_PRESETS,
        model.daily,
        (value) => value,
        (value) => Message.SelectedDaily({ value }),
        signing,
        h,
      ),
      segments(
        'per-payment',
        format(locale, 'allowance.perPurchase', {}),
        PER_PAYMENT_PRESETS,
        model.perPayment,
        (value) => value,
        (value) => Message.SelectedPerPayment({ value }),
        signing,
        h,
      ),
      h.div(
        [h.Class(fieldsetClassName)],
        [
          h.p([h.Class(legendClassName)], [format(locale, 'allowance.where', {})]),
          h.p([h.Class(payeeClassName)], [h.span([h.AriaHidden(true)], ['✓']), inputs.payeeName]),
        ],
      ),
      segments(
        'hours',
        format(locale, 'allowance.for', {}),
        HOUR_PRESETS,
        model.hours,
        (value) => hoursLabel(value, locale),
        (value) => Message.SelectedHours({ value }),
        signing,
        h,
      ),
      // What is about to be signed, as the same rules the live allowance shows (not a paragraph that repeats the picks).
      h.ul(
        [h.Class(clsx(rulesClassName, summaryClassName))],
        [
          h.li([], [receiptIcon(h), format(locale, 'allowance.rulePerPurchase', { amount: model.perPayment })]),
          h.li([], [placeIcon(h), format(locale, 'allowance.ruleWhere', { payee: inputs.payeeName })]),
          h.li([], [clockIcon(h), `${format(locale, 'allowance.for', {})} ${hoursLabel(model.hours, locale)}`]),
          h.li([], [approvalIcon(h), format(locale, 'allowance.ruleAsks', { perPayment: model.perPayment })]),
        ],
      ),
      overBalance(model, inputs, h),
      Step.guards.Failed(model.step)
        ? h.p([h.Role('alert'), h.Class('text-error')], [failureText(model.step.failure, locale)])
        : h.empty,
      h.button(
        [
          h.Type('button'),
          h.Class(primaryClassName),
          h.Disabled(signing || Option.isNone(model.maybePayTo)),
          h.OnClick(Message.ClickedConfirm()),
        ],
        busyLabel(signing, format(locale, signing ? 'allowance.signing' : 'allowance.confirm', {}), h),
      ),
      inputs.grant === null
        ? h.empty
        : h.button(
            [h.Type('button'), h.Class(secondaryClassName), h.OnClick(Message.ClickedCancel())],
            [format(locale, 'common.cancel', {})],
          ),
    ],
  )
}

/** Today's allowance: what is left, a meter of what the day has used, and when it resets; the daily cap alone when the
 *  Worker does not report the day. */
const today = (grant: ActiveGrant, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const left = leftToday(grant)
  if (left === null || grant.spentToday === undefined)
    return h.p(
      [h.Class(leftClassName)],
      [usdc(grant.dailyCap), h.span([h.Class(unitClassName)], [format(locale, 'allowance.aDay', {})])],
    )
  return h.div(
    [h.Class('grid gap-2')],
    [
      h.p(
        [h.Class(leftClassName)],
        [
          usdc(left),
          h.span([h.Class(unitClassName)], [format(locale, 'allowance.leftOf', { daily: usdc(grant.dailyCap) })]),
        ],
      ),
      h.meter([
        h.Class(meterClassName),
        h.Min('0'),
        h.Max(grant.dailyCap),
        h.Value(grant.spentToday),
        h.AriaLabel(format(locale, 'allowance.spent', { spent: usdc(grant.spentToday), daily: usdc(grant.dailyCap) })),
      ]),
      grant.periodEndsAt === undefined
        ? h.empty
        : h.p(
            [h.Class('text-sm text-muted')],
            [
              format(locale, 'allowance.resets', {
                time: clockTime(grant.periodEndsAt * 1000, locale, inputs.timeZone),
              }),
            ],
          ),
    ],
  )
}

const rules = (model: Model, grant: ActiveGrant, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const stopping = Stop.guards.Signing(model.stop)
  return h.div(
    [h.Class(formClassName)],
    [
      today(grant, inputs, h),
      h.ul(
        [h.Class(rulesClassName)],
        [
          h.li(
            [],
            [receiptIcon(h), format(locale, 'allowance.rulePerPurchase', { amount: usdc(grant.perPaymentCap) })],
          ),
          h.li([], [placeIcon(h), format(locale, 'allowance.ruleWhere', { payee: inputs.payeeName })]),
          h.li(
            [],
            [
              clockIcon(h),
              format(locale, 'allowance.ruleUntil', {
                time: clockTime(grant.expiresAt * 1000, locale, inputs.timeZone),
              }),
            ],
          ),
          h.li([], [approvalIcon(h), format(locale, 'allowance.ruleAsks', { perPayment: usdc(grant.perPaymentCap) })]),
        ],
      ),
      h.button(
        [h.Type('button'), h.Class(secondaryClassName), h.OnClick(Message.ClickedChange())],
        [format(locale, 'allowance.change', {})],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class(stopClassName),
          h.Disabled(stopping),
          h.OnClick(Message.ClickedStop({ grantId: grant.id })),
        ],
        busyLabel(
          stopping,
          format(locale, stopping ? 'allowance.stopping' : 'allowance.stop', { name: inputs.robotName }),
          h,
        ),
      ),
      Stop.guards.Failed(model.stop)
        ? h.p([h.Role('alert'), h.Class('text-error')], [failureText(model.stop.failure, locale)])
        : h.empty,
      h.p([h.Class(noteClassName)], [format(locale, 'allowance.arcNote', {})]),
    ],
  )
}

/** Robot details, folded away, with addresses printed whole as wallets print them: the chip's address (the grant's delegate), the payee, the signed grant's hash and when
 *  the robot paired. There is no grant transaction to link: the grant is a signed delegation that Arc checks on use. */
const robotDetails = (inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { locale, robot, grant } = inputs
  if (robot === null) return h.empty
  const row = (label: string, value: string | null) =>
    value === null ? [] : [h.dt([], [label]), h.dd([h.Class(detailValueClassName)], [value])]
  const payee = grant?.allowlist?.[0] ?? null
  return h.details(
    [h.Class(detailsClassName)],
    [
      h.summary([], [format(locale, 'allowance.details', {})]),
      h.dl(
        [h.Class(detailListClassName)],
        [
          ...row(format(locale, 'allowance.chip', {}), robot.chipAddress),
          ...row(inputs.payeeName, payee),
          ...row(format(locale, 'allowance.grantHash', {}), grant?.delegationHash ?? null),
          ...row(
            format(locale, 'allowance.paired', {}),
            robot.pairedAt === null ? null : clockTime(robot.pairedAt * 1000, locale, inputs.timeZone),
          ),
        ],
      ),
      h.p([h.Class('text-sm text-muted')], [format(locale, 'allowance.detailsNote', {})]),
    ],
  )
}

/** The allowance: the active grant's rules with Change and Stop, or the presets the passkey signs. */
export const allowanceView = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h) =>
  h.div(
    [h.Class('grid gap-4')],
    [
      inputs.grant !== null && inputs.grant.status === 'active' && !model.editing
        ? rules(model, inputs.grant, inputs, h)
        : form(model, inputs, h),
      robotDetails(inputs, h),
    ],
  ),
)
