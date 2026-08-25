# SkillMesh

A decentralized AI skill certification network built on **GenLayer Intelligent Contracts**, with a job board that demonstrates genuine cross-contract composability.

## Architecture — 2 contracts, one composability relationship

- **`contracts/certifier_oracle.py`** — anyone submits evidence of competency in a named skill. GenLayer's AI validators independently judge it and, on consensus, issue a permanent `certified` / `not_certified` verdict with confidence and reasoning. Certifications are keyed by `(holder, skill)` and are public — `is_certified(holder, skill)` is a free, walletless read anyone can call.
- **`contracts/hiring_board.py`** — a completely separate contract for posting jobs and applying to them. It does **not** re-implement or duplicate skill verification: `apply_to_job()` makes a live cross-contract call — `gl.get_contract_at(oracle).view().is_certified(...)` — and rejects the application outright if the oracle says no.

This is the point of the project: the Oracle's judgment is reusable infrastructure. The Board is just one consumer of it; any other app could plug into the same Oracle the same way.

## No server-side wallet

Both contracts are deployed once, by whoever sets the project up. There is no `PRIVATE_KEY` anywhere — every certification request, job post, and application is signed and paid for by the caller's own wallet, directly against these two fixed addresses.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Server | Express 5 — static files and one public config endpoint. No wallet. |
| Client | Plain HTML/CSS/JS (ES modules), `genlayer-js` (CDN, version-pinned) |
| Network | GenLayer StudioNet |
| Contracts | `contracts/certifier_oracle.py`, `contracts/hiring_board.py` |

## What's new in this upgrade (proof links, vacancies, profile page)

- **Verifiable proof links, not just text** — `request_certification` now takes an optional `proof_url`. When supplied, the AI validators independently fetch that page themselves (`gl.nondet.web.render`) — the candidate never controls what gets fetched — and are instructed to weigh it heavily. A submission with no proof link is explicitly judged as self-reported text only and held to a stricter bar. This is the real answer to "just writing text shouldn't be enough": the strength of the proof is now part of what's judged, and it's visible on every certification (`proof_url`, `proof_fetched`).
- **Vacancies (`positions_needed`)** — every job now records how many people it needs, not just whether it's open. `post_job` takes a `positions_needed` argument; `mark_hired` can be called once per position until the job auto-transitions to `filled`, and an employer can hire several different certified candidates for the same posting.
- **My Profile page** (`/profile`) — everything tied to the connected address in one place: certificates earned, jobs posted, jobs applied to (with per-job status: applied / withdrawn / hired), and jobs hired into. Backed by new read-only contract views (`get_jobs_posted_by`, `get_jobs_applied_by`, `get_jobs_hired_in`) plus the existing `get_skills_for_holder`.
- **⚠️ Breaking contract change** — `request_certification` and `post_job` both have new required arguments (`proof_url`, `positions_needed`). Both contracts must be **redeployed**, and `ORACLE_ADDRESS` / `BOARD_ADDRESS` in `.env` updated to the new addresses. Certifications and jobs issued under the old contracts won't carry over.

## What's new in the previous upgrade

- **Two wallet modes** — connect an injected wallet (MetaMask, SubWallet, etc.) as before, or use a **Browser Wallet**: a private key generated and kept only in this browser's `localStorage`, non-custodial, no extension required at all. This sidesteps the mobile in-app-browser wallet-injection issues that came up in earlier projects — export the key any time to back it up or move it elsewhere.
- **Real deliverable-grade confidence gating** — a job can require not just `certified`, but a minimum confidence score (`is_certified_with_min_confidence`), so an employer can set a higher bar than a bare pass/fail.
- **Admin controls** — both contracts now have an owner who can pause new activity (certification requests / job postings) without disturbing anything already in flight.
- **Re-attempt cooldown** — the Oracle owner can set a minimum wait between certification attempts for the same holder+skill, discouraging spam re-submissions.
- **Application withdrawal** — a candidate can withdraw an application and re-apply later; an employer can only hire from active (non-withdrawn) applicants.
- **Debug transparency** — `get_last_raw_response` exposes the last unparsed AI output for a certification, for troubleshooting an unexpected verdict.
- **Network** — now targets **GenLayer StudioNet** instead of Bradbury testnet.

## Getting Started

1. Deploy `contracts/certifier_oracle.py` **once** on GenLayer StudioNet. Note its address.
2. Deploy `contracts/hiring_board.py`, passing the Oracle's address as its constructor argument (`oracle_value`).
3. Put both addresses in `.env` as `ORACLE_ADDRESS` and `BOARD_ADDRESS` (see `.env.example`).
4. `npm install && npm run dev`

## Testing

```
pip install -r tests/requirements.txt
# start GenLayer Studio locally first
pytest tests/test.py -v -s
```

Deploys both contracts (Board pointed at Oracle) per session. Covers: stats starting at zero, an uncertified candidate correctly failing `is_certified`, strong vs. weak evidence being judged independently, cross-contract gating (an application is rejected before it's even certified in a skill the job doesn't require, and accepted once the candidate holds the required certification), multi-position jobs staying open until every vacancy is filled, and the `/profile`-backing views (`get_jobs_posted_by` / `get_jobs_applied_by` / `get_jobs_hired_in`).

---

© SkillMesh — decentralized AI skill certification, powered by GenLayer.
