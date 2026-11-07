import { Layer } from 'effect'
import { activityRoutes } from './Activity.ts'
import type { WalletDeps } from './Deps.ts'
import { episodesRoutes } from './Episodes.ts'
import { observationRoutes } from './Observations.ts'
import { grantsRoutes } from './Grants.ts'
import { revokeRoutes } from './Revoke.ts'
import { robotsRoutes } from './Robots.ts'
import { sendRoutes } from './Send.ts'

export type { WalletDeps } from './Deps.ts'

/** The owner's wallet API (spec §4, §6): robots and pairing codes, grants signed by the passkey, revoke, send, balance,
 * activity and the errand audit view. Every route needs a session; every mutating one also needs `Origin == AUTH_ORIGIN`. */
export const walletRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    robotsRoutes(deps),
    grantsRoutes(deps),
    revokeRoutes(deps),
    sendRoutes(deps),
    activityRoutes(deps),
    episodesRoutes(deps),
    observationRoutes(deps),
  )
