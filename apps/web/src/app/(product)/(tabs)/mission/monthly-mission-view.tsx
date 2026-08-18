"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/auth-client";
import { type GoalSetResult, SetGoalModal } from "./set-goal-modal";

// ─────────────────────────────────────────────────────────────────────────────
// Mission, Stitch "Dashboard" editorial design, WIRED to the real monthly
// mission backend. Same sleek-light language as the other tabs. All actions hit
// Supabase (completion logic + cadence + goal-set are unchanged):
//   • hero      → monthly_missions goal + macro progress
//   • today     → the FIRST undone daily step; later days stay locked until it's
//                 done (sequential unlock), the rest sit behind a week expander
//   • plan      → the 4 weekly milestones, toggled done
//   • set goal  → SetGoalModal (plan-month edge function)
// The finance-mockup content (velocity, syndicates, "Sovereign Expansion") is
// dropped, and the journal lives on its own tab now, every value here is the
// user's real mission data.
// ─────────────────────────────────────────────────────────────────────────────

type Step = {
	id: string;
	cadence: "daily" | "weekly";
	week_index: number;
	due_date: string | null;
	title: string;
	detail: string | null;
	estimate_label: string | null;
	done: boolean;
};
type Mission = {
	id: string;
	goal_title: string;
	goal_intent: string | null;
	focus_area_id: string | null;
	month_start: string;
	generated_by: string;
};

const PRIMARY = "#005ac2";
const SECONDARY = "#ee9800";
const ON_SURFACE = "#131313";
const ON_VARIANT = "#424754";
const SERIF = "'Libre Caslon Text', Georgia, serif";
const SANS = "'Sora', system-ui, sans-serif";
const FONT_SHEET =
	"https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap";
const ICON_SHEET =
	"https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block";

const NAV = [
	{ href: "/for-you", label: "For You", icon: "auto_awesome" },
	{ href: "/mission", label: "Mission", icon: "target" },
	{ href: "/opportunities", label: "Opportunities", icon: "trending_up" },
	{ href: "/journal", label: "Journal", icon: "menu_book" },
	{ href: "/community", label: "Community", icon: "group" },
];

const FOCUS_LABEL: Record<string, string> = {
	craft: "Craft & Mastery",
	venture: "Building a venture",
	mind: "Mind & body",
	people: "People & community",
	money: "Money & freedom",
	learn: "Deeper learning",
};

function parseDate(d: string): Date {
	return new Date(`${d}T00:00:00`);
}

function computeStreak(daily: Step[], today: string): number {
	const past = daily
		.filter((s) => s.due_date && s.due_date <= today)
		.sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""));
	let streak = 0;
	for (const s of past) {
		if (s.done) streak++;
		else break;
	}
	return streak;
}

export function MonthlyMissionView({
	mission: initialMission,
	steps: initialSteps,
	cadence: initialCadence,
	today,
	currentWeekIndex,
	streakState,
	promptGoal = false,
	firstName = "there",
	greeting = "Welcome",
	purposeMode = null,
}: {
	mission: Mission | null;
	steps: Step[];
	cadence: "daily" | "weekly";
	today: string;
	currentWeekIndex: number;
	streakState: number | null;
	promptGoal?: boolean;
	firstName?: string;
	greeting?: string;
	purposeMode?: "explorer" | "builder" | null;
}) {
	const [mission, setMission] = useState(initialMission);
	const [steps, setSteps] = useState(initialSteps);
	const [cadence, setCadence] = useState(initialCadence);
	// Goal-setting is never forced open. `promptGoal` (a fresh, still-template
	// goal not yet dismissed this month) shows a calm, dismissible nudge instead;
	// the modal only opens on an explicit tap.
	const [showGoal, setShowGoal] = useState(false);
	const [nudge, setNudge] = useState(promptGoal);

	const name = firstName && firstName !== "there" ? firstName : null;
	const tail = name ? `, ${name}` : "";

	function handleGoalSet(result: GoalSetResult) {
		setMission(result.mission);
		setSteps(result.steps);
		setCadence(result.cadence);
		setShowGoal(false);
		setNudge(false);
	}

	// Quietly remember the nudge was waved off, so it doesn't reappear this month.
	async function dismissNudge() {
		setNudge(false);
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (user && mission) {
			await supabase
				.from("profiles")
				.update({ goal_prompt_dismissed_month: mission.month_start })
				.eq("user_id", user.id);
		}
	}

	const daily = useMemo(
		() => steps.filter((s) => s.cadence === "daily"),
		[steps],
	);
	const weekly = useMemo(
		() =>
			steps
				.filter((s) => s.cadence === "weekly")
				.sort((a, b) => a.week_index - b.week_index),
		[steps],
	);
	const weekDays = useMemo(
		() =>
			daily
				.filter((s) => s.week_index === currentWeekIndex)
				.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
		[daily, currentWeekIndex],
	);

	const weeksDone = weekly.filter((s) => s.done).length;
	const weeksTotal = weekly.length || 4;
	const goalPct = Math.round((weeksDone / weeksTotal) * 100);

	const tasksDone = weekDays.filter((s) => s.done).length;
	const tasksTotal = weekDays.length;
	const tasksPct = tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0;
	const _daysLeft = weekDays.filter((s) => (s.due_date ?? "") >= today).length;
	const streak = streakState != null ? computeStreak(daily, today) : 0;

	// Daily steps unlock one at a time: the active step is the FIRST undone day
	// this week, you can't jump ahead until it's done. Weekly: this week's
	// milestone. Direction over a to-do list.
	const firstUndoneIdx = weekDays.findIndex((s) => !s.done);
	const focalStep =
		cadence === "daily"
			? (weekDays.find((s) => s.due_date === today) ??
				weekDays[firstUndoneIdx] ??
				weekDays[weekDays.length - 1] ??
				null)
			: (weekly.find((s) => s.week_index === currentWeekIndex) ?? null);

	// A calm, personal nudge that reflects where they are right now. The not-yet
	// line leans on the user's mode: explorers hear discovery, builders hear
	// execution. Everything else stays shared.
	const focalDone = focalStep?.done ?? false;
	const notYetLine =
		streak > 1
			? `${streak} days in rhythm. One step keeps it going.`
			: purposeMode === "explorer"
				? `One step is how you find the way${tail}.`
				: purposeMode === "builder"
					? `One step builds the thing${tail}. Make it today.`
					: `One small step is enough${tail}.`;
	const encouragement = !focalStep
		? `Nothing scheduled today${tail}. Enjoy the space.`
		: focalDone
			? streak > 1
				? `Done for today${tail}. ${streak} days in rhythm.`
				: `Done for today${tail}. Rest, or get a head start.`
			: notYetLine;

	async function setStepDone(id: string, done: boolean) {
		setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, done } : s)));
		await supabase
			.from("monthly_mission_steps")
			.update({ done, completed_at: done ? new Date().toISOString() : null })
			.eq("id", id);
	}

	async function changeCadence(next: "daily" | "weekly") {
		if (next === cadence) return;
		setCadence(next);
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (user) {
			await supabase
				.from("profiles")
				.update({ mission_cadence: next })
				.eq("user_id", user.id);
		}
	}

	const monthName = mission
		? parseDate(mission.month_start).toLocaleDateString("en-US", {
				month: "long",
			})
		: "";
	const focusLabel = mission?.focus_area_id
		? (FOCUS_LABEL[mission.focus_area_id] ?? null)
		: null;
	const isTemplate = mission?.generated_by === "template";

	return (
		<div style={{ background: "#fbfbfb", color: ON_SURFACE, fontFamily: SANS }}>
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			<link
				rel="preconnect"
				href="https://fonts.gstatic.com"
				crossOrigin="anonymous"
			/>
			<link rel="stylesheet" href={FONT_SHEET} precedence="default" />
			<link rel="stylesheet" href={ICON_SHEET} precedence="default" />
			<style>{SCOPED_CSS}</style>

			<Sidebar />

			<div className="mm-main min-h-screen">
				<TopBar monthName={monthName} />
				<div className="px-5 pb-6 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-[1280px]">
						{!mission ? (
							<EmptyState onSet={() => setShowGoal(true)} />
						) : (
							<>
								{/* ── Gentle goal nudge (never a forced modal) ───── */}
								{nudge && (
									<div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#005ac2]/15 bg-[#005ac2]/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
										<div className="flex items-start gap-3">
											<span
												className="material-symbols-outlined text-xl"
												style={{ color: PRIMARY }}
												aria-hidden="true"
											>
												flag
											</span>
											<p
												className="text-sm leading-relaxed"
												style={{ color: ON_SURFACE }}
											>
												<span className="font-bold">
													This is a starter goal.
												</span>{" "}
												<span style={{ color: ON_VARIANT }}>
													Set one that's truly yours whenever you're ready, no
													rush.
												</span>
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-1.5">
											<button
												type="button"
												onClick={() => setShowGoal(true)}
												className="rounded-xl px-4 py-2 font-bold text-sm text-white"
												style={{ background: PRIMARY }}
											>
												Set your goal
											</button>
											<button
												type="button"
												onClick={() => void dismissNudge()}
												className="rounded-xl px-3 py-2 font-semibold text-sm"
												style={{ color: ON_VARIANT }}
											>
												Maybe later
											</button>
										</div>
									</div>
								)}

								{/* ── Greeting ───────────────────────────────────── */}
								<div className="mt-4 mb-3">
									<h1
										className="font-bold text-2xl tracking-tight"
										style={{ fontFamily: SERIF }}
									>
										{greeting}
										{tail}
									</h1>
								</div>

								{/* ── Mission + Today (merged) ───────────────────── */}
								<section className="mb-4">
									<div className="glass-card signal-glow relative overflow-hidden rounded-[2rem] p-5">
										<div
											aria-hidden="true"
											className="absolute inset-0"
											style={{
												background:
													"radial-gradient(120% 100% at 100% 0%, rgba(0,90,194,0.12), transparent 55%), radial-gradient(90% 90% at 0% 100%, rgba(62,207,191,0.10), transparent 55%)",
											}}
										/>
										<div className="relative flex flex-col gap-5">
											{/* Left: mission info */}
											<div className="flex flex-col">
												<div
													className="mb-3 inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-white"
													style={{ background: PRIMARY }}
												>
													<span className="pulse-dot h-2 w-2 rounded-full bg-white" />
													<span className="font-bold text-[10px] uppercase tracking-[0.18em]">
														{monthName} mission
													</span>
												</div>
												<h1
													className="mb-2 max-w-2xl font-bold text-2xl leading-tight tracking-tight"
													style={{ fontFamily: SERIF }}
												>
													{mission.goal_title}
												</h1>
												{mission.goal_intent && (
													<p
														className="mb-4 max-w-xl text-sm leading-relaxed"
														style={{ color: ON_VARIANT, opacity: 0.85 }}
													>
														{mission.goal_intent}
													</p>
												)}
												<div className="flex flex-wrap items-center gap-4">
													<button
														type="button"
														onClick={() => setShowGoal(true)}
														className="rounded-xl px-5 py-2.5 font-bold text-sm text-white uppercase tracking-wider transition-all active:scale-95"
														style={{
															background: ON_SURFACE,
															boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
														}}
													>
														{isTemplate ? "Set your goal" : "Edit goal"}
													</button>
													<div className="flex items-center gap-3">
														<div className="h-2 w-32 overflow-hidden rounded-full bg-black/10">
															<div
																className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
																style={{
																	width: `${goalPct}%`,
																	background: PRIMARY,
																	boxShadow: "0 0 8px rgba(0,90,194,0.5)",
																}}
															/>
														</div>
														<span className="font-bold text-sm">
															{goalPct}% complete
														</span>
													</div>
												</div>
											</div>

											{/* Divider */}
											<div className="h-px bg-black/5" />

											{/* Right: today's pulse */}
											<div className="flex flex-col">
												<div className="mb-3 flex items-center justify-between gap-3">
													<h2
														className="font-bold text-xl tracking-tight"
														style={{ fontFamily: SERIF }}
													>
														{cadence === "daily" ? "Today" : "This week"}
													</h2>
													<CadenceToggle
														value={cadence}
														onChange={changeCadence}
													/>
												</div>

												<div key={focalStep?.id} className="step-reveal">
													{focalStep ? (
														<button
															type="button"
															onClick={() =>
																void setStepDone(focalStep.id, !focalStep.done)
															}
															aria-pressed={focalStep.done}
															className="flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition-colors"
															style={{
																borderColor: focalStep.done
																	? "rgba(0,90,194,0.2)"
																	: "rgba(0,90,194,0.3)",
																background: focalStep.done
																	? "transparent"
																	: "rgba(0,90,194,0.05)",
															}}
														>
															<span
																className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors"
																style={{
																	borderColor: focalStep.done
																		? PRIMARY
																		: "rgba(0,90,194,0.4)",
																	background: focalStep.done
																		? PRIMARY
																		: "transparent",
																}}
															>
																{focalStep.done && (
																	<span
																		className="material-symbols-outlined text-[18px] text-white"
																		style={{
																			fontVariationSettings: "'wght' 700",
																		}}
																	>
																		check
																	</span>
																)}
															</span>
															<span className="min-w-0 flex-1">
																<span
																	className="mb-1.5 block font-bold text-[10px] uppercase tracking-[0.16em]"
																	style={{ color: PRIMARY }}
																>
																	{cadence === "daily"
																		? "Your one thing today"
																		: `Week ${currentWeekIndex + 1} milestone`}
																</span>
																<span
																	className={`block font-bold text-base leading-snug tracking-tight ${
																		focalStep.done
																			? "line-through opacity-50"
																			: ""
																	}`}
																	style={{ fontFamily: SERIF }}
																>
																	{focalStep.title}
																</span>
																{focalStep.estimate_label && (
																	<span
																		className="mt-1.5 block font-bold text-[10px] uppercase tracking-wider"
																		style={{ color: ON_VARIANT, opacity: 0.45 }}
																	>
																		{focalStep.estimate_label}
																	</span>
																)}
															</span>
														</button>
													) : (
														<p
															className="rounded-2xl border border-black/5 p-4 text-sm"
															style={{ color: ON_VARIANT, opacity: 0.7 }}
														>
															No step scheduled right now.
														</p>
													)}
												</div>

												<p
													className="mt-3 text-sm leading-relaxed"
													style={{ color: ON_VARIANT, opacity: 0.85 }}
												>
													{encouragement}
												</p>

												{cadence === "daily" && tasksTotal > 0 && (
													<p
														className="mt-3 font-bold text-[10px] uppercase tracking-widest"
														style={{ color: ON_VARIANT, opacity: 0.45 }}
													>
														{tasksDone}/{tasksTotal} this week
													</p>
												)}
											</div>
										</div>
									</div>
								</section>

								{/* ── Stats bento ───────────────────────────────── */}
								<section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
									{/* Monthly progress */}
									<div className="glass-card flex flex-col rounded-[2rem] border-primary/40 border-b-4 p-4 sm:p-6">
										<div className="mb-3 flex items-start justify-between">
											<div>
												<p
													className="font-bold text-[11px] uppercase tracking-[0.2em]"
													style={{ color: ON_VARIANT, opacity: 0.7 }}
												>
													Monthly progress
												</p>
												<h3
													className="mt-1 font-bold text-3xl tracking-tight"
													style={{ color: PRIMARY, fontFamily: SERIF }}
												>
													{goalPct}%
												</h3>
											</div>
											<span
												className="material-symbols-outlined rounded-xl p-2 text-2xl"
												style={{
													background: "rgba(0,90,194,0.06)",
													color: PRIMARY,
												}}
											>
												target
											</span>
										</div>
										<div className="flex h-12 items-end gap-2">
											{Array.from({ length: weeksTotal }, (_, i) => {
												const done = weekly[i]?.done ?? false;
												const current = i === currentWeekIndex;
												return (
													<div
														key={weekly[i]?.id ?? `w${i}`}
														className="flex flex-1 flex-col items-center gap-2"
													>
														<div className="flex w-full flex-1 items-end">
															<div
																className="w-full rounded-t-md transition-all"
																style={{
																	height: done
																		? "100%"
																		: current
																			? "55%"
																			: "30%",
																	background: done
																		? PRIMARY
																		: current
																			? "rgba(0,90,194,0.35)"
																			: "rgba(0,0,0,0.06)",
																	boxShadow: done
																		? "0 0 12px rgba(0,90,194,0.3)"
																		: undefined,
																}}
															/>
														</div>
														<span
															className="font-bold text-[10px] uppercase tracking-wider"
															style={{
																color: current ? PRIMARY : ON_VARIANT,
																opacity: current ? 1 : 0.5,
															}}
														>
															W{i + 1}
														</span>
													</div>
												);
											})}
										</div>
									</div>

									{/* This month's focus */}
									<div className="glass-card relative flex flex-col overflow-hidden rounded-[2rem] p-4 sm:p-6">
										<div className="relative z-10">
											<div className="mb-3 flex items-center gap-2">
												<span
													className="material-symbols-outlined text-2xl"
													style={{
														color: SECONDARY,
														fontVariationSettings: "'FILL' 1",
													}}
												>
													explore
												</span>
												<span
													className="font-bold text-[11px] uppercase tracking-[0.2em]"
													style={{ color: SECONDARY }}
												>
													This month's focus
												</span>
											</div>
											<h3
												className="mb-2 font-bold text-xl leading-snug tracking-tight"
												style={{ fontFamily: SERIF }}
											>
												{focusLabel ?? "Your direction"}
											</h3>
											<p
												className="text-sm leading-relaxed"
												style={{ color: ON_VARIANT, opacity: 0.8 }}
											>
												{mission.goal_intent ??
													"One goal, one month, broken into weekly steps."}
											</p>
										</div>
										<span
											aria-hidden="true"
											className="material-symbols-outlined pointer-events-none absolute right-[-30px] bottom-[-30px] text-[200px]"
											style={{ color: SECONDARY, opacity: 0.05 }}
										>
											target
										</span>
									</div>

									{/* Rhythm */}
									<div className="glass-card col-span-2 flex flex-col justify-between rounded-[2rem] border-secondary/40 border-b-4 p-4 sm:p-6 lg:col-span-1">
										<p
											className="mb-3 font-bold text-[11px] uppercase tracking-[0.2em]"
											style={{ color: ON_VARIANT, opacity: 0.7 }}
										>
											Your rhythm
										</p>
										<div className="flex items-center gap-4">
											<Ring pct={goalPct} center={String(streak)} />
											<div>
												<p className="font-bold text-base tracking-tight">
													{streak} {streak === 1 ? "day" : "days"} in rhythm
												</p>
												<p
													className="font-bold text-xs uppercase tracking-wider"
													style={{ color: PRIMARY }}
												>
													{tasksDone}/{tasksTotal || 0} tasks this week
												</p>
											</div>
										</div>
										<div className="mt-3 space-y-2">
											<div
												className="flex justify-between font-bold text-[11px] uppercase tracking-widest"
												style={{ color: ON_SURFACE }}
											>
												<span>This week</span>
												<span>{tasksPct}%</span>
											</div>
											<div className="h-1.5 w-full rounded-full bg-black/5">
												<div
													className="h-full rounded-full"
													style={{
														width: `${tasksPct}%`,
														background: SECONDARY,
														boxShadow: "0 0 8px rgba(238,152,0,0.4)",
													}}
												/>
											</div>
										</div>
									</div>
								</section>

								{/* ── 4-week plan ───────────────────────────────── */}
								<section className="mt-4">
									<div className="glass-card rounded-[2rem] p-5 sm:p-8">
										<h3
											className="mb-4 font-bold text-2xl tracking-tight"
											style={{ fontFamily: SERIF }}
										>
											Your month
										</h3>
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											{weekly.length > 0 ? (
												weekly.map((s, i) => (
													<TaskRow
														key={s.id}
														step={s}
														today={today}
														weekLabel={`Week ${i + 1}`}
														current={i === currentWeekIndex}
														onToggle={() => void setStepDone(s.id, !s.done)}
													/>
												))
											) : (
												<p
													className="text-sm"
													style={{ color: ON_VARIANT, opacity: 0.6 }}
												>
													Your 4-week plan will appear once your goal is set.
												</p>
											)}
										</div>
									</div>
								</section>
							</>
						)}
					</div>
				</div>
			</div>

			{showGoal && mission && (
				<SetGoalModal
					monthName={monthName}
					monthStart={mission.month_start}
					initialGoal={mission.goal_title}
					initialIntent={mission.goal_intent ?? ""}
					autosuggest={isTemplate}
					onDismiss={() => {
						setShowGoal(false);
						setNudge(false);
					}}
					onGoalSet={handleGoalSet}
				/>
			)}
		</div>
	);
}

function TaskRow({
	step,
	today,
	weekLabel,
	current,
	locked = false,
	onToggle,
}: {
	step: Step;
	today: string;
	weekLabel?: string;
	current?: boolean;
	locked?: boolean;
	onToggle: () => void;
}) {
	const overdue = !step.done && step.due_date != null && step.due_date < today;
	const meta = locked
		? "Finish the step before to unlock"
		: (weekLabel ??
			step.estimate_label ??
			(step.due_date
				? overdue
					? "Overdue"
					: step.due_date === today
						? "Due today"
						: step.due_date
				: ""));
	return (
		<button
			type="button"
			onClick={locked ? undefined : onToggle}
			disabled={locked}
			aria-pressed={step.done}
			className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition-[colors,opacity] duration-300 ${
				locked ? "cursor-not-allowed" : "hover:bg-black/[0.03]"
			}`}
			style={{
				opacity: locked ? 0.55 : 1,
				background:
					current && !step.done && !locked ? "rgba(0,90,194,0.05)" : undefined,
			}}
		>
			<span
				className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
				style={{
					borderColor: step.done
						? PRIMARY
						: locked
							? "rgba(14,20,32,0.2)"
							: "rgba(0,90,194,0.3)",
					background: step.done ? PRIMARY : "transparent",
				}}
			>
				{step.done ? (
					<span
						className="material-symbols-outlined text-[16px] text-white"
						style={{ fontVariationSettings: "'wght' 700" }}
					>
						check
					</span>
				) : (
					locked && (
						<span
							className="material-symbols-outlined text-[13px]"
							style={{ color: "rgba(14,20,32,0.4)" }}
						>
							lock
						</span>
					)
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span
					className={`block font-bold text-sm leading-snug ${
						step.done ? "line-through opacity-50" : ""
					}`}
				>
					{locked ? "Locked" : step.title}
				</span>
				{meta && (
					<span
						className="mt-1 block font-bold text-[10px] uppercase tracking-wider"
						style={{
							color:
								overdue && !locked
									? "#ba1a1a"
									: current && !locked
										? PRIMARY
										: ON_VARIANT,
							opacity: step.done ? 0.5 : overdue || current ? 1 : 0.6,
						}}
					>
						{meta}
					</span>
				)}
			</span>
		</button>
	);
}

function CadenceToggle({
	value,
	onChange,
}: {
	value: "daily" | "weekly";
	onChange: (v: "daily" | "weekly") => void;
}) {
	return (
		<div className="flex rounded-full border border-black/5 bg-white/60 p-0.5">
			{(["daily", "weekly"] as const).map((c) => {
				const active = value === c;
				return (
					<button
						key={c}
						type="button"
						onClick={() => onChange(c)}
						className="rounded-full px-3 py-1 font-bold text-[10px] uppercase tracking-wider transition-colors"
						style={
							active
								? { background: PRIMARY, color: "#fff" }
								: { color: ON_VARIANT }
						}
					>
						{c}
					</button>
				);
			})}
		</div>
	);
}

function Ring({ pct, center }: { pct: number; center: string }) {
	const r = 34;
	const circ = 2 * Math.PI * r;
	const offset = circ * (1 - Math.min(100, Math.max(0, pct)) / 100);
	return (
		<div className="relative h-20 w-20 shrink-0">
			<svg
				className="h-full w-full -rotate-90"
				viewBox="0 0 80 80"
				aria-hidden="true"
			>
				<circle
					cx="40"
					cy="40"
					r={r}
					fill="transparent"
					stroke="rgba(0,0,0,0.06)"
					strokeWidth="6"
				/>
				<circle
					cx="40"
					cy="40"
					r={r}
					fill="transparent"
					stroke={PRIMARY}
					strokeWidth="6"
					strokeLinecap="round"
					strokeDasharray={circ}
					strokeDashoffset={offset}
				/>
			</svg>
			<span
				className="absolute inset-0 flex items-center justify-center font-bold text-2xl tracking-tight"
				style={{ fontFamily: SERIF }}
			>
				{center}
			</span>
		</div>
	);
}

function EmptyState({ onSet }: { onSet: () => void }) {
	// The Mission loop, named as a real sequence so the numbers carry meaning.
	const steps = [
		"Set one goal for this month",
		"North splits it into 4 weekly steps",
		"Do one small move each day",
	];
	return (
		<div className="glass-card mt-10 rounded-[2rem] p-8 text-center sm:p-12">
			<span
				className="material-symbols-outlined text-5xl"
				style={{ color: PRIMARY, opacity: 0.35 }}
			>
				target
			</span>
			<p
				className="mt-4 font-bold text-[11px] uppercase tracking-[0.22em]"
				style={{ color: PRIMARY }}
			>
				Mission
			</p>
			<p className="mt-2 font-bold text-2xl" style={{ fontFamily: SERIF }}>
				Turn one goal into daily motion
			</p>
			<p
				className="mx-auto mt-2 max-w-sm text-sm leading-relaxed"
				style={{ color: ON_VARIANT }}
			>
				Pick a single goal for the month. North breaks it down so there's always
				one small, doable move in front of you.
			</p>
			<ol className="mx-auto mt-7 flex max-w-xs flex-col gap-2.5 text-left">
				{steps.map((step, i) => (
					<li
						key={step}
						className="flex items-center gap-3 text-sm"
						style={{ color: ON_SURFACE }}
					>
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-bold text-[12px] text-white"
							style={{ background: PRIMARY }}
							aria-hidden="true"
						>
							{i + 1}
						</span>
						{step}
					</li>
				))}
			</ol>
			<button
				type="button"
				onClick={onSet}
				className="mt-8 rounded-xl px-7 py-3 font-bold text-sm text-white uppercase tracking-wider"
				style={{ background: PRIMARY }}
			>
				Set your goal
			</button>
		</div>
	);
}

function TopBar({ monthName }: { monthName: string }) {
	return (
		<header
			className="sticky top-0 z-40 px-5 py-3 backdrop-blur-md sm:px-6 lg:px-8"
			style={{ background: "rgba(251,251,251,0.7)" }}
		>
			<div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3">
				<span
					className="font-bold text-xl tracking-tight md:hidden"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					Mission
				</span>
				<span className="hidden md:block" />
				<div className="flex items-center gap-4">
					{monthName && (
						<span
							className="hidden rounded-full border border-black/5 px-3 py-1 font-bold text-[10px] uppercase tracking-wider sm:inline"
							style={{ color: ON_VARIANT, opacity: 0.7 }}
						>
							{monthName}
						</span>
					)}
					<a
						href="/profile"
						aria-label="Your profile"
						className="flex h-9 w-9 items-center justify-center rounded-full border border-black/5 bg-white shadow-sm"
					>
						<span
							className="material-symbols-outlined text-xl"
							style={{ color: ON_VARIANT }}
						>
							person
						</span>
					</a>
				</div>
			</div>
		</header>
	);
}

function Sidebar() {
	return (
		<aside className="mm-rail px-6 py-8">
			<a
				href="/for-you"
				aria-label="North home"
				className="mb-12 flex items-center gap-3 px-2"
			>
				<svg
					className="h-9 w-9 shrink-0"
					viewBox="0 0 100 100"
					fill={PRIMARY}
					aria-hidden="true"
				>
					<path d="M50 3 L58 42 L97 50 L58 58 L50 97 L42 58 L3 50 L42 42 Z" />
				</svg>
				<span
					className="font-bold text-3xl tracking-tighter"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					North
				</span>
			</a>
			<nav className="flex-1 space-y-1">
				{NAV.map((n) => {
					const active = n.href === "/mission";
					return (
						<a
							key={n.href}
							href={n.href}
							aria-current={active ? "page" : undefined}
							className="flex items-center gap-4 rounded-xl px-4 py-3 transition-colors"
							style={
								active
									? {
											color: PRIMARY,
											fontWeight: 700,
											background: "rgba(0,90,194,0.05)",
										}
									: { color: ON_VARIANT }
							}
						>
							<span
								className="material-symbols-outlined"
								style={
									active
										? { fontVariationSettings: "'FILL' 1, 'wght' 700" }
										: undefined
								}
							>
								{n.icon}
							</span>
							<span
								className="text-sm"
								style={{ fontWeight: active ? 700 : 500 }}
							>
								{n.label}
							</span>
						</a>
					);
				})}
			</nav>
			<div className="border-black/5 border-t pt-8">
				<button
					type="button"
					onClick={() => toast("Premium is coming soon")}
					className="flex w-full items-center justify-between rounded-xl px-4 py-3 font-bold text-sm transition-colors hover:bg-black/5"
					style={{ color: ON_SURFACE }}
				>
					Go Beyond
					<span
						className="rounded-full px-2 py-0.5 font-bold text-[10px] uppercase tracking-wider"
						style={{ color: PRIMARY, background: "rgba(0,90,194,0.1)" }}
					>
						Soon
					</span>
				</button>
			</div>
		</aside>
	);
}

const SCOPED_CSS = `
.material-symbols-outlined {
	font-family: 'Material Symbols Outlined';
	font-weight: normal; font-style: normal; line-height: 1; letter-spacing: normal;
	text-transform: none; display: inline-block; white-space: nowrap; word-wrap: normal;
	direction: ltr; -webkit-font-feature-settings: 'liga'; font-feature-settings: 'liga';
	-webkit-font-smoothing: antialiased; width: 1em; overflow: hidden;
}
/* Stitch recipe: frosted glass + a hairline gradient border (the ::before mask). */
.glass-card { position: relative; background: rgba(255,255,255,0.6); backdrop-filter: blur(32px); -webkit-backdrop-filter: blur(32px); border: 0.5px solid rgba(0,0,0,0.08); box-shadow: 0 8px 32px -4px rgba(0,0,0,0.06); }
.glass-card::before { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 0.5px; background: linear-gradient(to bottom right, rgba(255,255,255,0.9), rgba(255,255,255,0.1)); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; pointer-events: none; }
.glass-card > * { position: relative; }
.signal-glow { box-shadow: 0 40px 80px -12px rgba(0,90,194,0.15); }
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.02); }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,90,194,0.15); border-radius: 10px; }
@keyframes pulse-signal { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.1); } }
.pulse-dot { animation: pulse-signal 2s infinite ease-in-out; }
@keyframes step-reveal-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.step-reveal { animation: step-reveal-in 0.35s ease-out both; }
/* Critical layout, server-rendered: fixed sidebar + content offset before fonts
   load. Phones use the bottom tab bar. */
.mm-rail { position: fixed; left: 0; top: 0; height: 100%; width: 280px; z-index: 50; display: none; flex-direction: column; background: rgba(255,255,255,0.6); border-right: 1px solid rgba(0,0,0,0.05); backdrop-filter: blur(20px); }
.mm-main { margin-left: 0; padding-bottom: 5rem; }
@media (min-width: 768px) { .mm-rail { display: flex; } .mm-main { margin-left: 280px; padding-bottom: 2.5rem; } }
@media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }
`;
