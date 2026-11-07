import { Dialog } from '@foldkit/ui'
import { Option } from 'effect'
import { Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

// UPDATE

/** The fold, open and close steps of a sheet kept in a field of a parent Model. */
export const sheetFolds = <Model, Message>(config: {
  readonly read: (model: Model) => Dialog.Model
  readonly write: (model: Model, sheet: Dialog.Model) => Model
  readonly toParentMessage: (message: Dialog.Message) => Message
}) => {
  const foldOutMessage = Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  })
  const child = {
    read: (model: Model) => Option.some(config.read(model)),
    write: config.write,
    toParentMessage: config.toParentMessage,
    foldOutMessage,
  }
  return {
    fold: Update.foldChild({ update: Dialog.update, ...child }),
    open: Update.foldChildStep({ update: Dialog.open, ...child }),
    close: Update.foldChildStep({ update: Dialog.close, ...child }),
  }
}

// STYLES

const sheetDialogClassName =
  'm-0 h-full max-h-none w-full max-w-none bg-transparent p-0 open:flex items-end justify-center backdrop:bg-transparent'

const sheetBackdropClassName =
  'fixed inset-0 bg-ink/45 transition-opacity duration-200 data-[closed]:opacity-0 data-[leave]:duration-150'

const sheetPanelClassName =
  'relative grid w-full max-w-[30rem] gap-4 rounded-t-sheet bg-surface px-5 pt-3 pb-[calc(2rem+env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_40px_-20px_rgb(0_0_0/0.35)] transition-[translate,opacity] duration-[260ms] ease-drawer data-[closed]:translate-y-full data-[leave]:duration-[180ms] motion-reduce:data-[closed]:translate-y-0 motion-reduce:data-[closed]:opacity-0'

const sheetHandleClassName = 'h-[5px] w-10 justify-self-center rounded-full bg-rule'
const closeClassName =
  'min-h-12 cursor-pointer rounded-control font-semibold text-muted transition-transform active:scale-[0.96]'

export const sheetTitleClassName = 'font-display text-2xl leading-tight font-bold'

// VIEW

/** A bottom sheet (Foldkit UI Dialog, DESIGN.md "Sheets"): the backdrop, a handle, the content and a visible Close
 *  (Escape and the backdrop close it too), rendered only while the dialog is open. */
export const sheetView = <M>(
  { dialog, backdrop, panel, isVisible, closeButton }: Dialog.RenderInfo,
  content: ReadonlyArray<Html>,
  closeLabel: string,
  h: HtmlBuilder<M>,
): Html =>
  h.dialog(
    [...dialog, h.Class(sheetDialogClassName)],
    isVisible
      ? [
          h.div([...backdrop, h.Class(sheetBackdropClassName)]),
          h.div(
            [...panel, h.Class(sheetPanelClassName)],
            [
              h.span([h.Class(sheetHandleClassName), h.AriaHidden(true)]),
              ...content,
              h.button([...closeButton, h.Type('button'), h.Class(closeClassName)], [closeLabel]),
            ],
          ),
        ]
      : [],
  )

/** A titled sheet as a Dialog submodel, its content handed the description's attributes (Receive, Send). */
export const describedSheet = <M>(
  config: {
    readonly sheet: Dialog.Model
    readonly title: string
    readonly closeLabel: string
    readonly content: (description: Dialog.RenderInfo['description']) => ReadonlyArray<Html>
    readonly toParentMessage: (message: Dialog.Message) => M
  },
  h: HtmlBuilder<M>,
): Html =>
  h.submodel({
    slotId: config.sheet.id,
    model: config.sheet,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: (render: Dialog.RenderInfo) =>
        sheetView(
          render,
          [
            h.h2([...render.title, h.Class(sheetTitleClassName)], [config.title]),
            ...config.content(render.description),
          ],
          config.closeLabel,
          h,
        ),
    },
    toParentMessage: config.toParentMessage,
  })
