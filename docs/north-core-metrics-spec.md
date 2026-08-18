# North — Core Metrics Spec (v0)

**Covers:** DEC-03 (Signal score), DEC-04 (Alignment instrument), DEC-05 (Streak rules)
**Status:** v0 — buildable. Tunable parameters are marked ⚙️; resolve after first cohort data.
**Owner:** Jordayne Price · **Last updated:** 28 May 2026
**Implementation:** see appendix at the end of this document for the in-repo SQL / Edge Function locations.

These three are one system. The **streak** measures showing-up daily, the **signal score** reads behaviour over a rolling week, and the **alignment instrument** brackets the whole thing at week 0 and week 4. They share one source of truth for "active days" so they never disagree about whether you showed up.

---

## DEC-03 — Signal Score (v0)

### Construct
The score measures **coherence between stated intent and actual behaviour** — not productivity, not time-in-app. A user is "aligned" when they act on what they said matters. v0 is **rules-based and fully transparent**: no LLM in the score itself, so that when a user rates it inaccurate (FR-SIG-05) you know exactly which input they're rejecting and can tune it. AI stays in the *summaries and callouts* layer (AI-04/05), which sits on top of the score, not inside it.

One-sentence explanation to the user: *"Your signal reflects how much you acted on what you said matters, whether your attention tracked your focus, and whether you showed up — softened if you keep avoiding the same thing."*

### Inputs (all normalised 0–1, over a rolling 7-day window)

| Input | Symbol | Definition | Source |
|---|---|---|---|
| Action on intent | **A** | Completed aligned tasks ÷ assigned aligned tasks. Missions are generated from focus areas, so all tasks are "aligned" by construction in v0. | `user_mission_tasks` |
| Engagement coherence | **C** | Meaningful feed engagement (save, finish, long dwell) in followed/focus categories ÷ all meaningful engagement. | `content_interactions` |
| Consistency | **K** | Active days ÷ 7. *Shares its source with the streak (DEC-05).* | `streaks` / activity log |
| Avoidance | **V** | Penalty. Count of distinct aligned tasks skipped or abandoned ≥ 2× in the window, ÷ 3, capped at 1. | `user_mission_tasks` |

### Formula

```
Positive = 0.45·A + 0.25·C + 0.30·K        # weighted, 0–1   ⚙️ weights
Dampener = 1 − 0.20·V                       # 0.8–1.0          ⚙️ avoidance cap
Score    = round(100 · Positive · Dampener) # internal 0–100
```

⚙️ **Weights** put action-on-intent first (it *is* the definition of alignment), consistency second (showing up), coherence third (the softest signal — drift isn't inherently bad). Tune after cohort 1.

**Worked example.** Over 7 days: 12/21 tasks done (A=0.571); 11/18 meaningful engagements in-focus (C=0.611); 5/7 active days (K=0.714); 1 task avoided 3× (V=0.333).
Positive = 0.45·0.571 + 0.25·0.611 + 0.30·0.714 = **0.624**. Dampener = 1 − 0.20·0.333 = **0.933**. Score = **58** → *Finding*.

### Range & display — surface less than you measure
Compute 0–100 **internally** for analytics. **Surface a band + trend**, never the raw number — a precise number that ticks down is the anxiety machine the brand rejects.

| Band | Internal range ⚙️ |
|---|---|
| **Drifting** | 0–39 |
| **Finding** | 40–69 |
| **Aligned** | 70–100 |

Display = band label + a calm sparkline of the last ~6 weeks + a direction-of-travel arrow (↑ / → / ↓ vs last week).

### Update cadence
Rolling 7-day window, **recomputed daily**, but **surfaced to the user weekly** (in the Signal tab's weekly summary). Daily-visible scores invite obsessive checking — the exact attention behaviour North defines itself against. Weekly surfacing also reuses the summary cadence, so it's one rhythm.

### Cold-start & low-activity guards
- **< 7 calendar days since onboarding OR < 3 active days of data:** suppress the band, show *"Finding your signal"* with a one-line explainer. (This also removes the awkwardness of scoring someone before they've behaved.)
- **< 7 assigned aligned tasks in the window:** widen A's window to 14 days. If still sparse, mark the score **provisional** and don't let avoidance dampen it.
- **Zero activity in window:** hold the previous band, show ↓ trend, never zero out punitively.

### What v0 deliberately excludes
Reflection sentiment, AI-inferred "energy," social signals. All deferred until the rules-based score is validated against user accuracy ratings.

---

## DEC-04 — Alignment Instrument (v0)

### The core problem to design around
Self-reported alignment from people who **stayed** and **still answer surveys** is the most demand-biased measurement available — survivors are selected for liking the product. A naïve "+1.0 on a 5-pt scale" will be "hit" and mean nothing. The design below exists to defeat that.

### Two-layer instrument

**Layer 1 — Weekly pulse (within-person tracking).**
A single item, shown once a week inside the weekly summary, one tap to answer.

> Draft item (original; safe to use as-is): *"This week, how much did your time go toward what matters to you?"* — 5-point scale: Not at all · A little · Somewhat · Mostly · Fully.

Shown to **everyone, every week, from week 1** — so you capture the pulse of users *before they churn*, not just survivors. Store it even when the user later goes inactive.

**Layer 2 — Baseline/endpoint scale (the credible thesis claim).**
A short **validated** multi-item purpose/meaning scale, administered at onboarding (ONB-05) and again at **day 28**.

- **Do not invent this scale** — adapt a published, validated one so you inherit its psychometric validity. Candidate families: the **Claremont Purpose Scale** (purpose subscale), the **presence-of-meaning** subscale of the **Meaning in Life Questionnaire (MLQ)**, **Ryff's purpose-in-life** subscale, or **Scheier's Life Engagement Test**. ⚙️ Pick one (5–6 items keeps friction low).
- **Obtain the actual items from the source publication and check licensing** — some require author permission; reproducing or paraphrasing the items yourself breaks their validity. Treat item wording as fixed by the source.
- **Scoring:** mean of items → composite on the scale's native range (e.g., 1–5 or 1–7). Compare baseline vs day-28 within each user.

### Defeating demand bias — non-negotiable controls
1. **Triangulate against behaviour.** A real effect = self-report up **and** signal score up **and** mission completion holding. Self-report up *alone* = demand bias. You already have the behavioural data; use it as the cross-check.
2. **Measure the churned.** Segment lift including users who left (via their last weekly pulse), not just week-4 survivors. A survivors-only number is a survivorship illusion.
3. **Set the target *after* baseline.** Don't pre-commit to "+1.0." Run the baseline, observe the distribution, then set the target as a **within-person effect size** ⚙️ (e.g., a half-SD shift / Cohen's *d* ≈ 0.3) against your own data.

### Cadence summary
Baseline scale at onboarding → weekly single-item pulse for everyone → endpoint scale at day 28 → lift = within-person delta, triangulated and segmented.

---

## DEC-05 — Streak Rules (v0)

### The brand tension, resolved
Standard streaks run on loss aversion and guilt (the red flame, "don't lose your streak!", the panic). That is exactly the manipulative mechanic North rejects (Design §7.2). v0 **measures rhythm without punishing the break.**

### Two surfaces
1. **Rhythm streak** — current run of directed days, *with rest built in* (below).
2. **28-day consistency view** — a calm, muted pattern (contribution-graph style, not a number that shatters). This is the durable, low-stakes surface; it persists through any streak break, so a missed day never wipes the sense of progress.

### Definitions
- **"Day"** = the user's local calendar day in **AST (UTC−4)**. *Jamaica observes no daylight saving, so there are no DST edge cases* — a rare simplification.
- **Grace cutoff:** completions up to **03:59 local** count toward the *previous* day (people finish their day after midnight). ⚙️ cutoff time.
- **"Directed day"** (advances the rhythm streak): the user completes their **daily mission** (all 3 tasks). ⚙️ whether 2/3 should count.
- **"Active day"** (counts in the 28-day consistency view, and feeds Consistency **K** in the signal score): **≥ 1** completed task. This gives the calm graph more density while keeping the streak meaningful.

### Rest days, not freezes-to-panic
- The user earns **2 rest days per rolling 7** ⚙️. A missed day **auto-consumes** a rest credit if available: the streak holds and is framed as *intentional rest* — *"You took a rest day. Your rhythm is intact."* Not *"Streak saved!"*
- Rest is presented as **part of** moving with direction, not a failure of it.

### Reset behaviour
- The rhythm streak **only breaks** after rest credit is exhausted **and** a full day passes with no directed day.
- On break: **no zeroing-shame.** The 28-day consistency pattern persists untouched; messaging is invitational — *"Pick your rhythm back up whenever you're ready."*

### Notifications
- **No loss-framed pushes.** A calm streak is incompatible with "you're about to lose everything."
- Daily reminder copy is invitational, not threatening. ⚙️ exact copy, send time.

---

## How the three interlock

- **Consistency (K)** in the signal score and the streak's **active-day** count read the **same activity log** — one source of truth, no disagreement about whether you showed up.
- The **signal score** is the daily-to-weekly view; the **alignment scale** is the week-0/week-4 bracket. The thesis is proven when *both* move together (the triangulation rule).
- All three honour the same brand constraint: **surface less than you measure, never punish the break, optimise for direction not attention.**

### Open ⚙️ parameters to close after cohort 1
Signal weights (0.45/0.25/0.30), avoidance cap (0.20), band thresholds, A's window-widening rule · which validated alignment scale + its licence · effect-size target · rest-day count (2/7), grace cutoff (03:59), 2/3-task rule, reminder copy and send time.

---

## Appendix · Implementation notes (DEC-03 in-repo)

Where the score and summary live in this codebase:

| Component | Path |
|---|---|
| Score computation (PL/pgSQL) | `supabase/migrations/0005_signal_score_compute.sql` — `public.compute_signal_score(uid uuid, week_ending date)` |
| Daily cron schedule | `supabase/migrations/0005_signal_score_compute.sql` — `cron.schedule('signal-score-daily', '0 8 * * *', …)` (08:00 UTC = 04:00 AST) |
| Schema extensions | `supabase/migrations/0003_signal_score_schema.sql` — adds `user_mission_tasks.abandon_count`, `signal_scores.inputs jsonb`, `signal_summaries` table |
| RLS on summaries | `supabase/migrations/0004_signal_score_rls.sql` — own-rows read only; writes are service-role from the Edge Function |
| AI summary | `supabase/functions/signal-summary/index.ts` — calls DeepSeek (`deepseek-chat`, forced function-call for structured output); UPSERTs into `signal_summaries` |
| Weekly summary cron | `supabase/migrations/0006_signal_summary_cron.sql` — `cron.schedule('signal-summary-weekly', '0 9 * * 0', …)` (09:00 UTC Sunday = 05:00 AST Sunday) |
| Archetype tests | `supabase/tests/signal_score_archetypes.sql` — Streak-hero / Lurker / Avoider / Comeback |

### V (Avoidance) implementation note
The spec says *"count of distinct aligned tasks skipped or abandoned ≥ 2× in the window."* The schema implementation uses a counter column `user_mission_tasks.abandon_count` that the client bumps on explicit dismiss; V counts tasks where `abandon_count ≥ 2` in the 7-day window, divided by 3, capped at 1. As the spec reviewer predicted (chat transcript, "smaller notes" section), V will be near-zero for most v0 users — the dampener is cosmetic until cohort 1 data justifies redefining V by task `kind` (a design change deferred to post-cohort-1 tuning).

### Operator runbook for the AI summary layer

Before the weekly summary cron will succeed:

1. Set DeepSeek key and trigger secret as Supabase secrets:
   ```bash
   supabase secrets set DEEPSEEK_API_KEY=sk-...
   supabase secrets set SUMMARY_TRIGGER_SECRET=$(openssl rand -hex 32)
   ```
2. Set the Edge Functions base URL on the Postgres role so `net.http_post` from cron knows where to call:
   ```sql
   alter database postgres set app.functions_url = 'https://<project-ref>.supabase.co/functions/v1';
   ```
   For local dev: `'http://127.0.0.1:54321/functions/v1'`. This is **per-environment** — run the `alter database` against the dev and prod projects separately. The setup is part of the per-project bootstrap covered in [`docs/supabase-projects.md`](./supabase-projects.md) (DEC-16).
3. Deploy the function:
   ```bash
   supabase functions deploy signal-summary
   ```
4. Smoke test against one real user:
   ```bash
   curl -X POST -H "x-trigger-secret: $SUMMARY_TRIGGER_SECRET" \
     "https://<project-ref>.supabase.co/functions/v1/signal-summary"
   ```
   Confirm a `signal_summaries` row appears. Cost should be < $0.001 per call (`deepseek-chat`).

### Verifying the cron is registered

```sql
select jobname, schedule, active from cron.job
where jobname in ('signal-score-daily', 'signal-summary-weekly');
```

### Prompt versioning

The system prompt is stored in `supabase/functions/signal-summary/index.ts` and tagged via the `prompt_version` column in `signal_summaries`. To roll a new prompt, bump the version string and redeploy; old summaries remain queryable by version for A/B comparison.

---

## Appendix · Implementation notes (DEC-04 in-repo)

| Component | Path |
|---|---|
| Scale registry | `supabase/migrations/0008_alignment_instrument.sql` — `public.alignment_scales` + `public.alignment_scale_items` |
| Composite computation | `supabase/migrations/0008_alignment_instrument.sql` — `public.compute_alignment_composite(items jsonb, scale_id_in text)` + `BEFORE INSERT OR UPDATE` trigger on `public.baseline_endpoint_responses` |
| Layer-1 dispatch helper | `supabase/migrations/0008_alignment_instrument.sql` — `public.weekly_pulse_due(uid, as_of)` |
| Tests | `supabase/tests/alignment_instrument.sql` — license gate, composite, reverse-scoring, weekly-pulse-due |

### Selected scale (v0)
**MLQ presence-of-meaning subscale** (Steger, Frazier, Oishi & Kaler, 2006 — *Journal of Counseling Psychology* 53(1), 80–93). 5 items, 1–7 scale, well-validated, short, English. Seeded as `scale_id = 'mlq-pom'` with placeholder prompts and `license_status = 'pending_acquisition'`. **Clients cannot see the placeholder text** — the RLS policy on `alignment_scale_items` requires the parent scale's `license_status = 'licensed'`.

### Operator runbook — acquire and license MLQ items
1. Visit Steger's official MLQ page (e.g., <http://www.michaelfsteger.com>) or pull items from the Steger et al. 2006 paper. Confirm the free-for-non-commercial-use terms (and clarify commercial use if North will later monetise).
2. For each item, update the prompt verbatim from the source:
   ```sql
   update public.alignment_scale_items
       set prompt = '<verbatim item text from Steger 2006>'
       where scale_id = 'mlq-pom' and ordering = <n>;
   ```
   The reverse-scoring flag in the seed (`ordering = 5` is `reverse_scored = true`) is a placeholder pending the operator's confirmation against the actual scoring rules in Steger 2006 — adjust by issuing further `update`s if the real scoring differs.
3. Flip the license:
   ```sql
   update public.alignment_scales
       set license_status = 'licensed',
           license_evidence_url = '<URL to Steger page or stored PDF>'
       where id = 'mlq-pom';
   ```
4. The clients (admin + native) start receiving real items via RLS the moment step 3 commits. The Layer-2 surveys (onboarding ONB-05 + day-28) automatically pick up the new text — no app deploy required.

### Wiring it into the app
- **Onboarding (ONB-05)** — the existing onboarding flow currently asks the single-item baseline pulse (see `apps/web/src/app/north/_lib/data.ts` `ONBOARDING_QS`). For Layer 2, replace that single item with a call that fetches `alignment_scale_items where scale_id = 'mlq-pom'` and renders them as a 5-item scale; submit answers to `baseline_endpoint_responses` with `measurement = 'baseline'`. (Out of scope for this DEC's PR; lands in onboarding work.)
- **Day-28 re-measure** — a scheduled job (future Edge Function `signal-alignment-day28`) checks each user's `profiles.onboarded_at` and prompts them when `current_date - onboarded_at = 28`; submits `measurement = 'day28'`. (Out of scope; lands when the M3 Signal tab needs the lift number.)
- **Layer-1 weekly pulse** — the native Signal tab calls `select public.weekly_pulse_due(auth.uid())` on mount; if true, shows the single-item prompt and writes to `weekly_pulses` on tap. (Out of scope; lands in M3 native Signal-tab work.)

### What this PR deliberately defers
- Real MLQ items — operator-driven (above).
- Native-app onboarding/Signal-tab integration — M3 product work.
- The day-28 scheduled re-measure trigger — lands when the M3 cohort has reached day 28.
- Demand-bias triangulation analytics — analytical, lands when there is data to triangulate.
