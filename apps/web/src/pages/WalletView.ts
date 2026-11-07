import { Option } from 'effect'
import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { terminalStates, worldAuthorizeUrl } from '../api/Robot.ts'
import { type EpisodeActivity, leftToday, type RobotView, usdc, itemName } from '../api/Wallet.ts'
import { duck } from '../Duck.ts'
import { onlyUsdcOnArc, receiveBody } from '../Receive.ts'
import { episodeRouter, episodesRouter, robotConsoleRouter, robotsRouter, welcomeRouter } from '../route.ts'
import { describedSheet } from '../Sheet.ts'
import { walletSkeleton } from '../Skeleton.ts'
import { failedView, signedOutView } from './Shared.ts'
import { sendSheet } from './SendView.ts'
import { Decline, type Home, Message, type Model, type NeedsYou, WalletState } from './Wallet.ts'
import { busyLabel } from '../Busy.ts'

// STYLES

const pageClassName = 'grid gap-0 pb-6 transition-opacity duration-150 starting:opacity-0'
const balanceClassName = 'grid min-w-0 gap-0.5 px-2 pt-3'
const amountClassName =
  'font-display text-[clamp(2.75rem,16vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.02em] wrap-anywhere'
const amountUnitClassName = 'ml-1.5 inline-block text-[1.4rem] font-bold tracking-normal whitespace-nowrap'
const spentClassName = 'text-muted'
const pillRowClassName = 'flex flex-wrap gap-1.5 px-1 pt-4 pb-1'
const pillClassName =
  'inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full bg-surface pr-3.5 pl-3 font-semibold no-underline shadow-[0_1px_2px_rgb(31_45_54/0.06)] transition-transform active:scale-[0.96]'
const sectionTitleClassName = 'px-2 pt-6 pb-2.5 font-display text-xl leading-tight font-bold'
const askCardClassName = 'mx-0.5 grid gap-2.5 rounded-[24px_24px_24px_8px] bg-duck px-4 pt-3.5 pb-4'
const whoClassName = 'flex items-center gap-2 text-sm text-duck-deep'
const whoNameClassName = 'font-semibold text-ink'
const askTextClassName = 'text-[1.06rem] leading-snug'
const quoteClassName = 'border-l-[2.5px] border-ink/25 pl-2.5 text-[0.94rem] text-ink/80'
const askButtonsClassName = 'grid grid-cols-[1fr_auto] gap-2'
const approveClassName =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-black px-3 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const declineClassName =
  'inline-flex items-center justify-center gap-2 disabled:cursor-progress min-h-12 cursor-pointer rounded-control bg-surface px-6 font-semibold transition-transform active:scale-[0.96] disabled:opacity-60'
const listClassName = 'mx-0.5 grid rounded-card bg-surface py-1 [&>li+li]:border-t [&>li+li]:border-rule'
const rowLinkClassName = 'grid min-h-[4.5rem] grid-cols-[52px_1fr_auto] items-center gap-3 px-3.5 py-2.5 no-underline'
const faceClassName = 'relative grid size-[52px] place-items-center rounded-full bg-ink'
const faceOfflineClassName = 'relative grid size-[52px] place-items-center rounded-full bg-rule'
const onlineDotClassName = 'absolute right-px bottom-px size-[13px] rounded-full border-[3px] border-surface bg-online'
const offlineDotClassName = 'absolute right-px bottom-px size-[13px] rounded-full border-[3px] border-surface bg-muted'
const rowNameClassName = 'block text-[1.06rem] leading-tight font-semibold'
const rowLineClassName = 'block truncate text-[0.94rem] text-muted'
const badgeClassName =
  'grid h-[22px] min-w-[22px] place-items-center rounded-full bg-duck px-1.5 text-[0.8rem] font-bold'
const addFaceClassName = 'grid size-[52px] place-items-center rounded-full bg-paper text-2xl text-ink'
const paymentRowClassName =
  'flex min-h-11 justify-between gap-3 px-4 py-3 text-ink no-underline [&>span:first-child]:min-w-0'
const sectionHeadClassName = 'flex items-baseline justify-between gap-3 pr-2'
const sectionLinkClassName = 'inline-flex min-h-11 items-center text-[0.94rem] font-semibold text-muted'
const paymentSubClassName = 'block text-[0.92rem] text-muted'
const onZeroGClassName = 'ml-1.5 rounded-full bg-paid/10 px-1.5 text-[0.75rem] font-semibold text-paid'
const paymentAmountClassName = 'shrink-0 text-right font-semibold whitespace-nowrap'
const paidClassName = 'block text-[0.92rem] text-paid'
const emptyClassName = 'px-2 text-muted'
const stepsCardClassName = 'mx-1 mt-3 grid gap-2 rounded-card bg-surface p-4'
const stepRowClassName = 'grid min-h-11 grid-cols-[1.75rem_1fr_auto] items-center gap-2.5'
// Where the owner is, at a glance: one segment per step, filled once done.
const progressClassName = 'grid auto-cols-fr grid-flow-col gap-1'
const segmentClassName = 'h-1.5 rounded-full'
const stepMarkClassName = 'grid size-7 place-items-center rounded-full text-[0.8rem] font-semibold'
const stepActionClassName =
  'inline-flex min-h-10 cursor-pointer items-center rounded-control bg-ink px-3.5 text-sm font-semibold text-surface no-underline transition-transform active:scale-[0.96]'

// VIEW

const balanceView = (home: Home, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class(balanceClassName), h.AriaLabel(format(locale, 'home.balanceLabel', {}))],
    [
      home.wallet.balance === null
        ? h.p([h.Class('text-muted')], [format(locale, 'home.balanceUnknown', {})])
        : h.p([h.Class(amountClassName)], [home.wallet.balance.usdc, h.span([h.Class(amountUnitClassName)], ['USDC'])]),
      // Nothing spent is said by the empty Payments list; the line shows only when money moved.
      home.spentLastDay === '0'
        ? h.empty
        : h.p([h.Class(spentClassName)], [format(locale, 'home.spent', { amount: usdc(home.spentLastDay) })]),
    ],
  )

const pills = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Class(pillRowClassName), h.AriaLabel(format(locale, 'home.actions', {}))],
    [
      h.button(
        [h.Type('button'), h.Class(pillClassName), h.OnClick(Message.ClickedSend())],
        [h.span([h.AriaHidden(true)], ['↗ ']), format(locale, 'home.send', {})],
      ),
      h.button(
        [h.Type('button'), h.Class(pillClassName), h.OnClick(Message.ClickedReceive())],
        [h.span([h.AriaHidden(true)], ['↙ ']), format(locale, 'home.receive', {})],
      ),
      h.a(
        [h.Href(robotsRouter()), h.Class(pillClassName), h.AriaLabel(format(locale, 'home.addRobot', {}))],
        [h.span([h.AriaHidden(true)], ['+ ']), format(locale, 'home.robot', {})],
      ),
    ],
  )

const askCard = (model: Model, need: NeedsYou, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const declining = Decline.guards.Declining(model.decline) && model.decline.approvalId === need.approvalId
  const failed = Decline.guards.Failed(model.decline) && model.decline.approvalId === need.approvalId
  return h.keyed('article')(
    need.approvalId,
    [h.Class(askCardClassName)],
    [
      h.p([h.Class(whoClassName)], [h.span([h.Class(whoNameClassName)], [need.robotName])]),
      h.p(
        [h.Class(askTextClassName)],
        [
          need.amount === null
            ? format(locale, 'home.askNoAmount', { item: need.item })
            : format(locale, 'home.ask', { item: need.item, amount: usdc(need.amount) }),
        ],
      ),
      need.reason === null
        ? h.empty
        : h.p([h.Class(quoteClassName)], [format(locale, 'home.zeroGReason', { reason: need.reason })]),
      h.div(
        [h.Class(askButtonsClassName)],
        [
          h.a(
            [h.Href(worldAuthorizeUrl(need.approvalId)), h.Class(approveClassName)],
            [format(locale, 'home.approve', {})],
          ),
          h.button(
            [
              h.Type('button'),
              h.Class(declineClassName),
              h.Disabled(declining),
              h.OnClick(Message.ClickedDecline({ approvalId: need.approvalId })),
            ],
            busyLabel(declining, format(locale, declining ? 'home.declining' : 'home.decline', {}), h),
          ),
        ],
      ),
      failed && Decline.guards.Failed(model.decline)
        ? h.p(
            [h.Role('alert'), h.Class('text-error')],
            [format(locale, 'home.declineFailed', { message: model.decline.error })],
          )
        : h.empty,
    ],
  )
}

/** What the robot's latest errand says about it, while it is live or when it ended in a way worth a line. */
const errandLine = (episode: Home['episodes'][number], locale: Locale): string | null => {
  const item = episode.item
  if (episode.state === 'awaiting_approval') return format(locale, 'home.lineWaiting', {})
  if (!terminalStates.has(episode.state)) return format(locale, 'home.lineBusy', { item })
  if (episode.state === 'paid') return format(locale, 'home.linePaid', { item })
  if (episode.state === 'denied') return format(locale, 'home.lineDenied', { item })
  return null
}

/** The robot's last line, in its own words where the errand's state supports them. */
const robotLine = (robot: RobotView, home: Home, locale: Locale): string => {
  if (robot.status === 'unpaired')
    return robot.pairingCode === null
      ? format(locale, 'home.lineCodeExpired', {})
      : format(locale, 'home.linePairing', { code: robot.pairingCode })
  const latest = home.episodes.find((episode) => episode.robotId === robot.id)
  const fromErrand = latest === undefined ? null : errandLine(latest, locale)
  if (fromErrand !== null) return fromErrand
  if (!robot.lease.online) return format(locale, 'home.lineOffline', {})
  if (robot.grant === null || robot.grant.status !== 'active') return format(locale, 'home.lineNoAllowance', {})
  const left = leftToday(robot.grant)
  return left === null ? format(locale, 'home.lineReady', {}) : format(locale, 'home.lineLeft', { amount: usdc(left) })
}

const robotRow = (robot: RobotView, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const waiting = home.needsYou.filter((need) => need.robotId === robot.id).length
  const href = robot.status === 'paired' ? robotConsoleRouter({ robotId: robot.id }) : robotsRouter()
  return h.keyed('li')(
    robot.id,
    [],
    [
      h.a(
        [h.Href(href), h.Class(rowLinkClassName)],
        [
          h.span(
            [h.Class(robot.lease.online ? faceClassName : faceOfflineClassName)],
            [
              duck('size-[38px]', !robot.lease.online, h),
              h.span([
                h.Class(robot.lease.online ? onlineDotClassName : offlineDotClassName),
                h.AriaLabel(format(locale, robot.lease.online ? 'home.connected' : 'home.offline', {})),
                h.Role('img'),
              ]),
            ],
          ),
          h.span(
            [h.Class('min-w-0')],
            [
              h.span([h.Class(rowNameClassName)], [robot.name]),
              h.span([h.Class(rowLineClassName)], [robotLine(robot, home, locale)]),
            ],
          ),
          waiting === 0
            ? h.span([])
            : h.span(
                [
                  h.Class(badgeClassName),
                  h.Role('img'),
                  h.AriaLabel(format(locale, 'home.waitingCount', { count: waiting })),
                ],
                [String(waiting)],
              ),
        ],
      ),
    ],
  )
}

const addRobotRow = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.li(
    [],
    [
      h.a(
        [h.Href(robotsRouter()), h.Class(rowLinkClassName)],
        [
          h.span([h.Class(addFaceClassName), h.AriaHidden(true)], ['+']),
          h.span(
            [],
            [
              h.span([h.Class(rowNameClassName)], [format(locale, 'home.addRobot', {})]),
              h.span([h.Class(rowLineClassName)], [format(locale, 'home.addRobotHint', {})]),
            ],
          ),
          h.span([]),
        ],
      ),
    ],
  )

/** The errand's record is on 0G Storage (from the errand list's evidence). */
const savedOnZeroG = (home: Home, episodeId: string) =>
  home.episodes.find((episode) => episode.id === episodeId)?.evidence?.status === 'uploaded'

const paymentRow = (episode: EpisodeActivity, onZeroG: boolean, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const paid = episode.state === 'paid'
  const live = !terminalStates.has(episode.state)
  const amount = episode.amount === null ? '—' : `${usdc(episode.amount)} USDC`
  // The whole row opens the errand's proof (DESIGN.md: the proof stays one tap away).
  return h.keyed('li')(
    episode.id,
    [],
    [
      h.a(
        [h.Href(episodeRouter({ episodeId: episode.id })), h.Class(paymentRowClassName)],
        [
          h.span(
            [],
            [
              h.span([h.Class('font-semibold')], [itemName(episode.item)]),
              h.span(
                [h.Class(paymentSubClassName)],
                [
                  format(locale, 'home.paymentBy', { robot: episode.robotName, state: episode.state }),
                  onZeroG ? h.span([h.Class(onZeroGClassName)], [format(locale, 'proof.onZeroG', {})]) : h.empty,
                ],
              ),
            ],
          ),
          h.span(
            [h.Class(paymentAmountClassName)],
            [
              paid ? h.span([], [`−${amount}`]) : live ? h.span([], [amount]) : h.s([h.Class('text-muted')], [amount]),
              h.span(
                // Not paid is already plain from the struck amount and the reason beside it: said to screen readers only.
                [h.Class(paid ? paidClassName : live ? paymentSubClassName : 'sr-only')],
                [format(locale, paid ? 'home.paid' : live ? 'home.pending' : 'home.notPaid', {})],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const receiveSheet = (model: Model, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const address = home.wallet.account.smartAccount
  return describedSheet(
    {
      sheet: model.receiveSheet,
      title: format(locale, 'receive.title', {}),
      closeLabel: format(locale, 'profile.close', {}),
      content: (description) => [
        ...receiveBody({ address, copy: model.copy, onCopy: Message.ClickedCopyAddress({ address }), locale, h }),
        onlyUsdcOnArc(locale, h, description),
      ],
      toParentMessage: (message) => Message.GotReceiveSheetMessage({ message }),
    },
    h,
  )
}

type FirstStep = { readonly done: boolean; readonly label: string; readonly action: Html }

/** What a new owner still has to do, in order; the card goes once everything is done. */
const firstSteps = (home: Home, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<FirstStep> => {
  const paired = home.robots.find((robot) => robot.status === 'paired')
  const granted = home.robots.find((robot) => robot.grant !== null && robot.grant.status === 'active')
  const link = (href: string, label: string) => h.a([h.Href(href), h.Class(stepActionClassName)], [label])
  const telegram = Option.match(home.maybeTelegramLinked, {
    onNone: () => [],
    onSome: (linked) => [
      {
        done: linked,
        label: format(locale, 'home.stepTelegram', {}),
        action: link(welcomeRouter(), format(locale, 'home.stepConnect', {})),
      },
    ],
  })
  return [
    ...telegram,
    {
      done: home.wallet.balance !== null && BigInt(home.wallet.balance.units) > 0n,
      label: format(locale, 'home.stepFund', {}),
      action: h.button(
        [h.Type('button'), h.Class(stepActionClassName), h.OnClick(Message.ClickedReceive())],
        [format(locale, 'home.receive', {})],
      ),
    },
    {
      done: paired !== undefined,
      label: format(locale, 'home.stepRobot', {}),
      action: link(robotsRouter(), format(locale, 'home.stepAdd', {})),
    },
    {
      done: granted !== undefined,
      label: format(locale, 'home.stepAllowance', {}),
      action: link(robotConsoleRouter({ robotId: paired?.id ?? '' }), format(locale, 'home.stepGive', {})),
    },
    {
      done: home.episodes.some((episode) => episode.state === 'paid'),
      label: format(locale, 'home.stepErrand', {}),
      action: link(
        robotConsoleRouter({ robotId: granted?.id ?? paired?.id ?? '' }),
        format(locale, 'home.stepSend', {}),
      ),
    },
  ]
}

/** A step's mark: a green check once done, the next step in ink, the rest quiet. */
const stepMark = (done: boolean, isNext: boolean) =>
  clsx(stepMarkClassName, done ? 'bg-paid/12 text-paid' : isNext ? 'bg-ink text-surface' : 'bg-paper text-muted')

/** The first-steps card: each open step one tap from where it is done (the next one only, so the order is clear). */
const firstStepsCard = (home: Home, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const steps = firstSteps(home, locale, h)
  const next = steps.findIndex((step) => !step.done)
  if (next < 0) return h.empty
  return h.section(
    [h.Class(stepsCardClassName), h.AriaLabelledBy('first-steps')],
    [
      h.h2([h.Id('first-steps'), h.Class('font-semibold')], [format(locale, 'home.firstSteps', {})]),
      h.div(
        [h.Class(progressClassName), h.AriaHidden(true)],
        steps.map((step) => h.span([h.Class(clsx(segmentClassName, step.done ? 'bg-paid' : 'bg-rule'))])),
      ),
      h.ol(
        [h.Class('grid gap-1.5')],
        steps.map((step, index) =>
          h.li(
            [h.Class(stepRowClassName)],
            [
              h.span(
                [h.Class(stepMark(step.done, index === next)), h.AriaHidden(true)],
                [step.done ? '✓' : `${index + 1}`],
              ),
              h.span(
                [h.Class(step.done ? 'text-muted' : index === next ? 'font-semibold' : '')],
                [step.label, step.done ? h.span([h.Class('sr-only')], [format(locale, 'home.stepDone', {})]) : h.empty],
              ),
              index === next ? step.action : h.span([]),
            ],
          ),
        ),
      ),
    ],
  )
}

const loadedView = (model: Model, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(pageClassName)],
    [
      balanceView(home, locale, h),
      pills(locale, h),
      firstStepsCard(home, locale, h),
      home.needsYou.length === 0
        ? h.empty
        : h.section(
            [h.AriaLabelledBy('needs-you')],
            [
              h.h2([h.Id('needs-you'), h.Class(sectionTitleClassName)], [format(locale, 'home.needsYou', {})]),
              h.div(
                [h.Class('grid gap-2')],
                home.needsYou.map((need) => askCard(model, need, locale, h)),
              ),
            ],
          ),
      h.section(
        [h.AriaLabelledBy('robots')],
        [
          h.h2([h.Id('robots'), h.Class(sectionTitleClassName)], [format(locale, 'home.robots', {})]),
          h.ul(
            [h.Class(listClassName)],
            [...home.robots.map((robot) => robotRow(robot, home, locale, h)), addRobotRow(locale, h)],
          ),
        ],
      ),
      h.section(
        [h.AriaLabelledBy('payments')],
        [
          h.div(
            [h.Class(sectionHeadClassName)],
            [
              h.h2([h.Id('payments'), h.Class(sectionTitleClassName)], [format(locale, 'home.payments', {})]),
              home.activity.episodes.length === 0
                ? h.empty
                : h.a(
                    [h.Href(episodesRouter()), h.Class(sectionLinkClassName)],
                    [format(locale, 'episode.allRecords', {})],
                  ),
            ],
          ),
          home.activity.episodes.length === 0
            ? h.p([h.Class(emptyClassName)], [format(locale, 'home.noPayments', {})])
            : h.ul(
                [h.Class(listClassName)],
                home.activity.episodes.map((episode) => paymentRow(episode, savedOnZeroG(home, episode.id), locale, h)),
              ),
        ],
      ),
      receiveSheet(model, home, locale, h),
      sendSheet(model, home, locale, h),
    ],
  )

/** `/wallet`: the owner's home (DESIGN.md "Layout"): balance, Send/Receive/Robot, what needs them, robots, payments. */
export const walletView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main')],
    [
      h.h1([h.Class('sr-only')], [format(locale, 'wallet.title', {})]),
      WalletState.match(model.state, {
        Loading: () => walletSkeleton(locale, h),
        SignedOut: () => signedOutView(locale, h),
        Loaded: ({ home }) => loadedView(model, home, locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), locale, h),
      }),
    ],
  ),
)
