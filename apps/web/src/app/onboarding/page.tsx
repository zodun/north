"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/auth-client";
import {
	CAREER_STAGES,
	COUNTRIES,
	FIELDS,
	INTEREST_OPTIONS,
	MAX_FIELDS,
} from "@/lib/personalization-options";

// ── Data (stored values unchanged, visual labels/colors only) ──────────────

const GOLD = "#F5C842";
const TEAL = "#3ECFBF";

// Drives complete_onboarding (topFocusId + label). Display name/colour/icon
// live in FOCUS_META; the stored id + label here are untouched.
const FOCUS_AREAS = [
	{ id: "craft", label: "Craft & Mastery", hue: "#7ec4bb" },
	{ id: "venture", label: "Building a venture", hue: "#d4a574" },
	{ id: "mind", label: "Mind & body", hue: "#9aaee0" },
	{ id: "people", label: "People & community", hue: "#c97a5a" },
	{ id: "money", label: "Money & freedom", hue: "#a8b97a" },
	{ id: "learn", label: "Deeper learning", hue: "#b39ad8" },
];

// Cards are ink-on-white; selection earns the one gold accent (gold = the
// needle / next action). Glyphs are North's own — see FOCUS_GLYPHS.
const FOCUS_META: Record<string, { name: string; desc: string }> = {
	craft: { name: "Craft", desc: "Make things" },
	venture: { name: "Venture", desc: "Build something" },
	mind: { name: "Mind", desc: "Feel steady" },
	people: { name: "People", desc: "Connect" },
	money: { name: "Money", desc: "Get free" },
	learn: { name: "Learn", desc: "Go deep" },
};

// Career-stage / field / country option lists are shared with the Profile
// editor (see @/lib/personalization-options) so a stored value round-trips
// identically. Icons are onboarding-only chrome, keyed by the shared value.
const CAREER_STAGE_ICONS: Record<string, keyof typeof ICONS> = {
	Student: "book",
	"About to graduate": "rocket",
	"0 to 2 years in": "compass",
	"3 to 5 years in": "chart",
	"6+ years in": "clock",
	"Building my own thing": "pencil",
};

const TIME_OPTIONS = [
	{ value: "10 to 20 minutes", sub: "A quick daily check-in" },
	{ value: "30 to 45 minutes", sub: "Focused and consistent" },
	{ value: "1 to 2 hours", sub: "Deep work sessions" },
	{ value: "Whatever the day allows", sub: "Flexible, no pressure" },
];

const CONSENT_ROWS = [
	"Your behaviour data is used only to improve your experience",
	"It is never shared with or sold to third parties",
	"You can delete your data at any time from your profile",
];

const CTA_LABELS = [
	"That's me", // 0 welcome / name
	"These are my focus areas", // 1 focus
	"These are my fields", // 2 fields
	"This is my stage", // 3 career
	"These are my interests", // 4 interests
	"That's my direction", // 5 direction
	"That's where I am", // 6 location
	"That's my level", // 7 education
	"That's how I learn", // 8 learn-format
	"That's my aim", // 9 aim
	"This is my pace", // 10 time
	"That's where I am", // 11 purpose (explorer / builder)
	"That's who I am", // 12 demographics (gender + race)
	"Take me to North", // 13 consent (final step → completes onboarding)
];

// 14 steps: a welcome (name) + 12 questions + consent. The counter shows the
// 12 questions; the welcome and consent are framing steps.
const TOTAL_STEPS = 14;
const QUESTION_COUNT = 12;

// How the user likes to consume content → For You can favour matching kinds.
const CONTENT_FORMATS = [
	{ id: "read", label: "Read" },
	{ id: "watch", label: "Watch" },
	{ id: "listen", label: "Listen" },
];

// Do you already know your purpose? This is the one question that names who the
// user is in North. The two stances are worn across the app afterward, so the
// choice is framed as an induction, not a checkbox.
const PURPOSE_OPTIONS = [
	{
		id: "builder",
		icon: "rocket" as const,
		title: "Builder",
		creed: "I know what I'm working toward. I'm here to make it real.",
		sealed: "You're a Builder. North will move with you toward it.",
		color: GOLD,
	},
	{
		id: "explorer",
		icon: "compass" as const,
		title: "Explorer",
		creed: "I'm still finding my direction. I'm here to discover it.",
		sealed: "You're an Explorer. North will help you find the way.",
		color: TEAL,
	},
];

// Highest education completed or in progress → Opportunities eligibility.
const EDUCATION_LEVELS = [
	{ value: "In high school", sub: "Secondary school or equivalent" },
	{ value: "High school graduate", sub: "Finished secondary, not in college" },
	{ value: "In university", sub: "Currently pursuing a degree" },
	{ value: "Undergraduate degree", sub: "Bachelor's or equivalent" },
	{ value: "Postgraduate degree", sub: "Master's, doctorate, or higher" },
	{ value: "Self-taught or bootcamp", sub: "Skills outside a formal degree" },
];

// ── Main component ─────────────────────────────────────────────────────────

export default function OnboardingPage() {
	const [step, setStep] = useState(0);
	const [name, setName] = useState("");
	const [careerStage, setCareerStage] = useState<string | null>(null);
	const [fields, setFields] = useState<string[]>([]);
	const [country, setCountry] = useState<string>("");
	const [openToRemote, setOpenToRemote] = useState(false);
	const [openToRelocate, setOpenToRelocate] = useState(false);
	const [focus, setFocus] = useState<string[]>([]);
	const [contentFormats, setContentFormats] = useState<string[]>([]);
	const [interests, setInterests] = useState<string[]>([]);
	const [interestOther, setInterestOther] = useState("");
	const [direction, setDirection] = useState("");
	const [time, setTime] = useState<string | null>(null);
	const [educationLevel, setEducationLevel] = useState<string | null>(null);
	const [aspiration, setAspiration] = useState("");
	const [purposeMode, setPurposeMode] = useState<string | null>(null);
	const [gender, setGender] = useState<string>("");
	const [race, setRace] = useState<string>("");
	const [consent, setConsent] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [userId, setUserId] = useState<string | null>(null);

	useEffect(() => {
		supabase.auth.getUser().then(({ data }) => {
			if (data.user) setUserId(data.user.id);
		});
	}, []);

	// Prefill name from OAuth metadata, run once on mount only.
	useEffect(() => {
		supabase.auth.getSession().then(({ data }) => {
			const meta = data.session?.user.user_metadata ?? {};
			const oauthName =
				(meta.display_name as string | undefined) ??
				(meta.full_name as string | undefined) ??
				(meta.name as string | undefined) ??
				"";
			if (oauthName) setName((prev) => prev || oauthName);
		});
	}, []);

	const progress = ((step + 1) / TOTAL_STEPS) * 100;

	function toggleFocus(id: string) {
		setFocus((prev) =>
			prev.includes(id)
				? prev.filter((f) => f !== id)
				: prev.length < 3
					? [...prev, id]
					: prev,
		);
	}

	function toggleField(value: string) {
		setFields((prev) =>
			prev.includes(value)
				? prev.filter((f) => f !== value)
				: prev.length < MAX_FIELDS
					? [...prev, value]
					: prev,
		);
	}

	function toggleInterest(id: string) {
		setInterests((prev) =>
			prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
		);
	}

	function toggleContentFormat(id: string) {
		setContentFormats((prev) =>
			prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
		);
	}

	async function saveCurrentStep() {
		if (!userId) return;
		setError(null);

		// 0 welcome/name · 1 focus · 2 fields · 3 career · 4 interests ·
		// 5 direction · 6 location · 7 education · 8 learn-format · 9 aim · 10 time ·
		// 11 purpose
		if (step === 0) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ display_name: name.trim() })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 1 && focus.length > 0) {
			await supabase.from("user_focus_areas").delete().eq("user_id", userId);
			await supabase
				.from("user_focus_areas")
				.insert(focus.map((id) => ({ user_id: userId, focus_area_id: id })));
		}
		if (step === 2) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ fields })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 3 && careerStage) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ career_stage: careerStage })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 4) {
			// Chips plus any comma-separated "other" the user typed, deduped.
			const extra = interestOther
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const all = Array.from(new Set([...interests, ...extra]));
			const { error: err } = await supabase
				.from("profiles")
				.update({ interests: all })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 5) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ statement_of_intent: direction.trim() || null })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 6) {
			const { error: err } = await supabase
				.from("profiles")
				.update({
					country: country && country !== "Somewhere else" ? country : null,
					open_to_remote: openToRemote,
					open_to_relocate: openToRelocate,
				})
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 7 && educationLevel) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ education_level: educationLevel })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 8) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ content_formats: contentFormats })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 9) {
			const { error: err } = await supabase
				.from("profiles")
				.update({ aspiration: aspiration.trim() || null })
				.eq("user_id", userId);
			if (err) throw new Error(err.message);
		}
		if (step === 10 && time) {
			await supabase
				.from("profiles")
				.update({ time_budget_label: time })
				.eq("user_id", userId);
		}
		if (step === 11 && purposeMode) {
			// Best-effort: the stance is cosmetic and onboarding completion doesn't
			// depend on it, so a save hiccup must never trap the user on this step.
			await supabase
				.from("profiles")
				.update({ purpose_mode: purposeMode })
				.eq("user_id", userId);
		}
		if (step === 12) {
			await supabase
				.from("profiles")
				.update({
					gender: gender || null,
					race: race || null,
				})
				.eq("user_id", userId);
		}
	}

	async function handleComplete() {
		if (!userId)
			throw new Error("Session expired. Please refresh and try again.");
		if (focus.length === 0)
			throw new Error("Please go back and choose your focus areas first.");

		const topFocusId = focus[0];
		const topFocusLabel =
			FOCUS_AREAS.find((f) => f.id === topFocusId)?.label ?? topFocusId;
		// Signal baseline is no longer asked; seed the neutral midpoint of the
		// 1..5 scale (3) and let the Direction Score build from real behaviour.
		const { error: rpcErr } = await supabase.rpc("complete_onboarding", {
			p_focus_area_id: topFocusId,
			p_focus_area_label: topFocusLabel,
			p_pulse_score: 3,
		});

		if (rpcErr) {
			// RPC failed — check whether a previous attempt already set onboarded_at.
			// If so, navigate through; otherwise surface the error.
			const { data: profile } = await supabase
				.from("profiles")
				.select("onboarded_at")
				.eq("user_id", userId)
				.maybeSingle();
			if (!profile?.onboarded_at) throw new Error(rpcErr.message);
		}

		// Guided first action: land on Mission, not the passive feed, so the
		// very first thing after signup is setting a goal. Mission auto-opens the
		// goal prompt (seeded template) or shows the teaching empty state, so the
		// core loop clicks by doing rather than by reading a feed.
		// Hard navigation so a stale service worker or router state can't
		// intercept and silently drop the redirect.
		window.location.replace("/mission");
	}

	async function handleNext() {
		setSaving(true);
		setError(null);
		try {
			await saveCurrentStep();
			if (step < TOTAL_STEPS - 1) {
				setStep((s) => s + 1);
			} else {
				await handleComplete();
			}
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: "Something went wrong. Please try again.",
			);
		} finally {
			setSaving(false);
		}
	}

	// Steps 4 (interests), 5 (direction) and 9 (aim) are optional/skippable.
	const canContinue = (() => {
		if (step === 0) return name.trim().length > 0;
		if (step === 1) return focus.length > 0;
		if (step === 2) return fields.length > 0;
		if (step === 3) return careerStage !== null;
		if (step === 4) return true; // interests optional
		if (step === 5) return true; // direction optional
		if (step === 6) return country !== "";
		if (step === 7) return educationLevel !== null;
		if (step === 8) return contentFormats.length > 0;
		if (step === 9) return true; // aim optional
		if (step === 10) return time !== null;
		if (step === 11) return purposeMode !== null;
		if (step === 12) return true; // demographics optional
		if (step === 13) return focus.length > 0 && consent;
		return false;
	})();

	return (
		<div className="fixed inset-0 z-40 overflow-y-auto bg-[#EDF1F8] font-jakarta">
			<style>{ANIM}</style>

			{/* Light leaks */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 z-0"
				style={{
					background:
						"radial-gradient(150% 85% at 50% -12%, rgba(255,255,255,0.9), transparent 60%), radial-gradient(120% 90% at 100% 102%, rgba(62,207,191,0.10), transparent 55%), radial-gradient(110% 70% at 2% -4%, rgba(245,200,66,0.07), transparent 50%)",
				}}
			/>

			{/* Progress bar */}
			<div className="fixed top-0 right-0 left-0 z-50 h-[3px] bg-[#0E1420]/10">
				<div
					className="h-full bg-gradient-to-r from-[#F5C842] to-[#3ECFBF] transition-[width] duration-[400ms] ease-out motion-reduce:transition-none"
					style={{ width: `${progress}%` }}
				/>
			</div>
			<p className="fixed top-3 right-4 z-50 font-bold text-[#0E1420]/55 text-[10px] uppercase tracking-[0.1em]">
				{step === 0
					? "Welcome"
					: step >= TOTAL_STEPS - 1
						? "Almost done"
						: `${step} of ${QUESTION_COUNT}`}
			</p>

			{/* Back button */}
			{step > 0 && (
				<button
					type="button"
					onClick={() => setStep((s) => s - 1)}
					aria-label="Go back"
					className="absolute top-5 left-5 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[#0E1420]/10 bg-white transition-colors hover:bg-[#F4F7FC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C842] motion-reduce:transition-none"
				>
					<Icon name="back" color="#0E1420" />
				</button>
			)}

			{/* Step */}
			<div
				key={step}
				className="step-in relative z-10 mx-auto flex min-h-svh max-w-[420px] flex-col justify-center px-6 pt-16 pb-10"
			>
				{step === 0 && <StepName value={name} onChange={setName} />}
				{step === 1 && <StepFocus value={focus} onToggle={toggleFocus} />}
				{step === 2 && <StepFields value={fields} onToggle={toggleField} />}
				{step === 3 && (
					<StepCareerStage value={careerStage} onSelect={setCareerStage} />
				)}
				{step === 4 && (
					<StepInterests
						value={interests}
						onToggle={toggleInterest}
						other={interestOther}
						onOther={setInterestOther}
					/>
				)}
				{step === 5 && (
					<StepDirection value={direction} onChange={setDirection} />
				)}
				{step === 6 && (
					<StepLocation
						country={country}
						onCountry={setCountry}
						remote={openToRemote}
						onRemote={setOpenToRemote}
						relocate={openToRelocate}
						onRelocate={setOpenToRelocate}
					/>
				)}
				{step === 7 && (
					<StepEducation value={educationLevel} onSelect={setEducationLevel} />
				)}
				{step === 8 && (
					<StepLearnFormat
						value={contentFormats}
						onToggle={toggleContentFormat}
					/>
				)}
				{step === 9 && (
					<StepAspiration value={aspiration} onChange={setAspiration} />
				)}
				{step === 10 && <StepTime value={time} onSelect={setTime} />}
				{step === 11 && (
					<StepPurpose value={purposeMode} onSelect={setPurposeMode} />
				)}
				{step === 12 && (
					<StepDemographics
						gender={gender}
						race={race}
						onGender={setGender}
						onRace={setRace}
					/>
				)}
				{step === 13 && (
					<StepConsent consent={consent} onConsent={setConsent} />
				)}

				{/* CTA */}
				<div className="mt-8">
					<CtaButton
						onClick={handleNext}
						disabled={!canContinue || saving}
						saving={saving}
					>
						{CTA_LABELS[step]}
					</CtaButton>
					{(step === 4 || step === 5 || step === 9 || step === 12) && (
						<button
							type="button"
							onClick={handleNext}
							className="mt-3 w-full cursor-pointer text-center font-medium text-[#0E1420]/50 text-[12px] transition-colors hover:text-[#0E1420]/65 motion-reduce:transition-none"
						>
							Skip for now
						</button>
					)}
					{step === 13 && !consent && (
						<p className="mt-2 text-center text-[#0E1420]/50 text-[11px]">
							You must agree to continue
						</p>
					)}
					{error && (
						<p
							className="mt-3 text-center text-[13px] text-red-600"
							role="alert"
						>
							{error}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Shared chrome ───────────────────────────────────────────────────────────

function StepHead({
	eyebrow,
	headline,
	sub,
}: {
	eyebrow: string;
	headline: string;
	sub?: string;
}) {
	return (
		<div className="mb-8">
			<p
				className="mb-3 font-bold text-[10px] uppercase tracking-[0.15em]"
				style={{ color: "#8A6A00" }}
			>
				{eyebrow}
			</p>
			<h1 className="mb-2 font-black text-[#0E1420] text-[26px] leading-[1.15] tracking-tight">
				{headline}
			</h1>
			{sub && (
				<p className="text-[#0E1420]/65 text-[13px] leading-relaxed">{sub}</p>
			)}
		</div>
	);
}

function CtaButton({
	onClick,
	disabled,
	saving,
	children,
}: {
	onClick: () => void;
	disabled: boolean;
	saving: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="relative w-full cursor-pointer overflow-hidden rounded-[14px] py-[15px] font-black text-[#05050E] text-[15px] tracking-tight transition-all hover:bg-[#FFD966] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C842] focus-visible:ring-offset-2 focus-visible:ring-offset-[#EDF1F8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none motion-reduce:transition-none motion-reduce:active:scale-100"
			style={{
				backgroundColor: GOLD,
				boxShadow: disabled ? "none" : "0 2px 12px rgba(245,200,66,0.30)",
			}}
		>
			<span className="relative z-10">{saving ? "Saving…" : children} →</span>
			{!disabled && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 w-[45%] animate-shimmer motion-reduce:hidden"
					style={{
						background:
							"linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
					}}
				/>
			)}
		</button>
	);
}

function selectableRing(): string {
	return "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C842] focus-visible:ring-offset-2 focus-visible:ring-offset-[#EDF1F8]";
}

function CheckBadge({ color, size = 24 }: { color: string; size?: number }) {
	return (
		<span
			className="flex items-center justify-center rounded-full"
			style={{ width: size, height: size, backgroundColor: color }}
		>
			<svg
				width={size * 0.5}
				height={size * 0.5}
				viewBox="0 0 24 24"
				fill="none"
				stroke="#05050E"
				strokeWidth={3.5}
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M20 6 9 17l-5-5" />
			</svg>
		</span>
	);
}

// ── Steps ───────────────────────────────────────────────────────────────────

function StepName({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Welcome to North"
				headline="What should we call you?"
				sub="Just your first name is fine."
			/>
			<label htmlFor="onb-name" className="sr-only">
				Your first name
			</label>
			<input
				id="onb-name"
				type="text"
				// biome-ignore lint/a11y/noAutofocus: intentional UX for onboarding first step
				autoFocus
				autoComplete="given-name"
				autoCapitalize="words"
				placeholder="Your first name"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-[14px] border border-[#0E1420]/10 bg-white px-5 py-4 font-bold text-[#0E1420] text-[18px] outline-none transition-all placeholder:text-[#0E1420]/35 focus:border-[#F5C842] focus:bg-[rgba(245,200,66,0.04)]"
			/>
		</div>
	);
}

function StepCareerStage({
	value,
	onSelect,
}: {
	value: string | null;
	onSelect: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="A bit about you"
				headline="Where are you in your career?"
				sub="This filters what's actually open to you."
			/>
			<div className="flex flex-col gap-2">
				{CAREER_STAGES.map((opt) => {
					const selected = value === opt.value;
					return (
						<button
							key={opt.value}
							type="button"
							aria-pressed={selected}
							onClick={() => onSelect(opt.value)}
							className={`relative flex items-center gap-4 rounded-[16px] border-[1.5px] p-4 text-left transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={{
								backgroundColor: selected ? "rgba(245,200,66,0.10)" : "#ffffff",
								borderColor: selected ? GOLD : "rgba(14,20,32,0.12)",
							}}
						>
							<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F4F7FC]">
								<Icon
									name={CAREER_STAGE_ICONS[opt.value] ?? "compass"}
									color="rgba(14,20,32,0.55)"
									size={18}
								/>
							</span>
							<span className="flex-1">
								<span className="block font-black text-[#0E1420] text-[14px]">
									{opt.value}
								</span>
								<span className="mt-0.5 block text-[#0E1420]/55 text-[11px]">
									{opt.sub}
								</span>
							</span>
							{selected && <CheckBadge color={GOLD} size={22} />}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function StepFields({
	value,
	onToggle,
}: {
	value: string[];
	onToggle: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Your work"
				headline="What's your field?"
				sub="Up to two — where you are or where you're headed."
			/>
			<div className="flex flex-wrap gap-2">
				{FIELDS.map((label) => {
					const selected = value.includes(label);
					return (
						<button
							key={label}
							type="button"
							aria-pressed={selected}
							onClick={() => onToggle(label)}
							className={`cursor-pointer rounded-full border px-4 py-2.5 font-bold text-[12px] transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={
								selected
									? {
											backgroundColor: "rgba(62,207,191,0.14)",
											borderColor: "rgba(62,207,191,0.55)",
											color: "#0A8F7F",
										}
									: {
											backgroundColor: "#ffffff",
											borderColor: "rgba(14,20,32,0.12)",
											color: "rgba(14,20,32,0.55)",
										}
							}
						>
							{label}
						</button>
					);
				})}
			</div>
			<p className="mt-4 text-center text-[#0E1420]/55 text-[11px]">
				<span style={{ color: value.length > 0 ? "#0A8F7F" : undefined }}>
					{value.length}
				</span>{" "}
				of {MAX_FIELDS} selected
			</p>
		</div>
	);
}

function StepLocation({
	country,
	onCountry,
	remote,
	onRemote,
	relocate,
	onRelocate,
}: {
	country: string;
	onCountry: (v: string) => void;
	remote: boolean;
	onRemote: (v: boolean) => void;
	relocate: boolean;
	onRelocate: (v: boolean) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Where you are"
				headline="Where are you based?"
				sub="So everything you see is open to you."
			/>
			<label htmlFor="onb-country" className="sr-only">
				Your country
			</label>
			<div className="relative">
				<select
					id="onb-country"
					value={country}
					onChange={(e) => onCountry(e.target.value)}
					className="w-full appearance-none rounded-[14px] border border-[#0E1420]/10 bg-white px-5 py-4 font-bold text-[#0E1420] text-[16px] outline-none transition-all focus:border-[#F5C842] focus:bg-[rgba(245,200,66,0.04)]"
					style={{ color: country ? "#0E1420" : "rgba(14,20,32,0.55)" }}
				>
					<option value="" disabled className="bg-white text-[#0E1420]/55">
						Select your country
					</option>
					{COUNTRIES.map((c) => (
						<option key={c} value={c} className="bg-white text-[#0E1420]">
							{c}
						</option>
					))}
				</select>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-[#0E1420]/55"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2.5}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="m6 9 6 6 6-6" />
					</svg>
				</span>
			</div>

			<div className="mt-4 flex flex-col gap-2">
				<ToggleRow
					label="Open to remote opportunities"
					checked={remote}
					onChange={onRemote}
				/>
				<ToggleRow
					label="Open to relocating"
					checked={relocate}
					onChange={onRelocate}
				/>
			</div>
		</div>
	);
}

function ToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between rounded-[16px] border border-[#0E1420]/10 bg-white px-4 py-3.5">
			<span className="font-bold text-[#0E1420] text-[13px]">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				onClick={() => onChange(!checked)}
				className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${selectableRing()} motion-reduce:transition-none`}
				style={{
					backgroundColor: checked ? TEAL : "rgba(14,20,32,0.12)",
				}}
			>
				<span
					className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none"
					style={{
						transform: checked ? "translateX(22px)" : "translateX(2px)",
					}}
				/>
			</button>
		</div>
	);
}

function StepLearnFormat({
	value,
	onToggle,
}: {
	value: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="How you take it in"
				headline="How do you like to learn?"
				sub="Pick any that fit."
			/>
			<div className="flex flex-wrap gap-2">
				{CONTENT_FORMATS.map((opt) => {
					const selected = value.includes(opt.id);
					return (
						<button
							key={opt.id}
							type="button"
							aria-pressed={selected}
							onClick={() => onToggle(opt.id)}
							className={`cursor-pointer rounded-full border px-4 py-2.5 font-bold text-[12px] transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={
								selected
									? {
											backgroundColor: "rgba(62,207,191,0.14)",
											borderColor: "rgba(62,207,191,0.55)",
											color: "#0A8F7F",
										}
									: {
											backgroundColor: "#ffffff",
											borderColor: "rgba(14,20,32,0.12)",
											color: "rgba(14,20,32,0.55)",
										}
							}
						>
							{opt.label}
						</button>
					);
				})}
			</div>
			<p className="mt-4 text-center text-[#0E1420]/55 text-[11px]">
				<span style={{ color: value.length > 0 ? "#0A8F7F" : undefined }}>
					{value.length}
				</span>{" "}
				selected
			</p>
		</div>
	);
}

function StepEducation({
	value,
	onSelect,
}: {
	value: string | null;
	onSelect: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Your background"
				headline="Where are you in your education?"
				sub="So every scholarship you see is one you can get."
			/>
			<div className="flex flex-col gap-2">
				{EDUCATION_LEVELS.map((opt) => {
					const selected = value === opt.value;
					return (
						<button
							key={opt.value}
							type="button"
							aria-pressed={selected}
							onClick={() => onSelect(opt.value)}
							className={`relative flex items-center gap-4 rounded-[16px] border-[1.5px] p-4 text-left transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={{
								backgroundColor: selected ? "rgba(245,200,66,0.10)" : "#ffffff",
								borderColor: selected ? GOLD : "rgba(14,20,32,0.12)",
							}}
						>
							<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F4F7FC]">
								<Icon name="book" color="rgba(14,20,32,0.55)" size={18} />
							</span>
							<span className="flex-1">
								<span className="block font-black text-[#0E1420] text-[14px]">
									{opt.value}
								</span>
								<span className="mt-0.5 block text-[#0E1420]/55 text-[11px]">
									{opt.sub}
								</span>
							</span>
							{selected && <CheckBadge color={GOLD} size={22} />}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function StepFocus({
	value,
	onToggle,
}: {
	value: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="What matters to you"
				headline="What matters right now?"
				sub="Pick up to three. North points itself at these."
			/>
			<div className="grid grid-cols-2 gap-3">
				{FOCUS_AREAS.map((area) => {
					const m = FOCUS_META[area.id];
					const order = value.indexOf(area.id);
					const selected = order >= 0;
					return (
						<button
							key={area.id}
							type="button"
							aria-pressed={selected}
							onClick={() => onToggle(area.id)}
							className={`relative flex cursor-pointer flex-col items-start gap-2.5 rounded-[18px] border-[1.5px] p-4 text-left transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={{
								backgroundColor: selected ? "rgba(245,200,66,0.08)" : "#ffffff",
								borderColor: selected ? GOLD : "rgba(14,20,32,0.12)",
							}}
						>
							{selected && (
								// Pick order, not a checkmark — the first pick leads the
								// personalisation (it becomes topFocusId downstream).
								<span
									className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full font-black text-[#05050E] text-[11px]"
									style={{ backgroundColor: GOLD }}
								>
									{order + 1}
								</span>
							)}
							<FocusGlyph
								id={area.id}
								color={selected ? "#8A6A00" : "rgba(14,20,32,0.72)"}
							/>
							<span className="font-black text-[#0E1420] text-[13px]">
								{m.name}
							</span>
							<span className="text-[#0E1420]/55 text-[10px]">{m.desc}</span>
						</button>
					);
				})}
			</div>
			<p className="mt-3 text-center text-[#0E1420]/55 text-[11px]">
				<span style={{ color: value.length > 0 ? "#8A6A00" : undefined }}>
					{value.length}
				</span>{" "}
				of 3 selected
				{value.length > 1 && " · your first pick leads"}
			</p>
		</div>
	);
}

function StepInterests({
	value,
	onToggle,
	other,
	onOther,
}: {
	value: string[];
	onToggle: (id: string) => void;
	other: string;
	onOther: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="The real you"
				headline="What do you love outside work?"
				sub="This unlocks the unexpected — residencies, grants, open calls."
			/>
			<div className="flex flex-wrap gap-2">
				{INTEREST_OPTIONS.map((label) => {
					const selected = value.includes(label);
					return (
						<button
							key={label}
							type="button"
							aria-pressed={selected}
							onClick={() => onToggle(label)}
							className={`cursor-pointer rounded-full border px-4 py-2.5 font-bold text-[12px] transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={
								selected
									? {
											backgroundColor: "rgba(14,20,32,0.06)",
											borderColor: "rgba(14,20,32,0.45)",
											color: "#0E1420",
										}
									: {
											backgroundColor: "#ffffff",
											borderColor: "rgba(14,20,32,0.12)",
											color: "rgba(14,20,32,0.55)",
										}
							}
						>
							{label}
						</button>
					);
				})}
			</div>
			<label htmlFor="onb-interest-other" className="sr-only">
				Other interests
			</label>
			<input
				id="onb-interest-other"
				value={other}
				onChange={(e) => onOther(e.target.value)}
				placeholder="Anything else? e.g. chess, birdwatching"
				className="mt-3 w-full rounded-[14px] border border-[#0E1420]/10 bg-white px-4 py-3 font-medium text-[#0E1420] text-[14px] outline-none transition-all placeholder:text-[#0E1420]/35 focus:border-[#0E1420]/40"
			/>
		</div>
	);
}

function StepDirection({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Your direction"
				headline="Who do you want to become?"
				sub="A line is plenty."
			/>
			<label htmlFor="onb-direction" className="sr-only">
				Who you want to become
			</label>
			<textarea
				id="onb-direction"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				maxLength={200}
				placeholder="e.g. a self-taught designer building a studio of my own"
				className="h-[110px] w-full resize-none rounded-[14px] border border-[#0E1420]/10 bg-white px-4 py-3.5 font-medium text-[#0E1420] text-[14px] outline-none transition-all placeholder:text-[#0E1420]/35 focus:border-[#F5C842] focus:bg-[rgba(245,200,66,0.04)]"
			/>
		</div>
	);
}

function StepTime({
	value,
	onSelect,
}: {
	value: string | null;
	onSelect: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Your real life"
				headline="How much time on a real day?"
				sub="Be honest. North works with what you have."
			/>
			<div className="flex flex-col gap-2">
				{TIME_OPTIONS.map((opt) => {
					const selected = value === opt.value;
					return (
						<button
							key={opt.value}
							type="button"
							aria-pressed={selected}
							onClick={() => onSelect(opt.value)}
							className={`relative flex items-center gap-4 rounded-[16px] border-[1.5px] p-4 text-left transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={{
								backgroundColor: selected ? "rgba(245,200,66,0.10)" : "#ffffff",
								borderColor: selected ? GOLD : "rgba(14,20,32,0.12)",
							}}
						>
							<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F4F7FC]">
								<Icon name="clock" color="rgba(14,20,32,0.55)" size={18} />
							</span>
							<span className="flex-1">
								<span className="block font-black text-[#0E1420] text-[14px]">
									{opt.value}
								</span>
								<span className="mt-0.5 block text-[#0E1420]/55 text-[11px]">
									{opt.sub}
								</span>
							</span>
							{selected && <CheckBadge color={GOLD} size={22} />}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function StepPurpose({
	value,
	onSelect,
}: {
	value: string | null;
	onSelect: (v: string) => void;
}) {
	const chosen = PURPOSE_OPTIONS.find((o) => o.id === value) ?? null;
	return (
		<div>
			<StepHead
				eyebrow="Who you are here"
				headline="Do you already know your purpose?"
				sub="No wrong answer."
			/>
			<div className="flex flex-col gap-3">
				{PURPOSE_OPTIONS.map((opt) => {
					const selected = value === opt.id;
					return (
						<button
							key={opt.id}
							type="button"
							aria-pressed={selected}
							onClick={() => onSelect(opt.id)}
							className={`relative flex items-center gap-4 rounded-[20px] border-[1.5px] p-5 text-left transition-all hover:bg-[#F4F7FC] ${selectableRing()} motion-reduce:transition-none`}
							style={{
								backgroundColor: selected ? `${opt.color}1A` : "#ffffff",
								borderColor: selected ? opt.color : "rgba(14,20,32,0.12)",
							}}
						>
							{/* Ringed medallion: the mark they're choosing to wear. */}
							<span
								className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none"
								style={{
									background: `${opt.color}24`,
									border: `1.5px solid ${opt.color}${selected ? "" : "80"}`,
									transform: selected ? "scale(1.04)" : "scale(1)",
								}}
							>
								<span
									aria-hidden="true"
									className="absolute inset-[6px] rounded-full"
									style={{ border: `1px solid ${opt.color}59` }}
								/>
								<Icon name={opt.icon} color={opt.color} size={24} />
							</span>
							<span className="flex-1 pr-6">
								<span className="block font-black text-[#0E1420] text-[17px] tracking-tight">
									{opt.title}
								</span>
								<span className="mt-1 block text-[#0E1420]/60 text-[12px] leading-relaxed">
									{opt.creed}
								</span>
							</span>
							{selected && <CheckBadge color={opt.color} size={24} />}
						</button>
					);
				})}
			</div>

			{/* The seal: a quiet line of standing that appears once they choose. */}
			{chosen && (
				<p
					key={chosen.id}
					className="seal-in mt-5 flex items-center justify-center gap-2 text-center font-bold text-[12px] tracking-tight"
					style={{ color: chosen.color === GOLD ? "#8A6A00" : "#0A8F7F" }}
					aria-live="polite"
				>
					<Icon
						name={chosen.icon}
						color={chosen.color === GOLD ? "#8A6A00" : "#0A8F7F"}
						size={15}
					/>
					{chosen.sealed}
				</p>
			)}
		</div>
	);
}

function StepAspiration({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="What you're aiming for"
				headline="What do you want to make real this year?"
				sub="One thing. Big or small."
			/>
			<label htmlFor="onb-aspiration" className="sr-only">
				What you most want to make real this year
			</label>
			<textarea
				id="onb-aspiration"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				maxLength={160}
				placeholder="e.g. land my first role in design"
				className="h-[110px] w-full resize-none rounded-[14px] border border-[#0E1420]/10 bg-white px-4 py-3.5 font-medium text-[#0E1420] text-[14px] outline-none transition-all placeholder:text-[#0E1420]/35 focus:border-[#F5C842] focus:bg-[rgba(245,200,66,0.04)]"
			/>
		</div>
	);
}

const GENDER_OPTIONS = ["Man", "Woman", "Non-binary", "Prefer not to say"];

const RACE_OPTIONS = [
	"Black / African descent",
	"White / European descent",
	"Asian",
	"Hispanic / Latino",
	"Middle Eastern / North African",
	"Mixed / Multiracial",
	"Indigenous",
	"Prefer not to say",
];

function StepDemographics({
	gender,
	race,
	onGender,
	onRace,
}: {
	gender: string;
	race: string;
	onGender: (v: string) => void;
	onRace: (v: string) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="Who you are"
				headline="A little more about you."
				sub="Optional, and never shown publicly."
			/>
			<div className="mb-6">
				<p className="mb-3 font-semibold text-[#0E1420]/70 text-[12px] uppercase tracking-[0.1em]">
					Gender
				</p>
				<div className="flex flex-wrap gap-2">
					{GENDER_OPTIONS.map((opt) => (
						<button
							key={opt}
							type="button"
							onClick={() => onGender(gender === opt ? "" : opt)}
							className="cursor-pointer rounded-full border px-4 py-2.5 font-semibold text-[13px] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3ECFBF] motion-reduce:transition-none"
							style={
								gender === opt
									? {
											backgroundColor: "rgba(62,207,191,0.12)",
											borderColor: "rgba(62,207,191,0.5)",
											color: "#0A8F7F",
										}
									: {
											backgroundColor: "#FFFFFF",
											borderColor: "rgba(14,20,32,0.10)",
											color: "rgba(14,20,32,0.65)",
										}
							}
						>
							{opt}
						</button>
					))}
				</div>
			</div>
			<div>
				<p className="mb-3 font-semibold text-[#0E1420]/70 text-[12px] uppercase tracking-[0.1em]">
					Race / Ethnicity
				</p>
				<div className="flex flex-wrap gap-2">
					{RACE_OPTIONS.map((opt) => (
						<button
							key={opt}
							type="button"
							onClick={() => onRace(race === opt ? "" : opt)}
							className="cursor-pointer rounded-full border px-4 py-2.5 font-semibold text-[13px] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3ECFBF] motion-reduce:transition-none"
							style={
								race === opt
									? {
											backgroundColor: "rgba(62,207,191,0.12)",
											borderColor: "rgba(62,207,191,0.5)",
											color: "#0A8F7F",
										}
									: {
											backgroundColor: "#FFFFFF",
											borderColor: "rgba(14,20,32,0.10)",
											color: "rgba(14,20,32,0.65)",
										}
							}
						>
							{opt}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

function StepConsent({
	consent,
	onConsent,
}: {
	consent: boolean;
	onConsent: (v: boolean) => void;
}) {
	return (
		<div>
			<StepHead
				eyebrow="One last thing"
				headline="North learns from how you show up."
				sub="To personalise your Signal score and surface better opportunities, North tracks your in-app behaviour: tasks completed, content engaged with, and time patterns. This data never leaves North and is never sold."
			/>
			<div className="mb-6 rounded-[16px] border border-[#0E1420]/10 bg-white p-4">
				<div className="flex flex-col gap-3">
					{CONSENT_ROWS.map((row) => (
						<div key={row} className="flex items-start gap-3">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#0A8F7F"
								strokeWidth={2.5}
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
								className="mt-0.5 shrink-0"
							>
								<circle cx="12" cy="12" r="10" />
								<path d="m9 12 2 2 4-4" />
							</svg>
							<p className="text-[#0E1420]/70 text-[12px] leading-relaxed">
								{row}
							</p>
						</div>
					))}
				</div>
			</div>

			<div className="flex items-center justify-between rounded-[16px] border border-[#0E1420]/10 bg-white px-4 py-3.5">
				<span className="font-bold text-[#0E1420] text-[13px]">
					I agree to behavioural data collection
				</span>
				<button
					type="button"
					role="switch"
					aria-checked={consent}
					aria-label="Agree to behavioural data collection"
					onClick={() => onConsent(!consent)}
					className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${selectableRing()} motion-reduce:transition-none`}
					style={{
						backgroundColor: consent ? TEAL : "rgba(14,20,32,0.12)",
					}}
				>
					<span
						className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none"
						style={{
							transform: consent ? "translateX(22px)" : "translateX(2px)",
						}}
					/>
				</button>
			</div>
			<p className="mt-4 text-[#0E1420]/50 text-[10px] leading-relaxed">
				Governed by the Jamaica Data Protection Act 2020. Withdraw by deleting
				your account, which erases all behavioural data.
			</p>
		</div>
	);
}

// ── Icons ────────────────────────────────────────────────────────────────────

// ── Focus glyphs — North's own wayfinding set, drawn on one grammar ─────────
// 24-grid, single stroke weight, round caps. Each focus area is an artifact
// from the trail: nib laying a stroke (craft), planted flag (venture), cairn
// (mind — steady), bridge (people — connect), kite (money — free), plumb
// line sounding the depth (learn — go deep).
const FOCUS_GLYPHS: Record<string, React.ReactNode> = {
	craft: (
		<>
			<path d="M7.5 4h9v4c0 1.5-.3 2.8-1.1 4.1L12 17.5l-3.4-5.4C7.8 10.8 7.5 9.5 7.5 8V4Z" />
			<path d="M12 17.5v-5" />
			<circle cx="12" cy="10.5" r="0.4" />
			<path d="M6 20.8c4 .8 8 .6 12-.6" />
		</>
	),
	venture: (
		<>
			<path d="M7 21V4" />
			<path d="M7 4.8c2.8-1.6 5.6 1.6 8.5 0v6c-2.9 1.6-5.7-1.6-8.5 0" />
			<path d="M4.5 21h5" />
		</>
	),
	mind: (
		<>
			<ellipse cx="12" cy="5.4" rx="2.5" ry="2.1" />
			<ellipse cx="12" cy="11" rx="4" ry="2.5" />
			<ellipse cx="12" cy="17.5" rx="5.6" ry="3" />
		</>
	),
	people: (
		<>
			<path d="M2.5 9h19" />
			<path d="M5.5 16.5c0-4 2.9-6.5 6.5-6.5s6.5 2.5 6.5 6.5" />
			<path d="M2.5 16.5h3M18.5 16.5h3" />
			<path d="M4.5 20.5h15" />
		</>
	),
	money: (
		<>
			<path d="M12 3l5.5 6.5L12 16 6.5 9.5 12 3Z" />
			<path d="M12 3v13M6.5 9.5h11" />
			<path d="M12 16c-.4 2.6-2.3 3.6-4.8 4.5" />
		</>
	),
	learn: (
		<>
			<path d="M4 11.5h16" />
			<path d="M12 20V6.5" />
			<path d="M12 6.5c0-2.4 1.9-3.8 4.3-3.8 0 2.4-1.9 3.8-4.3 3.8Z" />
			<path d="M12 9.5c0-1.8-1.4-2.9-3.2-2.9 0 1.8 1.4 2.9 3.2 2.9Z" />
			<path d="M12 15.5c-2 .5-3.1 1.7-3.3 3.3" />
			<path d="M12 15.5c2 .5 3.1 1.7 3.3 3.3" />
		</>
	),
};

function FocusGlyph({
	id,
	color,
	size = 26,
}: {
	id: string;
	color: string;
	size?: number;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{FOCUS_GLYPHS[id]}
		</svg>
	);
}

const ICONS = {
	back: "M19 12H5M12 19l-7-7 7-7",
	compass: "",
	explore: "",
	pencil: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
	rocket:
		"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
	brain: "",
	users:
		"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
	chart: "M3 3v18h18M18 17V9M13 17V5M8 17v-3",
	book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
	clock: "M12 6v6l4 2",
} as const;

function Icon({
	name,
	color = "currentColor",
	size = 18,
}: {
	name: keyof typeof ICONS;
	color?: string;
	size?: number;
}) {
	const common = {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: color,
		strokeWidth: 2,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
		"aria-hidden": true,
	};
	if (name === "compass") {
		return (
			<svg {...common} aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
			</svg>
		);
	}
	if (name === "explore") {
		return (
			<svg {...common} aria-hidden="true">
				<circle cx="11" cy="11" r="8" />
				<path d="m21 21-4.35-4.35" />
			</svg>
		);
	}
	if (name === "brain") {
		return (
			<svg {...common} aria-hidden="true">
				<path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0 3 3 0 0 0 2-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3z" />
				<path d="M12 5v14" />
			</svg>
		);
	}
	if (name === "clock") {
		return (
			<svg {...common} aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<path d={ICONS.clock} />
			</svg>
		);
	}
	return (
		<svg {...common} aria-hidden="true">
			<path d={ICONS[name]} />
		</svg>
	);
}

const ANIM = `
@keyframes stepIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.step-in { animation: stepIn 400ms cubic-bezier(0.16,1,0.3,1); }
@keyframes sealIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.seal-in { animation: sealIn 420ms cubic-bezier(0.16,1,0.3,1); }
@media (prefers-reduced-motion: reduce) { .step-in, .seal-in { animation: none; } }
`;
