# Demo walkthrough (deployed app)

The click-by-click run for the 4-minute slot and the video. Record the real run in `docs/evidence/demo-run.md`.

`$APP` = <https://vitaquack.com>. Pages are under `$APP/app/`, the API under `$APP/api/`.

## Already proven on mainnet (do not re-prove on stage)

| What | Evidence |
| --- | --- |
| Settle, replay refused, revoke, next payment refused (stock enforcers) | `docs/evidence/2026-11-06-smoke.md` |
| Our `RobotPaymentPolicyEnforcer` on Arc | `docs/evidence/contracts.md` (`0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`) |
| A passkey-signed grant on the deployed app: the Worker's relayer deployed the Hybrid account and Arc's ERC-1271 check accepted the passkey signature | [0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b) (`docs/evidence/2026-11-06-deployed-e2e.md`) |
| Deployed pages, rehearsal brain (not 0G): chai paid, reload mid-errand restored, revoke, next chai refused | [0x782f8dfc…8875](https://explorer.arc.io/tx/0x782f8dfc25083a5b9328deb949aa037487eb1d2c688492db7fd4e9225a598875) paid, [0xaaa018d2…27c6](https://explorer.arc.io/tx/0xaaa018d2ee34ccd3647c22cb1ec532dd595f468451839e2b8b9b5696a7fe27c6) revoke (`docs/evidence/2026-11-06-deployed-browser.md`, run 4) |
| Deployed pages, stub issuer and rehearsal brain: an over-cap 0.50 payment approved and paid, a second one denied, nothing signed | [0xc0e507b6…5fa7](https://explorer.arc.io/tx/0xc0e507b6a5b9da03061f98afe4f64a9aeb6879e6d8927cfd43be1504937f5fa7) paid with the co-signed approval (`docs/evidence/2026-11-06-deployed-browser.md`, runs 5 and 6) |
| The whole journey on the deployed pages with 0G Compute decisions (`qwen3-vl-plus`; World stub): chai paid, gate OPEN, over-cap item approved and paid, a second denied, revoke, next chai refused | [0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a) chai, [0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548) cigarettes, [0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02) revoke (`docs/evidence/2026-11-06-deployed-browser.md`, run 7; screenshots in `docs/evidence/screens/`) |
| Live World (real Orb ID), real 0G, a real passkey owner: 0G `ask_human` → World App → token accepted → co-signed → paid 0.50 | [0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9) (`docs/evidence/2026-11-06-live-world.md`) |

The restricted-item rows are earlier runs. The stage run uses spending limits only. All runs:
`docs/evidence/README.md`.

## Before the slot (10 minutes)

| Check | How | Expected |
| --- | --- | --- |
| Worker healthy, right release | `curl -s $APP/api/health` | `"status":"ok"` and `"release"` = the commit you deployed |
| Chain configured | `curl -s $APP/api/merchants/duck-cafe/items` | `"payTo":"0x…"` (not `null`) |
| World configured | the approval page shows **Approve with World** (not "World approval is not configured…") | World client id/secret/issuer set; redirect URI `$APP/api/world/callback` registered at the World portal |
| 0G configured | starting an errand does not answer `not configured: ZG_API_KEY` | the errand reaches "Asking 0G..." |
| Mock chip ready | laptop terminal in the repo | `bun apps/chip/src/main.ts --server $APP --pair <CODE>` ready to paste |
| Owner funded | the owner's smart account (step 2) holds ≥ 2.50 USDC on Arc (the run spends chai 0.10 + one approved thali 2.00) | the balance on the wallet home |
| Second screen | `$APP/app/gate/duck-cafe` open | big **CLOSED** |

The stub issuer (`APP_WORLD_ISSUER=$APP/api/dev/world`, its page says `STUB IdP — not World — rehearsal only`,
`docs/evidence/2026-11-06-world-stub.md`) is for rehearsal only. The submission uses auth.world.org.

## The run

The allowance defaults to 3.00 USDC a day and 1.00 per purchase. Anything over 1.00 needs a fresh World approval, and
the daily cap can't be lifted, approved or not.

| # | Screen and click | What the screen must show | If it goes wrong |
| --- | --- | --- | --- |
| 1 | `$APP/app/` → type a name in **Your name** → **Create passkey wallet** → approve the passkey prompt (Face ID / Touch ID / phone) | "Signed in. Opening your wallet...", then the wallet home (`/app/wallet`). The avatar opens a sheet with your name and the smart account `0x…` address | Prompt dismissed: "The passkey step did not finish. Please try again." → click again. Existing wallet: **Sign in with passkey** |
| 2 | The wallet home | The balance, **Send**, **Receive**, **+ Robot**. **Receive** shows the address as a QR code and **Copy address**; **Send** takes an Arc address and an amount (**Max** sends everything) and asks the passkey once for that transfer | "Balance unavailable right now": the RPC throttled; reload |
| 3 | **+ Robot** (or **Add a robot**) → `/app/wallet/robots` → "What's your robot called?" → type "Duck" → **Next** | The one-time code (10 minutes), `./vitaquack-chip --pair CODE`, and "Waiting for Duck to connect..." | Code expired → **Start again** |
| 4 | Laptop: `bun apps/chip/src/main.ts --server $APP --pair CODE` (the Radxa: `./vitaquack-chip --server $APP --pair CODE`) | chip log `paired`, `lease ok`; within 3 s the page says **Duck connected** | Nothing happens: the chip is not polling (network) |
| 5 | Keep the presets **3.00** a day, **1.00** for one purchase, **Duck Café**, **1 day** → read the sentence aloud → **Confirm with passkey** | "Duck can spend up to 3.00 USDC a day, at most 1.00 at a time, only at Duck Café, for the next day...", then "Signing and activating on Arc..." (the first grant also deploys the account), then Duck's conversation with **3.00 a day** in its header | "Something went wrong: arc refused…" is Arc's reason; retry once. `not configured: …` = a missing binding |
| 6 | In Duck's conversation (`/app/robot/:id`) optionally pick the 0G brain (glm-5.3 in a TEE, or qwen3-vl-plus without a TEE proof), tap **Get me a chai**, then let Duck scan the counter's chai QR | "Waiting for Duck to scan the QR code at the counter.", "Asking 0G...", **0G decided: buy it** with 0G's reason (**The rehearsal brain (not 0G) decided** means the deploy is on the rehearsal brain: never present that as 0G), "My chip is signing the payment...", "Paying on Arc...", then **Paid with my chip 0.10 USDC** with **On Arc** and **Show proof** | 0G slow or down: "I stopped safely and paid nothing: …", the safe-stop beat; never fake it. Chip silent 60 s: "It timed out. Nothing was paid." |
| 7 | Second screen, the gate | **OPEN** (the merchant's Ed25519-signed status verified) | Still CLOSED: the errand paid a different invoice; send Duck again |
| 8 | Conversation → **Get me a thali**, Duck scans the thali QR | **0G decided: ask you first**, then a yellow "I need your OK" bubble with **Approve with World ID** and **No** (also under **Needs you** on the wallet home) | Only "Waiting for your answer": World or the approver is not configured (expires after 300 s). A **walked away** or **stopped safely** stays as it is: ask again |
| 9 | **Approve with World ID** → World sign-in (scan with World App) → **approve** in World App → back on the approval page (`/app/wallet/approvals/:id`) | "Duck wants to buy thali", **2.00 USDC**, "over the robot's per-payment limit (2.00 > 1.00 USDC)…", then **Approved: the chip signs the payment now** and **Paid · view on Arc** | "World token rejected: acr (…)" = not Orb-verified; "stale" = not fresh: approve again. "a different World account than the one bound to this wallet": the first approval binds it |
| 10 | The approval page's **Payee and invoice** (optional) | the Duck Café payee and the invoice id | |
| 11 | **Back to Duck** → **Get me a thali** again, Duck scans | as in step 8 | As in step 8 |
| 12 | **No** in the yellow bubble (or **Approve with World ID** → **deny** in World App) | "You said no. Nothing was paid."; no chip request, no transaction | |
| 13 | **Get me a thali** a third time, Duck scans | 2.10 spent + 2.00 = 4.10, past the 3.00 daily cap: **0G decided: walk away**, then "I walked away. Nothing was paid." | If 0G asks instead, tap **No**: an approval cannot lift the daily cap, and Arc would refuse 4.10 > 3.00 |
| 14 | The **3.00 a day** pill in the header → the allowance sheet → **Stop Duck's allowance** → passkey | "Stopping on Arc...", then **No allowance** in the header | 202 / still revoking: reload |
| 15 | Conversation → **Get me a chai**, Duck scans | "The payment failed: …CannotUseADisabledDelegation…" | |
| 16 | Evidence: a receipt's **Show proof** (or **All of Duck's errands, with their proof**) | the episode on 0G Storage and its EpisodeLog record (the `vitaquack-evidence-uploader` service uploads it shortly after) | `pending`: wait and reload |
| 17 | The public proof: on the owner's episode page, **Public proof: anyone can check it on 0G** (or `$APP/app/proofs`, the profile sheet's **Proofs on 0G**, pick the errand) → `/app/proofs/:id`, signed out works too → **Verify against 0G** | The 0G decision (model, request id, action, reason, TEE signer), the Arc payment and the chip-signed frame, loaded from 0G Storage; Verify shows **Every check passed.** with each check listed | "Some checks failed." names the check; show it as it is. `pending`: not uploaded yet |
| 18 | If a judge asks for a replay: open any receipt's **Show proof** (or `/app/wallet/episodes`, pick the errand) → **Replay** | 0G re-asked with the stored input (temperature 0, nothing written); original and replay side by side with both request ids and **same: yes** when the actions match | `not configured: ZG_API_KEY`: no 0G key. A differing replay is shown as it is |

## Fallbacks for the wallet lane

| If this fails | Then |
| --- | --- |
| The phone's passkey prompt | use the laptop's platform passkey (same flow); the EOA fallback owner exists on the account but has no UI |
| The first grant's deploy is slow | it is one relayer transaction; wait for "active", do not click twice (a second click answers 409) |
| World IdP down | show **No** (owner) for the deny beat; the approve beat needs World, so say that |
| Arc RPC throttled | **Refresh**; balances and revoke status are read lazily from Arc |

The World integration notes for the Agent Pass prize are in `docs/world-debrief.md`.
