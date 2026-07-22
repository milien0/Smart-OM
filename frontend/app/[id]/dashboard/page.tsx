"use client";

import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { API_BASE } from "@/utils/api";

import {
	MapPinIcon,
	TicketIcon,
	DocumentTextIcon,
	CubeIcon,
	ChevronRightIcon,
	BuildingOffice2Icon,
	XMarkIcon,
	ShieldCheckIcon,
	GlobeEuropeAfricaIcon,
	ExclamationTriangleIcon,
	ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

// --- TIPI DATI ---
type SiteType = {
	id: string;
	name: string;
	address: string | null;
};

type ModelType = {
	id: string;
	site_id: string;
	name: string;
	format: string | null;
	created_at: string;
};

type TicketType = {
	id: string;
	site_id: string;
	poi_id: string | null;
	contact_id: string | null;
	title: string;
	status: "open" | "in_progress" | "resolved" | "closed";
	priority: string;
	created_at: string;
};

type DocumentType = {
	id: string;
	name: string;
	mime_type: string | null;
	created_at: string;
};

type PoiType = {
	id: string;
	title: string;
	severity: "info" | "warning" | "critical";
	created_at: string;
};

type TicketTab = "tutti" | "interno" | "esterno";

export default function SiteDashboardPage() {
	return (
		<Suspense>
			<SiteDashboard />
		</Suspense>
	);
}

function SiteDashboard() {
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const siteId = params?.id as string;
	// Modello scelto dalla galleria (query ?model=...), altrimenti il primo.
	const modelParam = searchParams?.get("model");

	// --- STATI ---
	const [sites, setSites] = useState<SiteType[]>([]);
	const [models, setModels] = useState<ModelType[]>([]);
	const [tickets, setTickets] = useState<TicketType[]>([]);
	const [documents, setDocuments] = useState<DocumentType[]>([]);
	const [pois, setPois] = useState<PoiType[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSiteDrawerOpen, setIsSiteDrawerOpen] = useState(false);
	const [ticketTab, setTicketTab] = useState<TicketTab>("tutti");
	const [previewThumb, setPreviewThumb] = useState<string | null>(null);

	// --- FETCH DATI ---
	const fetchAll = useCallback(async () => {
		if (!siteId) return;
		setIsLoading(true);
		try {
			const [sitesRes, modelsRes, ticketsRes, docsRes] = await Promise.all([
				axios.get(`${API_BASE}/api/sites`).catch(() => ({ data: [] })),
				axios
					.get(`${API_BASE}/api/models?site_id=${siteId}`)
					.catch(() => ({ data: [] })),
				axios
					.get(`${API_BASE}/api/tickets/site/${siteId}`)
					.catch(() => ({ data: [] })),
				axios
					.get(`${API_BASE}/api/documents/site/${siteId}`)
					.catch(() => ({ data: [] })),
			]);

			// L'endpoint /api/sites risponde con un wrapper { status, data }.
			setSites(sitesRes.data?.data || sitesRes.data || []);
			setModels(modelsRes.data || []);
			setTickets(ticketsRes.data || []);
			setDocuments(docsRes.data || []);

			// I pin sono legati ai modelli: aggreghiamo i POI di tutti i modelli della sede.
			const modelList: ModelType[] = modelsRes.data || [];
			const poiResults = await Promise.all(
				modelList.map((m) =>
					axios
						.get(`${API_BASE}/api/pois?model_id=${m.id}`)
						.then((r) => r.data || [])
						.catch(() => []),
				),
			);
			setPois(poiResults.flat());
		} catch (err) {
			console.error("Errore nel caricamento della dashboard:", err);
		} finally {
			setIsLoading(false);
		}
	}, [siteId]);

	useEffect(() => {
		fetchAll();
	}, [fetchAll]);

	// Anteprima 3D catturata dal viewer (localStorage, per browser).
	const previewModel =
		models.find((m) => m.id === modelParam) || models[0] || null;
	useEffect(() => {
		if (!previewModel) return;
		try {
			setPreviewThumb(localStorage.getItem(`smartom_thumb_${previewModel.id}`));
		} catch {}
	}, [previewModel]);

	// --- DERIVATI ---
	const currentSite = sites.find((s) => s.id === siteId);

	// Interno = ticket gestito internamente, Esterno = assegnato a un contatto esterno.
	const filteredTickets = useMemo(() => {
		if (ticketTab === "interno") return tickets.filter((t) => !t.contact_id);
		if (ticketTab === "esterno") return tickets.filter((t) => t.contact_id);
		return tickets;
	}, [tickets, ticketTab]);

	const ticketStats = useMemo(
		() => ({
			open: filteredTickets.filter((t) => t.status === "open").length,
			inProgress: filteredTickets.filter((t) => t.status === "in_progress")
				.length,
			closed: filteredTickets.filter(
				(t) => t.status === "closed" || t.status === "resolved",
			).length,
		}),
		[filteredTickets],
	);

	const criticalPois = pois.filter((p) => p.severity === "critical");
	const warningPois = pois.filter((p) => p.severity === "warning");
	const highPriorityOpen = tickets.filter(
		(t) =>
			t.status !== "closed" &&
			t.status !== "resolved" &&
			(t.priority === "high" || t.priority === "critical"),
	);

	// Indice di rischio molto semplice derivato da criticità aperte.
	const riskScore = criticalPois.length * 3 + highPriorityOpen.length * 2 + warningPois.length;
	const riskLevel =
		riskScore >= 8
			? { label: "Alto", color: "text-red-600", bg: "bg-red-50 border-red-100", bar: "bg-red-500", pct: 90 }
			: riskScore >= 3
				? { label: "Medio", color: "text-amber-600", bg: "bg-amber-50 border-amber-100", bar: "bg-amber-500", pct: 55 }
				: { label: "Basso", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100", bar: "bg-emerald-500", pct: 20 };

	const openViewerHref = previewModel
		? `/${siteId}/${previewModel.format === "ply" ? "ply" : "splat"}/${previewModel.id}`
		: `/${siteId}/models`;

	if (isLoading) {
		return (
			<div className='flex-1 flex items-center justify-center'>
				<div className='flex flex-col items-center gap-4'>
					<div className='w-12 h-12 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin' />
					<p className='text-xs font-bold text-zinc-400 uppercase tracking-widest'>
						Caricamento dashboard sede...
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className='flex-1 flex flex-col overflow-y-auto xl:overflow-hidden p-5 lg:p-6 gap-4 relative bg-gradient-to-b from-[#f7f9fc] to-[#eef2f8]'>
			{/* HEADER */}
			<div className='flex items-start justify-between shrink-0'>
				<div>
					<h1 className='text-2xl font-semibold text-[#1f1f1f] tracking-tight'>
						{currentSite?.name || "Dashboard Sede"}
					</h1>
					<p className='text-sm text-zinc-500'>
						{currentSite?.address || "Panoramica operativa della sede"}
					</p>
				</div>

				<div className='flex items-center gap-2'>
					<a
						href={`/${siteId}/models`}
						className='flex items-center gap-2 px-4 py-2.5 bg-white border border-zinc-200 hover:border-blue-300 hover:text-blue-600 rounded-full text-xs font-semibold text-zinc-600 shadow-sm transition-all'
					>
						<CubeIcon className='h-4 w-4' />
						Tutti i modelli 3D
					</a>

					{/* SELETTORE SEDE (apre il pannello che scorre da destra) */}
					<button
						onClick={() => setIsSiteDrawerOpen(true)}
						className='flex items-center gap-2 px-4 py-2.5 bg-white border border-zinc-200 hover:border-blue-300 hover:text-blue-600 rounded-full text-xs font-semibold text-zinc-600 shadow-sm transition-all'
					>
						<BuildingOffice2Icon className='h-4 w-4' />
						Cambia azienda
						<ChevronRightIcon className='h-3.5 w-3.5' />
					</button>
				</div>
			</div>

			{/* RIGA KPI: PIN POINT / TICKET / DOCUMENTI */}
			<div className='grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0 items-stretch'>
				{/* PIN POINT */}
				<div className='bg-white border border-zinc-200/60 rounded-[1.75rem] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.12)] flex flex-col min-h-[150px]'>
					<div className='flex items-center gap-2 text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-3'>
						<MapPinIcon className='h-4 w-4 text-blue-500' /> Pin Point
					</div>
					<div className='flex items-end gap-2 flex-1'>
						<span className='text-4xl font-semibold text-[#1f1f1f] leading-none'>
							{pois.length}
						</span>
						<span className='text-xs text-zinc-500 mb-1'>pin totali</span>
					</div>
					<div className='flex gap-2 mt-3'>
						<span className='text-[10px] font-semibold px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-100'>
							{criticalPois.length} critici
						</span>
						<span className='text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100'>
							{warningPois.length} warning
						</span>
					</div>
				</div>

				{/* TICKET */}
				<div className='bg-white border border-zinc-200/60 rounded-[1.75rem] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.12)] flex flex-col min-h-[150px]'>
					<div className='flex flex-wrap items-center justify-between gap-2 mb-3'>
						<div className='flex items-center gap-2 text-[11px] font-bold text-zinc-400 uppercase tracking-wider'>
							<TicketIcon className='h-4 w-4 text-blue-500' /> Ticket
						</div>
						{/* Tab Interno / Esterno */}
						<div className='flex bg-white border border-zinc-200 rounded-full p-0.5'>
							{(["tutti", "interno", "esterno"] as TicketTab[]).map((tab) => (
								<button
									key={tab}
									onClick={() => setTicketTab(tab)}
									className={`px-2.5 py-1 rounded-full text-[10px] font-semibold capitalize transition-all ${
										ticketTab === tab
											? "bg-blue-600 text-white shadow-sm"
											: "text-zinc-500 hover:text-zinc-700"
									}`}
								>
									{tab}
								</button>
							))}
						</div>
					</div>
					<div className='grid grid-cols-3 gap-2 flex-1'>
						<div className='flex flex-col items-center justify-center bg-[#f6f8fb] rounded-2xl border border-zinc-100 py-2'>
							<span className='text-2xl font-semibold text-blue-600 leading-none'>
								{ticketStats.open}
							</span>
							<span className='text-[10px] text-zinc-500 mt-1 font-medium'>
								Aperti
							</span>
						</div>
						<div className='flex flex-col items-center justify-center bg-[#f6f8fb] rounded-2xl border border-zinc-100 py-2'>
							<span className='text-2xl font-semibold text-amber-600 leading-none'>
								{ticketStats.inProgress}
							</span>
							<span className='text-[10px] text-zinc-500 mt-1 font-medium'>
								In corso
							</span>
						</div>
						<div className='flex flex-col items-center justify-center bg-[#f6f8fb] rounded-2xl border border-zinc-100 py-2'>
							<span className='text-2xl font-semibold text-zinc-500 leading-none'>
								{ticketStats.closed}
							</span>
							<span className='text-[10px] text-zinc-500 mt-1 font-medium'>
								Chiusi
							</span>
						</div>
					</div>
				</div>

				{/* DOCUMENTI */}
				<div className='bg-white border border-zinc-200/60 rounded-[1.75rem] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.12)] flex flex-col min-h-[150px]'>
					<div className='flex items-center justify-between mb-3'>
						<div className='flex items-center gap-2 text-[11px] font-bold text-zinc-400 uppercase tracking-wider'>
							<DocumentTextIcon className='h-4 w-4 text-blue-500' /> Documenti
						</div>
						<span className='text-xs font-semibold text-zinc-400'>
							{documents.length}
						</span>
					</div>
					{documents.length === 0 ? (
						<p className='text-xs text-zinc-400 italic flex-1 flex items-center'>
							Nessun documento caricato.
						</p>
					) : (
						<ul className='space-y-1.5 overflow-hidden'>
							{documents.slice(0, 3).map((doc) => (
								<li
									key={doc.id}
									className='flex items-center gap-2 bg-[#f6f8fb] border border-zinc-100 rounded-xl px-3 py-1.5'
								>
									<DocumentTextIcon className='h-3.5 w-3.5 text-zinc-400 shrink-0' />
									<span className='text-xs text-zinc-600 font-medium truncate'>
										{doc.name}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* ANTEPRIMA MODELLO (si espande per riempire lo spazio disponibile) */}
			<div className='relative bg-[#0d0f12] rounded-[2rem] overflow-hidden flex-1 min-h-[260px] group ring-1 ring-black/10 shadow-[0_24px_48px_-24px_rgba(16,24,40,0.35)]'>
				{previewThumb ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={previewThumb}
						alt={`Anteprima 3D di ${previewModel?.name}`}
						className='absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]'
					/>
				) : (
					<div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#12151c] via-[#0d0f12] to-[#171b24]'>
						<CubeIcon className='h-14 w-14 text-zinc-600' />
						<p className='text-xs text-zinc-500 font-medium'>
							{previewModel
								? "Apri il modello per generare l'anteprima"
								: "Nessun modello 3D caricato per questa sede"}
						</p>
					</div>
				)}
				<div className='absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none' />

				{/* Titolo overlay */}
				<div className='absolute top-5 left-6'>
					<span className='text-[10px] font-bold uppercase tracking-[0.2em] text-white/50'>
						Anteprima Modello
					</span>
					{previewModel && (
						<h2 className='text-xl font-semibold text-white drop-shadow-md tracking-tight'>
							{previewModel.name}
						</h2>
					)}
				</div>

				{/* Pulsante APRI 3D */}
				<a
					href={openViewerHref}
					className='absolute bottom-5 right-6 px-7 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-full text-sm font-semibold shadow-xl shadow-blue-900/50 ring-1 ring-white/20 flex items-center gap-2 transition-all hover:scale-[1.03] active:scale-[0.98]'
				>
					<CubeIcon className='h-4 w-4' /> Apri 3D
				</a>
			</div>

			{/* RIGA INFERIORE: SICUREZZA / AMBIENTALE */}
			<div className='grid grid-cols-1 lg:grid-cols-2 gap-4 shrink-0 items-stretch'>
				{/* SICUREZZA + RISK MANAGEMENT */}
				<div className='bg-white border border-zinc-200/60 rounded-[1.75rem] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.12)]'>
					<div className='flex items-center justify-between mb-4'>
						<div className='flex items-center gap-2 text-[11px] font-bold text-zinc-400 uppercase tracking-wider'>
							<ShieldCheckIcon className='h-4 w-4 text-blue-500' /> Sicurezza
						</div>
						{/* Risk Management */}
						<div
							className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${riskLevel.bg} ${riskLevel.color}`}
						>
							<ExclamationTriangleIcon className='h-3.5 w-3.5' />
							Risk: {riskLevel.label}
						</div>
					</div>

					{/* Barra indice di rischio */}
					<div className='mb-4'>
						<div className='h-2 w-full bg-zinc-200/60 rounded-full overflow-hidden'>
							<div
								className={`h-full rounded-full transition-all duration-700 ${riskLevel.bar}`}
								style={{ width: `${riskLevel.pct}%` }}
							/>
						</div>
						<p className='text-[10px] text-zinc-400 mt-1.5'>
							Indice calcolato da pin critici e ticket ad alta priorità aperti.
						</p>
					</div>

					{/* Card criticità */}
					{criticalPois.length === 0 && highPriorityOpen.length === 0 ? (
						<div className='flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-xs font-medium text-emerald-700'>
							<ShieldCheckIcon className='h-4 w-4' /> Nessuna criticità di
							sicurezza aperta.
						</div>
					) : (
						<div className='space-y-2'>
							{criticalPois.slice(0, 2).map((p) => (
								<div
									key={p.id}
									className='flex items-center gap-3 bg-white border border-red-100 rounded-2xl px-4 py-2.5'
								>
									<span className='w-2 h-2 rounded-full bg-red-500 shrink-0' />
									<span className='text-xs font-medium text-zinc-700 truncate'>
										{p.title}
									</span>
									<span className='ml-auto text-[9px] font-bold uppercase text-red-500'>
										Pin critico
									</span>
								</div>
							))}
							{highPriorityOpen.slice(0, 2).map((t) => (
								<div
									key={t.id}
									className='flex items-center gap-3 bg-white border border-amber-100 rounded-2xl px-4 py-2.5'
								>
									<span className='w-2 h-2 rounded-full bg-amber-500 shrink-0' />
									<span className='text-xs font-medium text-zinc-700 truncate'>
										{t.title}
									</span>
									<span className='ml-auto text-[9px] font-bold uppercase text-amber-500'>
										Ticket {t.priority}
									</span>
								</div>
							))}
						</div>
					)}
				</div>

				{/* AMBIENTALE */}
				<div className='bg-white border border-zinc-200/60 rounded-[1.75rem] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.12)]'>
					<div className='flex items-center justify-between mb-4'>
						<div className='flex items-center gap-2 text-[11px] font-bold text-zinc-400 uppercase tracking-wider'>
							<GlobeEuropeAfricaIcon className='h-4 w-4 text-blue-500' />{" "}
							Ambientale
						</div>
						<span className='text-[9px] font-bold uppercase tracking-wider text-zinc-300'>
							Dati dimostrativi
						</span>
					</div>

					<div className='grid grid-cols-2 gap-4 items-center'>
						{/* Torta: ripartizione ticket per stato */}
						<TicketPie
							open={ticketStats.open}
							inProgress={ticketStats.inProgress}
							closed={ticketStats.closed}
						/>

						{/* Istogramma: pin per severità */}
						<SeverityBars
							info={pois.filter((p) => p.severity === "info").length}
							warning={warningPois.length}
							critical={criticalPois.length}
						/>
					</div>
				</div>
			</div>

			{/* DRAWER SELETTORE SEDE (scorre da destra) */}
			{isSiteDrawerOpen && (
				<div
					className='fixed inset-0 z-50 bg-black/30 backdrop-blur-sm'
					onClick={() => setIsSiteDrawerOpen(false)}
				>
					<aside
						onClick={(e) => e.stopPropagation()}
						className='absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200'
					>
						<div className='p-5 border-b border-zinc-100 flex items-center justify-between bg-[#f8fafd]'>
							<h3 className='text-sm font-semibold text-zinc-900 flex items-center gap-2'>
								<BuildingOffice2Icon className='h-4 w-4 text-blue-500' />
								Seleziona azienda
							</h3>
							<button
								onClick={() => setIsSiteDrawerOpen(false)}
								className='w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-zinc-600 shadow-sm transition-colors'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>
						<div className='flex-1 overflow-y-auto p-4 space-y-2'>
							{sites.map((site) => {
								const isCurrent = site.id === siteId;
								return (
									<button
										key={site.id}
										onClick={() => {
											setIsSiteDrawerOpen(false);
											if (!isCurrent) router.push(`/${site.id}`);
										}}
										className={`w-full text-left px-4 py-3 rounded-2xl border transition-all flex items-center gap-3 ${
											isCurrent
												? "bg-blue-50 border-blue-200 text-blue-700"
												: "bg-white border-zinc-100 hover:border-blue-200 text-zinc-700"
										}`}
									>
										<BuildingOffice2Icon className='h-4 w-4 shrink-0 opacity-60' />
										<span className='min-w-0'>
											<span className='block text-sm font-semibold truncate'>
												{site.name}
											</span>
											{site.address && (
												<span className='block text-[11px] text-zinc-400 truncate'>
													{site.address}
												</span>
											)}
										</span>
										{isCurrent && (
											<span className='ml-auto text-[9px] font-bold uppercase tracking-wider text-blue-500'>
												Attuale
											</span>
										)}
									</button>
								);
							})}
							{sites.length === 0 && (
								<p className='text-xs text-zinc-400 italic p-4'>
									Nessuna sede disponibile.
								</p>
							)}
						</div>
						<div className='p-4 border-t border-zinc-100'>
							<a
								href='/'
								className='flex items-center justify-center gap-2 w-full py-2.5 rounded-full border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors'
							>
								<ArrowTopRightOnSquareIcon className='h-3.5 w-3.5' />
								Vai alla schermata Admin
							</a>
						</div>
					</aside>
				</div>
			)}
		</div>
	);
}

// --- GRAFICO A TORTA (SVG) ---
function TicketPie({
	open,
	inProgress,
	closed,
}: {
	open: number;
	inProgress: number;
	closed: number;
}) {
	const total = open + inProgress + closed;
	const slices = [
		{ value: open, color: "#2563eb", label: "Aperti" },
		{ value: inProgress, color: "#d97706", label: "In corso" },
		{ value: closed, color: "#94a3b8", label: "Chiusi" },
	].filter((s) => s.value > 0);

	let cumulative = 0;
	const radius = 40;
	const cx = 50;
	const cy = 50;

	const arcs = slices.map((s) => {
		const startAngle = (cumulative / Math.max(total, 1)) * 2 * Math.PI - Math.PI / 2;
		cumulative += s.value;
		const endAngle = (cumulative / Math.max(total, 1)) * 2 * Math.PI - Math.PI / 2;
		const x1 = cx + radius * Math.cos(startAngle);
		const y1 = cy + radius * Math.sin(startAngle);
		const x2 = cx + radius * Math.cos(endAngle);
		const y2 = cy + radius * Math.sin(endAngle);
		const largeArc = s.value / total > 0.5 ? 1 : 0;
		return {
			...s,
			d: `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`,
		};
	});

	return (
		<div className='flex flex-col items-center gap-2'>
			<svg viewBox='0 0 100 100' className='w-24 h-24'>
				{total === 0 ? (
					<circle cx={cx} cy={cy} r={radius} fill='#e4e4e7' />
				) : slices.length === 1 ? (
					<circle cx={cx} cy={cy} r={radius} fill={slices[0].color} />
				) : (
					arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} />)
				)}
				<circle cx={cx} cy={cy} r={22} fill='#ffffff' />
				<text
					x={cx}
					y={cy + 4}
					textAnchor='middle'
					className='fill-zinc-700'
					fontSize='14'
					fontWeight='600'
				>
					{total}
				</text>
			</svg>
			<div className='flex flex-wrap justify-center gap-x-3 gap-y-1'>
				{[
					{ color: "#2563eb", label: `Aperti ${open}` },
					{ color: "#d97706", label: `In corso ${inProgress}` },
					{ color: "#94a3b8", label: `Chiusi ${closed}` },
				].map((l) => (
					<span
						key={l.label}
						className='flex items-center gap-1 text-[10px] text-zinc-500 font-medium'
					>
						<span
							className='w-2 h-2 rounded-full'
							style={{ backgroundColor: l.color }}
						/>
						{l.label}
					</span>
				))}
			</div>
		</div>
	);
}

// --- ISTOGRAMMA SEVERITÀ PIN (SVG) ---
function SeverityBars({
	info,
	warning,
	critical,
}: {
	info: number;
	warning: number;
	critical: number;
}) {
	const bars = [
		{ value: info, color: "#2563eb", label: "Info" },
		{ value: warning, color: "#d97706", label: "Warning" },
		{ value: critical, color: "#dc2626", label: "Critici" },
	];
	const max = Math.max(info, warning, critical, 1);

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-end justify-center gap-5 h-24'>
				{bars.map((b) => (
					<div key={b.label} className='flex flex-col items-center gap-1'>
						<span className='text-[10px] font-semibold text-zinc-500'>
							{b.value}
						</span>
						<div
							className='w-8 rounded-t-lg transition-all duration-700'
							style={{
								height: `${Math.max((b.value / max) * 80, 4)}px`,
								backgroundColor: b.color,
								opacity: b.value === 0 ? 0.2 : 1,
							}}
						/>
					</div>
				))}
			</div>
			<div className='flex justify-center gap-5'>
				{bars.map((b) => (
					<span
						key={b.label}
						className='text-[10px] text-zinc-500 font-medium w-8 text-center'
					>
						{b.label}
					</span>
				))}
			</div>
		</div>
	);
}
