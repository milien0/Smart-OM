// @ts-nocheck
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/utils/api";
import * as THREE from "three";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import { createDSMMesh } from "@/utils/dsmMeshGenerator";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	CSS2DRenderer,
	CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import {
	ArrowPathIcon,
	BugAntIcon,
	BuildingOfficeIcon,
	DocumentArrowDownIcon,
	HandRaisedIcon,
	HomeIcon,
	MapPinIcon,
	SparklesIcon,
	StopIcon,
	SunIcon,
	VideoCameraIcon,
	WrenchScrewdriverIcon,
	XMarkIcon,
	ClipboardDocumentCheckIcon,
	PencilSquareIcon,
	CameraIcon,
	PlusIcon,
	PhotoIcon,
	ExclamationTriangleIcon,
	BoltIcon,
	LockClosedIcon,
	LockOpenIcon,
	ArrowUturnLeftIcon,
	ArrowsRightLeftIcon,
	TrashIcon,
	FunnelIcon,
	Squares2X2Icon,
	CheckCircleIcon,
	CubeTransparentIcon,
	ChatBubbleLeftRightIcon,
	ViewColumnsIcon,
	PaperAirplaneIcon,
	ChevronRightIcon,
	UserGroupIcon,
	PhoneIcon,
	EnvelopeIcon,
	CloudArrowUpIcon,
	DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { useParams, useRouter } from "next/navigation";
import ServicesModal from "./servicesModal";

const SEVERITY_COLORS = {
	info: "#378ADD",
	warning: "#EF9F27",
	critical: "#E24B4A",
	maintenance: "#8B5CF6",
};

type Severity = "info" | "warning" | "critical" | "maintenance";

type Category =
	| "fotovoltaic"
	| "surveilance"
	| "green_maintenance"
	| "roof"
	| "facade"
	| "pest_control"
	| "generic";

// Palette dedicata alle CATEGORIE: volutamente distinta dai colori di severity
// (niente blu/ambra/rosso/viola) per non generare confusione visiva.
const CATEGORY_COLORS: Record<Category, string> = {
	fotovoltaic: "#14B8A6", // teal
	surveilance: "#EC4899", // pink
	green_maintenance: "#22C55E", // green
	roof: "#64748B", // slate
	facade: "#06B6D4", // cyan
	pest_control: "#84CC16", // lime
	generic: "#78716C", // stone
};

const getCategoryColor = (cat?: Category | null) =>
	CATEGORY_COLORS[(cat as Category) || "generic"] || CATEGORY_COLORS.generic;

// Schema BICOLORE per i pin nella vista 3D: invece di una tavolozza
// arcobaleno (severity + categoria) usiamo due soli colori con significato
// "normale vs. attenzione".
const PIN_BICOLOR = {
	normal: "#5B8AF5", // info / maintenance — blu brand
	alert: "#E24B4A", // warning / critical — rosso allerta
};
const getPinBicolor = (severity?: Severity | null) =>
	severity === "warning" || severity === "critical"
		? PIN_BICOLOR.alert
		: PIN_BICOLOR.normal;

// ============================================================
// HELPER VISUALI "PREMIUM" — glow, marker di precisione, linee
// con alone e riempimento aree. Usati sia dai pin che dalle misure.
// ============================================================

// Stylesheet condiviso per le etichette dei pin (iniettato una volta sola)
function ensurePinLabelStyles() {
	if (document.getElementById("smart-pin-styles")) return;
	const style = document.createElement("style");
	style.id = "smart-pin-styles";
	style.textContent = `
		@keyframes smartPinPulse {
			0% { transform: scale(0.8); opacity: 1; }
			50% { transform: scale(1.75); opacity: 0.25; }
			100% { transform: scale(0.8); opacity: 1; }
		}
		/* IMPORTANTE: CSS2DRenderer riscrive il transform dell'elemento ESTERNO
		   a ogni frame per seguire la camera. Le transizioni/transform di stile
		   vivono quindi su questo elemento INTERNO, mai su quello esterno,
		   altrimenti l'etichetta "insegue" la camera con ritardo. */
		.smart-pin-label {
			display: flex; align-items: center; gap: 8px;
			background: linear-gradient(135deg, rgba(32,34,38,0.97) 0%, rgba(16,17,20,0.94) 100%);
			backdrop-filter: blur(8px) saturate(160%);
			color: #f4f4f5;
			font-family: -apple-system, BlinkMacSystemFont, sans-serif;
			font-size: 11px; font-weight: 600; letter-spacing: 0.01em;
			padding: 6px 13px; border-radius: 8px; white-space: nowrap;
			border: 1px solid color-mix(in srgb, var(--pin-color) 42%, transparent);
			box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 13px color-mix(in srgb, var(--pin-color) 32%, transparent), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.07);
			transform: translateY(-10px);
			pointer-events: auto; cursor: pointer;
			transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
		}
		.smart-pin-label:hover {
			transform: translateY(-13px) scale(1.05);
			border-color: color-mix(in srgb, var(--pin-color) 85%, transparent);
			box-shadow: 0 14px 36px rgba(0,0,0,0.6), 0 0 20px color-mix(in srgb, var(--pin-color) 45%, transparent), inset 0 1px 0 rgba(255,255,255,0.1);
		}
	`;
	document.head.appendChild(style);
}

// Texture radiale per gli aloni luminosi (generata una volta, poi riusata)
let _glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
	if (_glowTexture) return _glowTexture;
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const ctx = c.getContext("2d")!;
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, "rgba(255,255,255,1)");
	g.addColorStop(0.3, "rgba(255,255,255,0.45)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	_glowTexture = new THREE.CanvasTexture(c);
	return _glowTexture;
}

// Alone luminoso billboard (sempre rivolto alla camera)
function makeGlowSprite(
	color: string | number,
	scale: number,
	opacity = 0.55,
): THREE.Sprite {
	const mat = new THREE.SpriteMaterial({
		map: getGlowTexture(),
		color: new THREE.Color(color as any),
		transparent: true,
		opacity,
		depthTest: false,
		blending: THREE.AdditiveBlending,
	});
	const sprite = new THREE.Sprite(mat);
	sprite.scale.setScalar(scale);
	sprite.renderOrder = 998;
	return sprite;
}

// Marker di precisione per i punti delle misure: nucleo bianco,
// guscio colorato semi-trasparente e alone additivo.
function buildPointMarker(
	pos: THREE.Vector3,
	color: number,
	r: number,
): THREE.Group {
	const grp = new THREE.Group();
	const halo = new THREE.Mesh(
		new THREE.SphereGeometry(r * 1.9, 16, 16),
		new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.28,
			depthTest: false,
		}),
	);
	const core = new THREE.Mesh(
		new THREE.SphereGeometry(r, 16, 16),
		new THREE.MeshBasicMaterial({ color, depthTest: false }),
	);
	const dot = new THREE.Mesh(
		new THREE.SphereGeometry(r * 0.45, 12, 12),
		new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
	);
	halo.position.copy(pos);
	core.position.copy(pos);
	dot.position.copy(pos);
	halo.renderOrder = 997;
	core.renderOrder = 999;
	dot.renderOrder = 1000;
	const glow = makeGlowSprite(color, r * 6.5, 0.45);
	glow.position.copy(pos);
	grp.add(glow, halo, core, dot);
	return grp;
}

// Linea "neon": alone largo semi-trasparente + nucleo sottile brillante
function buildGlowLine(
	flatPoints: number[],
	color: number,
	resW: number,
	resH: number,
): THREE.Group {
	const grp = new THREE.Group();
	const mk = (width: number, opacity: number, order: number) => {
		const geo = new LineGeometry();
		geo.setPositions(flatPoints);
		const mat = new LineMaterial({
			color,
			linewidth: width,
			transparent: opacity < 1,
			opacity,
			depthTest: false,
		});
		mat.resolution.set(resW, resH);
		const line = new Line2(geo, mat);
		line.renderOrder = order;
		return line;
	};
	grp.add(mk(14, 0.18, 995)); // alone esterno
	grp.add(mk(3.5, 1, 996)); // nucleo
	grp.userData.isGlowLine = true;
	return grp;
}

// Riempimento traslucido del poligono area (triangolazione a ventaglio)
function buildAreaFill(
	points: THREE.Vector3[],
	color: number,
): THREE.Mesh | null {
	if (points.length < 3) return null;
	const centroid = new THREE.Vector3();
	points.forEach((p) => centroid.add(p));
	centroid.divideScalar(points.length);
	const verts: THREE.Vector3[] = [];
	for (let i = 0; i < points.length; i++) {
		verts.push(centroid, points[i], points[(i + 1) % points.length]);
	}
	const geo = new THREE.BufferGeometry().setFromPoints(verts);
	const mesh = new THREE.Mesh(
		geo,
		new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.13,
			side: THREE.DoubleSide,
			depthTest: false,
		}),
	);
	mesh.renderOrder = 994;
	mesh.userData.isAreaFill = true;
	return mesh;
}

// ============================================================
// UPLOAD DROPZONE — zona di caricamento riutilizzabile (foto e
// documenti): click o drag&drop, validazione tipo/dimensione,
// anteprima, barra di avanzamento e stati di esito. Stile
// allineato ai pannelli scuri del viewer.
// ============================================================

// Il backend (multer) limita le foto a 15MB: usiamo lo stesso tetto
// lato client per entrambi i tipi di file.
const MAX_UPLOAD_MB = 15;

function formatFileSize(bytes: number) {
	if (!bytes || bytes <= 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.min(
		Math.floor(Math.log(bytes) / Math.log(k)),
		sizes.length - 1,
	);
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Upload via XMLHttpRequest: fetch non espone il progresso di invio.
function xhrUpload(
	url: string,
	formData: FormData,
	onProgress: (pct: number) => void,
): Promise<any> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", url);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable)
				onProgress(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(JSON.parse(xhr.responseText));
				} catch {
					resolve(null);
				}
			} else {
				let msg = `Errore del server (HTTP ${xhr.status}).`;
				try {
					// Il middleware error del backend risponde { error: "..." }
					const body = JSON.parse(xhr.responseText);
					if (body?.error || body?.message) msg = body.error || body.message;
				} catch {}
				reject(new Error(msg));
			}
		};
		xhr.onerror = () =>
			reject(new Error("Errore di rete: impossibile raggiungere il server."));
		xhr.send(formData);
	});
}

// Tasto/gesto in stile "keycap" per la barra dei suggerimenti comandi
function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className='px-1.5 py-[1px] rounded-[5px] bg-white/[0.07] border border-white/[0.1] text-[11px] font-semibold text-[#f0f0ec] tracking-wide shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)] font-sans not-italic'>
			{children}
		</kbd>
	);
}

type DropzonePhase = "idle" | "uploading" | "success" | "error";

function UploadDropzone({
	label,
	accept,
	kind,
	onUpload,
	maxSizeMB = MAX_UPLOAD_MB,
	className = "",
}: {
	label: string;
	accept: string;
	kind: "image" | "document";
	onUpload: (file: File, onProgress: (pct: number) => void) => Promise<void>;
	maxSizeMB?: number;
	className?: string;
}) {
	const [phase, setPhase] = useState<DropzonePhase>("idle");
	const [progress, setProgress] = useState(0);
	const [current, setCurrent] = useState<{
		name: string;
		size: number;
		preview: string | null;
	} | null>(null);
	const [queueInfo, setQueueInfo] = useState<{
		index: number;
		total: number;
	} | null>(null);
	const [errorMsg, setErrorMsg] = useState("");
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const dragDepth = useRef(0);

	const matchesAccept = (file: File) => {
		const rules = accept
			.split(",")
			.map((r) => r.trim().toLowerCase())
			.filter(Boolean);
		const name = file.name.toLowerCase();
		const type = (file.type || "").toLowerCase();
		return rules.some((rule) => {
			if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
			if (rule.startsWith(".")) return name.endsWith(rule);
			return type === rule;
		});
	};

	const fail = (msg: string) => {
		setPhase("error");
		setErrorMsg(msg);
	};

	const handleFiles = async (list: FileList | File[] | null) => {
		if (!list || phase === "uploading") return;
		const files = Array.from(list);
		if (!files.length) return;

		const invalid = files.find((f) => !matchesAccept(f));
		if (invalid) return fail(`Formato non supportato: ${invalid.name}`);
		const tooBig = files.find((f) => f.size > maxSizeMB * 1024 * 1024);
		if (tooBig)
			return fail(
				`${tooBig.name} (${formatFileSize(tooBig.size)}) supera il limite di ${maxSizeMB}MB`,
			);

		setPhase("uploading");
		setErrorMsg("");
		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				setQueueInfo(files.length > 1 ? { index: i + 1, total: files.length } : null);
				const preview =
					kind === "image" && file.type.startsWith("image/")
						? URL.createObjectURL(file)
						: null;
				setCurrent({ name: file.name, size: file.size, preview });
				setProgress(0);
				try {
					await onUpload(file, setProgress);
				} finally {
					if (preview) URL.revokeObjectURL(preview);
				}
			}
			setPhase("success");
			setTimeout(
				() => setPhase((p) => (p === "success" ? "idle" : p)),
				2200,
			);
		} catch (err: any) {
			const msg = typeof err?.message === "string" && err.message.length <= 90
				? err.message
				: "Caricamento non riuscito. Riprova.";
			fail(msg);
		} finally {
			setCurrent(null);
			setQueueInfo(null);
		}
	};

	return (
		<div
			onClick={() => {
				if (phase === "uploading") return;
				if (phase === "error") setPhase("idle");
				inputRef.current?.click();
			}}
			onDragEnter={(e) => {
				e.preventDefault();
				dragDepth.current += 1;
				setIsDragging(true);
			}}
			onDragOver={(e) => e.preventDefault()}
			onDragLeave={(e) => {
				e.preventDefault();
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) setIsDragging(false);
			}}
			onDrop={(e) => {
				e.preventDefault();
				dragDepth.current = 0;
				setIsDragging(false);
				if (phase === "error") setPhase("idle");
				handleFiles(e.dataTransfer?.files ?? null);
			}}
			className={`cursor-pointer select-none px-2.5 py-2 rounded-[8px] border border-dashed transition-colors ${
				isDragging
					? "border-[#5B8AF5] bg-[rgba(6,57,222,0.10)]"
					: phase === "error"
						? "border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.04)]"
						: "border-white/[0.08] hover:bg-white/[0.02]"
			} ${className}`}
		>
			<input
				ref={inputRef}
				type='file'
				accept={accept}
				multiple
				className='hidden'
				onChange={(e) => {
					handleFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			{phase === "uploading" ? (
				<div className='flex items-center gap-2.5 w-full'>
					{current?.preview ? (
						<img
							src={current.preview}
							alt='Anteprima'
							className='w-9 h-9 rounded-[6px] object-cover border border-white/[0.08] shrink-0'
						/>
					) : (
						<div className='w-9 h-9 rounded-[6px] bg-[rgba(91,138,245,0.08)] flex items-center justify-center text-[#5B8AF5] shrink-0'>
							{kind === "image" ? (
								<PhotoIcon className='h-4 w-4' />
							) : (
								<DocumentTextIcon className='h-4 w-4' />
							)}
						</div>
					)}
					<div className='min-w-0 flex-1'>
						<div className='flex justify-between items-baseline gap-2'>
							<span className='truncate text-[11px] font-semibold text-[#f0f0ec]'>
								{current?.name}
							</span>
							<span className='text-[11px] text-[#a1a19d] tabular-nums shrink-0'>
								{queueInfo ? `${queueInfo.index}/${queueInfo.total} · ` : ""}
								{progress}%
							</span>
						</div>
						<div className='text-[11px] text-[#a1a19d]'>
							{formatFileSize(current?.size ?? 0)}
						</div>
						<div className='mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden'>
							<div
								className='h-full bg-[#5B8AF5] rounded-full transition-all duration-150'
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>
				</div>
			) : phase === "success" ? (
				<div className='flex items-center gap-1.5 text-[11px] font-semibold text-[#22C55E]'>
					<CheckCircleIcon className='h-3.5 w-3.5 shrink-0' /> Caricamento
					completato
				</div>
			) : phase === "error" ? (
				<div className='flex items-center gap-1.5 text-[11px] font-semibold text-[#ef4444]'>
					<ExclamationTriangleIcon className='h-3.5 w-3.5 shrink-0' />
					<span className='truncate flex-1'>{errorMsg}</span>
					<span className='text-[#5B8AF5] underline shrink-0'>Riprova</span>
				</div>
			) : (
				<div className='flex items-center gap-1.5 text-[11px] font-semibold text-[#5B8AF5]'>
					<CloudArrowUpIcon className='h-3.5 w-3.5 shrink-0' />
					<span>{label}</span>
					<span className='text-[11px] text-[#a1a19d] font-medium'>
						· trascina qui o clicca (max {maxSizeMB}MB)
					</span>
				</div>
			)}
		</div>
	);
}

type MaintenanceStatus = "open" | "in_progress" | "closed";

type Pin = {
	id: string;
	model_id: string;
	position?: { x: number; y: number; z: number };
	x?: number;
	y?: number;
	z?: number;
	title: string;
	description?: string | null;
	severity: Severity;
	category: Category;
	subcategory_id?: string | null;
	maintenance_periodicity?: string | null;
	maintenance_last_done?: string | null;
	maintenance_due_date?: string | null;
};

type Annotation = Pin;
type Tool = "navigate" | "pin" | "measure" | "area" | "arc";

type PendingAnnotation = {
	type: "pin";
	position: THREE.Vector3;
} | null;

type SavedGeometry = {
	id: string;
	name: string;
	type: "Misura" | "Arco" | "Area";
	value: string;
	points: THREE.Vector3[];
	meshGroupUuid?: string;
};

type PendingGeometry = {
	type: "Misura" | "Arco" | "Area";
	value: string;
	points: THREE.Vector3[];
} | null;

const SEVERITIES: { type: Severity; name: string; hex: string }[] = [
	{ type: "info", name: "Info", hex: SEVERITY_COLORS.info },
	{ type: "warning", name: "Warning", hex: SEVERITY_COLORS.warning },
	{ type: "critical", name: "Critical", hex: SEVERITY_COLORS.critical },
	{
		type: "maintenance",
		name: "Manutenzione",
		hex: SEVERITY_COLORS.maintenance,
	},
];

const CATEGORIES: { type: Category; name: string; icon: any }[] = [
	{
		type: "fotovoltaic",
		name: "Fotovoltaico",
		icon: <SunIcon className='h-4 w-4' />,
	},
	{
		type: "surveilance",
		name: "Videosorveglianza",
		icon: <VideoCameraIcon className='h-4 w-4' />,
	},
	{
		type: "green_maintenance",
		name: "Verde",
		icon: <SparklesIcon className='h-4 w-4' />,
	},
	{ type: "roof", name: "Copertura", icon: <HomeIcon className='h-4 w-4' /> },
	{
		type: "facade",
		name: "Facciata",
		icon: <BuildingOfficeIcon className='h-4 w-4' />,
	},
	{
		type: "pest_control",
		name: "Disinfestazione",
		icon: <BugAntIcon className='h-4 w-4' />,
	},
	{
		type: "generic",
		name: "Generico",
		icon: <WrenchScrewdriverIcon className='h-4 w-4' />,
	},
];

// Periodicità della manutenzione programmata
const MAINTENANCE_PERIODICITIES: {
	value: string;
	name: string;
	months: number;
}[] = [
	{ value: "monthly", name: "Mensile", months: 1 },
	{ value: "quarterly", name: "Trimestrale", months: 3 },
	{ value: "biannual", name: "Semestrale", months: 6 },
	{ value: "annual", name: "Annuale", months: 12 },
];

// Aggiunge N mesi a una data ISO (YYYY-MM-DD) e restituisce la nuova data ISO
function addMonthsToDate(dateStr: string, months: number): string {
	if (!dateStr) return "";
	const d = new Date(dateStr);
	if (isNaN(d.getTime())) return "";
	d.setMonth(d.getMonth() + months);
	return d.toISOString().slice(0, 10);
}

// Stati e priorità gestiti per i ticket (coerenti col backend /api/tickets)
const TICKET_STATUSES: { value: string; name: string }[] = [
	{ value: "open", name: "Aperto" },
	{ value: "in_progress", name: "In Corso" },
	{ value: "resolved", name: "Risolto" },
	{ value: "closed", name: "Chiuso" },
];

const TICKET_PRIORITIES: { value: string; label: string }[] = [
	{ value: "low", label: "LOW" },
	{ value: "medium", label: "MEDIUM" },
	{ value: "high", label: "HIGH" },
	{ value: "urgent", label: "URGENT" },
];

interface PlyViewerProps {
	url: string;
	modelId: string;
	// Formato del modello (dal DB). I file "sog" sono convertiti dal backend in
	// PLY binario e vanno letti come SceneFormat.Ply.
	format?: string | null;
	// Modalità iniziale: "view" (sola lettura, per l'utente finale) o "edit".
	// Default "view": l'utente finale vede il 3D e consulta i dati ma non modifica.
	initialMode?: "view" | "edit";
}

// Mappa il formato del modello all'enum SceneFormat di
// @mkkellogg/gaussian-splats-3d. I .sog diventano PLY binario a monte.
function resolveSceneFormat(format?: string | null) {
	switch ((format || "").toLowerCase()) {
		case "ply":
		case "sog":
			return GaussianSplats3D.SceneFormat.Ply;
		case "ksplat":
			return GaussianSplats3D.SceneFormat.KSplat;
		case "splat":
		default:
			return GaussianSplats3D.SceneFormat.Splat;
	}
}

export default function PlyViewer({
	url,
	modelId,
	format,
	initialMode = "view",
}: PlyViewerProps) {
	const { id: siteId } = useParams();
	const router = useRouter();
	const mountRef = useRef<HTMLDivElement>(null);
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [pending, setPending] = useState<PendingAnnotation>(null);
	const [annTitle, setAnnTitle] = useState("");
	const [annDescription, setAnnDescription] = useState("");
	const [annSeverity, setAnnSeverity] = useState<Severity>("info");
	const [annCategory, setAnnCategory] = useState<Category>("generic");
	const [annMaintenancePeriodicity, setAnnMaintenancePeriodicity] =
		useState("monthly");
	const [annMaintenanceLastDone, setAnnMaintenanceLastDone] = useState("");
	const [annMaintenanceDueDate, setAnnMaintenanceDueDate] = useState("");
	const [tool, setTool] = useState<Tool>("navigate");

	// --- MODALITÀ VISUALIZZA / MODIFICA ---
	// In "view" l'utente finale può solo navigare e consultare (pin, ticket,
	// misure, foto, documenti) ma NON può creare / modificare / eliminare nulla.
	// In "edit" si sbloccano tutti gli strumenti di editing.
	const [mode, setMode] = useState<"view" | "edit">(initialMode);
	const isEdit = mode === "edit";
	// Ref parallelo: serve al click-handler della scena 3D, che vive dentro un
	// useEffect con closure "congelata" e non vedrebbe lo stato aggiornato.
	const isEditRef = useRef(initialMode === "edit");
	isEditRef.current = isEdit;

	// --- NOTIFICHE TOAST (sostituiscono i vecchi notify() del browser) ---
	const [toasts, setToasts] = useState<
		{ id: number; msg: string; type: "error" | "success" | "info" }[]
	>([]);
	const toastIdRef = useRef(0);
	const notify = useCallback(
		(msg: string, type: "error" | "success" | "info" = "error") => {
			const id = ++toastIdRef.current;
			setToasts((prev) => [...prev, { id, msg, type }]);
			setTimeout(
				() => setToasts((prev) => prev.filter((t) => t.id !== id)),
				4000,
			);
		},
		[],
	);

	const [loading, setLoading] = useState(true);
	const [loadProgress, setLoadProgress] = useState(0);
	const [loadError, setLoadError] = useState<string | null>(null);

	// Il loader resta montato durante la dissolvenza di uscita (fade-out)
	const [loaderVisible, setLoaderVisible] = useState(true);
	useEffect(() => {
		if (loading) {
			setLoaderVisible(true);
			return;
		}
		const t = setTimeout(() => setLoaderVisible(false), 550);
		return () => clearTimeout(t);
	}, [loading]);
	const [leftTab, setLeftTab] = useState<'misure' | 'punti' | 'media'>('misure');
	const [collapsedCategories, setCollapsedCategories] = useState<Set<Category>>(new Set());

	// Filtro categorie: Set delle categorie attualmente visibili (default: tutte)
	const [activeCategories, setActiveCategories] = useState<Set<Category>>(
		() => new Set(CATEGORIES.map((c) => c.type)),
	);

	const toggleCategory = (cat: Category) => {
		setActiveCategories((prev) => {
			const next = new Set(prev);
			if (next.has(cat)) next.delete(cat);
			else next.add(cat);
			return next;
		});
	};

	// --- NAVIGAZIONE WASD + BLOCCAGGIO QUOTA ---
	const [altitudeLock, setAltitudeLock] = useState(false);
	const keysRef = useRef<Set<string>>(new Set());
	const altitudeLockRef = useRef(false);
	altitudeLockRef.current = altitudeLock;
	// Altezza (camera + target) memorizzata quando si attiva il blocco quota
	const lockedHeightRef = useRef<{ cam: number; target: number } | null>(null);

	// Velocità di navigazione WASD (moltiplicatore regolabile via slider)
	const [navSpeed, setNavSpeed] = useState(0.4);
	const navSpeedRef = useRef(0.4);
	navSpeedRef.current = navSpeed;

	const toggleAltitudeLock = () => {
		setAltitudeLock((prev) => {
			const next = !prev;
			if (next && cameraRef.current && controlsRef.current) {
				lockedHeightRef.current = {
					cam: cameraRef.current.position.y,
					target: controlsRef.current.target.y,
				};
			} else {
				lockedHeightRef.current = null;
			}
			return next;
		});
	};

	// Registra i tasti di navigazione premuti (ignora se si sta scrivendo in un campo)
	useEffect(() => {
		const isTyping = () => {
			const el = document.activeElement as HTMLElement | null;
			return (
				!!el &&
				(el.tagName === "INPUT" ||
					el.tagName === "TEXTAREA" ||
					el.tagName === "SELECT" ||
					el.isContentEditable)
			);
		};
		const NAV_KEYS = ["w", "a", "s", "d", "q", "e", " ", "shift"];
		const onDown = (e: KeyboardEvent) => {
			if (isTyping()) return;
			const k = e.key.toLowerCase();
			if (NAV_KEYS.includes(k)) keysRef.current.add(k);
		};
		const onUp = (e: KeyboardEvent) => {
			keysRef.current.delete(e.key.toLowerCase());
		};
		const clear = () => keysRef.current.clear();
		window.addEventListener("keydown", onDown);
		window.addEventListener("keyup", onUp);
		window.addEventListener("blur", clear);
		return () => {
			window.removeEventListener("keydown", onDown);
			window.removeEventListener("keyup", onUp);
			window.removeEventListener("blur", clear);
		};
	}, []);

	// AI Chat
	const [showAiChat, setShowAiChat] = useState(false);
	const [aiMessages, setAiMessages] = useState<{role: 'user' | 'ai'; text: string}[]>([
		{ role: 'ai', text: 'Ciao! Sono l\'assistente AI di Smart O&M. Ho accesso al modello 3D, ai pin, ai ticket, alle misure e ai documenti caricati. Chiedimi qualsiasi cosa sull\'impianto!' }
	]);
	const [aiInput, setAiInput] = useState('');
	const [isAiLoading, setIsAiLoading] = useState(false);
	const [aiMode, setAiMode] = useState<'documenti' | 'poi' | 'modello3d' | 'tutto'>('tutto');
	const aiAbortRef = useRef<AbortController | null>(null);

	// Kanban / ticket globali
	const [showKanban, setShowKanban] = useState(false);
	const [allSiteTickets, setAllSiteTickets] = useState<any[]>([]);
	const [isLoadingAllTickets, setIsLoadingAllTickets] = useState(false);

	// Model switcher
	const [showModelSwitcher, setShowModelSwitcher] = useState(false);
	const [siteModels, setSiteModels] = useState<any[]>([]);
	const [isLoadingModels, setIsLoadingModels] = useState(false);

	// Contacts modal
	const [showContacts, setShowContacts] = useState(false);
	const [isCreatingContact, setIsCreatingContact] = useState(false);
	// Se valorizzato, il form contatti è in modalità modifica (PUT) invece che creazione
	const [editingContactId, setEditingContactId] = useState<string | null>(null);
	const [newContact, setNewContact] = useState({ name: '', company: '', service_type: '', phone: '', email: '', notes: '' });

	// Catalogo servizi (ex pagina /services, ora modale nell'editor)
	const [showServices, setShowServices] = useState(false);

	// Subcategories
	const [subcategories, setSubcategories] = useState<{id: string; site_id: string; category: string; name: string}[]>([]);
	const [showNewSubcat, setShowNewSubcat] = useState<Category | null>(null);
	const [newSubcatName, setNewSubcatName] = useState('');
	const [annSubcategoryId, setAnnSubcategoryId] = useState<string | null>(null);

	// Site-level media (foto e documenti non legati a pin)
	const [showSiteMedia, setShowSiteMedia] = useState(false);
	const [sitePhotos, setSitePhotos] = useState<any[]>([]);
	const [siteDocuments, setSiteDocuments] = useState<any[]>([]);
	const [isLoadingSiteMedia, setIsLoadingSiteMedia] = useState(false);
	const [siteMediaTab, setSiteMediaTab] = useState<'foto' | 'documenti'>('foto');

	// 🔥 STATI GESTIONE TICKET, FOTO E MODIFICHE
	const [selectedPoi, setSelectedPoi] = useState<Annotation | null>(null);
	const [poiTickets, setPoiTickets] = useState<any[]>([]);
	const [poiPhotos, setPoiPhotos] = useState<any[]>([]);
	const [isLoadingTickets, setIsLoadingTickets] = useState(false);
	const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
	const [isEditingPoi, setIsEditingPoi] = useState(false);
	const [isCreatingTicketInline, setIsCreatingTicketInline] = useState(false);
	const [poiDocuments, setPoiDocuments] = useState<any[]>([]);
	const [isLoadingDocs, setIsLoadingDocs] = useState(false);

	// Dettaglio / modifica del singolo ticket
	const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
	const [isEditingTicket, setIsEditingTicket] = useState(false);
	const [isSavingTicket, setIsSavingTicket] = useState(false);
	const [ticketEditForm, setTicketEditForm] = useState({
		title: "",
		description: "",
		status: "open",
		priority: "medium",
		contact_id: ""
	});

	// Form Modifica POI
	const [editPoiForm, setEditPoiForm] = useState({
		title: "",
		description: "",
		severity: "info" as Severity,
		category: "generic" as Category,
		subcategory_id: null as string | null,
	});

	// Form Creazione Nuovo Ticket Inline (solo i campi realmente gestiti)
	const [inlineTicketForm, setInlineTicketForm] = useState({
		title: "",
		description: "",
		priority: "medium",
		contact_id: ""
	});

	const [measureDistance, setMeasureDistance] = useState<number | null>(null);
	const [slopeStats, setSlopeStats] = useState<{
		degrees: number;
		percent: number;
	} | null>(null);
	const [calculatedArea, setCalculatedArea] = useState<number | null>(null);
	const [calculatedArc, setCalculatedArc] = useState<{
		length: number;
		radius: number;
	} | null>(null);

	const [savedGeometries, setSavedGeometries] = useState<SavedGeometry[]>([]);
	const [pendingGeom, setPendingGeom] = useState<PendingGeometry>(null);
	const [geomName, setGeomName] = useState("");

	const annotGroupRef = useRef<THREE.Group | null>(null);
	const geometryPersistentGroupRef = useRef<THREE.Group | null>(null);
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
	const controlsRef = useRef<OrbitControls | null>(null);
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
	const modelMeshRef = useRef<THREE.Mesh | null>(null);
	// Riferimento alla scena: serve per forzare un render sincrono subito
	// prima di leggere i pixel del canvas (senza, il buffer WebGL può
	// risultare vuoto e le catture vengono nere).
	const sceneRef = useRef<THREE.Scene | null>(null);

	const toolRef = useRef<Tool>("navigate");
	toolRef.current = tool;

	const modelRadiusRef = useRef(1);
	const interactionPointsRef = useRef<THREE.Vector3[]>([]);
	const geometryPreviewRef = useRef<THREE.Group | null>(null);

	const [contacts, setContacts] = useState<any[]>([]);

	const savedGeomCountRef = useRef(0);
	savedGeomCountRef.current = savedGeometries.length;

	const drawPersistentGeometry = useCallback((geom: SavedGeometry): string => {
		const persistentGroup = geometryPersistentGroupRef.current;
		if (!persistentGroup || !mountRef.current) return "";

		const singleGeomGroup = new THREE.Group();
		singleGeomGroup.userData = { id: geom.id };

		const r = modelRadiusRef.current;
		const color =
			geom.type === "Misura"
				? 0x378add
				: geom.type === "Arco"
					? 0xef9f27
					: 0xe24b4a;

		// Marker di precisione su ogni vertice della misura
		geom.points.forEach((p) => {
			singleGeomGroup.add(buildPointMarker(p, color, r * 0.002));
		});

		let pointsToDraw: THREE.Vector3[] = [];
		if (geom.type === "Misura") {
			pointsToDraw = geom.points;
		} else if (geom.type === "Area") {
			pointsToDraw = [...geom.points, geom.points[0]];
			// Riempimento traslucido del poligono
			const fill = buildAreaFill(geom.points, color);
			if (fill) singleGeomGroup.add(fill);
		} else if (geom.type === "Arco" && geom.points.length === 3) {
			const curve = new THREE.CatmullRomCurve3(
				[geom.points[0], geom.points[1], geom.points[2]],
				false,
				"centripetal",
			);
			pointsToDraw = curve.getPoints(40);
		}

		if (pointsToDraw.length >= 2) {
			singleGeomGroup.add(
				buildGlowLine(
					pointsToDraw.flatMap((p) => [p.x, p.y, p.z]),
					color,
					mountRef.current.clientWidth,
					mountRef.current.clientHeight,
				),
			);
		}

		persistentGroup.add(singleGeomGroup);
		return singleGeomGroup.uuid;
	}, []);

	const openGeomModal = useCallback(
		(
			type: "Misura" | "Arco" | "Area",
			valueStr: string,
			points: THREE.Vector3[],
		) => {
			setGeomName(`${type} ${savedGeomCountRef.current + 1}`);
			setPendingGeom({ type, value: valueStr, points: [...points] });
		},
		[],
	);

	useEffect(() => {
	const fetchContacts = async () => {
		try {
			const res = await fetch(`${API_BASE}/api/contacts/site/` + siteId);
			if (res.ok) {
				const data = await res.json();
				setContacts(data);
			}
		} catch (err) {
			console.error("Errore nel caricamento dei contatti:", err);
		}
	};
	fetchContacts();
}, []);

	useEffect(() => {
		const fetchSubcategories = async () => {
			try {
				const res = await fetch(`${API_BASE}/api/subcategories?site_id=${siteId}`);
				if (res.ok) setSubcategories(await res.json());
			} catch {}
		};
		fetchSubcategories();
	}, [siteId]);

	const openGeomModalRef = useRef(openGeomModal);
	useEffect(() => {
		openGeomModalRef.current = openGeomModal;
	}, [openGeomModal]);

	const confirmGeometry = () => {
		if (!pendingGeom) return;
		const generatedId = Math.random().toString(36).substring(2, 9);

		const newGeom: SavedGeometry = {
			id: generatedId,
			name:
				geomName.trim() || `${pendingGeom.type} ${savedGeometries.length + 1}`,
			type: pendingGeom.type,
			value: pendingGeom.value,
			points: pendingGeom.points,
		};

		const meshUuid = drawPersistentGeometry(newGeom);
		newGeom.meshGroupUuid = meshUuid;

		setSavedGeometries((prev) => [...prev, newGeom]);
		notify("Rilievo salvato.", "success");

		interactionPointsRef.current = [];
		geometryPreviewRef.current?.clear();
		setPendingGeom(null);
		setGeomName("");
		setCalculatedArea(null);
	};

	const discardGeometry = () => {
		interactionPointsRef.current = [];
		geometryPreviewRef.current?.clear();
		setPendingGeom(null);
		setGeomName("");
		setCalculatedArea(null);
	};

	// Passa da modifica a sola lettura e viceversa. Uscendo dalla modifica si
	// torna alla navigazione e si annulla qualsiasi operazione in sospeso, così
	// da non lasciare pin/misure a metà quando si torna in modalità view.
	const toggleMode = () => {
		setMode((prev) => {
			const next = prev === "edit" ? "view" : "edit";
			if (next === "view") {
				setTool("navigate");
				setPending(null);
				setPendingGeom(null);
				setGeomName("");
				interactionPointsRef.current = [];
				geometryPreviewRef.current?.clear();
				setMeasureDistance(null);
				setSlopeStats(null);
				setCalculatedArea(null);
				setCalculatedArc(null);
			}
			return next;
		});
	};

	const removeGeometry = (id: string, uuid?: string) => {
		setSavedGeometries((prev) => prev.filter((g) => g.id !== id));

		const persistentGroup = geometryPersistentGroupRef.current;
		if (persistentGroup && uuid) {
			const meshObject = persistentGroup.children.find(
				(child) => child.uuid === uuid,
			);
			if (meshObject) {
				persistentGroup.remove(meshObject);
			}
		}
	};

	const triggerAreaConfirmation = () => {
		if (interactionPointsRef.current.length >= 3 && calculatedArea !== null) {
			openGeomModalRef.current(
				"Area",
				`${calculatedArea.toFixed(2)} m²`,
				interactionPointsRef.current,
			);
		}
	};

	const exportToCSV = () => {
		if (savedGeometries.length === 0) return;

		const headers = ["Nome", "Tipo", "Valore Calcolato"];
		const rows = savedGeometries.map((g) => {
			return [`"${g.name.replace(/"/g, '""')}"`, g.type, `"${g.value}"`];
		});

		const csvContent = [
			headers.join(","),
			...rows.map((e) => e.join(",")),
		].join("\n");
		const blob = new Blob(["\uFEFF" + csvContent], {
			type: "text/csv;charset=utf-8;",
		});
		const encodedUri = URL.createObjectURL(blob);

		const link = document.createElement("a");
		link.setAttribute("href", encodedUri);
		link.setAttribute("download", `Rilievo_Misure_${modelId || "Modello"}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(encodedUri);
	};

	// Sistema robusto di recupero coordinate
	const getPoiCoordinates = (ann: Annotation) => {
		const posX = ann.position?.x ?? ann.x ?? 0;
		const posY = ann.position?.y ?? ann.y ?? 0;
		const posZ = ann.position?.z ?? ann.z ?? 0;
		return { x: posX, y: posY, z: posZ };
	};

	const addAnnotationToScene = useCallback((ann: Annotation) => {
		const group = annotGroupRef.current;
		if (!group) return;
		const cam = cameraRef.current;
		const ctl = controlsRef.current;
		const dist = cam && ctl ? cam.position.distanceTo(ctl.target) : 10;

		const coords = getPoiCoordinates(ann);
		const container = new THREE.Group();
		container.userData.annId = ann.id;
		// Schema bicolore: un solo colore per pin (blu = normale, rosso = allerta)
		const pinColor = getPinBicolor(ann.severity);

		ensurePinLabelStyles();
		// Elemento esterno: gestito da CSS2DRenderer (transform riscritto ogni
		// frame). NIENTE stili o transizioni qui, altrimenti l'etichetta laggha.
		const labelHolder = document.createElement("div");
		const labelDiv = document.createElement("div");
		labelDiv.className = "smart-pin-label";
		labelDiv.style.setProperty("--pin-color", pinColor);

		// LED: anello pulsante + nucleo, entrambi nello stesso colore bicolore
		const led = document.createElement("span");
		led.style.cssText =
			"position: relative; display: flex; width: 9px; height: 9px; margin-right: 2px;";
		led.innerHTML = `
			<span style="position: absolute; display: inline-flex; height: 100%; width: 100%; border-radius: 50%; background-color: ${pinColor}; animation: smartPinPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></span>
			<span style="position: relative; display: inline-flex; border-radius: 50%; width: 9px; height: 9px; background-color: ${pinColor}; box-shadow: 0 0 6px ${pinColor}99;"></span>
		`;
		const titleSpan = document.createElement("span");
		titleSpan.textContent = ann.title;
		labelDiv.append(led, titleSpan);
		labelHolder.appendChild(labelDiv);

		labelDiv.addEventListener("click", (e) => {
			e.stopPropagation();
			if (handlePoiSelectRef.current) {
				handlePoiSelectRef.current(ann);
				focusAnnotation(ann);
			}
		});

		const labelObj = new CSS2DObject(labelHolder);
		const stalkHeight = dist * 0.08;
		const anchor = new THREE.Vector3(coords.x, coords.y, coords.z);

		// --- Punto di ancoraggio: nucleo pieno, punto bianco, guscio
		//     traslucido e alone luminoso additivo. Colore bicolore
		//     (blu = normale, rosso = allerta), coerente col LED dell'etichetta. ---
		const PIN_ACCENT = pinColor;
		const core = new THREE.Mesh(
			new THREE.SphereGeometry(1, 20, 20),
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(PIN_ACCENT),
				depthTest: false,
			}),
		);
		core.scale.setScalar(dist * 0.0032);
		core.position.copy(anchor);
		core.renderOrder = 999;
		container.add(core);

		const whiteDot = new THREE.Mesh(
			new THREE.SphereGeometry(1, 12, 12),
			new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
		);
		whiteDot.scale.setScalar(dist * 0.0014);
		whiteDot.position.copy(anchor);
		whiteDot.renderOrder = 1000;
		container.add(whiteDot);

		const shell = new THREE.Mesh(
			new THREE.SphereGeometry(1, 20, 20),
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(PIN_ACCENT),
				transparent: true,
				opacity: 0.14,
				depthTest: false,
			}),
		);
		shell.scale.setScalar(dist * 0.0052);
		shell.position.copy(anchor);
		shell.renderOrder = 997;
		container.add(shell);

		const glow = makeGlowSprite(PIN_ACCENT, dist * 0.013, 0.4);
		glow.position.copy(anchor);
		container.add(glow);

		// Stelo sottile neutro, coerente con i bordi bianchi traslucidi della UI
		const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
		const cylinderMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			depthTest: false,
			transparent: true,
			opacity: 0.35,
		});
		const stalk = new THREE.Mesh(cylinderGeo, cylinderMat);
		stalk.scale.set(dist * 0.0003, stalkHeight, dist * 0.0003);
		stalk.position.set(coords.x, coords.y + stalkHeight / 2, coords.z);
		stalk.renderOrder = 998;
		container.add(stalk);

		labelObj.position.set(coords.x, coords.y + stalkHeight, coords.z);
		container.add(labelObj);

		group.add(container);
	}, []);

	const handlePoiSelect = useCallback(
		async (poi: Annotation) => {
			setSelectedPoi(poi);
			setIsEditingPoi(false);
			setIsCreatingTicketInline(false);

			setEditPoiForm({
				title: poi.title,
				description: poi.description || "",
				severity: poi.severity,
				category: poi.category,
				subcategory_id: poi.subcategory_id || null,
			});

			setIsLoadingTickets(true);
			setIsLoadingPhotos(true);
			setIsLoadingDocs(true);

			try {
				const [ticketsRes, photosRes, docsRes] = await Promise.all([
					fetch(`${API_BASE}/api/tickets/site/${siteId}`).catch(
						() => null,
					),
					fetch(`${API_BASE}/api/photos?poi_id=${poi.id}`).catch(
						() => null,
					),
					fetch(`${API_BASE}/api/documents/poi/${poi.id}`).catch(
						() => null,
					),
				]);

				if (ticketsRes && ticketsRes.ok) {
					const tData = await ticketsRes.json();
					setPoiTickets(
						Array.isArray(tData)
							? tData.filter((t: any) => t.poi_id === poi.id)
							: [],
					);
				} else {
					setPoiTickets([]);
				}

				if (photosRes && photosRes.ok) {
					const pData = await photosRes.json();
					setPoiPhotos(Array.isArray(pData) ? pData : []);
				} else {
					setPoiPhotos([]);
				}

				if (docsRes && docsRes.ok) {
					const dData = await docsRes.json();
					setPoiDocuments(Array.isArray(dData) ? dData : []);
				} else {
					setPoiDocuments([]);
				}
			} catch (err) {
				console.error("Errore recupero logistica POI:", err);
			} finally {
				setIsLoadingTickets(false);
				setIsLoadingPhotos(false);
				setIsLoadingDocs(false);
			}
		},
		[siteId],
	);

	const handlePoiSelectRef = useRef(handlePoiSelect);
	useEffect(() => {
		handlePoiSelectRef.current = handlePoiSelect;
	}, [handlePoiSelect]);

	const handleUpdatePoi = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedPoi) return;

		try {
			const res = await fetch(
				`${API_BASE}/api/pois/${selectedPoi.id}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(editPoiForm),
				},
			);

			if (res.ok) {
				const updatedPoi = await res.json();
				setAnnotations((prev) =>
					prev.map((a) => (a.id === selectedPoi.id ? updatedPoi : a)),
				);
				setSelectedPoi(updatedPoi);
				setIsEditingPoi(false);
				notify("Modifiche al POI salvate.", "success");

				const group = annotGroupRef.current;
				if (group) {
					const oldObj = group.children.find(
						(c) => c.userData.annId === selectedPoi.id,
					);
					if (oldObj) {
						oldObj.traverse((child) => {
							if (child instanceof CSS2DObject) child.element.remove();
						});
						group.remove(oldObj);
					}
					addAnnotationToScene(updatedPoi);
				}
			}
		} catch (err) {
			notify("Impossibile salvare le modifiche apportate al POI.");
		}
	};

	// Upload foto legata al POI selezionato (usato da UploadDropzone).
	// Multer sul backend è configurato come upload.single("image"):
	// il campo DEVE chiamarsi "image".
	const uploadPoiPhoto = async (
		file: File,
		onProgress: (pct: number) => void,
	) => {
		if (!selectedPoi) return;
		const formData = new FormData();
		formData.append("image", file);
		formData.append("site_id", siteId); // il backend valida site_id come UUID
		formData.append("poi_id", selectedPoi.id);
		// caption è opzionale: usiamo il nome originale del file come default
		formData.append("caption", file.name);

		try {
			// Il backend ritorna la riga inserita in poi_photos
			// { id, poi_id, file_path, caption, created_at }
			const newPhoto = await xhrUpload(
				`${API_BASE}/api/photos`,
				formData,
				onProgress,
			);
			setPoiPhotos((prev) => [newPhoto, ...prev]);
			notify("Foto caricata.", "success");
		} catch (err) {
			console.error("Upload foto POI fallito:", err);
			notify("Errore durante il caricamento della foto.");
			throw err;
		}
	};

	const uploadPoiDoc = async (
		file: File,
		onProgress: (pct: number) => void,
	) => {
		if (!selectedPoi) return;
		const formData = new FormData();
		formData.append("file", file);
		formData.append("site_id", siteId as string);
		formData.append("poi_id", selectedPoi.id);

		try {
			const newDoc = await xhrUpload(
				`${API_BASE}/api/documents/upload`,
				formData,
				onProgress,
			);
			setPoiDocuments((prev) => [newDoc, ...prev]);
			notify("Documento caricato.", "success");
		} catch (err) {
			console.error("Upload documento POI fallito:", err);
			notify("Errore durante il caricamento del documento.");
			throw err;
		}
	};

	const handleDeleteDoc = async (docId: string) => {
		try {
			const res = await fetch(`${API_BASE}/api/documents/${docId}`, { method: "DELETE" });
			if (res.ok) {
				setPoiDocuments((prev) => prev.filter((d) => d.id !== docId));
			}
		} catch {
			notify("Errore durante l'eliminazione del documento.");
		}
	};

	const handleCreateSubcategory = async (category: Category) => {
		if (!newSubcatName.trim()) return;
		try {
			const res = await fetch(`${API_BASE}/api/subcategories`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ site_id: siteId, category, name: newSubcatName.trim() }),
			});
			if (res.ok) {
				const created = await res.json();
				setSubcategories((prev) => [...prev, created]);
				setNewSubcatName('');
				setShowNewSubcat(null);
				return created;
			}
		} catch {}
		return null;
	};

	const handleDeleteSubcategory = async (id: string) => {
		try {
			const res = await fetch(`${API_BASE}/api/subcategories/${id}`, { method: 'DELETE' });
			if (res.ok) setSubcategories((prev) => prev.filter((s) => s.id !== id));
		} catch {}
	};

	const fetchSiteMedia = async () => {
		setIsLoadingSiteMedia(true);
		try {
			const [photosRes, docsRes] = await Promise.all([
				fetch(`${API_BASE}/api/photos?site_general=true`).catch(() => null),
				fetch(`${API_BASE}/api/documents/site/${siteId}`).catch(() => null),
			]);
			if (photosRes?.ok) {
				const data = await photosRes.json();
				setSitePhotos(Array.isArray(data) ? data.filter((p: any) => !p.poi_id) : []);
			}
			if (docsRes?.ok) {
				const data = await docsRes.json();
				setSiteDocuments(Array.isArray(data) ? data.filter((d: any) => !d.poi_id) : []);
			}
		} catch {} finally {
			setIsLoadingSiteMedia(false);
		}
	};

	const uploadSitePhoto = async (
		file: File,
		onProgress: (pct: number) => void,
	) => {
		const formData = new FormData();
		formData.append("image", file);
		formData.append("site_id", siteId as string);
		formData.append("caption", file.name);
		try {
			const newPhoto = await xhrUpload(
				`${API_BASE}/api/photos`,
				formData,
				onProgress,
			);
			setSitePhotos((prev) => [newPhoto, ...prev]);
			notify("Foto del sito caricata.", "success");
		} catch (err) {
			console.error("Upload foto sito fallito:", err);
			notify("Errore durante il caricamento della foto.");
			throw err;
		}
	};

	const uploadSiteDoc = async (
		file: File,
		onProgress: (pct: number) => void,
	) => {
		const formData = new FormData();
		formData.append("file", file);
		formData.append("site_id", siteId as string);
		try {
			const newDoc = await xhrUpload(
				`${API_BASE}/api/documents/upload`,
				formData,
				onProgress,
			);
			setSiteDocuments((prev) => [newDoc, ...prev]);
			notify("Documento del sito caricato.", "success");
		} catch (err) {
			console.error("Upload documento sito fallito:", err);
			notify("Errore durante il caricamento del documento.");
			throw err;
		}
	};

const handleCreateInlineTicket = async (e: React.FormEvent) => {
	e.preventDefault();
	if (!selectedPoi || !inlineTicketForm.title.trim()) return;

	const payload = {
		site_id: siteId,
		poi_id: selectedPoi.id,
		title: inlineTicketForm.title.trim(),
		description: inlineTicketForm.description.trim(),
		priority: inlineTicketForm.priority,
		// Se è vuoto, mandiamo null
		contact_id: inlineTicketForm.contact_id ? inlineTicketForm.contact_id : null,
	};

	try {
		const res = await fetch(`${API_BASE}/api/tickets`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		if (res.ok) {
			const newTicket = await res.json();
			setPoiTickets((prev) => [
				{ ...newTicket, poi_id: selectedPoi.id },
				...prev,
			]);
			setIsCreatingTicketInline(false);
			setInlineTicketForm({
				title: "",
				description: "",
				priority: "medium",
				contact_id: "", // Resetta il form
			});
			notify("Ticket aperto.", "success");
		}
	} catch (err) {
		notify("Errore durante l'apertura del ticket.");
	}
};

	// Apertura dettaglio del ticket: recupera i dati aggiornati da GET /api/tickets/:id
	const handleSelectTicket = useCallback(async (ticket: any) => {
		setSelectedTicket(ticket);
		setIsEditingTicket(false);
		setTicketEditForm({
			title: ticket.title || "",
			description: ticket.description || "",
			status: ticket.status || "open",
			priority: ticket.priority || "medium",
			contact_id: ticket.contact_id || "", // Carica il contatto se esiste
		});

		// Aggiorniamo il dettaglio con i dati freschi dal server (best effort)
		try {
			const res = await fetch(
				`${API_BASE}/api/tickets/${ticket.id}`,
			).catch(() => null);
			if (res && res.ok) {
				const fresh = await res.json();
				setSelectedTicket((prev: any) =>
					prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev,
				);
				setTicketEditForm((prev) => ({
					title: fresh.title ?? prev.title,
					description: fresh.description ?? prev.description,
					status: fresh.status ?? prev.status,
					priority: fresh.priority ?? prev.priority,
				}));
			}
		} catch (err) {
			console.error("Errore recupero dettaglio ticket:", err);
		}
	}, []);

	// Salvataggio modifiche ticket: PUT /api/tickets/:id
	const handleUpdateTicket = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedTicket || !ticketEditForm.title.trim()) return;

		setIsSavingTicket(true);
		try {
			const res = await fetch(
				`${API_BASE}/api/tickets/${selectedTicket.id}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
					title: ticketEditForm.title.trim(),
					description: ticketEditForm.description.trim(),
					status: ticketEditForm.status,
					priority: ticketEditForm.priority,	
					contact_id: ticketEditForm.contact_id ? ticketEditForm.contact_id : null, 
				}),
				},
			);

			if (res.ok) {
				const updated = await res.json();
				// Manteniamo poi_id lato client (il PUT potrebbe non restituirlo)
				const merged = {
					...selectedTicket,
					...updated,
					poi_id: updated.poi_id ?? selectedTicket.poi_id,
				};
				setPoiTickets((prev) =>
					prev.map((t) => (t.id === merged.id ? merged : t)),
				);
				setSelectedTicket(merged);
				setIsEditingTicket(false);
				notify("Ticket aggiornato.", "success");
			} else {
				const msg = await res.text().catch(() => "");
				console.error("Update ticket fallito:", res.status, msg);
				notify("Errore durante l'aggiornamento del ticket.");
			}
		} catch (err) {
			console.error("Update ticket error:", err);
			notify("Impossibile aggiornare il ticket.");
		} finally {
			setIsSavingTicket(false);
		}
	};

	// Eliminazione ticket: DELETE /api/tickets/:id
	const handleDeleteTicket = async (id: string) => {
		try {
			const res = await fetch(`${API_BASE}/api/tickets/${id}`, {
				method: "DELETE",
			});
			if (res.ok) {
				setPoiTickets((prev) => prev.filter((t) => t.id !== id));
				setSelectedTicket(null);
			} else {
				notify("Impossibile eliminare il ticket.");
			}
		} catch (err) {
			console.error("Delete ticket error:", err);
			notify("Impossibile eliminare il ticket.");
		}
	};

	const fetchAllSiteTickets = useCallback(async () => {
		if (!siteId) return;
		setIsLoadingAllTickets(true);
		try {
			const res = await fetch(`${API_BASE}/api/tickets/site/${siteId}`);
			if (res.ok) {
				const data = await res.json();
				setAllSiteTickets(Array.isArray(data) ? data : []);
			}
		} catch (err) {
			console.error("Fetch all tickets error:", err);
		} finally {
			setIsLoadingAllTickets(false);
		}
	}, [siteId]);

	const openKanban = useCallback(() => {
		fetchAllSiteTickets();
		setShowKanban(true);
	}, [fetchAllSiteTickets]);

	const openModelSwitcher = useCallback(async () => {
		if (!siteId) return;
		setShowModelSwitcher(true);
		setIsLoadingModels(true);
		try {
			const res = await fetch(`${API_BASE}/api/models?site_id=${siteId}`);
			if (res.ok) {
				const data = await res.json();
				setSiteModels(Array.isArray(data) ? data : []);
			}
		} catch (err) {
			console.error("Fetch models error:", err);
		} finally {
			setIsLoadingModels(false);
		}
	}, [siteId]);

	const handleKanbanStatusChange = useCallback(async (ticketId: string, newStatus: string) => {
		try {
			const ticket = allSiteTickets.find((t) => t.id === ticketId);
			if (!ticket) return;
			const res = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...ticket, status: newStatus }),
			});
			if (res.ok) {
				setAllSiteTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: newStatus } : t));
				setPoiTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: newStatus } : t));
			}
		} catch (err) {
			console.error("Kanban status change error:", err);
		}
	}, [allSiteTickets]);

	const handleCreateContact = useCallback(async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newContact.name.trim() || !newContact.service_type.trim()) return;
		try {
			const res = await fetch(`${API_BASE}/api/contacts`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...newContact, site_id: siteId }),
			});
			if (res.ok) {
				const created = await res.json();
				setContacts((prev) => [...prev, created]);
				setIsCreatingContact(false);
				setNewContact({ name: '', company: '', service_type: '', phone: '', email: '', notes: '' });
			}
		} catch (err) {
			console.error('Create contact error:', err);
		}
	}, [newContact, siteId]);

	const handleDeleteContact = useCallback(async (id: string) => {
		try {
			const res = await fetch(`${API_BASE}/api/contacts/${id}`, { method: 'DELETE' });
			if (res.ok || res.status === 204) {
				setContacts((prev) => prev.filter((c) => c.id !== id));
			}
		} catch (err) {
			console.error('Delete contact error:', err);
		}
	}, []);

	// Precompila il form della rubrica con i dati del contatto da modificare
	const startEditContact = useCallback((c: any) => {
		setEditingContactId(c.id);
		setNewContact({
			name: c.name || '',
			company: c.company || '',
			service_type: c.service_type || '',
			phone: c.phone || '',
			email: c.email || '',
			notes: c.notes || '',
		});
		setIsCreatingContact(true);
	}, []);

	// Salvataggio modifiche contatto: PUT /api/contacts/:id (parità con la vecchia pagina /contacts)
	const handleUpdateContact = useCallback(async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingContactId || !newContact.name.trim() || !newContact.service_type.trim()) return;
		try {
			const res = await fetch(`${API_BASE}/api/contacts/${editingContactId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...newContact, site_id: siteId }),
			});
			if (res.ok) {
				const updated = await res.json();
				setContacts((prev) => prev.map((c) => (c.id === editingContactId ? { ...c, ...updated } : c)));
				setIsCreatingContact(false);
				setEditingContactId(null);
				setNewContact({ name: '', company: '', service_type: '', phone: '', email: '', notes: '' });
				notify("Contatto aggiornato.", "success");
			}
		} catch (err) {
			console.error('Update contact error:', err);
		}
	}, [editingContactId, newContact, siteId]);

	// Eliminazione foto del sito: DELETE /api/photos/:id (parità con la vecchia pagina /photos)
	const handleDeleteSitePhoto = useCallback(async (photoId: string) => {
		try {
			const res = await fetch(`${API_BASE}/api/photos/${photoId}`, { method: 'DELETE' });
			if (res.ok || res.status === 204) {
				setSitePhotos((prev) => prev.filter((p) => p.id !== photoId));
			}
		} catch (err) {
			console.error('Delete site photo error:', err);
		}
	}, []);

	const buildModelContext = useCallback(() => {
		const parts: string[] = [];

		if (annotations.length > 0) {
			parts.push(`PUNTI DI INTERESSE (${annotations.length} totali):`);
			const bySeverity = { critical: 0, warning: 0, info: 0, maintenance: 0 };
			annotations.forEach((a) => { bySeverity[a.severity as keyof typeof bySeverity] = (bySeverity[a.severity as keyof typeof bySeverity] || 0) + 1; });
			parts.push(`  Riepilogo: ${bySeverity.critical} critici, ${bySeverity.warning} warning, ${bySeverity.maintenance} manutenzione, ${bySeverity.info} info`);
			annotations.forEach((a) => {
				const cat = CATEGORIES.find((c) => c.type === a.category);
				const sub = a.subcategory_id ? subcategories.find((s) => s.id === a.subcategory_id) : null;
				let line = `  - "${a.title}" [${a.severity}] categoria: ${cat?.name || a.category}`;
				if (sub) line += ` > ${sub.name}`;
				if (a.description) line += ` — ${a.description}`;
				if (a.severity === 'maintenance') {
					if (a.maintenance_periodicity) line += ` | periodicità: ${a.maintenance_periodicity}`;
					if (a.maintenance_due_date) line += ` | scadenza: ${a.maintenance_due_date}`;
					if (a.maintenance_last_done) line += ` | ultimo intervento: ${a.maintenance_last_done}`;
				}
				parts.push(line);
			});
		}

		if (allSiteTickets.length > 0) {
			parts.push(`\nTICKET (${allSiteTickets.length} totali):`);
			const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
			allSiteTickets.forEach((t) => { byStatus[t.status as keyof typeof byStatus] = (byStatus[t.status as keyof typeof byStatus] || 0) + 1; });
			parts.push(`  Riepilogo: ${byStatus.open} aperti, ${byStatus.in_progress} in corso, ${byStatus.resolved} risolti, ${byStatus.closed} chiusi`);
			allSiteTickets.forEach((t) => {
				const poi = annotations.find((a) => a.id === t.poi_id);
				let line = `  - [${t.status}] "${t.title}"`;
				if (poi) line += ` (pin: "${poi.title}")`;
				if (t.description) line += ` — ${t.description}`;
				if (t.priority) line += ` | priorità: ${t.priority}`;
				parts.push(line);
			});
		}

		if (savedGeometries.length > 0) {
			parts.push(`\nMISURE/RILIEVI (${savedGeometries.length} totali):`);
			savedGeometries.forEach((g) => {
				parts.push(`  - "${g.name}" [${g.type}]: ${g.value}`);
			});
		}

		return parts.join('\n');
	}, [annotations, allSiteTickets, savedGeometries, subcategories]);

	const captureCanvasScreenshot = useCallback((): string | null => {
		const renderer = rendererRef.current;
		if (!renderer) return null;
		try {
			// Render sincrono prima della lettura: senza, il buffer può essere
			// vuoto e lo screenshot esce nero (stessa cosa per le anteprime).
			if (sceneRef.current && cameraRef.current) {
				renderer.render(sceneRef.current, cameraRef.current);
			}
			return renderer.domElement.toDataURL('image/jpeg', 0.85);
		} catch {
			return null;
		}
	}, []);

	const extractModelMetadata = useCallback((): string => {
		const mesh = modelMeshRef.current;
		if (!mesh) return 'Modello 3D non ancora caricato.';

		const geom = mesh.geometry;
		const parts: string[] = ['METADATI GEOMETRICI DEL MODELLO 3D:'];

		const vertexCount = geom.attributes.position?.count || 0;
		parts.push(`  Numero vertici/punti: ${vertexCount.toLocaleString('it-IT')}`);

		geom.computeBoundingBox();
		const bb = geom.boundingBox;
		if (bb) {
			const size = new THREE.Vector3();
			bb.getSize(size);
			parts.push(`  Bounding box (unità modello): ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
			parts.push(`  Min: (${bb.min.x.toFixed(2)}, ${bb.min.y.toFixed(2)}, ${bb.min.z.toFixed(2)})`);
			parts.push(`  Max: (${bb.max.x.toFixed(2)}, ${bb.max.y.toFixed(2)}, ${bb.max.z.toFixed(2)})`);

			const volume = size.x * size.y * size.z;
			parts.push(`  Volume bounding box: ${volume.toFixed(2)} unità³`);
			const area = 2 * (size.x * size.y + size.y * size.z + size.x * size.z);
			parts.push(`  Superficie bounding box: ${area.toFixed(2)} unità²`);
		}

		const bs = geom.boundingSphere;
		if (bs) {
			parts.push(`  Raggio bounding sphere: ${bs.radius.toFixed(2)} unità`);
		}

		const hasColors = !!geom.attributes.color;
		const hasNormals = !!geom.attributes.normal;
		parts.push(`  Dati colore vertici: ${hasColors ? 'Sì' : 'No'}`);
		parts.push(`  Dati normali: ${hasNormals ? 'Sì' : 'No'}`);

		if (hasColors && geom.attributes.color) {
			const colors = geom.attributes.color;
			let rSum = 0, gSum = 0, bSum = 0;
			const sampleSize = Math.min(vertexCount, 5000);
			const step = Math.max(1, Math.floor(vertexCount / sampleSize));
			let sampled = 0;
			for (let i = 0; i < vertexCount; i += step) {
				rSum += colors.getX(i);
				gSum += colors.getY(i);
				bSum += colors.getZ(i);
				sampled++;
			}
			if (sampled > 0) {
				const rAvg = Math.round((rSum / sampled) * 255);
				const gAvg = Math.round((gSum / sampled) * 255);
				const bAvg = Math.round((bSum / sampled) * 255);
				parts.push(`  Colore medio (RGB): (${rAvg}, ${gAvg}, ${bAvg})`);
			}
		}

		const cam = cameraRef.current;
		const ctl = controlsRef.current;
		if (cam && ctl) {
			parts.push(`\nVISTA CORRENTE CAMERA:`);
			parts.push(`  Posizione camera: (${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)})`);
			parts.push(`  Target camera: (${ctl.target.x.toFixed(2)}, ${ctl.target.y.toFixed(2)}, ${ctl.target.z.toFixed(2)})`);
			const dist = cam.position.distanceTo(ctl.target);
			parts.push(`  Distanza dal target: ${dist.toFixed(2)} unità`);
			parts.push(`  FOV: ${cam.fov}°`);
		}

		return parts.join('\n');
	}, []);

	const handleAiSend = useCallback(async () => {
		const text = aiInput.trim();
		if (!text || isAiLoading) return;

		setAiMessages((prev) => [...prev, { role: 'user', text }]);
		setAiInput('');
		setIsAiLoading(true);

		const aiMsgIndex = { current: -1 };
		setAiMessages((prev) => {
			aiMsgIndex.current = prev.length;
			return [...prev, { role: 'ai', text: '' }];
		});

		const controller = new AbortController();
		aiAbortRef.current = controller;

		try {
			const payload: any = {
				question: text,
				site_id: siteId,
				mode: aiMode,
			};

			if (aiMode === 'poi' || aiMode === 'tutto') {
				payload.model_context = buildModelContext();
			}

			if (aiMode === 'modello3d' || aiMode === 'tutto') {
				const screenshot = captureCanvasScreenshot();
				if (screenshot) payload.image = screenshot;
				const geoMeta = extractModelMetadata();
				payload.model_context = (payload.model_context ? payload.model_context + '\n\n' : '') + geoMeta;
			}

			const res = await fetch(`${API_BASE}/api/documents/ask`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!res.ok) {
				const err = await res.text().catch(() => '');
				throw new Error(err || `HTTP ${res.status}`);
			}

			if (!res.body) throw new Error('No response body');

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					try {
						const payload = JSON.parse(line.slice(6));
						if (payload.type === 'token') {
							setAiMessages((prev) => {
								const updated = [...prev];
								const idx = aiMsgIndex.current;
								if (idx >= 0 && updated[idx]) {
									updated[idx] = { ...updated[idx], text: updated[idx].text + payload.token };
								}
								return updated;
							});
						} else if (payload.type === 'error') {
							setAiMessages((prev) => {
								const updated = [...prev];
								const idx = aiMsgIndex.current;
								if (idx >= 0 && updated[idx]) {
									updated[idx] = { ...updated[idx], text: updated[idx].text || `Errore: ${payload.message}` };
								}
								return updated;
							});
						}
					} catch {}
				}
			}
		} catch (err: any) {
			if (err.name !== 'AbortError') {
				setAiMessages((prev) => {
					const updated = [...prev];
					const idx = aiMsgIndex.current;
					if (idx >= 0 && updated[idx] && !updated[idx].text) {
						updated[idx] = { ...updated[idx], text: 'Errore di connessione con il motore AI. Verifica che Ollama sia attivo.' };
					}
					return updated;
				});
			}
		} finally {
			setIsAiLoading(false);
			aiAbortRef.current = null;
		}
	}, [aiInput, isAiLoading, siteId, aiMode, buildModelContext, captureCanvasScreenshot, extractModelMetadata]);

	useEffect(() => {
		const fetchPois = async () => {
			try {
				const res = await fetch(
					`${API_BASE}/api/pois?model_id=${modelId}`,
				);
				if (res.ok) {
					const data: Annotation[] = await res.json();
					setAnnotations(data);
					if (annotGroupRef.current) annotGroupRef.current.clear();
					data.forEach((poi) => addAnnotationToScene(poi));
				}
			} catch (err) {
				console.error("Errore nel caricamento iniziale dei POI:", err);
			}
		};
		if (!loading) fetchPois();
	}, [loading, modelId, addAnnotationToScene]);

	// Cattura un'anteprima del modello per la pagina di scelta modelli.
	// Salvata in localStorage (nessuna modifica al backend): la card del
	// modello mostra l'ultima vista catturata da questo browser.
	useEffect(() => {
		if (loading || !modelId) return;
		const t = setTimeout(() => {
			try {
				const renderer = rendererRef.current;
				const src = renderer?.domElement;
				if (!renderer || !src || !src.width) return;
				// Render sincrono: garantisce che il buffer contenga il frame corrente
				if (sceneRef.current && cameraRef.current) {
					renderer.render(sceneRef.current, cameraRef.current);
				}
				const c = document.createElement("canvas");
				c.width = 480;
				c.height = Math.round((src.height / src.width) * 480);
				c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
				localStorage.setItem(
					`smartom_thumb_${modelId}`,
					c.toDataURL("image/jpeg", 0.72),
				);
			} catch {
				/* quota o canvas non pronti: l'anteprima resta quella precedente */
			}
		}, 1500);
		return () => clearTimeout(t);
	}, [loading, modelId]);

	// Sincronizza la visibilità dei marker 3D con il filtro categorie
	useEffect(() => {
		const group = annotGroupRef.current;
		if (!group) return;
		const byId = new Map(annotations.map((a) => [a.id, a]));
		group.children.forEach((child) => {
			const ann = byId.get(child.userData.annId);
			if (!ann) return;
			child.visible = activeCategories.has(
				(ann.category as Category) || "generic",
			);
		});
	}, [activeCategories, annotations]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		mount.innerHTML = "";

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x0c0c0e);
		sceneRef.current = scene;

		const camera = new THREE.PerspectiveCamera(
			60,
			mount.clientWidth / mount.clientHeight,
			0.01,
			5000,
		);
		cameraRef.current = camera;

		const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		// Render nitido su display HiDPI/Retina (cap a 2x per non pesare sulla GPU)
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		mount.appendChild(renderer.domElement);
		rendererRef.current = renderer;

		const labelRenderer = new CSS2DRenderer();
		labelRenderer.setSize(mount.clientWidth, mount.clientHeight);
		labelRenderer.domElement.style.position = "absolute";
		labelRenderer.domElement.style.top = "0";
		labelRenderer.domElement.style.left = "0";
		labelRenderer.domElement.style.pointerEvents = "none";
		// Sopra la vignettatura estetica (z-1), sotto i pannelli UI (z-10+)
		labelRenderer.domElement.style.zIndex = "2";
		mount.appendChild(labelRenderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;
		controls.rotateSpeed = 0.8;
		controls.zoomSpeed = 1.2;
		controls.panSpeed = 1.0;

		controls.mouseButtons = {
			LEFT: THREE.MOUSE.ROTATE,
			MIDDLE: THREE.MOUSE.PAN,
			RIGHT: THREE.MOUSE.PAN,
		};
		controlsRef.current = controls;

		scene.add(new THREE.AmbientLight(0xffffff, 0.65));
		const d1 = new THREE.DirectionalLight(0xffffff, 0.8);
		d1.position.set(1, 1.5, 1);
		scene.add(d1);

		const annotGroup = new THREE.Group();
		scene.add(annotGroup);
		annotGroupRef.current = annotGroup;

		const persistentGroup = new THREE.Group();
		persistentGroup.renderOrder = 90;
		scene.add(persistentGroup);
		geometryPersistentGroupRef.current = persistentGroup;

		const measureGroup = new THREE.Group();
		measureGroup.renderOrder = 100;
		scene.add(measureGroup);
		geometryPreviewRef.current = measureGroup;

		// Bersaglio del raycaster. Per gli splat il click viene risolto in due modi:
		//  1) raycast PRECISO sugli splat reali (octree di mkkellogg) — è quello
		//     che dà la posizione esatta del pin sulla superficie;
		//  2) fallback su una mesh DSM proxy (heightfield dai centri) finché
		//     l'octree non è pronto, o se il raycast splat non trova nulla.
		let model: THREE.Object3D | null = null;
		const raycaster = new THREE.Raycaster();
		let floorLimitY = 0; // limite inferiore di quota (catturato da animate())

		// Raycasting preciso sugli splat (mkkellogg). La classe Raycaster non è
		// esportata dal pacchetto, ma il Viewer ne crea un'istanza interna
		// (viewer.viewer.raycaster) che riusiamo dopo il caricamento.
		let splatMeshForRay: any = null;
		let splatRaycaster: any = null;
		const gsScreenPos = new THREE.Vector2();
		const gsScreenDim = new THREE.Vector2();
		const gsHits: any[] = [];

		const viewer = new GaussianSplats3D.DropInViewer({
			sharedMemoryForWorkers: false,
			dynamicScene: false,
		});
		scene.add(viewer);

		viewer
			.addSplatScene(url, {
				showLoadingUI: false,
				format: resolveSceneFormat(format), // sog/ply → Ply, splat → Splat…
			})
			.then(() => {
				viewer.rotation.x = Math.PI;
				viewer.updateMatrixWorld(true);

				const splatMesh = viewer.viewer?.splatMesh;
				if (splatMesh) {
					// Bersaglio per il raycast preciso + costruzione dell'octree
					// degli splat (async, in worker). Finché non è pronto si usa
					// il fallback DSM.
					splatMeshForRay = splatMesh;
					splatRaycaster = viewer.viewer?.raycaster || null;
					if (splatRaycaster) {
						// intersezione col vero ellissoide della gaussiana → max precisione
						splatRaycaster.raycastAgainstTrueSplatEllipsoid = true;
					}
					try {
						splatMesh
							.buildSplatTree?.([0])
							?.then(() => {
								console.log("[SPLAT] Octree pronto: raycast preciso attivo.");
							})
							.catch((e: unknown) =>
								console.warn("[SPLAT] buildSplatTree fallita:", e),
							);
					} catch (e) {
						console.warn("[SPLAT] buildSplatTree non disponibile:", e);
					}

					const splatCount = splatMesh.getSplatCount?.() ?? 0;
					if (splatCount > 0) {
						const xs: number[] = [],
							ys: number[] = [],
							zs: number[] = [];
						const c = new THREE.Vector3();
						const stride = Math.max(1, Math.floor(splatCount / 20000));
						const rawCenters = new Float32Array(splatCount * 3);

						for (let i = 0; i < splatCount; i++) {
							splatMesh.getSplatCenter(i, c);
							rawCenters[i * 3] = c.x;
							rawCenters[i * 3 + 1] = c.y;
							rawCenters[i * 3 + 2] = c.z;
							if (i % stride === 0) {
								c.applyMatrix4(viewer.matrixWorld);
								xs.push(c.x);
								ys.push(c.y);
								zs.push(c.z);
							}
						}

						xs.sort((a, b) => a - b);
						ys.sort((a, b) => a - b);
						zs.sort((a, b) => a - b);

						const p2 = Math.floor(xs.length * 0.02);
						const p98 = Math.floor(xs.length * 0.98);
						const centerX = (xs[p2] + xs[p98]) / 2;
						const centerZ = (zs[p2] + zs[p98]) / 2;
						const bottomY = ys[p2];
						const topY = ys[p98];

						viewer.position.set(-centerX, -bottomY, -centerZ);
						viewer.updateMatrixWorld(true);

						const sizeX = xs[p98] - xs[p2];
						const sizeY = topY - bottomY;
						const sizeZ = zs[p98] - zs[p2];
						const maxDim = Math.max(sizeX, sizeY, sizeZ);
						floorLimitY = 0;

						// "Raggio" equivalente per marker misure / zoom annotazioni.
						modelRadiusRef.current = maxDim * 0.5;

						const centerY = sizeY / 2;
						controls.target.set(0, centerY, 0);
						const fitDistance = maxDim * 1.0;
						camera.position.set(0, centerY + maxDim * 0.25, fitDistance);
						camera.near = 0.1;
						camera.far = 15000;
						camera.updateProjectionMatrix();
						controls.update();
						// Salva l'inquadratura come stato di "Reset vista".
						controls.saveState();

						const { mesh, error } = createDSMMesh(
							rawCenters,
							viewer.matrixWorld,
						);
						if (error) {
							console.error("[SPLAT] Errore generazione Proxy Mesh:", error);
						} else if (mesh) {
							model = mesh;
							scene.add(mesh);
							modelMeshRef.current = mesh;
						}
					}
				}

				setLoadProgress(100);
				setLoading(false);
			})
			.catch((e: unknown) => {
				console.error("Splat error:", e);
				setLoadError("Impossibile caricare il modello.");
				setLoading(false);
			});

		const mouse = new THREE.Vector2();

		function raycastModel(clientX: number, clientY: number) {
			const rect = renderer.domElement.getBoundingClientRect();

			// 1) Raycast PRECISO sugli splat reali (se l'octree è pronto).
			if (
				splatMeshForRay &&
				splatRaycaster &&
				splatMeshForRay.getSplatTree?.()
			) {
				gsScreenPos.set(clientX - rect.left, clientY - rect.top);
				gsScreenDim.set(rect.width, rect.height);
				splatRaycaster.setFromCameraAndScreenPosition(
					camera,
					gsScreenPos,
					gsScreenDim,
				);
				gsHits.length = 0;
				splatRaycaster.intersectSplatMesh(splatMeshForRay, gsHits);
				if (gsHits.length > 0) {
					// intersectSplatMesh restituisce gli hit ordinati per distanza:
					// il primo è la superficie più vicina alla camera.
					return { point: gsHits[0].origin.clone() };
				}
			}

			// 2) Fallback: mesh DSM proxy (finché l'octree non è pronto).
			if (!model) return null;
			mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
			mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(mouse, camera);
			return raycaster.intersectObject(model, false)[0] || null;
		}

		let downX = 0,
			downY = 0;
		function onPointerDown(e: PointerEvent) {
			downX = e.clientX;
			downY = e.clientY;
		}

		function onPointerUp(e: PointerEvent) {
			if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
			// In sola lettura nessun click sulla superficie crea pin/misure.
			if (!isEditRef.current) return;
			const t = toolRef.current;
			if (t === "navigate") return;

			const hit = raycastModel(e.clientX, e.clientY);
			if (!hit) return;

			if (t === "pin") {
				setPending({ type: "pin", position: hit.point.clone() });
				return;
			}

			const mPoints = interactionPointsRef.current;
			const previewGroup = geometryPreviewRef.current;
			if (!previewGroup) return;
			const r = modelRadiusRef.current;

			if (t === "measure") {
				if (mPoints.length >= 2) {
					mPoints.length = 0;
					previewGroup.clear();
					setMeasureDistance(null);
					setSlopeStats(null);
				}

				mPoints.push(hit.point.clone());
				previewGroup.add(buildPointMarker(hit.point, 0x378add, r * 0.002));

				if (mPoints.length === 2) {
					const pointsArray = [
						mPoints[0].x,
						mPoints[0].y,
						mPoints[0].z,
						mPoints[1].x,
						mPoints[1].y,
						mPoints[1].z,
					];
					previewGroup.add(
						buildGlowLine(
							pointsArray,
							0x378add,
							mount.clientWidth,
							mount.clientHeight,
						),
					);

					const dist = mPoints[0].distanceTo(mPoints[1]);
					setMeasureDistance(dist);

					const dx = mPoints[1].x - mPoints[0].x;
					const dy = mPoints[1].y - mPoints[0].y;
					const dz = mPoints[1].z - mPoints[0].z;
					const horizontalDist = Math.hypot(dx, dz);

					let slopeText = "";
					if (horizontalDist > 0.0001) {
						const rad = Math.atan(Math.abs(dy) / horizontalDist);
						const deg = rad * (180 / Math.PI);
						const pct = (Math.abs(dy) / horizontalDist) * 100;
						setSlopeStats({ degrees: deg, percent: pct });
						slopeText = ` (${deg.toFixed(1)}° / ${pct.toFixed(1)}%)`;
					} else {
						setSlopeStats({ degrees: 90, percent: Infinity });
						slopeText = ` (90.0° / Verticale)`;
					}

					openGeomModalRef.current(
						"Misura",
						`${dist.toFixed(2)} m${slopeText}`,
						mPoints,
					);
				}
			}

			if (t === "arc") {
				if (mPoints.length >= 3) {
					mPoints.length = 0;
					previewGroup.clear();
					setCalculatedArc(null);
				}

				mPoints.push(hit.point.clone());
				previewGroup.add(buildPointMarker(hit.point, 0xef9f27, r * 0.002));

				if (mPoints.length === 3) {
					const [p1, p2, p3] = mPoints;
					const curve = new THREE.CatmullRomCurve3(
						[p1, p2, p3],
						false,
						"centripetal",
					);
					const curvePoints = curve.getPoints(40);

					let totalLength = 0;
					for (let i = 0; i < curvePoints.length - 1; i++) {
						totalLength += curvePoints[i].distanceTo(curvePoints[i + 1]);
					}

					const chord = p1.distanceTo(p3);
					const midChordPoint = new THREE.Vector3()
						.addVectors(p1, p3)
						.multiplyScalar(0.5);
					const sagitta = p2.distanceTo(midChordPoint);

					let radius = 0;
					if (sagitta > 0.0001) {
						radius = sagitta / 2 + (chord * chord) / (8 * sagitta);
					} else {
						radius = Infinity;
					}

					setCalculatedArc({ length: totalLength, radius: radius });

					previewGroup.add(
						buildGlowLine(
							curvePoints.flatMap((p) => [p.x, p.y, p.z]),
							0xef9f27,
							mount.clientWidth,
							mount.clientHeight,
						),
					);

					const radText =
						radius === Infinity ? "Piano" : `${radius.toFixed(2)} m`;
					openGeomModalRef.current(
						"Arco",
						`Sviluppo: ${totalLength.toFixed(2)} m, Raggio: ${radText}`,
						mPoints,
					);
				}
			}

			if (t === "area") {
				mPoints.push(hit.point.clone());
				previewGroup.add(buildPointMarker(hit.point, 0xe24b4a, r * 0.002));

				// Rimuove perimetro e riempimento precedenti (vengono ricostruiti)
				const stale = previewGroup.children.filter(
					(c) =>
						c instanceof THREE.Line ||
						(c as any).isLine2 ||
						c.userData.isGlowLine ||
						c.userData.isAreaFill,
				);
				stale.forEach((l) => previewGroup.remove(l));

				if (mPoints.length >= 2) {
					const linePoints = [...mPoints, mPoints[0]];
					previewGroup.add(
						buildGlowLine(
							linePoints.flatMap((p) => [p.x, p.y, p.z]),
							0xe24b4a,
							mount.clientWidth,
							mount.clientHeight,
						),
					);
				}

				// Anteprima del riempimento traslucido dell'area
				if (mPoints.length >= 3) {
					const fill = buildAreaFill(mPoints, 0xe24b4a);
					if (fill) previewGroup.add(fill);
				}

				if (mPoints.length >= 3) {
					const areaNormal = new THREE.Vector3();
					for (let i = 0; i < mPoints.length; i++) {
						const va = mPoints[i];
						const vb = mPoints[(i + 1) % mPoints.length];
						areaNormal.x += va.y * vb.z - va.z * vb.y;
						areaNormal.y += va.z * vb.x - va.x * vb.z;
						areaNormal.z += va.x * vb.y - va.y * vb.x;
					}
					setCalculatedArea(areaNormal.length() * 0.5);
				}
			}
		}

		renderer.domElement.addEventListener("pointerdown", onPointerDown);
		renderer.domElement.addEventListener("pointerup", onPointerUp);

		const navClock = new THREE.Clock();
		let raf = 0;
		function animate() {
			raf = requestAnimationFrame(animate);
			const delta = navClock.getDelta();

			if (controlsRef.current) {
				const ctl = controlsRef.current;

				// Navigazione WASD sul piano orizzontale (relativa alla camera)
				const keys = keysRef.current;
				if (keys.size > 0) {
					const dist = camera.position.distanceTo(ctl.target) || 1;
					const speed = dist * navSpeedRef.current * delta;
					const forward = new THREE.Vector3();
					camera.getWorldDirection(forward);
					forward.y = 0;
					forward.normalize();
					const right = new THREE.Vector3()
						.crossVectors(forward, camera.up)
						.normalize();
					const move = new THREE.Vector3();
					if (keys.has("w")) move.add(forward);
					if (keys.has("s")) move.sub(forward);
					if (keys.has("d")) move.add(right);
					if (keys.has("a")) move.sub(right);
					// Salita/discesa solo se la quota NON è bloccata
					if (!altitudeLockRef.current) {
						if (keys.has(" ") || keys.has("e")) move.y += 1;
						if (keys.has("shift") || keys.has("q")) move.y -= 1;
					}
					if (move.lengthSq() > 0) {
						move.normalize().multiplyScalar(speed);
						camera.position.add(move);
						ctl.target.add(move);
					}
				}

				ctl.update();

				// Bloccaggio in quota: forza l'altezza dopo l'update di OrbitControls
				if (altitudeLockRef.current && lockedHeightRef.current) {
					camera.position.y = lockedHeightRef.current.cam;
					ctl.target.y = lockedHeightRef.current.target;
				}
			}

			if (camera.position.y < floorLimitY) camera.position.y = floorLimitY;
			renderer.render(scene, camera);
			labelRenderer.render(scene, camera);
		}
		animate();

		const ro = new ResizeObserver(() => {
			camera.aspect = mount.clientWidth / mount.clientHeight;
			camera.updateProjectionMatrix();
			// Ricalcola il DPR: cambia quando la finestra passa tra monitor diversi
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(mount.clientWidth, mount.clientHeight);
			labelRenderer.setSize(mount.clientWidth, mount.clientHeight);

			scene.traverse((child: any) => {
				if (child.isLine2 && child.material) {
					child.material.resolution.set(mount.clientWidth, mount.clientHeight);
				}
			});
		});
		ro.observe(mount);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			renderer.domElement.removeEventListener("pointerdown", onPointerDown);
			renderer.domElement.removeEventListener("pointerup", onPointerUp);
			controls.dispose();
			try {
				scene.remove(viewer);
				viewer.dispose?.();
			} catch (e) {
				console.warn("[SPLAT] dispose viewer:", e);
			}
			renderer.dispose();
			mount.innerHTML = "";
		};
	}, [url]);

	useEffect(() => {
		if (tool !== "area") {
			interactionPointsRef.current = [];
			geometryPreviewRef.current?.clear();
			setMeasureDistance(null);
			setSlopeStats(null);
			setCalculatedArea(null);
			setCalculatedArc(null);
		}

		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				interactionPointsRef.current = [];
				geometryPreviewRef.current?.clear();
				setMeasureDistance(null);
				setSlopeStats(null);
				setCalculatedArea(null);
				setCalculatedArc(null);
				setPending(null);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [tool]);

	// Scorciatoie tastiera per gli strumenti (come promesso nei tooltip).
	// Nota: W/A/S/D/Q/E sono riservati alla navigazione, quindi l'Area usa R.
	// Gli strumenti di modifica sono attivi solo in modalità Modifica.
	useEffect(() => {
		const isTyping = () => {
			const el = document.activeElement as HTMLElement | null;
			return (
				!!el &&
				(el.tagName === "INPUT" ||
					el.tagName === "TEXTAREA" ||
					el.tagName === "SELECT" ||
					el.isContentEditable)
			);
		};
		const onToolKey = (e: KeyboardEvent) => {
			if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
			const k = e.key.toLowerCase();
			if (k === "h") setTool("navigate");
			if (!isEditRef.current) return;
			if (k === "p") setTool("pin");
			if (k === "m") setTool("measure");
			if (k === "r") setTool("area");
			if (k === "c") setTool("arc");
		};
		window.addEventListener("keydown", onToolKey);
		return () => window.removeEventListener("keydown", onToolKey);
	}, []);

	// Cursore contestuale: mano per la navigazione, mirino per gli strumenti
	// di precisione (pin e misure).
	useEffect(() => {
		const el = mountRef.current;
		if (!el) return;
		el.style.cursor = tool === "navigate" ? "grab" : "crosshair";
	}, [tool]);

	const confirmAnnotation = useCallback(async () => {
		if (!pending || !annTitle.trim()) return;
		const p = pending.position;
		const isMaintenance = annSeverity === "maintenance";

		const payload = {
			model_id: modelId,
			site_id: siteId,
			position: { x: p.x, y: p.y, z: p.z },
			x: p.x,
			y: p.y,
			z: p.z,
			title: annTitle.trim(),
			description: annDescription.trim() || null,
			severity: annSeverity,
			category: annCategory,
			subcategory_id: annSubcategoryId || null,
			// Campi manutenzione: valorizzati solo per i pin di tipo "maintenance"
			maintenance_periodicity: isMaintenance ? annMaintenancePeriodicity : null,
			maintenance_last_done: isMaintenance
				? annMaintenanceLastDone || null
				: null,
			maintenance_due_date: isMaintenance
				? annMaintenanceDueDate || null
				: null,
		};

		try {
			const res = await fetch(`${API_BASE}/api/pois`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				// Rendiamo visibile l'errore del backend: è la causa più comune
				// per cui un pin (es. manutenzione) non compare nel modello.
				const msg = await res.text().catch(() => "");
				console.error("Creazione POI fallita:", res.status, msg);
				notify(
					`Impossibile salvare il pin (HTTP ${res.status}).\n${
						msg ||
						"Verifica che il backend accetti la severità 'maintenance' e i campi manutenzione."
					}`,
				);
				return; // manteniamo aperta la modale per non perdere i dati inseriti
			}

			const savedPoi: Annotation = await res.json();
			addAnnotationToScene(savedPoi);
			setAnnotations((prev) => [...prev, savedPoi]);
			notify("Pin salvato.", "success");
		} catch (err) {
			console.error("Errore di rete:", err);
			notify("Errore di rete durante il salvataggio del pin.");
			return;
		}

		setPending(null);
		setAnnTitle("");
		setAnnDescription("");
		setAnnSeverity("info");
		setAnnCategory("generic");
		setAnnMaintenancePeriodicity("monthly");
		setAnnMaintenanceLastDone("");
		setAnnMaintenanceDueDate("");
	}, [
		pending,
		annTitle,
		annDescription,
		annSeverity,
		annCategory,
		annMaintenancePeriodicity,
		annMaintenanceLastDone,
		annMaintenanceDueDate,
		modelId,
		siteId,
		addAnnotationToScene,
	]);

	const cancelAnnotation = useCallback(() => {
		setPending(null);
		setAnnTitle("");
		setAnnDescription("");
		setAnnSeverity("info");
		setAnnCategory("generic");
		setAnnMaintenancePeriodicity("monthly");
		setAnnMaintenanceLastDone("");
		setAnnMaintenanceDueDate("");
	}, []);

	async function removeAnnotation(id: string) {
		try {
			const res = await fetch(`${API_BASE}/api/pois/${id}`, {
				method: "DELETE",
			});
			if (res.ok) {
				setAnnotations((prev) => prev.filter((a) => a.id !== id));
				const group = annotGroupRef.current;
				if (group) {
					const obj = group.children.find((c) => c.userData.annId === id);
					if (obj) {
						obj.traverse((child) => {
							if (child instanceof CSS2DObject) child.element.remove();
						});
						group.remove(obj);
					}
				}
				if (selectedPoi?.id === id) setSelectedPoi(null);
			}
		} catch (err) {
			console.error("Errore cancellazione:", err);
		}
	}

	function focusAnnotation(ann: Annotation) {
		const ctl = controlsRef.current;
		const cam = cameraRef.current;
		if (!ctl || !cam) return;
		const coords = getPoiCoordinates(ann);
		const target = new THREE.Vector3(coords.x, coords.y, coords.z);
		const currentDist = cam.position.distanceTo(ctl.target);
		const zoomDist = Math.min(currentDist * 0.45, modelRadiusRef.current * 0.6);
		const dir = cam.position.clone().sub(ctl.target).normalize();
		const newCamPos = target.clone().add(dir.multiplyScalar(zoomDist));

		const startTarget = ctl.target.clone();
		const startCam = cam.position.clone();
		const duration = 500;
		const startTime = performance.now();

		function animateZoom(now: number) {
			const t = Math.min((now - startTime) / duration, 1);
			const ease = 1 - Math.pow(1 - t, 3);
			ctl!.target.lerpVectors(startTarget, target, ease);
			cam!.position.lerpVectors(startCam, newCamPos, ease);
			ctl!.update();
			if (t < 1) requestAnimationFrame(animateZoom);
		}
		requestAnimationFrame(animateZoom);
	}

	// Costruisce l'URL dell'immagine sfruttando lo streaming del backend:
	// GET /api/photos/stream?path=<file_path assoluto salvato nel DB>
	const getPhotoUrl = (img: any) =>
		img?.file_path
			? `${API_BASE}/api/photos/stream?path=${encodeURIComponent(
					img.file_path,
				)}`
			: img?.url || "";

	const handleViewPhoto = (img: any) => {
		const photoUrl = getPhotoUrl(img);
		if (photoUrl) window.open(photoUrl, "_blank");
	};

	// Tooltip ricco (nome + descrizione) mostrato sotto i controlli della top
	// bar: istantaneo e coerente col design, al posto dei title del browser.
	const topTip = (label: string, desc?: string) => (
		<span className='absolute top-[calc(100%+10px)] left-1/2 -translate-x-1/2 flex flex-col items-center px-3 py-1.5 rounded-[8px] bg-[#1b1c1f] border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.55)] opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 z-50 whitespace-nowrap'>
			<span className='text-[11px] font-semibold text-[#f0f0ec] leading-tight'>
				{label}
			</span>
			{desc && (
				<span className='text-[11px] text-[#a1a19d] leading-tight'>{desc}</span>
			)}
		</span>
	);

	const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
		<button
			onClick={() => setTool(t)}
			className={`group relative flex items-center justify-center w-10 h-10 rounded-full transition-all ${
				tool === t
					? "bg-[#0639DE] text-white shadow-[0_2px_12px_rgba(6,57,222,0.35)]"
					: "text-[#a1a19d] hover:bg-white/[0.06] hover:text-[#f0f0ec]"
			}`}
		>
			<span className='[&>svg]:h-[18px] [&>svg]:w-[18px]'>{icon}</span>
			<span className='absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-[#161618] text-[#f0f0ec] px-2.5 py-1.5 rounded-[7px] text-[11px] font-medium whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0 translate-y-1 transition-all border border-white/[0.06]'>
				{label}
			</span>
		</button>
	);

	return (
		<div className='fixed inset-0 bg-[#0c0c0e] select-none overflow-hidden w-screen h-screen'>
			<div ref={mountRef} className='absolute inset-0 w-full h-full' />

			{/* Vignettatura cinematografica: dà profondità alla scena 3D.
			    pointer-events-none, sotto le etichette (z-2) e la UI (z-10+). */}
			<div
				className='absolute inset-0 pointer-events-none z-[1]'
				style={{
					background:
						"radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.32) 100%)",
				}}
			/>

			{/* ===== TOP BAR (glass panel) ===== */}
			<div className='absolute top-2.5 left-2.5 right-2.5 h-[52px] flex items-center justify-between gap-3 px-4 bg-[#161618]/82 backdrop-blur-[40px] saturate-[160%] border border-white/[0.06] rounded-[14px] shadow-[0_8px_40px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.03)] pointer-events-auto z-30'>
				{/* Brand */}
				<div className='flex items-center gap-2.5'>
					<div className='flex items-center justify-center h-[26px] w-[26px] rounded-[7px] bg-gradient-to-br from-[#FF2D00] to-[#FFB800] shadow-[0_2px_8px_rgba(255,45,0,0.25)]'>
						<CubeTransparentIcon className='h-3.5 w-3.5 text-white' />
					</div>
					<span className='text-[13px] font-extrabold tracking-[1.5px] bg-gradient-to-r from-[#f0f0ec] to-[#a1a19d] bg-clip-text text-transparent'>
						SMART O&M
					</span>
				</div>

				{/* Status indicators */}
				<div className='flex items-center gap-1.5'>
					<button
						onClick={() => {
							setSelectedPoi(null);
							setLeftTab('punti');
						}}
						className='group relative flex items-center gap-[7px] bg-white/[0.03] px-3 py-[5px] rounded-full text-[11px] font-semibold text-[#a1a19d] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all cursor-pointer'
					>
						<span className='w-1.5 h-1.5 rounded-full' style={{ background: annotations.length > 0 ? '#ef4444' : '#34a853', boxShadow: annotations.length > 0 ? '0 0 6px rgba(239,68,68,0.4)' : '0 0 6px rgba(52,168,83,0.4)' }} />
						{annotations.length} Pin
						{topTip("Punti di interesse", "Clicca per aprire l'elenco dei pin")}
					</button>
					<div className='group relative flex items-center gap-[7px] bg-white/[0.03] px-3 py-[5px] rounded-full text-[11px] font-semibold text-[#a1a19d] border border-white/[0.05]'>
						<span className='w-1.5 h-1.5 rounded-full bg-[#a1a19d]' />
						{savedGeometries.length} Misure
						{topTip("Rilievi di questa sessione", "Distanze, aree e archi — esportabili in CSV")}
					</div>
					<button
						onClick={openKanban}
						className='group relative flex items-center gap-[7px] bg-white/[0.03] px-3 py-[5px] rounded-full text-[11px] font-semibold text-[#a1a19d] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all cursor-pointer'
					>
						<span className='w-1.5 h-1.5 rounded-full bg-[#D97706]' style={{ boxShadow: '0 0 6px rgba(217,119,6,0.4)' }} />
						Ticket
						{topTip("Board Ticket", "Clicca per gestire gli interventi")}
					</button>
					<div className='group relative flex items-center gap-[7px] bg-white/[0.03] px-3 py-[5px] rounded-full text-[11px] font-semibold text-[#a1a19d] border border-white/[0.05]'>
						<span className='w-1.5 h-1.5 rounded-full bg-[#34a853]' style={{ boxShadow: '0 0 6px rgba(52,168,83,0.4)' }} />
						Online
						{topTip("Server connesso", "Dati sincronizzati col backend")}
					</div>
				</div>

				{/* Controlli — icona + etichetta sempre visibile da ≥1280px;
				    sotto quella soglia resta icona + tooltip per non rompere
				    il layout su schermi stretti. Ogni gruppo logico ha uno
				    sfondo "capsula" per leggersi a colpo d'occhio. */}
				<div className='flex items-center gap-2'>
					{/* Toggle Visualizza / Modifica */}
					<button
						onClick={toggleMode}
						className={`group relative flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-[12px] font-semibold border transition-all ${
							isEdit
								? "bg-[#0639DE] text-white border-[#0639DE] shadow-[0_2px_12px_rgba(6,57,222,0.35)]"
								: "bg-white/[0.03] text-[#a1a19d] border-white/[0.05] hover:bg-white/[0.06] hover:text-[#f0f0ec]"
						}`}
					>
						<PencilSquareIcon className='h-4 w-4' />
						{isEdit ? "Modifica" : "Visualizza"}
						{topTip(
							isEdit ? "Modalità Modifica attiva" : "Modalità Visualizzazione",
							isEdit
								? "Clicca per tornare in sola lettura"
								: "Clicca per abilitare pin, misure e modifiche",
						)}
					</button>

					{/* Gruppo: pannelli (AI, Ticket, Modelli, Contatti, Servizi) */}
					<div className='flex items-center gap-0.5 h-[34px] bg-white/[0.02] rounded-lg px-1 border border-white/[0.04]'>
						<button
							onClick={() => setShowAiChat(true)}
							className='group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md text-[#5B8AF5] hover:bg-[rgba(6,57,222,0.12)] transition-all'
						>
							<SparklesIcon className='h-4 w-4 shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								AI
							</span>
							{topTip("Assistente AI", "Chiedi qualsiasi cosa sull'impianto")}
						</button>

						<button
							onClick={openKanban}
							className='group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md text-[#a1a19d] hover:bg-white/[0.05] hover:text-[#f0f0ec] transition-all'
						>
							<ViewColumnsIcon className='h-4 w-4 shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								Ticket
							</span>
							{topTip("Board Ticket", "Kanban degli interventi")}
						</button>

						<button
							onClick={openModelSwitcher}
							className='group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md text-[#a1a19d] hover:bg-white/[0.05] hover:text-[#f0f0ec] transition-all'
						>
							<CubeTransparentIcon className='h-4 w-4 shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								Modelli
							</span>
							{topTip("Cambia Modello", "Passa a un altro rilievo 3D")}
						</button>

						<button
							onClick={() => setShowContacts(true)}
							className='group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md text-[#a1a19d] hover:bg-white/[0.05] hover:text-[#f0f0ec] transition-all'
						>
							<UserGroupIcon className='h-4 w-4 shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								Contatti
							</span>
							{topTip("Rubrica Contatti", "Fornitori e manutentori")}
						</button>

						<button
							onClick={() => setShowServices(true)}
							className='group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md text-[#a1a19d] hover:bg-white/[0.05] hover:text-[#f0f0ec] transition-all'
						>
							<WrenchScrewdriverIcon className='h-4 w-4 shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								Servizi
							</span>
							{topTip("Catalogo Servizi", "Prenota rilievi e interventi")}
						</button>
					</div>

					{/* Gruppo: navigazione (velocità, blocco quota, reset) */}
					<div className='flex items-center gap-0.5 h-[34px] bg-white/[0.02] rounded-lg px-1 border border-white/[0.04]'>
						<div className='group relative flex items-center gap-2 h-[28px] px-2'>
							<BoltIcon className='h-4 w-4 text-[#D97706] shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold text-[#a1a19d] whitespace-nowrap'>
								Velocità
							</span>
							<input
								type='range'
								min={0.1}
								max={2}
								step={0.1}
								value={navSpeed}
								onChange={(e) => setNavSpeed(parseFloat(e.target.value))}
								className='w-16 accent-[#0639DE] cursor-pointer [&::-webkit-slider-track]:bg-white/10 [&::-webkit-slider-track]:rounded [&::-webkit-slider-track]:h-[3px]'
							/>
							<span className='text-[11px] font-semibold text-[#a1a19d] tabular-nums w-7 text-right'>
								{navSpeed.toFixed(1)}×
							</span>
							{topTip("Velocità di camminata", "Quanto veloci ci si muove con WASD")}
						</div>

						<button
							onClick={toggleAltitudeLock}
							className={`group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md transition-all ${
								altitudeLock
									? "bg-[#0639DE] text-white"
									: "text-[#a1a19d] hover:bg-white/[0.05] hover:text-[#f0f0ec]"
							}`}
						>
							{altitudeLock ? (
								<LockClosedIcon className='h-4 w-4 shrink-0' />
							) : (
								<LockOpenIcon className='h-4 w-4 shrink-0' />
							)}
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								Quota
							</span>
							{topTip(
								altitudeLock ? "Quota bloccata" : "Blocco quota",
								"Mantiene l'altezza costante mentre cammini",
							)}
						</button>

						<button
							onClick={() => controlsRef.current?.reset()}
							className='group relative flex items-center gap-1.5 h-[28px] px-2 rounded-md text-[#a1a19d] hover:bg-white/[0.05] hover:text-[#f0f0ec] transition-all'
						>
							<ArrowUturnLeftIcon className='h-4 w-4 shrink-0' />
							<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
								Reset
							</span>
							{topTip("Reset vista", "Torna all'inquadratura iniziale")}
						</button>
					</div>

					{/* Esporta CSV */}
					<button
						onClick={exportToCSV}
						disabled={savedGeometries.length === 0}
						className='group relative flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-[#5B8AF5] hover:bg-[rgba(6,57,222,0.12)] disabled:text-white/[0.28] disabled:hover:bg-transparent transition-all border border-transparent disabled:border-transparent'
					>
						<DocumentArrowDownIcon className='h-4 w-4 shrink-0' />
						<span className='hidden xl:inline text-[11px] font-semibold whitespace-nowrap'>
							CSV
						</span>
						{topTip(
							"Esporta CSV",
							savedGeometries.length === 0
								? "Nessuna misura da esportare"
								: "Scarica le misure salvate",
						)}
					</button>
				</div>
			</div>

			{/* ===== BOTTOM TOOLBAR (dock centrato) ===== */}
			<div className='absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-[3px] bg-[#161618]/82 backdrop-blur-[40px] saturate-[160%] border border-white/[0.06] rounded-full px-2 py-1.5 shadow-[0_8px_40px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.03)] pointer-events-auto z-20'>
				{toolBtn("navigate", <HandRaisedIcon />, "Pan (H)")}
				{isEdit && (
					<div className='flex items-center gap-[3px] animate-in fade-in slide-in-from-bottom-2 duration-200'>
						<div className='w-px h-[22px] bg-white/[0.07] mx-1' />
						{toolBtn("pin", <MapPinIcon />, "Nuovo Pin (P)")}
						<div className='w-px h-[22px] bg-white/[0.07] mx-1' />
						{toolBtn("measure", <ArrowsRightLeftIcon />, "Misura Distanza (M)")}
						{toolBtn("area", <StopIcon />, "Misura Area (R)")}
						{toolBtn("arc", <ArrowPathIcon />, "Misura Arco (C)")}
					</div>
				)}
			</div>

			{/* ===== STORICO RILIEVI (pannello sinistro, glass) ===== */}
			<div className='absolute left-2.5 top-[72px] bottom-2.5 bg-[#161618]/82 backdrop-blur-[40px] saturate-[160%] border border-white/[0.06] rounded-[14px] shadow-[0_8px_40px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.03)] w-[260px] flex flex-col overflow-hidden pointer-events-auto z-10'>
				{/* Segmented control */}
				<div className='p-2 border-b border-white/[0.04] shrink-0'>
					<div className='flex bg-black/25 p-[3px] rounded-[10px] gap-[2px]'>
						<button
							onClick={() => setLeftTab('misure')}
							className={`flex-1 text-center py-1.5 text-[11px] font-semibold rounded-[7px] transition-colors ${leftTab === 'misure' ? 'bg-white/[0.09] text-[#f0f0ec] shadow-[0_1px_2px_rgba(0,0,0,0.2)]' : 'text-[#a1a19d] hover:text-[#f0f0ec]'}`}
						>
							Misure
						</button>
						<button
							onClick={() => setLeftTab('punti')}
							className={`flex-1 text-center py-1.5 text-[11px] font-semibold rounded-[7px] transition-colors ${leftTab === 'punti' ? 'bg-white/[0.09] text-[#f0f0ec] shadow-[0_1px_2px_rgba(0,0,0,0.2)]' : 'text-[#a1a19d] hover:text-[#f0f0ec]'}`}
						>
							Punti
						</button>
						<button
							onClick={() => { setLeftTab('media'); fetchSiteMedia(); }}
							className={`flex-1 text-center py-1.5 text-[11px] font-semibold rounded-[7px] transition-colors ${leftTab === 'media' ? 'bg-white/[0.09] text-[#f0f0ec] shadow-[0_1px_2px_rgba(0,0,0,0.2)]' : 'text-[#a1a19d] hover:text-[#f0f0ec]'}`}
						>
							Media
						</button>
					</div>
				</div>

				<div className='flex-1 overflow-y-auto p-1.5 flex flex-col gap-1.5 text-[11px] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
					{leftTab === 'misure' && (
						<>
							{savedGeometries.length === 0 ? (
								<div className='flex flex-col items-center gap-2 text-white/[0.28] text-center py-8'>
									<Squares2X2Icon className='h-8 w-8 text-white/[0.08]' />
									<span className='italic text-[11px]'>Nessun rilievo salvato</span>
								</div>
							) : (
								savedGeometries.map((g) => (
									<div
										key={g.id}
										className='group bg-white/[0.02] hover:bg-white/[0.04] p-2.5 rounded-lg border border-white/[0.04] flex flex-col gap-0.5 relative transition-colors'
									>
										<div className='flex items-center justify-between font-semibold text-[#f0f0ec] pr-5'>
											<span className='truncate max-w-[110px]'>{g.name}</span>
											<span
												className={`text-[11px] px-1.5 py-0.5 rounded uppercase tracking-wider text-white font-bold ${
													g.type === "Misura"
														? "bg-[#378ADD]"
														: g.type === "Arco"
															? "bg-[#D97706]"
															: "bg-[#ef4444]"
												}`}
											>
												{g.type}
											</span>
										</div>
										<div className='text-[#a1a19d] text-[11px] truncate'>
											{g.value}
										</div>

										{isEdit && (
											<button
												onClick={() => removeGeometry(g.id, g.meshGroupUuid)}
												title='Elimina Rilievo'
												className='absolute top-2 right-2 text-white/[0.15] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity'
											>
												<TrashIcon className='h-3.5 w-3.5' />
											</button>
										)}
									</div>
								))
							)}
						</>
					)}
					{leftTab === 'punti' && (
						<>
							{annotations.length === 0 ? (
								<div className='flex flex-col items-center gap-2 text-white/[0.28] text-center py-8'>
									<MapPinIcon className='h-8 w-8 text-white/[0.08]' />
									<span className='italic text-[11px]'>Nessun pin salvato</span>
								</div>
							) : (
								CATEGORIES.filter((cat) => annotations.some((a) => ((a.category as Category) || 'generic') === cat.type) || subcategories.some((s) => s.category === cat.type)).map((cat) => {
									const catPins = annotations.filter((a) => ((a.category as Category) || 'generic') === cat.type);
									const catSubcats = subcategories.filter((s) => s.category === cat.type);
									const isCollapsed = collapsedCategories.has(cat.type);
									const color = CATEGORY_COLORS[cat.type];
									const unsortedPins = catPins.filter((a) => !a.subcategory_id || !catSubcats.some((s) => s.id === a.subcategory_id));
									return (
										<div key={cat.type} className='mb-0.5'>
											<button
												onClick={() => setCollapsedCategories((prev) => {
													const next = new Set(prev);
													if (next.has(cat.type)) next.delete(cat.type);
													else next.add(cat.type);
													return next;
												})}
												className='w-full flex items-center gap-2 px-2 py-1.5 rounded-[7px] hover:bg-white/[0.04] transition-colors'
											>
												<svg className={`h-3 w-3 text-[#a1a19d] transition-transform ${isCollapsed ? '' : 'rotate-90'}`} viewBox='0 0 12 12' fill='none'><path d='M4.5 2.5L8 6L4.5 9.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'/></svg>
												<span className='flex shrink-0' style={{ color }}>{cat.icon}</span>
												<span className='text-[11px] font-semibold text-[#f0f0ec] flex-1 text-left'>{cat.name}</span>
												<span className='text-[11px] tabular-nums text-[#a1a19d]'>{catPins.length}</span>
											</button>
											{!isCollapsed && (
												<div className='ml-3 mt-0.5 border-l border-white/[0.04] pl-2 flex flex-col gap-0.5'>
													{/* Subcategories */}
													{catSubcats.map((sub) => {
														const subPins = catPins.filter((a) => a.subcategory_id === sub.id);
														const subKey = `sub_${sub.id}`;
														const isSubCollapsed = collapsedCategories.has(subKey as Category);
														return (
															<div key={sub.id}>
																<div className='group flex items-center gap-1.5 px-1.5 py-1 rounded-[6px] hover:bg-white/[0.03] transition-colors'>
																	<button onClick={() => setCollapsedCategories((prev) => { const next = new Set(prev); if (next.has(subKey as Category)) next.delete(subKey as Category); else next.add(subKey as Category); return next; })} className='flex items-center gap-1.5 flex-1 min-w-0'>
																		<svg className={`h-2.5 w-2.5 text-white/[0.28] transition-transform ${isSubCollapsed ? '' : 'rotate-90'}`} viewBox='0 0 12 12' fill='none'><path d='M4.5 2.5L8 6L4.5 9.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'/></svg>
																		<span className='text-[11px] font-semibold text-[#a1a19d] truncate'>{sub.name}</span>
																		<span className='text-[11px] tabular-nums text-white/[0.28]'>{subPins.length}</span>
																	</button>
																	{isEdit && (
																		<button onClick={() => handleDeleteSubcategory(sub.id)} className='shrink-0 text-white/[0.1] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity' title='Elimina sottocategoria'>
																			<XMarkIcon className='h-2.5 w-2.5' />
																		</button>
																	)}
																</div>
																{!isSubCollapsed && subPins.length > 0 && (
																	<div className='ml-3 border-l border-white/[0.03] pl-1.5 flex flex-col gap-0.5'>
																		{subPins.map((ann) => (
																			<div key={ann.id} onClick={() => { focusAnnotation(ann); handlePoiSelect(ann); }} className={`group flex items-center gap-2 px-2 py-1.5 rounded-[7px] cursor-pointer transition-colors ${selectedPoi?.id === ann.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}>
																				<span className='shrink-0 w-2 h-2 rounded-full' style={{ background: SEVERITY_COLORS[ann.severity] }} />
																				<span className='text-[11px] text-[#f0f0ec] truncate flex-1'>{ann.title}</span>
																				{isEdit && (
																					<button onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }} title='Elimina' className='shrink-0 text-white/[0.15] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity'><TrashIcon className='h-3 w-3' /></button>
																				)}
																			</div>
																		))}
																	</div>
																)}
															</div>
														);
													})}
													{/* Pins without subcategory */}
													{unsortedPins.map((ann) => (
														<div
															key={ann.id}
															onClick={() => {
																focusAnnotation(ann);
																handlePoiSelect(ann);
															}}
															className={`group flex items-center gap-2 px-2 py-1.5 rounded-[7px] cursor-pointer transition-colors ${selectedPoi?.id === ann.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
														>
															<span
																className='shrink-0 w-2 h-2 rounded-full'
																style={{ background: SEVERITY_COLORS[ann.severity] }}
															/>
															<span className='text-[11px] text-[#f0f0ec] truncate flex-1'>{ann.title}</span>
															{isEdit && (
																<button
																	onClick={(e) => {
																		e.stopPropagation();
																		removeAnnotation(ann.id);
																	}}
																	title='Elimina'
																	className='shrink-0 text-white/[0.15] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity'
																>
																	<TrashIcon className='h-3 w-3' />
																</button>
															)}
														</div>
													))}
													{/* Add subcategory inline (solo in modifica) */}
													{isEdit && (showNewSubcat === cat.type ? (
														<div className='flex items-center gap-1 px-1.5 py-1'>
															<input autoFocus value={newSubcatName} onChange={(e) => setNewSubcatName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateSubcategory(cat.type)} placeholder='Nome...' className='flex-1 bg-black/30 border border-white/[0.06] rounded-[5px] px-2 py-1 text-[11px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)]' />
															<button onClick={() => handleCreateSubcategory(cat.type)} className='text-[#5B8AF5] hover:text-white transition-colors'><PlusIcon className='h-3 w-3' /></button>
															<button onClick={() => { setShowNewSubcat(null); setNewSubcatName(''); }} className='text-white/[0.28] hover:text-[#f0f0ec] transition-colors'><XMarkIcon className='h-3 w-3' /></button>
														</div>
													) : (
														<button onClick={() => setShowNewSubcat(cat.type)} className='flex items-center gap-1 px-2 py-1 text-[11px] text-[#5B8AF5] hover:text-white font-semibold transition-colors'>
															<PlusIcon className='h-2.5 w-2.5' /> Sottocategoria
														</button>
													))}
												</div>
											)}
										</div>
									);
								})
							)}
						</>
					)}
					{leftTab === 'media' && (
						<>
							{/* Sub-tabs foto/documenti */}
							<div className='flex bg-black/20 p-[2px] rounded-[8px] gap-[2px] mx-0.5 mb-2 shrink-0'>
								<button onClick={() => setSiteMediaTab('foto')} className={`flex-1 text-center py-1 text-[11px] font-semibold rounded-[6px] transition-colors ${siteMediaTab === 'foto' ? 'bg-white/[0.08] text-[#f0f0ec]' : 'text-[#a1a19d] hover:text-[#f0f0ec]'}`}>Foto</button>
								<button onClick={() => setSiteMediaTab('documenti')} className={`flex-1 text-center py-1 text-[11px] font-semibold rounded-[6px] transition-colors ${siteMediaTab === 'documenti' ? 'bg-white/[0.08] text-[#f0f0ec]' : 'text-[#a1a19d] hover:text-[#f0f0ec]'}`}>Documenti</button>
							</div>

							{isLoadingSiteMedia ? (
								<div className='flex flex-col items-center justify-center py-8 gap-2'>
									<div className='w-4 h-4 border-2 border-white/[0.08] border-t-[#5B8AF5] rounded-full animate-spin' />
									<span className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold'>Caricamento...</span>
								</div>
							) : siteMediaTab === 'foto' ? (
								<>
									<UploadDropzone
										label='Carica foto del sito'
										accept='image/*'
										kind='image'
										onUpload={uploadSitePhoto}
										className='mb-1'
									/>
									{sitePhotos.length === 0 ? (
										<div className='flex flex-col items-center gap-2 text-white/[0.28] text-center py-6'>
											<PhotoIcon className='h-8 w-8 text-white/[0.08]' />
											<span className='italic text-[11px]'>Nessuna foto del sito</span>
										</div>
									) : (
										<div className='grid grid-cols-3 gap-1.5'>
											{sitePhotos.map((img) => (
												<div key={img.id} onClick={() => handleViewPhoto(img)} className='h-16 bg-white/[0.02] border border-white/[0.04] rounded-[8px] overflow-hidden relative cursor-pointer group hover:border-white/[0.08] transition-all'>
													<div className='absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'><PhotoIcon className='h-4 w-4 text-white' /></div>
													<img src={getPhotoUrl(img)} alt={img.caption || 'Foto sito'} className='w-full h-full object-cover' onError={(e) => { e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' fill='%23333'><rect width='100' height='100'/></svg>"; }} />
													{isEdit && (
														<button
															onClick={(e) => { e.stopPropagation(); handleDeleteSitePhoto(img.id); }}
															title='Elimina foto'
															className='absolute top-1 right-1 z-10 w-5 h-5 rounded-[5px] bg-black/60 flex items-center justify-center text-white/60 hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity'
														>
															<TrashIcon className='h-3 w-3' />
														</button>
													)}
												</div>
											))}
										</div>
									)}
								</>
							) : (
								<>
									<UploadDropzone
										label='Carica documento del sito'
										accept='.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'
										kind='document'
										onUpload={uploadSiteDoc}
										className='mb-1'
									/>
									{siteDocuments.length === 0 ? (
										<div className='flex flex-col items-center gap-2 text-white/[0.28] text-center py-6'>
											<DocumentArrowDownIcon className='h-8 w-8 text-white/[0.08]' />
											<span className='italic text-[11px]'>Nessun documento del sito</span>
										</div>
									) : (
										<div className='flex flex-col gap-1.5'>
											{siteDocuments.map((doc) => (
												<div key={doc.id} className='group flex items-center gap-2 bg-white/[0.02] border border-white/[0.04] rounded-[8px] p-2 hover:bg-white/[0.04] hover:border-white/[0.08] transition-all'>
													<div className='w-7 h-7 rounded-[5px] bg-[rgba(91,138,245,0.08)] flex items-center justify-center text-[#5B8AF5] shrink-0'><DocumentArrowDownIcon className='h-3.5 w-3.5' /></div>
													<div className='min-w-0 flex-1'>
														<div className='text-[11px] font-semibold text-[#f0f0ec] truncate'>{doc.name}</div>
														<div className='text-[11px] text-[#a1a19d]'>{doc.size ? `${(doc.size / 1024).toFixed(0)} KB` : ''}</div>
													</div>
													<button onClick={() => window.open(`${API_BASE}/api/documents/${doc.id}/view`, '_blank')} className='shrink-0 text-[#5B8AF5] hover:text-white transition-colors' title='Apri'><ArrowUturnLeftIcon className='h-3 w-3 rotate-180' /></button>
													{isEdit && (
														<button onClick={() => handleDeleteDoc(doc.id)} className='shrink-0 text-white/[0.15] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity' title='Elimina'><TrashIcon className='h-3 w-3' /></button>
													)}
												</div>
											))}
										</div>
									)}
								</>
							)}
						</>
					)}
				</div>
			</div>

			{/* MODALE SALVATAGGIO NOME GEOMETRIA */}
			{pendingGeom && (
				<div className='absolute inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'>
					<div
						className='w-80 bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] overflow-hidden'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center gap-2.5'>
							<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
								<Squares2X2Icon className='h-3.5 w-3.5' />
							</div>
							<span className='text-[13px] font-semibold text-[#f0f0ec]'>Salva {pendingGeom.type}</span>
						</div>
						<div className='p-[18px]'>
							<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>
								Nome Rilievo
							</label>
							<input
								autoFocus
								type='text'
								value={geomName}
								onChange={(e) => setGeomName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && confirmGeometry()}
								className='w-full mb-3 px-3 py-2 text-[12px] font-semibold bg-black/30 border border-white/[0.04] rounded-[6px] outline-none text-[#f0f0ec] focus:border-[rgba(6,57,222,0.4)] font-[Inter,monospace] tabular-nums'
							/>

							<div className='text-[11px] bg-white/[0.02] p-2.5 rounded-[8px] border border-white/[0.04] text-[#a1a19d] mb-4 break-words'>
								<span className='font-semibold block text-[#f0f0ec] mb-0.5 text-[11px]'>
									Valore registrato:
								</span>
								{pendingGeom.value}
							</div>

							<div className='flex gap-2'>
								<button
									onClick={discardGeometry}
									className='flex-1 px-3 py-2 text-[12px] font-medium rounded-[8px] border border-white/[0.08] text-[#f0f0ec] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all'
								>
									Scarta
								</button>
								<button
									onClick={confirmGeometry}
									className='flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] text-white bg-[#0639DE] hover:bg-[#0530B8] border border-[#0639DE] transition-colors'
								>
									Conferma
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* ===== HINT CONTESTUALI (status bar sopra toolbar) ===== */}
			<div className='absolute bottom-[68px] left-1/2 -translate-x-1/2 text-[11px] text-white/70 bg-[#161618]/82 backdrop-blur-[40px] saturate-[160%] rounded-[14px] px-4 py-2.5 pointer-events-none max-w-2xl text-center border border-white/[0.06] shadow-[0_8px_40px_rgba(0,0,0,0.55)] z-10'>
				{tool === "navigate" && (
					<div className='flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5'>
						<span className='flex items-center gap-1.5 whitespace-nowrap'>
							<Kbd>Trascina SX</Kbd>
							<span className='text-[#a1a19d]'>ruota</span>
						</span>
						<span className='flex items-center gap-1.5 whitespace-nowrap'>
							<Kbd>Trascina DX</Kbd>
							<span className='text-[#a1a19d]'>sposta</span>
						</span>
						<span className='flex items-center gap-1.5 whitespace-nowrap'>
							<Kbd>Rotella</Kbd>
							<span className='text-[#a1a19d]'>zoom</span>
						</span>
						<span className='flex items-center gap-1.5 whitespace-nowrap'>
							<span className='flex items-center gap-0.5'>
								<Kbd>W</Kbd>
								<Kbd>A</Kbd>
								<Kbd>S</Kbd>
								<Kbd>D</Kbd>
							</span>
							<span className='text-[#a1a19d]'>cammina</span>
						</span>
						<span className='flex items-center gap-1.5 whitespace-nowrap'>
							<span className='flex items-center gap-0.5'>
								<Kbd>Q</Kbd>
								<Kbd>E</Kbd>
							</span>
							<span className='text-[#a1a19d]'>giù / su</span>
						</span>
						{altitudeLock && (
							<span className='inline-flex items-center gap-1 text-[#7fb4ec] font-semibold whitespace-nowrap'>
								<LockClosedIcon className='h-3 w-3' /> quota bloccata
							</span>
						)}
					</div>
				)}
				{tool === "pin" && (
					<>
						<strong className='text-white/90'>Pin:</strong> clicca sulla
						superficie per salvare un marcatore.
					</>
				)}
				{tool === "measure" && (
					<>
						<strong className='text-white/90'>Misura:</strong> Clicca 2 punti.
						Al secondo clic comparirà la modale di salvataggio.
					</>
				)}
				{tool === "area" && (
					<>
						<strong className='text-white/90'>Area:</strong> Clicca i vertici
						dell'area in sequenza e clicca su "Conferma Area" in basso.
					</>
				)}
				{tool === "arc" && (
					<>
						<strong className='text-white/90'>Arco:</strong> Seleziona 3 punti
						(Inizio, colmo, fine). Al 3° punto si aprirà la modale.
					</>
				)}
			</div>

			{/* OVERLAY REAL-TIME (MISURE, AREE, ARCHI) — sopra la hint bar */}
			<div className='absolute bottom-[110px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3.5 pointer-events-none z-10'>
				{tool === "measure" && measureDistance !== null && (
					<div className='bg-[#161618]/90 backdrop-blur-[40px] border border-[#378ADD]/30 text-white px-5 py-2.5 rounded-full font-semibold shadow-[0_8px_40px_rgba(0,0,0,0.55)] text-sm flex flex-wrap items-center gap-4 justify-center'>
						<div>
							Distanza:{" "}
							<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
								{measureDistance.toFixed(2)} m
							</span>
						</div>
						{slopeStats && (
							<>
								<div>
									Pendenza:{" "}
									<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
										{slopeStats.degrees.toFixed(1)}°
									</span>
								</div>
								<div>
									Grado (%):{" "}
									<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
										{slopeStats.percent === Infinity
											? "Verticale"
											: `${slopeStats.percent.toFixed(1)}%`}
									</span>
								</div>
							</>
						)}
					</div>
				)}

				{tool === "area" && calculatedArea !== null && (
					<div className='flex flex-col items-center gap-2 pointer-events-auto'>
						<div className='bg-[#161618]/90 backdrop-blur-[40px] border border-[#ef4444]/30 text-white px-5 py-2.5 rounded-full font-semibold shadow-[0_8px_40px_rgba(0,0,0,0.55)] text-sm flex items-center gap-2 justify-center'>
							<span>Superficie provvisoria:</span>
							<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
								{calculatedArea.toFixed(2)} m²
							</span>
						</div>

						{interactionPointsRef.current.length >= 3 && (
							<button
								onClick={triggerAreaConfirmation}
								className='bg-[#0639DE] hover:bg-[#0530B8] text-white font-bold text-[13px] px-6 py-2.5 rounded-full shadow-[0_2px_12px_rgba(6,57,222,0.35)] border border-[#0639DE] transition-colors flex items-center gap-1.5'
							>
								<CheckCircleIcon className='h-4 w-4' /> Conferma Area
							</button>
						)}
					</div>
				)}

				{tool === "arc" && calculatedArc !== null && (
					<div className='bg-[#161618]/90 backdrop-blur-[40px] border border-[#D97706]/30 text-white px-5 py-2.5 rounded-full font-semibold shadow-[0_8px_40px_rgba(0,0,0,0.55)] text-sm flex flex-wrap items-center gap-4 justify-center'>
						<div>
							Sviluppo Arco:{" "}
							<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
								{calculatedArc.length.toFixed(2)} m
							</span>
						</div>
						<div>
							Raggio:{" "}
							<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
								{calculatedArc.radius === Infinity
									? "Piano"
									: `${calculatedArc.radius.toFixed(2)} m`}
							</span>
						</div>
					</div>
				)}
			</div>

			{/* LOADING SPINNER (con dissolvenza di uscita) */}
			{loaderVisible && (
				<div
					className={`absolute inset-0 flex flex-col items-center justify-center bg-[#0c0c0e] z-50 transition-opacity duration-500 ${
						loading ? "opacity-100" : "opacity-0 pointer-events-none"
					}`}
				>
					<div className='flex items-center justify-center h-[52px] w-[52px] rounded-[14px] bg-[rgba(6,57,222,0.06)] border border-white/[0.06] mb-5 shadow-[0_8px_40px_rgba(0,0,0,0.55)]'>
						<ArrowPathIcon className='h-6 w-6 text-[#5B8AF5] animate-spin' />
					</div>
					<div className='w-48 h-[3px] bg-white/10 rounded-full overflow-hidden mb-3'>
						<div
							className='h-full bg-[#0639DE] rounded-full transition-all duration-200'
							style={{ width: `${loadProgress}%` }}
						/>
					</div>
					<span className='text-[#a1a19d] text-[11px] font-semibold tracking-wide'>
						Caricamento modello… {loadProgress}%
					</span>
				</div>
			)}

			{/* MODALE CREAZIONE NUOVO PIN */}
			{pending && (
				<div className='absolute inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'>
					<div
						className='w-[370px] bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] overflow-hidden max-h-[90vh] flex flex-col'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center justify-between shrink-0'>
							<div className='flex items-center gap-2.5'>
								<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
									<MapPinIcon className='h-3.5 w-3.5' />
								</div>
								<span className='text-[13px] font-semibold text-[#f0f0ec]'>Nuovo punto di interesse</span>
							</div>
							<button onClick={cancelAnnotation} className='w-7 h-7 rounded-[7px] flex items-center justify-center text-white/[0.28] hover:bg-white/[0.04] hover:text-[#f0f0ec] transition-colors text-[15px]'>&#x2715;</button>
						</div>

						<div className='p-[18px] overflow-y-auto flex flex-col gap-3'>
							<div>
								<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>Titolo *</label>
								<input
									autoFocus
									type='text'
									placeholder='es. Estintore Co2, Quadro, Crepa…'
									value={annTitle}
									onChange={(e) => setAnnTitle(e.target.value)}
									className='w-full px-3 py-2 text-[12px] font-medium bg-black/30 border border-white/[0.04] rounded-[6px] outline-none text-[#f0f0ec] placeholder:text-white/[0.28] focus:border-[rgba(6,57,222,0.4)]'
								/>
							</div>

							<div>
								<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>Descrizione</label>
								<textarea
									placeholder='Dettagli aggiuntivi opzionali…'
									value={annDescription}
									onChange={(e) => setAnnDescription(e.target.value)}
									rows={2}
									className='w-full px-3 py-2 text-[12px] bg-black/30 border border-white/[0.04] rounded-[6px] outline-none text-[#f0f0ec] resize-none placeholder:text-white/[0.28] focus:border-[rgba(6,57,222,0.4)]'
								/>
							</div>

							<div>
								<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-2'>Severità</label>
								<div className='grid grid-cols-2 gap-2'>
									{SEVERITIES.map((s) => (
										<button
											key={s.type}
											type='button'
											onClick={() => setAnnSeverity(s.type)}
											className={`py-2 rounded-[8px] text-[11px] font-medium border transition-all ${
												annSeverity === s.type
													? "bg-white/[0.09] text-[#f0f0ec] border-white/[0.12] shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
													: "bg-transparent text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]"
											}`}
										>
											<span
												className='inline-block w-2 h-2 rounded-full mr-1.5'
												style={{ background: s.hex }}
											/>
											{s.name}
										</button>
									))}
								</div>
							</div>

							<div>
								<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-2'>Categoria</label>
								<div className='grid grid-cols-2 gap-2'>
									{CATEGORIES.map((c) => (
										<button
											key={c.type}
											type='button'
											onClick={() => setAnnCategory(c.type)}
											className={`py-2 px-2 rounded-[8px] text-[11px] font-medium border transition-all flex items-center gap-1.5 ${
												annCategory === c.type
													? "bg-white/[0.09] text-[#f0f0ec] border-white/[0.12] shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
													: "bg-transparent text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]"
											}`}
										>
											<span>{c.icon}</span>
											<span className='truncate'>{c.name}</span>
										</button>
									))}
								</div>
							</div>

							<div>
								<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-2'>Sottocategoria</label>
								<div className='flex flex-wrap gap-1.5'>
									<button type='button' onClick={() => setAnnSubcategoryId(null)} className={`py-1.5 px-2.5 rounded-[7px] text-[11px] font-medium border transition-all ${!annSubcategoryId ? 'bg-white/[0.09] text-[#f0f0ec] border-white/[0.12]' : 'text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]'}`}>Nessuna</button>
									{subcategories.filter((s) => s.category === annCategory).map((sub) => (
										<button key={sub.id} type='button' onClick={() => setAnnSubcategoryId(sub.id)} className={`py-1.5 px-2.5 rounded-[7px] text-[11px] font-medium border transition-all ${annSubcategoryId === sub.id ? 'bg-white/[0.09] text-[#f0f0ec] border-white/[0.12]' : 'text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]'}`}>{sub.name}</button>
									))}
									{showNewSubcat === annCategory ? (
										<input
											autoFocus
											value={newSubcatName}
											onChange={(e) => setNewSubcatName(e.target.value)}
											onKeyDown={async (e) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													const c = await handleCreateSubcategory(annCategory);
													if (c) setAnnSubcategoryId(c.id);
												} else if (e.key === 'Escape') {
													setShowNewSubcat(null);
													setNewSubcatName('');
												}
											}}
											onBlur={() => { setShowNewSubcat(null); setNewSubcatName(''); }}
											placeholder='Nome…'
											className='py-1.5 px-2.5 w-28 rounded-[7px] text-[11px] bg-black/30 border border-[rgba(6,57,222,0.45)] text-[#f0f0ec] outline-none'
										/>
									) : (
										<button type='button' onClick={() => { setShowNewSubcat(annCategory); setNewSubcatName(''); }} className='py-1.5 px-2.5 rounded-[7px] text-[11px] font-semibold border border-dashed border-white/[0.14] text-[#5B8AF5] hover:bg-white/[0.04] transition-all'>+ Nuova</button>
									)}
								</div>
							</div>

							{annSeverity === "maintenance" && (
								<div className='p-3 rounded-[10px] bg-[#8B5CF6]/[0.06] border border-[#8B5CF6]/[0.15] flex flex-col gap-3'>
									<div className='text-[11px] font-semibold text-[#8B5CF6]'>
										Piano di Manutenzione
									</div>

									<div>
										<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>Periodicità *</label>
										<div className='grid grid-cols-2 gap-1.5'>
											{MAINTENANCE_PERIODICITIES.map((per) => (
												<button
													key={per.value}
													type='button'
													onClick={() => {
														setAnnMaintenancePeriodicity(per.value);
														setAnnMaintenanceDueDate(
															addMonthsToDate(annMaintenanceLastDone, per.months),
														);
													}}
													className={`py-1.5 rounded-[7px] text-[11px] font-medium border transition-all ${
														annMaintenancePeriodicity === per.value
															? "bg-[#8B5CF6] text-white border-[#8B5CF6]"
															: "bg-black/20 text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]"
													}`}
												>
													{per.name}
												</button>
											))}
										</div>
									</div>

									<div>
										<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>Ultima manutenzione effettuata</label>
										<input
											type='date'
											value={annMaintenanceLastDone}
											onChange={(e) => {
												const last = e.target.value;
												setAnnMaintenanceLastDone(last);
												const per = MAINTENANCE_PERIODICITIES.find(
													(x) => x.value === annMaintenancePeriodicity,
												);
												setAnnMaintenanceDueDate(
													addMonthsToDate(last, per?.months ?? 1),
												);
											}}
											className='w-full px-3 py-2 text-[12px] bg-black/30 border border-white/[0.04] rounded-[6px] outline-none text-[#f0f0ec] focus:border-[#8B5CF6]/40 [color-scheme:dark]'
										/>
									</div>

									<div>
										<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>Scadenza prevista</label>
										<input
											type='date'
											value={annMaintenanceDueDate}
											onChange={(e) => setAnnMaintenanceDueDate(e.target.value)}
											className='w-full px-3 py-2 text-[12px] bg-black/30 border border-white/[0.04] rounded-[6px] outline-none text-[#f0f0ec] focus:border-[#8B5CF6]/40 [color-scheme:dark]'
										/>
										<p className='text-[11px] text-white/[0.28] mt-1'>
											Calcolata da ultima manutenzione + periodicità. Modificabile.
										</p>
									</div>
								</div>
							)}

							<div className='flex gap-2 pt-1'>
								<button
									onClick={cancelAnnotation}
									className='flex-1 px-3 py-2 text-[12px] font-medium rounded-[8px] border border-white/[0.08] text-[#f0f0ec] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all'
								>
									Annulla
								</button>
								<button
									onClick={confirmAnnotation}
									disabled={!annTitle.trim()}
									className='flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] text-white disabled:opacity-40 transition-all bg-[#0639DE] hover:bg-[#0530B8] border border-[#0639DE]'
								>
									Salva Pin
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* POI list panel removed — tree view now lives in left panel "Punti" tab */}

			{/* SCHEDA DEFINITIVA: DETTAGLI AVANZATI DEL PIN */}
			{selectedPoi && (
				<div className='absolute top-[72px] right-2.5 bottom-2.5 w-[290px] bg-[#161618]/82 backdrop-blur-[40px] saturate-[160%] text-[#f0f0ec] border border-white/[0.06] rounded-[14px] p-4 shadow-[0_8px_40px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.03)] flex flex-col gap-4 pointer-events-auto z-20 animate-in fade-in slide-in-from-right-5 duration-200'>
					{/* Header Scheda */}
					<div className='flex justify-between items-start border-b border-zinc-800 pb-3 shrink-0'>
						<div className='min-w-0 flex-1'>
							<span
								style={{
									backgroundColor: SEVERITY_COLORS[selectedPoi.severity],
								}}
								className='text-[11px] font-bold px-2 py-0.5 rounded text-white uppercase tracking-wider'
							>
								{selectedPoi.severity}
							</span>
							<h3 className='text-base font-semibold truncate mt-1.5 text-white pr-2 flex items-center gap-2'>
								{selectedPoi.title}
								{isEdit && !isEditingPoi && (
									<button
										onClick={() => setIsEditingPoi(true)}
										className='text-zinc-500 hover:text-blue-400 transition-colors'
										title='Modifica POI'
									>
										<PencilSquareIcon className='h-4 w-4' />
									</button>
								)}
							</h3>
						</div>
						<button
							onClick={() => setSelectedPoi(null)}
							className='p-1 bg-zinc-800/60 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors'
						>
							<XMarkIcon className='h-4 w-4' />
						</button>
					</div>

					{/* Corpo Centrale Scrollabile */}
					<div className='flex-1 overflow-y-auto space-y-5 pr-1 text-xs'>
						{isEditingPoi ? (
							<form
								onSubmit={handleUpdatePoi}
								className='bg-black/20 border border-white/[0.06] p-3.5 rounded-[14px] space-y-3.5'
							>
								<span className='text-[11px] font-bold text-[#5B8AF5] uppercase tracking-[0.08em] block'>
									Modifica Marcatore
								</span>
								<div>
									<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>
										Titolo *
									</label>
									<input
										required
										type='text'
										value={editPoiForm.title}
										onChange={(e) =>
											setEditPoiForm({ ...editPoiForm, title: e.target.value })
										}
										className='w-full px-3 py-2 text-[13px] bg-black/30 border border-white/[0.06] rounded-[8px] outline-none text-[#f0f0ec] focus:border-[rgba(6,57,222,0.5)] transition-colors'
									/>
								</div>
								<div>
									<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>
										Descrizione
									</label>
									<textarea
										value={editPoiForm.description}
										onChange={(e) =>
											setEditPoiForm({
												...editPoiForm,
												description: e.target.value,
											})
										}
										rows={2}
										className='w-full px-3 py-2 text-[13px] bg-black/30 border border-white/[0.06] rounded-[8px] outline-none text-[#f0f0ec] focus:border-[rgba(6,57,222,0.5)] resize-none transition-colors'
									/>
								</div>
								<div className='grid grid-cols-2 gap-2.5'>
									<div>
										<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>
											Severità
										</label>
										<select
											value={editPoiForm.severity}
											onChange={(e) =>
												setEditPoiForm({
													...editPoiForm,
													severity: e.target.value as any,
												})
											}
											className='w-full px-3 py-2 text-[13px] bg-black/30 border border-white/[0.06] rounded-[8px] outline-none text-[#f0f0ec] focus:border-[rgba(6,57,222,0.5)] [color-scheme:dark]'
										>
											{SEVERITIES.map((s) => (
												<option key={s.type} value={s.type}>
													{s.name}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>
											Categoria
										</label>
										<select
											value={editPoiForm.category}
											onChange={(e) =>
												setEditPoiForm({
													...editPoiForm,
													category: e.target.value as Category,
													subcategory_id: null,
												})
											}
											className='w-full px-3 py-2 text-[13px] bg-black/30 border border-white/[0.06] rounded-[8px] outline-none text-[#f0f0ec] focus:border-[rgba(6,57,222,0.5)] [color-scheme:dark]'
										>
											{CATEGORIES.map((c) => (
												<option key={c.type} value={c.type}>
													{c.name}
												</option>
											))}
										</select>
									</div>
								</div>
								<div>
									<label className='block text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em] mb-1.5'>
										Sottocategoria
									</label>
									<div className='flex flex-wrap gap-1.5'>
										<button type='button' onClick={() => setEditPoiForm({ ...editPoiForm, subcategory_id: null })} className={`py-1.5 px-2.5 rounded-[7px] text-[11px] font-medium border transition-all ${!editPoiForm.subcategory_id ? 'bg-white/[0.09] text-[#f0f0ec] border-white/[0.12]' : 'text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]'}`}>Nessuna</button>
										{subcategories.filter((s) => s.category === editPoiForm.category).map((sub) => (
											<button key={sub.id} type='button' onClick={() => setEditPoiForm({ ...editPoiForm, subcategory_id: sub.id })} className={`py-1.5 px-2.5 rounded-[7px] text-[11px] font-medium border transition-all ${editPoiForm.subcategory_id === sub.id ? 'bg-white/[0.09] text-[#f0f0ec] border-white/[0.12]' : 'text-[#a1a19d] border-white/[0.04] hover:bg-white/[0.04]'}`}>{sub.name}</button>
										))}
										{showNewSubcat === editPoiForm.category ? (
											<input
												autoFocus
												value={newSubcatName}
												onChange={(e) => setNewSubcatName(e.target.value)}
												onKeyDown={async (e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														const c = await handleCreateSubcategory(editPoiForm.category);
														if (c) setEditPoiForm((f) => ({ ...f, subcategory_id: c.id }));
													} else if (e.key === 'Escape') {
														setShowNewSubcat(null);
														setNewSubcatName('');
													}
												}}
												onBlur={() => { setShowNewSubcat(null); setNewSubcatName(''); }}
												placeholder='Nome…'
												className='py-1.5 px-2.5 w-28 rounded-[7px] text-[11px] bg-black/30 border border-[rgba(6,57,222,0.45)] text-[#f0f0ec] outline-none'
											/>
										) : (
											<button type='button' onClick={() => { setShowNewSubcat(editPoiForm.category); setNewSubcatName(''); }} className='py-1.5 px-2.5 rounded-[7px] text-[11px] font-semibold border border-dashed border-white/[0.14] text-[#5B8AF5] hover:bg-white/[0.04] transition-all'>+ Nuova</button>
										)}
									</div>
								</div>
								<div className='flex gap-2 pt-1'>
									<button
										type='button'
										onClick={() => setIsEditingPoi(false)}
										className='flex-1 py-2 text-[13px] font-semibold rounded-[8px] border border-white/[0.08] text-[#f0f0ec] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all'
									>
										Annulla
									</button>
									<button
										type='submit'
										className='flex-1 py-2 text-[13px] font-semibold bg-[#0639DE] hover:bg-[#0731b8] text-white rounded-[8px] transition-colors'
									>
										Salva
									</button>
								</div>
							</form>
						) : (
							selectedPoi.description && (
								<div className='bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/50'>
									<span className='text-[11px] font-bold text-zinc-500 uppercase tracking-wider block mb-1'>
										Descrizione Marcatore
									</span>
									<p className='text-xs text-zinc-300 leading-relaxed font-medium'>
										{selectedPoi.description}
									</p>
								</div>
							)
						)}

						{selectedPoi.severity === "maintenance" && (
							<div className='bg-purple-500/5 border border-purple-500/20 p-3 rounded-xl space-y-2'>
								<span className='text-[11px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5'>
									<WrenchScrewdriverIcon className='h-3.5 w-3.5' /> Piano di
									Manutenzione
								</span>
								<div className='flex justify-between text-[11px]'>
									<span className='text-zinc-500 font-medium'>Periodicità</span>
									<span className='text-zinc-200 font-semibold'>
										{MAINTENANCE_PERIODICITIES.find(
											(p) => p.value === selectedPoi.maintenance_periodicity,
										)?.name || "—"}
									</span>
								</div>
								<div className='flex justify-between text-[11px]'>
									<span className='text-zinc-500 font-medium'>
										Ultima effettuata
									</span>
									<span className='text-zinc-200 font-semibold'>
										{selectedPoi.maintenance_last_done
											? new Date(
													selectedPoi.maintenance_last_done,
												).toLocaleDateString()
											: "—"}
									</span>
								</div>
								<div className='flex justify-between text-[11px]'>
									<span className='text-zinc-500 font-medium'>
										Scadenza prevista
									</span>
									<span className='text-purple-300 font-bold'>
										{selectedPoi.maintenance_due_date
											? new Date(
													selectedPoi.maintenance_due_date,
												).toLocaleDateString()
											: "—"}
									</span>
								</div>
							</div>
						)}

						<div className='space-y-2.5 border-t border-zinc-900 pt-4'>
							<div className='flex justify-between items-center text-zinc-400 font-bold uppercase tracking-widest pl-1'>
								<span className='flex items-center gap-1.5'>
									<CameraIcon className='h-4 w-4' /> Galleria Foto
								</span>
							</div>

							<UploadDropzone
								label='Aggiungi foto'
								accept='image/*'
								kind='image'
								onUpload={uploadPoiPhoto}
							/>

							{isLoadingPhotos ? (
								<div className='text-center py-4 text-zinc-600'>
									Caricamento archivio...
								</div>
							) : poiPhotos.length === 0 ? (
								<div className='text-center py-4 bg-zinc-900/30 rounded-xl border border-dashed border-zinc-800 text-zinc-600 font-medium'>
									Nessuna foto allegata a questo punto.
								</div>
							) : (
								<div className='grid grid-cols-3 gap-2'>
									{poiPhotos.map((img) => (
										<div
											key={img.id}
											onClick={() => handleViewPhoto(img)}
											className='h-16 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden relative cursor-pointer group hover:border-zinc-600 transition-all'
										>
											<div className='absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
												<PhotoIcon className='h-4 w-4 text-white' />
											</div>
											<img
												src={getPhotoUrl(img)}
												alt={img.caption || "Foto POI"}
												className='w-full h-full object-cover'
												onError={(e) => {
													e.target.src =
														"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' fill='%23333'><rect width='100' height='100'/></svg>";
												}}
											/>
										</div>
									))}
								</div>
							)}
						</div>

						<div className='space-y-2.5 border-t border-white/[0.04] pt-4'>
							<div className='flex justify-between items-center text-[#a1a19d] font-bold uppercase tracking-[0.06em] text-[11px] pl-1'>
								<span className='flex items-center gap-1.5'>
									<DocumentArrowDownIcon className='h-4 w-4' /> Documenti
								</span>
							</div>

							<UploadDropzone
								label='Allega documento'
								accept='.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg'
								kind='document'
								onUpload={uploadPoiDoc}
							/>

							{isLoadingDocs ? (
								<div className='flex flex-col items-center justify-center py-4 gap-2'>
									<div className='w-4 h-4 border-2 border-white/[0.08] border-t-[#5B8AF5] rounded-full animate-spin' />
									<span className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold'>Caricamento...</span>
								</div>
							) : poiDocuments.length === 0 ? (
								<div className='text-center py-4 bg-white/[0.02] rounded-[10px] border border-dashed border-white/[0.06] text-[#a1a19d] text-[11px] font-medium px-4'>
									Nessun documento allegato.
								</div>
							) : (
								<div className='space-y-1.5'>
									{poiDocuments.map((doc: any) => (
										<div
											key={doc.id}
											className='group flex items-center gap-2.5 bg-white/[0.02] border border-white/[0.04] rounded-[8px] p-2.5 hover:bg-white/[0.04] hover:border-white/[0.08] transition-all'
										>
											<div className='w-8 h-8 rounded-[6px] bg-[rgba(91,138,245,0.08)] flex items-center justify-center text-[#5B8AF5] shrink-0'>
												<DocumentArrowDownIcon className='h-4 w-4' />
											</div>
											<div className='min-w-0 flex-1'>
												<div className='text-[11px] font-semibold text-[#f0f0ec] truncate'>{doc.name}</div>
												<div className='text-[11px] text-[#a1a19d]'>
													{doc.size ? `${(doc.size / 1024).toFixed(0)} KB` : ''}
													{doc.mime_type ? ` · ${doc.mime_type.split('/').pop()?.toUpperCase()}` : ''}
												</div>
											</div>
											<button
												onClick={() => window.open(`${API_BASE}/api/documents/${doc.id}/view`, '_blank')}
												className='shrink-0 text-[#5B8AF5] hover:text-white transition-colors'
												title='Apri documento'
											>
												<ArrowUturnLeftIcon className='h-3.5 w-3.5 rotate-180' />
											</button>
											{isEdit && (
												<button
													onClick={() => handleDeleteDoc(doc.id)}
													className='shrink-0 text-white/[0.15] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity'
													title='Elimina'
												>
													<TrashIcon className='h-3.5 w-3.5' />
												</button>
											)}
										</div>
									))}
								</div>
							)}
						</div>

						<div className='space-y-2.5 border-t border-white/[0.04] pt-4'>
							<div className='flex justify-between items-center text-[#a1a19d] font-bold uppercase tracking-[0.06em] text-[11px] pl-1'>
								<span className='flex items-center gap-1.5'>
									<ClipboardDocumentCheckIcon className='h-4 w-4' /> Ticket
									Correlati
								</span>
								{isEdit && !isCreatingTicketInline && (
									<button
										onClick={() => setIsCreatingTicketInline(true)}
										className='flex items-center gap-1 normal-case font-semibold text-[11px] text-[#F0A93B] bg-[#D97706]/[0.14] hover:bg-[#D97706]/[0.24] border border-[#D97706]/[0.35] rounded-[8px] px-2.5 py-1.5 transition-colors'
									>
										<PlusIcon className='h-3.5 w-3.5' /> Apri Ticket
									</button>
								)}
							</div>

							{isCreatingTicketInline && (
								<form
									onSubmit={handleCreateInlineTicket}
									className='bg-black/30 border border-white/[0.06] p-3.5 rounded-[12px] space-y-3 animate-in fade-in zoom-in-95 duration-150'
								>
									<span className='text-[11px] font-bold text-[#D97706] uppercase tracking-[0.06em] block'>
										Nuovo Ticket
									</span>

									<div>
										<label className='text-[11px] text-[#a1a19d] block mb-1 uppercase tracking-[0.06em] font-bold'>
											Titolo *
										</label>
										<input
											required
											type='text'
											placeholder='Es: Ripristino quadro elettrico...'
											value={inlineTicketForm.title}
											onChange={(e) =>
												setInlineTicketForm({
													...inlineTicketForm,
													title: e.target.value,
												})
											}
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[#f0f0ec] outline-none text-[12px] focus:border-[rgba(6,57,222,0.4)] transition-colors'
										/>
									</div>

									<div>
										<label className='text-[11px] text-[#a1a19d] block mb-1 uppercase tracking-[0.06em] font-bold'>
											Descrizione *
										</label>
										<textarea
											required
											placeholder='Cosa bisogna fare...'
											value={inlineTicketForm.description}
											onChange={(e) =>
												setInlineTicketForm({
													...inlineTicketForm,
													description: e.target.value,
												})
											}
											rows={2}
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[#f0f0ec] outline-none text-[12px] focus:border-[rgba(6,57,222,0.4)] resize-none transition-colors'
										/>
									</div>

									<div>
										<label className='text-[11px] text-[#a1a19d] block mb-1.5 uppercase tracking-[0.06em] font-bold'>
											Priorità
										</label>
										<div className='grid grid-cols-4 gap-1.5'>
											{TICKET_PRIORITIES.map((p) => {
												const active = inlineTicketForm.priority === p.value;
												return (
													<button
														key={p.value}
														type='button'
														onClick={() =>
															setInlineTicketForm({
																...inlineTicketForm,
																priority: p.value,
															})
														}
														className={`flex items-center justify-center gap-1 py-1.5 rounded-[6px] text-[11px] font-bold tracking-wide border transition-colors ${
															active
																? "bg-[#0639DE] border-[#0639DE] text-white"
																: "bg-white/[0.02] border-white/[0.04] text-[#a1a19d] hover:bg-white/[0.04]"
														}`}
													>
														{p.value === "urgent" && (
															<ExclamationTriangleIcon className='h-3 w-3' />
														)}
														{p.label}
													</button>
												);
											})}
										</div>
									</div>

									<div>
										<label className='text-[11px] text-[#a1a19d] block mb-1 uppercase tracking-[0.06em] font-bold'>
											Contatto (Opzionale)
										</label>
										<select
											value={inlineTicketForm.contact_id}
											onChange={(e) =>
												setInlineTicketForm({
													...inlineTicketForm,
													contact_id: e.target.value,
												})
											}
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[#f0f0ec] outline-none text-[12px] focus:border-[rgba(6,57,222,0.4)] transition-colors'
										>
											<option value=''>-- Nessun contatto --</option>
											{contacts.map((c) => (
												<option key={c.id} value={c.id}>
													{c.name} — {c.company || c.service_type}
												</option>
											))}
										</select>
									</div>

									<div className='flex gap-2 pt-2 mt-1 border-t border-white/[0.04]'>
										<button
											type='button'
											onClick={() => setIsCreatingTicketInline(false)}
											className='flex-1 py-1.5 rounded-[8px] border border-white/[0.08] text-[#f0f0ec] text-[12px] font-medium hover:bg-white/[0.04] transition-colors'
										>
											Annulla
										</button>
										<button
											type='submit'
											className='flex-1 py-1.5 rounded-[8px] bg-[#0639DE] hover:bg-[#0530B8] text-white text-[12px] font-semibold border border-[#0639DE] transition-colors'
										>
											Crea Ticket
										</button>
									</div>
								</form>
							)}

							{isLoadingTickets ? (
								<div className='flex flex-col items-center justify-center py-6 gap-2'>
									<div className='w-4 h-4 border-2 border-white/[0.08] border-t-[#D97706] rounded-full animate-spin' />
									<span className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold'>
										Caricamento...
									</span>
								</div>
							) : poiTickets.length === 0 ? (
								<div className='text-center py-6 bg-white/[0.02] rounded-[10px] border border-dashed border-white/[0.06] text-[#a1a19d] text-[11px] font-medium px-4'>
									Nessun intervento registrato per questa posizione.
								</div>
							) : (
								<div className='space-y-2'>
									{poiTickets.map((ticket: any) => (
										<div
											key={ticket.id}
											onClick={() => handleSelectTicket(ticket)}
											className='bg-white/[0.02] border border-white/[0.04] p-3 rounded-[10px] flex flex-col gap-2 hover:border-white/[0.08] hover:bg-white/[0.04] transition-colors cursor-pointer'
										>
											<div className='flex justify-between items-start gap-2'>
												<h4 className='font-bold text-[#f0f0ec] text-[12px] leading-tight truncate flex-1'>
													{ticket.title}
												</h4>
												<span
													className={`text-[11px] px-1.5 py-0.5 rounded-[4px] font-bold uppercase tracking-[0.06em] shrink-0 ${
														ticket.status === "open"
															? "bg-[rgba(239,68,68,0.1)] text-[#f87171] border border-[rgba(239,68,68,0.18)]"
															: ticket.status === "in_progress"
																? "bg-[rgba(217,119,6,0.1)] text-[#D97706] border border-[rgba(217,119,6,0.18)]"
																: "bg-[rgba(52,168,83,0.1)] text-[#34a853] border border-[rgba(52,168,83,0.18)]"
													}`}
												>
													{TICKET_STATUSES.find(s => s.value === ticket.status)?.name || ticket.status}
												</span>
											</div>
											{ticket.description && (
												<p className='text-[11px] text-[#a1a19d] line-clamp-2 leading-relaxed'>
													{ticket.description}
												</p>
											)}
											<div className='flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 border-t border-zinc-800/60 pt-2 text-[11px] text-zinc-500 font-bold uppercase tracking-wider'>
												<span>
													Priorità:{" "}
													<span
														className={
															ticket.priority === "urgent"
																? "text-red-400"
																: ticket.priority === "high"
																	? "text-amber-500"
																	: "text-zinc-300"
														}
													>
														{ticket.priority}
													</span>
												</span>
												<span className='ml-auto text-[11px] font-semibold text-[#8FB4F5] bg-white/[0.05] border border-white/[0.08] rounded-full px-2 py-0.5 normal-case tracking-normal transition-colors'>
													Dettagli →
												</span>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Footer Scheda */}
					<div className='shrink-0 border-t border-zinc-800 pt-3 flex gap-2'>
						{isEdit && (
							<button
								onClick={() => removeAnnotation(selectedPoi.id)}
								className='flex-1 py-2 rounded-xl bg-red-950/30 hover:bg-red-950/60 border border-red-900/40 text-red-400 font-semibold transition-colors shadow-sm'
							>
								Elimina POI
							</button>
						)}
						<button
							onClick={() => setSelectedPoi(null)}
							className={`${isEdit ? "px-4" : "flex-1"} py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold transition-colors`}
						>
							Chiudi
						</button>
					</div>
				</div>
			)}

			{/* MODALE DETTAGLIO / MODIFICA TICKET */}
			{selectedTicket && (
				<div
					className='absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'
					onClick={() => setSelectedTicket(null)}
				>
					<div
						className='w-[370px] max-h-[85vh] overflow-y-auto bg-[#161618] border border-white/[0.06] rounded-[16px] p-5 text-[#f0f0ec] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150'
						onClick={(e) => e.stopPropagation()}
					>
						{/* Header */}
						<div className='flex justify-between items-start border-b border-zinc-800 pb-3'>
							<div className='min-w-0 flex-1'>
								<span className='text-[11px] font-bold text-amber-500 uppercase tracking-wider block mb-1'>
									{isEditingTicket ? "Modifica Ticket" : "Dettaglio Ticket"}
								</span>
								{!isEditingTicket && (
									<h3 className='text-base font-semibold text-white leading-tight break-words pr-2'>
										{selectedTicket.title}
									</h3>
								)}
							</div>
							<button
								onClick={() => setSelectedTicket(null)}
								className='p-1 bg-zinc-800/60 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors shrink-0'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>

						{isEditingTicket ? (
							/* ---- MODALITÀ MODIFICA ---- */
							<form onSubmit={handleUpdateTicket} className='space-y-3.5'>
								<div>
									<label className='text-[11px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
										Titolo Ticket *
									</label>
									<input
										required
										type='text'
										value={ticketEditForm.title}
										onChange={(e) =>
											setTicketEditForm({
												...ticketEditForm,
												title: e.target.value,
											})
										}
										className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none text-xs focus:border-blue-500'
									/>
								</div>

								<div>
									<label className='text-[11px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
										Cosa bisogna fare?
									</label>
									<textarea
										value={ticketEditForm.description}
										onChange={(e) =>
											setTicketEditForm({
												...ticketEditForm,
												description: e.target.value,
											})
										}
										rows={3}
										className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none text-xs focus:border-blue-500 resize-none'
									/>
								</div>

								<div>
									<label className='text-[11px] text-zinc-400 block mb-1.5 uppercase tracking-wider font-bold'>
										Stato
									</label>
									<div className='grid grid-cols-4 gap-2'>
										{TICKET_STATUSES.map((s) => {
											const active = ticketEditForm.status === s.value;
											return (
												<button
													key={s.value}
													type='button'
													onClick={() =>
														setTicketEditForm({
															...ticketEditForm,
															status: s.value,
														})
													}
													className={`py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide border transition-colors ${
														active
															? "bg-blue-600 border-blue-500 text-white"
															: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
													}`}
												>
													{s.name}
												</button>
											);
										})}
									</div>
								</div>

								<div>
									<label className='text-[11px] text-zinc-400 block mb-1.5 uppercase tracking-wider font-bold'>
										Livello Priorità
									</label>
									<div className='grid grid-cols-4 gap-2'>
										{TICKET_PRIORITIES.map((p) => {
											const active = ticketEditForm.priority === p.value;
											return (
												<button
													key={p.value}
													type='button'
													onClick={() =>
														setTicketEditForm({
															...ticketEditForm,
															priority: p.value,
														})
													}
													className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-bold tracking-wide border transition-colors ${
														active
															? "bg-blue-600 border-blue-500 text-white"
															: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
													}`}
												>
													{p.value === "urgent" && (
														<ExclamationTriangleIcon className='h-3 w-3' />
													)}
													{p.label}
												</button>
											);
										})}
									</div>
								</div>

								<div>
									<label className='text-[11px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
										Contatto di Riferimento (Opzionale)
									</label>
									<select
										value={ticketEditForm.contact_id}
										onChange={(e) =>
											setTicketEditForm({
												...ticketEditForm,
												contact_id: e.target.value,
											})
										}
										className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none text-xs focus:border-blue-500'
									>
										<option value=''>-- Nessun contatto --</option>
										{contacts.map((c) => (
											<option key={c.id} value={c.id}>
												{c.first_name} {c.last_name}
											</option>
										))}
									</select>
								</div>

								<div className='flex gap-2 pt-2 border-t border-zinc-800/60'>
									<button
										type='button'
										onClick={() => setIsEditingTicket(false)}
										className='flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium'
									>
										Annulla
									</button>
									<button
										type='submit'
										disabled={isSavingTicket || !ticketEditForm.title.trim()}
										className='flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-semibold'
									>
										{isSavingTicket ? "Salvataggio..." : "Salva Modifiche"}
									</button>
								</div>
							</form>
						) : (
							/* ---- MODALITÀ DETTAGLIO ---- */
							<div className='space-y-4 text-xs'>
								<div className='flex flex-wrap items-center gap-2'>
									<span
										className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-widest ${
											selectedTicket.status === "open"
												? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
												: selectedTicket.status === "in_progress"
													? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
													: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
										}`}
									>
										{selectedTicket.status}
									</span>
									<span
										className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-widest border ${
											selectedTicket.priority === "urgent"
												? "bg-red-500/10 text-red-400 border-red-500/20"
												: selectedTicket.priority === "high"
													? "bg-amber-500/10 text-amber-400 border-amber-500/20"
													: "bg-zinc-700/40 text-zinc-300 border-zinc-700"
										}`}
									>
										Priorità: {selectedTicket.priority}
									</span>
								</div>

								<div className='bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/50'>
									<span className='text-[11px] font-bold text-zinc-500 uppercase tracking-wider block mb-1'>
										Cosa bisogna fare
									</span>
									<p className='text-xs text-zinc-300 leading-relaxed font-medium whitespace-pre-wrap break-words'>
										{selectedTicket.description ||
											"Nessuna descrizione fornita."}
									</p>
								</div>

								{selectedTicket.contact_id && (
									<div className='bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/50 mt-3'>
										<span className='text-[11px] font-bold text-zinc-500 uppercase tracking-wider block mb-1'>
											Contatto di riferimento
										</span>
										<div className='text-xs text-zinc-300 font-medium'>
											{contacts.find(c => c.id === selectedTicket.contact_id)?.company || ""} 
											{" "}
											({contacts.find(c => c.id === selectedTicket.contact_id)?.service_type || "Contatto rimosso"})
										</div>
									</div>
								)}

								{selectedTicket.created_at && (
									<div className='text-[11px] text-zinc-500 font-medium'>
										Creato il{" "}
										<span className='text-zinc-300'>
											{new Date(selectedTicket.created_at).toLocaleString()}
										</span>
									</div>
								)}

								{isEdit && (
									<div className='flex gap-2 pt-2 border-t border-zinc-800/60'>
										<button
											onClick={() => handleDeleteTicket(selectedTicket.id)}
											className='py-2 px-3 rounded-lg bg-red-950/30 hover:bg-red-950/60 border border-red-900/40 text-red-400 font-semibold transition-colors'
										>
											Elimina
										</button>
										<button
											onClick={() => setIsEditingTicket(true)}
											className='flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5'
										>
											<PencilSquareIcon className='h-4 w-4' /> Modifica
										</button>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}

			{/* ===== AI CHAT MODAL ===== */}
			{showAiChat && (
				<div
					className='absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'
					onClick={() => setShowAiChat(false)}
				>
					<div
						className='w-[540px] h-[580px] bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] flex flex-col overflow-hidden'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center justify-between'>
							<div className='flex items-center gap-2.5'>
								<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
									<SparklesIcon className='h-3.5 w-3.5' />
								</div>
								<span className='text-[13px] font-semibold text-[#f0f0ec]'>Assistente AI</span>
							</div>
							<button
								onClick={() => setShowAiChat(false)}
								className='flex items-center justify-center h-7 w-7 rounded-[7px] text-white/[0.28] hover:text-[#f0f0ec] hover:bg-white/[0.04] transition-colors'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>

						<div className='px-[18px] pt-3 pb-1.5 flex gap-1.5 shrink-0 flex-wrap'>
							{([
								{ key: 'tutto', label: 'Tutto', icon: '🌐' },
								{ key: 'documenti', label: 'Documenti', icon: '📄' },
								{ key: 'poi', label: 'POI & Ticket', icon: '📍' },
								{ key: 'modello3d', label: 'Modello 3D', icon: '👁' },
							] as const).map((m) => (
								<button
									key={m.key}
									onClick={() => setAiMode(m.key)}
									className={`px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
										aiMode === m.key
											? 'bg-[#0639DE] text-white shadow-[0_2px_8px_rgba(6,57,222,0.3)]'
											: 'bg-white/[0.04] text-[#a1a19d] hover:bg-white/[0.08] hover:text-[#f0f0ec] border border-white/[0.06]'
									}`}
								>
									<span className='text-[12px]'>{m.icon}</span>
									{m.label}
								</button>
							))}
						</div>

						{aiMode === 'modello3d' && (
							<div className='mx-[18px] mb-1.5 px-3 py-2 rounded-[8px] bg-[rgba(6,57,222,0.08)] border border-[rgba(6,57,222,0.15)] text-[11px] text-[#5B8AF5] leading-relaxed'>
								Cattura lo screenshot della vista corrente + metadati geometrici (dimensioni, vertici, bounding box) e li invia all'AI. Posiziona la camera sull'area di interesse prima di chiedere.
							</div>
						)}

						<div ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className='flex-1 overflow-y-auto p-[18px] pt-1.5 flex flex-col gap-3 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
							{aiMessages.map((msg, i) => (
								<div
									key={i}
									className={`max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
										msg.role === 'user'
											? 'self-end bg-white/[0.04] border border-white/[0.06] rounded-[14px] rounded-br-[4px] text-[#f0f0ec]'
											: 'self-start bg-[rgba(6,57,222,0.12)] border border-[rgba(6,57,222,0.15)] rounded-[14px] rounded-bl-[4px] text-[#f0f0ec]'
									}`}
								>
									{msg.text || (isAiLoading && i === aiMessages.length - 1 ? (
										<span className='inline-flex gap-1'>
											<span className='w-1.5 h-1.5 rounded-full bg-[#5B8AF5] animate-bounce [animation-delay:0ms]' />
											<span className='w-1.5 h-1.5 rounded-full bg-[#5B8AF5] animate-bounce [animation-delay:150ms]' />
											<span className='w-1.5 h-1.5 rounded-full bg-[#5B8AF5] animate-bounce [animation-delay:300ms]' />
										</span>
									) : '')}
									{isAiLoading && i === aiMessages.length - 1 && msg.text && (
										<span className='inline-block w-[2px] h-[14px] bg-[#5B8AF5] animate-pulse ml-0.5 align-text-bottom' />
									)}
								</div>
							))}
						</div>

						<div className='px-[18px] py-3 border-t border-white/[0.04] bg-black/10'>
							<div className='flex bg-black/20 border border-white/[0.06] rounded-[10px] p-[3px] pl-3.5 items-center gap-2 focus-within:border-[rgba(6,57,222,0.3)] transition-colors'>
								<input
									type='text'
									value={aiInput}
									onChange={(e) => setAiInput(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && !isAiLoading && handleAiSend()}
									placeholder={isAiLoading ? 'Sto pensando...' : "Chiedi qualcosa sull'impianto..."}
									disabled={isAiLoading}
									className='flex-1 bg-transparent border-none text-[13px] text-[#f0f0ec] outline-none placeholder:text-white/[0.28] disabled:opacity-50'
								/>
								<button
									onClick={handleAiSend}
									disabled={isAiLoading}
									className='w-8 h-8 rounded-[8px] bg-[#0639DE] hover:bg-[#0530B8] disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0'
								>
									<PaperAirplaneIcon className='h-3.5 w-3.5' />
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* ===== KANBAN TICKET BOARD ===== */}
			{showKanban && (
				<div
					className='absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'
					onClick={() => setShowKanban(false)}
				>
					<div
						className='w-[85vw] max-w-[920px] h-[70vh] bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] flex flex-col overflow-hidden'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center justify-between shrink-0'>
							<div className='flex items-center gap-2.5'>
								<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
									<ViewColumnsIcon className='h-3.5 w-3.5' />
								</div>
								<span className='text-[13px] font-semibold text-[#f0f0ec]'>Board Ticket</span>
								<span className='text-[11px] text-[#a1a19d] ml-1'>{allSiteTickets.length} totali</span>
							</div>
							<button
								onClick={() => setShowKanban(false)}
								className='flex items-center justify-center h-7 w-7 rounded-[7px] text-white/[0.28] hover:text-[#f0f0ec] hover:bg-white/[0.04] transition-colors'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>

						<div className='flex-1 flex gap-2.5 p-[18px] overflow-x-auto bg-black/[0.06] [&::-webkit-scrollbar]:h-[4px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
							{isLoadingAllTickets ? (
								<div className='flex-1 flex items-center justify-center text-[#a1a19d] text-[13px]'>Caricamento ticket...</div>
							) : (
								[
									{ status: 'open', label: 'Aperto', color: '#ef4444' },
									{ status: 'in_progress', label: 'In Corso', color: '#D97706' },
									{ status: 'resolved', label: 'Risolto', color: '#34a853' },
									{ status: 'closed', label: 'Chiuso', color: '#64748B' },
								].map((col) => {
									const colTickets = allSiteTickets.filter((t) => t.status === col.status);
									return (
										<div key={col.status} className='flex-[0_0_220px] bg-white/[0.015] border border-white/[0.04] rounded-[12px] p-3 flex flex-col gap-2'>
											<div className='flex items-center gap-2 pb-1'>
												<span className='w-2 h-2 rounded-full shrink-0' style={{ background: col.color }} />
												<span className='text-[11px] font-bold text-[#a1a19d] uppercase tracking-[0.06em]'>{col.label}</span>
												<span className='ml-auto bg-white/[0.05] px-1.5 py-[1px] rounded-full text-[11px] text-white/[0.28] font-semibold'>{colTickets.length}</span>
											</div>
											<div className='flex-1 overflow-y-auto flex flex-col gap-2 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
												{colTickets.length === 0 && (
													<div className='text-center py-6 text-[11px] text-white/[0.18] italic'>Nessun ticket</div>
												)}
												{colTickets.map((ticket) => {
													const poi = annotations.find((a) => a.id === ticket.poi_id);
													const nextStatuses = TICKET_STATUSES.filter((s) => s.value !== col.status);
													return (
														<div
															key={ticket.id}
															onClick={() => {
																if (poi) {
																	setShowKanban(false);
																	focusAnnotation(poi);
																	handlePoiSelect(poi);
																}
															}}
															className={`bg-white/[0.025] border border-white/[0.04] rounded-[10px] p-3 text-[12px] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all group ${poi ? 'cursor-pointer' : ''}`}
														>
															<div className='flex items-start justify-between gap-2 mb-1.5'>
																<span className={`text-[11px] font-bold px-[7px] py-[1px] rounded-full ${
																	ticket.priority === 'urgent' || ticket.priority === 'high'
																		? 'bg-[rgba(239,68,68,0.1)] text-[#f87171]'
																		: 'bg-white/[0.04] text-white/[0.28]'
																}`}>
																	{ticket.priority?.toUpperCase()}
																</span>
																{poi && (
																	<span className='text-[11px] text-[#5B8AF5] truncate max-w-[80px] flex items-center gap-1'>
																		<MapPinIcon className='h-2.5 w-2.5 shrink-0' />
																		{poi.title}
																	</span>
																)}
															</div>
															<div className='text-[#f0f0ec] font-medium mb-2 leading-snug'>{ticket.title}</div>
															{ticket.description && (
																<div className='text-[#a1a19d] text-[11px] mb-2 line-clamp-2'>{ticket.description}</div>
															)}
															{isEdit && (
																<div className='flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
																	{nextStatuses.map((ns) => (
																		<button
																			key={ns.value}
																			onClick={(e) => { e.stopPropagation(); handleKanbanStatusChange(ticket.id, ns.value); }}
																			className='flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-[6px] border border-white/[0.06] text-[#a1a19d] hover:bg-white/[0.04] hover:text-[#f0f0ec] transition-all'
																		>
																			<ChevronRightIcon className='h-2.5 w-2.5' />
																			{ns.name}
																		</button>
																	))}
																</div>
															)}
														</div>
													);
												})}
											</div>
										</div>
									);
								})
							)}
						</div>
					</div>
				</div>
			)}

			{/* ===== MODEL SWITCHER MODAL ===== */}
			{showModelSwitcher && (
				<div
					className='absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'
					onClick={() => setShowModelSwitcher(false)}
				>
					<div
						className='w-[460px] max-h-[70vh] bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] flex flex-col overflow-hidden'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center justify-between shrink-0'>
							<div className='flex items-center gap-2.5'>
								<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
									<CubeTransparentIcon className='h-3.5 w-3.5' />
								</div>
								<span className='text-[13px] font-semibold text-[#f0f0ec]'>Modelli 3D</span>
								<span className='text-[11px] text-[#a1a19d] ml-1'>{siteModels.length} disponibili</span>
							</div>
							<button
								onClick={() => setShowModelSwitcher(false)}
								className='flex items-center justify-center h-7 w-7 rounded-[7px] text-white/[0.28] hover:text-[#f0f0ec] hover:bg-white/[0.04] transition-colors'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>

						<div className='flex-1 overflow-y-auto p-3 flex flex-col gap-2 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
							{isLoadingModels ? (
								<div className='flex items-center justify-center py-12 text-[#a1a19d] text-[13px]'>Caricamento modelli...</div>
							) : siteModels.length === 0 ? (
								<div className='text-center py-12 text-[11px] text-white/[0.28] italic'>Nessun modello trovato per questa sede.</div>
							) : (
								siteModels.map((m) => {
									const isCurrent = m.id === modelId;
									const format = (m.format || 'ply').toUpperCase();
									const viewerPath = m.format === 'splat' ? 'splat' : 'ply';
									return (
										<div
											key={m.id}
											onClick={() => {
												if (isCurrent) return;
												setShowModelSwitcher(false);
												router.push(`/${siteId}/${viewerPath}/${m.id}`);
											}}
											className={`flex items-center gap-3 p-3.5 rounded-[10px] border transition-all ${
												isCurrent
													? 'bg-[rgba(6,57,222,0.08)] border-[rgba(6,57,222,0.25)]'
													: 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08] cursor-pointer'
											}`}
										>
											<div className={`w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0 ${
												isCurrent ? 'bg-[#0639DE] text-white' : 'bg-white/[0.04] text-[#a1a19d]'
											}`}>
												<CubeTransparentIcon className='h-5 w-5' />
											</div>
											<div className='min-w-0 flex-1'>
												<div className='text-[13px] font-semibold text-[#f0f0ec] truncate flex items-center gap-2'>
													{m.name}
													{isCurrent && (
														<span className='text-[11px] font-bold px-1.5 py-[1px] rounded-full bg-[#0639DE] text-white'>ATTIVO</span>
													)}
												</div>
												<div className='text-[11px] text-[#a1a19d] flex items-center gap-2'>
													<span className='font-mono text-[11px] bg-white/[0.04] px-1.5 py-[1px] rounded'>{format}</span>
													{m.created_at && (
														<span>{new Date(m.created_at).toLocaleDateString()}</span>
													)}
												</div>
											</div>
											{!isCurrent && (
												<ChevronRightIcon className='h-4 w-4 text-white/[0.28] shrink-0' />
											)}
										</div>
									);
								})
							)}
						</div>
					</div>
				</div>
			)}

			{/* ===== RUBRICA CONTATTI MODAL ===== */}
			{showContacts && (
				<div
					className='absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'
					onClick={() => { setShowContacts(false); setIsCreatingContact(false); setEditingContactId(null); }}
				>
					<div
						className='w-[500px] max-h-[75vh] bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] flex flex-col overflow-hidden'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center justify-between shrink-0'>
							<div className='flex items-center gap-2.5'>
								<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
									<UserGroupIcon className='h-3.5 w-3.5' />
								</div>
								<span className='text-[13px] font-semibold text-[#f0f0ec]'>Rubrica Contatti</span>
								<span className='text-[11px] text-[#a1a19d] ml-1'>{contacts.length}</span>
							</div>
							<div className='flex items-center gap-1.5'>
								{isEdit && !isCreatingContact && (
									<button
										onClick={() => setIsCreatingContact(true)}
										className='flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] text-[11px] font-semibold text-[#5B8AF5] hover:bg-[rgba(6,57,222,0.12)] transition-colors'
									>
										<PlusIcon className='h-3 w-3' /> Nuovo
									</button>
								)}
								<button
									onClick={() => { setShowContacts(false); setIsCreatingContact(false); setEditingContactId(null); }}
									className='flex items-center justify-center h-7 w-7 rounded-[7px] text-white/[0.28] hover:text-[#f0f0ec] hover:bg-white/[0.04] transition-colors'
								>
									<XMarkIcon className='h-4 w-4' />
								</button>
							</div>
						</div>

						{isCreatingContact && (
							<form onSubmit={editingContactId ? handleUpdateContact : handleCreateContact} className='px-[18px] py-4 border-b border-white/[0.04] space-y-2.5'>
								<span className='text-[11px] font-bold text-[#5B8AF5] uppercase tracking-[0.06em] block'>{editingContactId ? 'Modifica Contatto' : 'Nuovo Contatto'}</span>
								<div className='grid grid-cols-2 gap-2'>
									<div>
										<label className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Nome *</label>
										<input
											required
											value={newContact.name}
											onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
											placeholder='Mario Rossi'
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
										/>
									</div>
									<div>
										<label className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Azienda</label>
										<input
											value={newContact.company}
											onChange={(e) => setNewContact({ ...newContact, company: e.target.value })}
											placeholder='Elettrica Srl'
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
										/>
									</div>
								</div>
								<div>
									<label className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Tipo Servizio *</label>
									<input
										required
										value={newContact.service_type}
										onChange={(e) => setNewContact({ ...newContact, service_type: e.target.value })}
										placeholder='Elettricista, Idraulico, Coperturista...'
										className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
									/>
								</div>
								<div className='grid grid-cols-2 gap-2'>
									<div>
										<label className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Telefono</label>
										<input
											value={newContact.phone}
											onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
											placeholder='+39 333 ...'
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
										/>
									</div>
									<div>
										<label className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Email</label>
										<input
											type='email'
											value={newContact.email}
											onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
											placeholder='mario@azienda.it'
											className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
										/>
									</div>
								</div>
								<div>
									<label className='text-[11px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Note</label>
									<input
										value={newContact.notes}
										onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
										placeholder='Note aggiuntive...'
										className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-1.5 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
									/>
								</div>
								<div className='flex gap-2 pt-1'>
									<button
										type='button'
										onClick={() => { setIsCreatingContact(false); setEditingContactId(null); setNewContact({ name: '', company: '', service_type: '', phone: '', email: '', notes: '' }); }}
										className='flex-1 py-1.5 rounded-[8px] border border-white/[0.08] text-[#f0f0ec] text-[12px] font-medium hover:bg-white/[0.04] transition-colors'
									>
										Annulla
									</button>
									<button
										type='submit'
										className='flex-1 py-1.5 rounded-[8px] bg-[#0639DE] hover:bg-[#0530B8] text-white text-[12px] font-semibold border border-[#0639DE] transition-colors'
									>
										{editingContactId ? 'Salva Modifiche' : 'Salva Contatto'}
									</button>
								</div>
							</form>
						)}

						<div className='flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
							{contacts.length === 0 ? (
								<div className='text-center py-12 text-[11px] text-white/[0.28] italic'>
									Nessun contatto in rubrica.
								</div>
							) : (
								contacts.map((c) => (
									<div
										key={c.id}
										className='group flex items-start gap-3 p-3 rounded-[10px] bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all'
									>
										<div className='w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center text-[#a1a19d] shrink-0 mt-0.5'>
											<UserGroupIcon className='h-4 w-4' />
										</div>
										<div className='min-w-0 flex-1'>
											<div className='text-[13px] font-semibold text-[#f0f0ec] truncate'>{c.name}</div>
											<div className='text-[11px] text-[#a1a19d] truncate'>
												{c.company && <span>{c.company} — </span>}
												<span className='text-[#5B8AF5]'>{c.service_type}</span>
											</div>
											<div className='flex items-center gap-3 mt-1.5'>
												{c.phone && (
													<span className='flex items-center gap-1 text-[11px] text-[#a1a19d]'>
														<PhoneIcon className='h-3 w-3' /> {c.phone}
													</span>
												)}
												{c.email && (
													<span className='flex items-center gap-1 text-[11px] text-[#a1a19d]'>
														<EnvelopeIcon className='h-3 w-3' /> {c.email}
													</span>
												)}
											</div>
											{c.notes && (
												<div className='text-[11px] text-white/[0.28] mt-1 italic truncate'>{c.notes}</div>
											)}
										</div>
										{isEdit && (
											<div className='shrink-0 flex items-center gap-1.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity'>
												<button
													onClick={() => startEditContact(c)}
													title='Modifica contatto'
													className='text-white/[0.15] hover:text-[#5B8AF5] transition-colors'
												>
													<PencilSquareIcon className='h-4 w-4' />
												</button>
												<button
													onClick={() => handleDeleteContact(c.id)}
													title='Elimina contatto'
													className='text-white/[0.15] hover:text-[#ef4444] transition-colors'
												>
													<TrashIcon className='h-4 w-4' />
												</button>
											</div>
										)}
									</div>
								))
							)}
						</div>
					</div>
				</div>
			)}

			{/* ===== NOTIFICHE TOAST ===== */}
			<div className='absolute bottom-16 right-2.5 z-[100] flex flex-col gap-2 pointer-events-none'>
				{toasts.map((t) => (
					<div
						key={t.id}
						className='flex items-center gap-2.5 bg-[#161618]/92 backdrop-blur-[40px] saturate-[160%] border border-white/[0.08] rounded-[12px] px-4 py-3 shadow-[0_8px_40px_rgba(0,0,0,0.55)] max-w-[340px] pointer-events-auto animate-in fade-in slide-in-from-right-4 duration-200'
					>
						<span
							className='w-2 h-2 rounded-full shrink-0'
							style={{
								background:
									t.type === "error"
										? "#E24B4A"
										: t.type === "success"
											? "#22C55E"
											: "#378ADD",
								boxShadow: `0 0 8px ${
									t.type === "error"
										? "rgba(226,75,74,0.5)"
										: t.type === "success"
											? "rgba(34,197,94,0.5)"
											: "rgba(55,138,221,0.5)"
								}`,
							}}
						/>
						<span className='text-[12px] font-medium text-[#f0f0ec] leading-snug'>
							{t.msg}
						</span>
					</div>
				))}
			</div>

			{/* ===== MODALE CATALOGO SERVIZI (ex pagina /services) ===== */}
			<ServicesModal open={showServices} onClose={() => setShowServices(false)} />
		</div>
	);
}
