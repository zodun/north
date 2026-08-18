"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IdentityCrest } from "@/components/product/identity-crest";
import { coverUrl } from "@/lib/article-image/cover";
import { supabase } from "@/lib/auth-client";
import { proxiedImage } from "@/lib/img";
import type { PurposeMode } from "@/lib/purpose";

// ─────────────────────────────────────────────────────────────────────────────
// For You, "Sleek Light" (Stitch: Elite Interface Design).
//
// The owner chose to keep this design's literal blue/glass skin (#005ac2 primary,
// Sora + Libre Caslon, glass panels + drop shadows) rather than port it to North's
// Soft Sky tokens. Unlike the earlier verbatim paste, this version is WIRED:
//   • hero  → the AI's #1 personalised content_item (with its reason)
//   • cards → real content_items from the feed query
//   • Save / Share → real content_interactions + navigator.share
// Layout is made responsive so it functions as a PWA: the desktop sidebar
// collapses under `lg`, and navigation falls to the app's bottom tab bar.
// The mockup's "Mentorship Match" + "Masterclass" bento cards are replaced with
// two real North surfaces: a Today's Focus card (monthly mission + step
// progress → /mission) and a Featured Opportunity card (→ opportunity link).
// ─────────────────────────────────────────────────────────────────────────────

export type Item = {
	id: string;
	kind: string;
	title: string;
	eyebrow: string | null;
	body: string | null;
	source: string | null;
	external_url: string | null;
	cloudinary_public_id: string | null;
	thumbnail_url: string | null;
	content_category_id: string | null;
	published_at: string;
	why?: string | null;
	saves_count?: number | null;
};
type Category = { id: string; label: string };
export type MissionBlock = {
	title: string;
	intent: string | null;
	done: number;
	total: number;
};
export type OpportunityBlock = {
	id: string;
	title: string;
	org: string | null;
	opportunity_type: string | null;
	location: string | null;
	deadlineLabel: string | null;
	external_url: string | null;
};

// ── Mockup palette (verbatim from the Stitch export) ─────────────────────────
const PRIMARY = "#005ac2";
const SECONDARY = "#ee9800";
const ERROR = "#ba1a1a";
const ON_SURFACE = "#131313";
const ON_VARIANT = "#424754";
const SERIF = "'Libre Caslon Text', Georgia, serif";
const SANS = "'Sora', system-ui, sans-serif";

// Google Fonts sheets. Rendered as hoisted <link> tags (see render) so they land
// in <head> in the server HTML on every load. Icon font uses display=block so no
// fallback ligature text shows before it loads.
const FONT_SHEET =
	"https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap";
const ICON_SHEET =
	"https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block";

// Hero accent by category/eyebrow, tints the hero's aurora so each featured
// pick feels distinct. Falls back to the primary blue.
const HERO_ACCENT: Record<string, string> = {
	Money: "#3ECFBF",
	Skills: "#ff9d2e",
	Mindset: "#7B61FF",
	Career: "#F5C842",
	Entrepreneurship: "#4d8eff",
	Networking: "#5ea0ff",
};

// ── Kind → presentation ──────────────────────────────────────────────────────
type KindConf = {
	tag: string;
	icon: string;
	color: string;
	cta: string;
	playable: boolean;
};
const KIND: Record<string, KindConf> = {
	essay: {
		tag: "ARTICLE",
		icon: "article",
		color: PRIMARY,
		cta: "Read",
		playable: false,
	},
	story: {
		tag: "ARTICLE",
		icon: "article",
		color: PRIMARY,
		cta: "Read",
		playable: false,
	},
	opportunity: {
		tag: "OPPORTUNITY",
		icon: "trending_up",
		color: PRIMARY,
		cta: "Open",
		playable: false,
	},
	video: {
		tag: "VIDEO",
		icon: "movie",
		color: ERROR,
		cta: "Watch",
		playable: true,
	},
	voice: {
		tag: "PODCAST",
		icon: "mic",
		color: SECONDARY,
		cta: "Listen",
		playable: true,
	},
};
function kindConf(kind: string): KindConf {
	return KIND[kind] ?? KIND.essay;
}

function readMinutes(body: string | null): number | null {
	if (!body) return null;
	const words = body.trim().split(/\s+/).length;
	return Math.max(1, Math.round(words / 200));
}
function youtubeThumbnail(url: string): string | null {
	const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
	return m ? `https://img.youtube.com/vi/${m[1]}/maxresdefault.jpg` : null;
}
// Article bodies can be stored as HTML (e.g. "<p>Type <strong>…</strong></p>").
// Card/hero previews are plain text, so strip tags + common entities and the
// em/en dashes before showing, or the raw markup leaks onto the page.
// Video sources (YouTube/TED) tack channel metadata onto titles, e.g.
// "The Invisible Infrastructure in the Sky | Adam Bry | TED". That clutters the
// card and gets clamped mid-suffix, so strip the trailing channel noise and
// keep the real title (the leading segment). Conservative: only collapses to
// the first segment when the tail is a known publisher, so legitimate titles
// that happen to contain a pipe are left alone.
// Decode the HTML entities that creep in from external sources. Video titles
// from YouTube/TED arrive escaped ("Why I quit a &quot;Stable&quot; job"), so
// without this the raw &quot; / &#39; / &amp; leak onto the card. Ampersand is
// decoded first so a double-encoded "&amp;quot;" still resolves to a real quote.
function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;|&#34;/g, '"')
		.replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'");
}

function cleanTitle(title: string): string {
	let s = decodeEntities(title)
		.replace(/\s*[-–—]\s*YouTube\s*$/i, "")
		.trim();
	if (
		s.includes("|") &&
		/\|\s*(TEDx?|TED-?Ed|TED|YouTube|NPR|WIRED|Bloomberg)\s*$/i.test(s)
	) {
		s = (s.split("|")[0] ?? s).trim();
	}
	return s.replace(/\s*[—–]\s*/g, ", ").trim();
}

function plainText(body: string): string {
	return decodeEntities(body.replace(/<[^>]*>/g, " "))
		.replace(/\s*[—–]\s*/g, ", ")
		.replace(/\s+/g, " ")
		.trim();
}

// Shared image resolution: db thumbnail → YouTube thumb → OG image (lazy) →
// deterministic on-brand cover. Mirrors feed.tsx so every card always shows art.
function useArticleImage(item: Item, categoryLabel: string | null) {
	const fallback = coverUrl({
		id: item.id,
		category: categoryLabel ?? item.eyebrow,
	});
	// Treat blank/whitespace as absent: the DB stores empty-string thumbnails for
	// imageless rows, and `??` would let "" through (→ <img src=""> blank card).
	const thumb = item.thumbnail_url?.trim() || null;
	const ext = item.external_url?.trim() || null;
	const yt = ext ? youtubeThumbnail(ext) : null;
	const canFetch = !thumb && !yt && Boolean(ext);
	// Always start with fallback so every card shows art immediately; OG fetch
	// replaces it when it resolves.
	const initial = thumb ?? yt ?? fallback;
	const [src, setSrc] = useState<string | null>(initial);
	const [phase, setPhase] = useState<"have" | "idle" | "loading" | "done">(
		canFetch ? "idle" : "have",
	);
	const ref = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!canFetch || phase !== "idle") return;
		const el = ref.current;
		if (!el) return;
		const ctrl = new AbortController();
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				io.disconnect();
				setPhase("loading");
				fetch(`/api/og-image?url=${encodeURIComponent(ext ?? "")}`, {
					signal: ctrl.signal,
				})
					.then((r) =>
						r.ok && r.headers.get("content-type")?.includes("json")
							? r.json()
							: null,
					)
					.then((d: { imageUrl?: string | null } | null) =>
						setSrc(d?.imageUrl ?? fallback),
					)
					.catch(() => setSrc(fallback))
					.finally(() => setPhase("done"));
			},
			{ rootMargin: "200% 0px" },
		);
		io.observe(el);
		return () => {
			io.disconnect();
			ctrl.abort();
		};
	}, [canFetch, phase, ext, fallback]);

	const onError = useCallback(() => {
		setSrc((cur) => {
			if (cur?.includes("maxresdefault"))
				return cur.replace("maxresdefault", "hqdefault");
			if (cur && !cur.includes("/api/cover")) return fallback;
			return cur;
		});
	}, [fallback]);

	return { src, ref, loading: phase === "loading", onError };
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export function SleekForYou({
	items,
	categories,
	initialSaved,
	preview = false,
	aspiration = null,
	purposeMode = null,
	mission = null,
	opportunity = null,
}: {
	items: Item[];
	categories: Category[];
	initialSaved: string[];
	preview?: boolean;
	aspiration?: string | null;
	purposeMode?: PurposeMode | null;
	mission?: MissionBlock | null;
	opportunity?: OpportunityBlock | null;
}) {
	const [saved, setSaved] = useState<Set<string>>(new Set(initialSaved));
	const [toast, setToast] = useState<string | null>(null);
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Fonts are loaded via hoisted <link> tags in the JSX below (React moves them
	// to <head> and server-renders them), so they're in the initial HTML on every
	// visit instead of being injected after hydration. That removes the flash
	// where the headline showed in a fallback serif and icons were blank before
	// snapping to the mockup look each time you re-entered the page.

	function flashToast(msg: string) {
		setToast(msg);
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(null), 2000);
	}

	const catLabel = (item: Item) =>
		categories.find((c) => c.id === item.content_category_id)?.label ??
		item.eyebrow;

	async function save(item: Item) {
		if (saved.has(item.id)) return;
		setSaved((prev) => new Set([...prev, item.id]));
		flashToast("Saved to your profile");
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (!user) return;
		await supabase.from("content_interactions").insert({
			user_id: user.id,
			content_item_id: item.id,
			action: "save",
			content_category_id: item.content_category_id,
			kind: item.kind,
		});
	}

	async function share(item: Item) {
		const url = item.external_url ?? window.location.href;
		try {
			if (navigator.share)
				await navigator.share({ title: cleanTitle(item.title), url });
			else {
				await navigator.clipboard?.writeText(url);
				flashToast("Link copied");
			}
		} catch {
			/* user cancelled share */
		}
	}

	const hero = items[0] ?? null;
	// Dashboard, not a feed: a single trimmed row of recommendations (6) rather
	// than the full content pool. The left rail is the focus of the screen.
	const rest = items.slice(1, 7);

	return (
		<div
			style={{
				background: "#F8F9FA",
				color: ON_SURFACE,
				fontFamily: SANS,
				minHeight: "100%",
			}}
		>
			{/* Hoisted to <head> by React and server-rendered, so the Stitch fonts
			    are present in the initial HTML on every visit (no post-hydration
			    flash). preconnect speeds the font-file fetch. */}
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			<link
				rel="preconnect"
				href="https://fonts.gstatic.com"
				crossOrigin="anonymous"
			/>
			<link rel="stylesheet" href={FONT_SHEET} precedence="default" />
			<link rel="stylesheet" href={ICON_SHEET} precedence="default" />
			<style>{SCOPED_CSS}</style>

			<div>
				<SidebarNav />

				<div className="sleek-main min-w-0 md:ml-[280px]">
					<TopBar />

					<main className="mx-auto max-w-[1200px] px-5 pt-6 pb-24 sm:px-6 lg:px-8">
						{purposeMode && (
							<div className="mb-5 flex items-center gap-3 border-black/5 border-b pb-4">
								<IdentityCrest mode={purposeMode} variant="compact" />
							</div>
						)}
						{hero ? (
							<Hero
								item={hero}
								categoryLabel={catLabel(hero)}
								aspiration={aspiration}
								onRead={() => void share(hero)}
							/>
						) : (
							<EmptyState />
						)}

						{(mission || opportunity) && (
							<section className="mt-10 grid grid-cols-12 gap-8 lg:mt-12">
								{mission && <MissionCard mission={mission} />}
								{opportunity && <OpportunityCard opportunity={opportunity} />}
							</section>
						)}

						{rest.length > 0 && (
							<section className="mt-8 lg:mt-10">
								<div className="mb-6 flex items-end justify-between">
									<div>
										<h3
											className="font-bold text-2xl tracking-tight lg:text-[32px]"
											style={{ fontFamily: SERIF, color: ON_SURFACE }}
										>
											Recommended Growth
										</h3>
										<p
											className="mt-1 text-sm"
											style={{ color: ON_VARIANT, opacity: 0.7 }}
										>
											Curated for your current trajectory.
										</p>
									</div>
									{preview && (
										<a
											href="/api/billing/checkout"
											className="hidden shrink-0 rounded-xl border-2 px-5 py-2.5 font-bold text-xs uppercase tracking-wider transition-all hover:bg-black/5 sm:block"
											style={{ borderColor: PRIMARY, color: PRIMARY }}
										>
											Unlock full ranking
										</a>
									)}
								</div>

								<div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
									{rest.map((item) => (
										<GrowthCard
											key={item.id}
											item={item}
											categoryLabel={catLabel(item)}
											isSaved={saved.has(item.id)}
											onSave={() => void save(item)}
											onShare={() => void share(item)}
										/>
									))}
								</div>

								{/* A single sponsored slot at the end of the feed. */}
								<FeedEndAd />
							</section>
						)}
					</main>
				</div>
			</div>

			{toast && (
				<div
					aria-live="polite"
					className="sleek-toast pointer-events-none fixed bottom-[88px] left-1/2 z-50 flex items-center gap-2 rounded-xl px-4 py-3 font-semibold text-xs"
					style={{ background: ON_SURFACE, color: "#fff" }}
				>
					<span
						className="material-symbols-outlined text-base"
						style={{ fontVariationSettings: "'FILL' 1" }}
					>
						bookmark
					</span>
					{toast}
				</div>
			)}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero, featured insight (the personalised #1 pick)
// ─────────────────────────────────────────────────────────────────────────────

function Hero({
	item,
	categoryLabel,
	aspiration,
	onRead,
}: {
	item: Item;
	categoryLabel: string | null;
	aspiration: string | null;
	onRead: () => void;
}) {
	const conf = kindConf(item.kind);
	const { src: heroImg, onError: heroImgError } = useArticleImage(
		item,
		categoryLabel,
	);
	const accent = HERO_ACCENT[(categoryLabel ?? "").trim()] ?? "#4d8eff";
	const why = (
		item.why ??
		(aspiration?.trim()
			? `You said this matters: ${aspiration.trim()}. One step toward it today.`
			: "Chosen for the direction you set in North.")
	).replace(/\s*[—–]\s*/g, ", ");

	return (
		<section className="group relative mt-6 h-[420px] w-full overflow-hidden rounded-[2rem] shadow-2xl shadow-black/20 sm:h-[480px] lg:h-[540px]">
			<div
				className="absolute inset-0 z-0 overflow-hidden"
				style={{
					background:
						"linear-gradient(135deg, #06224d 0%, #001233 58%, #00081c 100%)",
				}}
			>
				{heroImg && (
					// biome-ignore lint/performance/noImgElement: hero background photo, dynamic
					<img
						src={proxiedImage(heroImg)}
						alt=""
						onError={heroImgError}
						className="absolute inset-0 h-full w-full object-cover opacity-35 transition-opacity duration-700"
					/>
				)}
				<div
					className="hero-blob hero-blob--a"
					style={{
						background: `radial-gradient(circle at 50% 50%, ${accent}66, transparent 62%)`,
					}}
				/>
				<div className="hero-blob hero-blob--b" />
				<div className="hero-blob hero-blob--c" />
				<span className="hero-star" style={{ top: "20%", left: "26%" }} />
				<span
					className="hero-star"
					style={{ top: "32%", left: "68%", animationDelay: "1.2s" }}
				/>
				<span
					className="hero-star"
					style={{ top: "60%", left: "38%", animationDelay: "2.1s" }}
				/>
				<span
					className="hero-star"
					style={{ top: "46%", left: "84%", animationDelay: "0.6s" }}
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
				<div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-transparent" />
			</div>

			<div className="relative z-10 flex h-full max-w-3xl flex-col justify-end p-7 sm:p-10 lg:p-16">
				<div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 backdrop-blur-md">
					<span
						className="h-2 w-2 animate-pulse rounded-full"
						style={{ background: SECONDARY }}
					/>
					<span className="font-bold text-[11px] text-white uppercase tracking-[0.18em]">
						{categoryLabel ? `Featured · ${categoryLabel}` : "Featured insight"}
					</span>
				</div>

				<h2
					className="mb-4 line-clamp-3 text-[30px] text-white leading-[1.08] tracking-tight sm:text-[42px] lg:text-[56px] lg:leading-[1.04]"
					style={{ fontFamily: SERIF, fontWeight: 700 }}
				>
					{cleanTitle(item.title)}
				</h2>

				{item.body && (
					<p className="mb-7 max-w-xl font-light text-base text-white/85 leading-relaxed sm:text-lg">
						{plainText(item.body).slice(0, 180)}
						{plainText(item.body).length > 180 ? "…" : ""}
					</p>
				)}

				<div className="flex flex-wrap items-center gap-5">
					{item.external_url ? (
						<a
							href={item.external_url}
							target="_blank"
							rel="noopener noreferrer"
							className="rounded-xl bg-white px-8 py-3.5 font-bold text-sm uppercase tracking-wider shadow-black/20 shadow-xl transition-all hover:bg-white/90"
							style={{ color: ON_SURFACE }}
						>
							{conf.cta}
						</a>
					) : null}
					<button
						type="button"
						onClick={onRead}
						className="flex items-center gap-2 font-bold text-white/70 text-xs uppercase tracking-widest transition-colors hover:text-white"
					>
						<span className="material-symbols-outlined text-lg">ios_share</span>
						Share
					</button>
				</div>

				<p className="mt-5 max-w-md text-[13px] text-white/60 leading-relaxed">
					{why}
				</p>
			</div>
		</section>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Growth card
// ─────────────────────────────────────────────────────────────────────────────

function GrowthCard({
	item,
	categoryLabel,
	isSaved,
	onSave,
	onShare,
}: {
	item: Item;
	categoryLabel: string | null;
	isSaved: boolean;
	onSave: () => void;
	onShare: () => void;
}) {
	const conf = kindConf(item.kind);
	const { src, ref, onError } = useArticleImage(item, categoryLabel);
	const mins = readMinutes(item.body);
	const badge = conf.playable
		? conf.cta.toUpperCase()
		: mins
			? `${mins} MIN READ`
			: conf.cta.toUpperCase();

	const media = (
		<>
			<div className="relative h-56 overflow-hidden">
				{src && (
					// biome-ignore lint/performance/noImgElement: remote card image, dynamic dimensions
					<img
						src={proxiedImage(src)}
						alt=""
						onError={onError}
						loading="lazy"
						className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
					/>
				)}
				{conf.playable && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
						<span
							className="material-symbols-outlined text-6xl text-white"
							style={{ fontVariationSettings: "'FILL' 1" }}
						>
							play_circle
						</span>
					</div>
				)}
				<div className="absolute top-3 right-3 rounded-md bg-white/95 px-2.5 py-1 shadow-sm backdrop-blur-md">
					<span
						className="font-black text-[10px] tracking-widest"
						style={{ color: ON_SURFACE }}
					>
						{badge}
					</span>
				</div>
			</div>

			<div className="flex flex-1 flex-col p-5">
				<div className="mb-3 flex items-center gap-2">
					<span
						className="material-symbols-outlined text-base"
						style={{ color: conf.color }}
					>
						{conf.icon}
					</span>
					<span
						className="font-black text-[10px] tracking-wider"
						style={{ color: conf.color }}
					>
						{conf.tag}
					</span>
				</div>
				<h4
					className="mb-2 line-clamp-2 font-bold text-lg leading-tight transition-colors"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					{cleanTitle(item.title)}
				</h4>
				{item.body && (
					<p
						className="line-clamp-2 text-sm leading-relaxed"
						style={{ color: ON_VARIANT, opacity: 0.75 }}
					>
						{plainText(item.body)}
					</p>
				)}
			</div>
		</>
	);

	return (
		<article
			ref={(el) => {
				ref.current = el;
			}}
			className="group flex flex-col overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-md transition-all duration-500 hover:border-black/10 hover:shadow-2xl"
		>
			{item.external_url ? (
				<a
					href={item.external_url}
					target="_blank"
					rel="noopener noreferrer"
					className="block cursor-pointer"
				>
					{media}
				</a>
			) : (
				<div className="block">{media}</div>
			)}

			<div className="flex items-center justify-between border-black/5 border-t px-5 py-3">
				<span
					className="font-medium text-[11px]"
					style={{ color: ON_VARIANT, opacity: 0.6 }}
				>
					{categoryLabel ?? ""}
				</span>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={onSave}
						aria-pressed={isSaved}
						aria-label={isSaved ? "Saved" : "Save"}
						className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-black/5"
					>
						<span
							className="material-symbols-outlined text-xl"
							style={{
								color: isSaved ? PRIMARY : ON_VARIANT,
								fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0",
							}}
						>
							bookmark
						</span>
					</button>
					<button
						type="button"
						onClick={onShare}
						aria-label="Share"
						className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-black/5"
					>
						<span
							className="material-symbols-outlined text-xl"
							style={{ color: ON_VARIANT }}
						>
							ios_share
						</span>
					</button>
				</div>
			</div>
		</article>
	);
}

// A single reserved "Sponsored · Coming soon" slot that closes the feed: a
// full-width strip below the grid, not woven inside it. Calm, dashed, no hard
// sell, on-brand with the calm field (direction over attention).
function FeedEndAd() {
	return (
		<div className="mt-8 flex flex-col items-center gap-4 rounded-[2rem] border border-black/[0.08] border-dashed bg-white/40 px-8 py-9 text-center sm:flex-row sm:justify-center sm:gap-6 sm:text-left">
			<span
				className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
				style={{ background: "rgba(62,207,191,0.12)" }}
			>
				<span
					className="material-symbols-outlined text-[26px]"
					style={{ color: "#0A8F7F" }}
				>
					near_me
				</span>
			</span>
			<div className="max-w-md">
				<span
					className="font-bold text-[10px] uppercase tracking-[0.22em]"
					style={{ color: ON_VARIANT, opacity: 0.5 }}
				>
					Sponsored · Coming soon
				</span>
				<h4
					className="mt-1 font-bold text-xl leading-snug tracking-tight"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					More offers, always in your direction
				</h4>
				<p
					className="mt-1.5 text-[13px] leading-relaxed"
					style={{ color: ON_VARIANT, opacity: 0.65 }}
				>
					As partners come on board, their offers will land here, ranked to your
					trajectory and clearly marked. Direction, never noise.
				</p>
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bento, Today's Focus (mission) + Featured Opportunity
// ─────────────────────────────────────────────────────────────────────────────

function MissionCard({ mission }: { mission: MissionBlock }) {
	const pct =
		mission.total > 0 ? Math.round((mission.done / mission.total) * 100) : 0;
	const intent = mission.intent?.replace(/\s*[—–]\s*/g, ", ") ?? null;
	return (
		<div className="col-span-12 flex flex-col rounded-[2rem] border border-black/5 bg-white p-8 shadow-md md:col-span-5">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<span
						className="mb-3 block font-bold text-[11px] uppercase tracking-[0.18em]"
						style={{ color: SECONDARY }}
					>
						Monthly focus
					</span>
					<h3
						className="font-bold text-2xl leading-tight tracking-tight"
						style={{ fontFamily: SERIF, color: ON_SURFACE }}
					>
						{mission.title}
					</h3>
				</div>
				<span
					className="material-symbols-outlined text-4xl"
					style={{ color: SECONDARY, opacity: 0.4 }}
				>
					target
				</span>
			</div>

			<div className="mb-6 rounded-2xl border border-black/5 bg-black/[0.03] p-5">
				{intent && (
					<p
						className="mb-4 text-sm leading-relaxed"
						style={{ color: ON_VARIANT }}
					>
						{intent}
					</p>
				)}
				<div
					className="flex items-center justify-between font-semibold text-xs"
					style={{ color: ON_VARIANT }}
				>
					<span>
						{mission.done} of {mission.total} steps
					</span>
					<span style={{ color: SECONDARY }}>{pct}%</span>
				</div>
				<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
					<div
						className="h-full rounded-full"
						style={{ width: `${pct}%`, background: SECONDARY }}
					/>
				</div>
			</div>

			<a
				href="/mission"
				className="mt-auto w-full rounded-xl py-4 text-center font-bold text-[#131313] text-xs uppercase tracking-wider transition-all hover:brightness-110"
				style={{ background: SECONDARY }}
			>
				Open mission
			</a>
		</div>
	);
}

function OppMeta({ icon, label }: { icon: string; label: string }) {
	return (
		<div
			className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider"
			style={{ color: ON_SURFACE }}
		>
			<span
				className="material-symbols-outlined text-lg"
				style={{ color: PRIMARY }}
			>
				{icon}
			</span>
			{label}
		</div>
	);
}

function OpportunityCard({ opportunity }: { opportunity: OpportunityBlock }) {
	const href = opportunity.external_url ?? "/opportunities";
	const external = Boolean(opportunity.external_url);
	const sub = [opportunity.org, opportunity.opportunity_type]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="col-span-12 flex flex-col gap-8 rounded-[2rem] border border-black/5 bg-white p-8 shadow-md md:col-span-7 lg:flex-row">
			<div className="flex flex-1 flex-col">
				<span
					className="mb-3 block font-bold text-[11px] uppercase tracking-[0.18em]"
					style={{ color: PRIMARY }}
				>
					Opportunity
				</span>
				<h3
					className="mb-3 line-clamp-2 font-bold text-2xl leading-tight tracking-tight"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					{opportunity.title}
				</h3>
				{sub && (
					<p
						className="mb-6 line-clamp-1 text-sm"
						style={{ color: ON_VARIANT, opacity: 0.75 }}
					>
						{sub}
					</p>
				)}
				<div className="mb-7 flex flex-wrap gap-5">
					{opportunity.location && (
						<OppMeta icon="location_on" label={opportunity.location} />
					)}
					{opportunity.deadlineLabel && (
						<OppMeta
							icon="calendar_today"
							label={`Closes ${opportunity.deadlineLabel}`}
						/>
					)}
				</div>
				<a
					href={href}
					{...(external
						? { target: "_blank", rel: "noopener noreferrer" }
						: {})}
					className="mt-auto w-fit rounded-xl border-2 px-8 py-3 font-bold text-xs uppercase tracking-wider transition-all hover:bg-black/5"
					style={{ borderColor: PRIMARY, color: PRIMARY }}
				>
					View opportunity
				</a>
			</div>
			<div
				className="flex h-44 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl lg:h-auto lg:w-60"
				style={{
					background:
						"linear-gradient(135deg, rgba(0,90,194,0.14), rgba(0,90,194,0.05))",
				}}
			>
				<span
					className="material-symbols-outlined"
					style={{ color: PRIMARY, fontSize: "3.5rem", opacity: 0.55 }}
				>
					trending_up
				</span>
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome, sidebar (desktop) + top bar
// ─────────────────────────────────────────────────────────────────────────────

const NAV = [
	{ href: "/for-you", label: "For You", icon: "auto_awesome" },
	{ href: "/mission", label: "Mission", icon: "target" },
	{ href: "/opportunities", label: "Opportunities", icon: "trending_up" },
	{ href: "/journal", label: "Journal", icon: "menu_book" },
	{ href: "/community", label: "Community", icon: "group" },
];

// Always-visible left nav: a slim icon rail on phones (64px) that expands to the
// full labelled 280px panel from `lg` up. Labels and the brand subtitle are
// `hidden lg:*`; every link keeps an aria-label so the rail stays accessible
// while collapsed. This is the focus of the screen, so the shell's bottom tab
// bar is suppressed on /for-you (see product-shell).
function SidebarNav() {
	return (
		<aside className="sleek-rail fixed top-0 left-0 z-50 h-full w-[280px] flex-col border-black/5 border-r bg-white/80 px-6 py-8 backdrop-blur-xl">
			<a
				href="/for-you"
				aria-label="North home"
				className="mb-8 flex items-center justify-center gap-3 md:mb-12 md:justify-start md:px-2"
			>
				<svg
					className="h-8 w-8 shrink-0 md:h-9 md:w-9"
					viewBox="0 0 100 100"
					fill={PRIMARY}
					aria-hidden="true"
				>
					<path d="M50 3 L58 42 L97 50 L58 58 L50 97 L42 58 L3 50 L42 42 Z" />
				</svg>
				<span
					className="hidden font-bold text-3xl leading-none tracking-tighter md:block"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					North
				</span>
			</a>

			<nav className="flex-1 space-y-1">
				{NAV.map((n, i) => {
					const active = i === 0;
					return (
						<a
							key={n.href}
							href={n.href}
							aria-label={n.label}
							aria-current={active ? "page" : undefined}
							className="flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-300"
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

			<div className="space-y-1 border-black/5 border-t pt-4 md:pt-8">
				<button
					type="button"
					onClick={() => toast("Premium is coming soon")}
					aria-label="Go Beyond, upgrade — coming soon"
					className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-0 py-3 text-center font-bold text-white text-xs uppercase tracking-wider shadow-lg transition-all hover:brightness-110 active:scale-[0.98] md:mt-6 md:px-6 md:py-4"
					style={{
						background: PRIMARY,
						boxShadow: "0 10px 24px rgba(0,90,194,0.2)",
					}}
				>
					<span className="material-symbols-outlined text-xl md:hidden">
						bolt
					</span>
					<span className="hidden md:inline">Go Beyond</span>
					<span className="hidden font-bold text-[10px] opacity-80 md:inline">
						· Soon
					</span>
				</button>
			</div>
		</aside>
	);
}

function TopBar() {
	return (
		<header
			className="sticky top-0 z-40 px-5 py-3 backdrop-blur-md sm:px-6 lg:px-8"
			style={{ background: "rgba(248,249,250,0.7)" }}
		>
			<div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3">
				{/* The rail carries the wordmark; on mobile the bar shows the section
			    title on the left and the profile icon on the right. */}
				<span
					className="font-bold text-xl tracking-tight md:hidden"
					style={{ fontFamily: SERIF, color: ON_SURFACE }}
				>
					For You
				</span>

				<div className="relative hidden w-96 max-w-full md:block">
					<span
						className="material-symbols-outlined absolute top-1/2 left-4 -translate-y-1/2"
						style={{ color: "rgba(66,71,84,0.5)" }}
					>
						search
					</span>
					<input
						type="text"
						placeholder="Search insights..."
						className="w-full rounded-full border border-black/5 bg-white/90 py-2.5 pr-4 pl-12 font-medium text-sm outline-none transition-all focus:border-[#005ac2] focus:ring-2 focus:ring-[#005ac2]/20"
					/>
				</div>

				<div className="flex items-center gap-4">
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

function EmptyState() {
	return (
		<div className="mt-20 flex flex-col items-center px-6 text-center">
			<span
				className="material-symbols-outlined text-6xl"
				style={{ color: PRIMARY, opacity: 0.3 }}
			>
				explore
			</span>
			<p
				className="mt-4 font-bold text-[11px] uppercase tracking-[0.22em]"
				style={{ color: PRIMARY }}
			>
				For You
			</p>
			<p
				className="mt-2 font-bold text-xl"
				style={{ color: ON_SURFACE, fontFamily: SERIF }}
			>
				Content that points somewhere
			</p>
			<p
				className="mt-2 max-w-xs text-sm leading-relaxed"
				style={{ color: ON_VARIANT }}
			>
				A calm feed matched to your focus, never built to fill time. It sharpens
				as you save what fits and skip what doesn't.
			</p>
		</div>
	);
}

const SCOPED_CSS = `
.material-symbols-outlined {
	font-family: 'Material Symbols Outlined';
	font-weight: normal;
	font-style: normal;
	line-height: 1;
	letter-spacing: normal;
	text-transform: none;
	display: inline-block;
	white-space: nowrap;
	word-wrap: normal;
	direction: ltr;
	font-feature-settings: 'liga';
	-webkit-font-feature-settings: 'liga';
	-webkit-font-smoothing: antialiased;
	/* Clip the box to one glyph so that, before the icon font loads, the
	   fallback ligature word ("trending_up", "play_circle"…) can't expand and
	   wrap the layout, then snap back when the font arrives. Kills the shift. */
	width: 1em;
	overflow: hidden;
}
@keyframes sleek-toast { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
.sleek-toast { animation: sleek-toast 220ms ease-out; }
@media (prefers-reduced-motion: reduce) {
	.sleek-toast, .animate-pulse { animation: none; }
}
/* The desktop sidebar: hidden on phones, shown from md up. Driven by this
   scoped rule (not Tailwind's hidden/md:flex) so a stray global ".hidden"
   injected by another route's Play-CDN styles can never override it. */
.sleek-rail { display: none; }
@media (min-width: 768px) { .sleek-rail { display: flex !important; } }
.sleek-main { margin-left: 0; }
@media (min-width: 768px) { .sleek-main { margin-left: 280px !important; } }
.hero-blob { position: absolute; border-radius: 9999px; filter: blur(70px); opacity: 0.85; will-change: transform; }
.hero-blob--a { top: -25%; right: -12%; width: 70%; height: 90%; animation: heroDriftA 16s ease-in-out infinite alternate; }
.hero-blob--b { bottom: -32%; left: -12%; width: 65%; height: 85%; background: radial-gradient(circle at 50% 50%, rgba(77,142,255,0.5), transparent 62%); animation: heroDriftB 21s ease-in-out infinite alternate; }
.hero-blob--c { top: 4%; left: 30%; width: 50%; height: 60%; background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.12), transparent 60%); animation: heroDriftC 26s ease-in-out infinite alternate; }
@keyframes heroDriftA { from { transform: translate(0,0) scale(1); } to { transform: translate(-7%, 8%) scale(1.08); } }
@keyframes heroDriftB { from { transform: translate(0,0) scale(1); } to { transform: translate(8%, -6%) scale(1.1); } }
@keyframes heroDriftC { from { transform: translate(0,0); } to { transform: translate(5%, 5%); } }
.hero-rings { position: absolute; top: -22%; right: -16%; width: 58%; height: auto; opacity: 0.28; transform-origin: center; animation: heroSpin 150s linear infinite; }
@keyframes heroSpin { to { transform: rotate(360deg); } }
.hero-star { position: absolute; width: 3px; height: 3px; border-radius: 9999px; background: #fff; opacity: 0.5; box-shadow: 0 0 6px rgba(255,255,255,0.8); animation: heroTwinkle 3.6s ease-in-out infinite; }
@keyframes heroTwinkle { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 0.9; transform: scale(1.35); } }
@media (prefers-reduced-motion: reduce) { .hero-blob, .hero-rings, .hero-star { animation: none; } }
`;
