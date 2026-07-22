// @ts-nocheck
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/utils/api";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	CSS2DRenderer,
	CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import { createDSMMesh } from "@/utils/dsmMeshGenerator";
import {
	ArrowPathIcon,
	DocumentArrowDownIcon,
	HandRaisedIcon,
	MapPinIcon,
	StopIcon,
	SparklesIcon,
	SunIcon,
	VideoCameraIcon,
	WrenchScrewdriverIcon,
	HomeIcon,
	BuildingOfficeIcon,
	BugAntIcon,
	XMarkIcon,
	ClipboardDocumentCheckIcon,
	PencilSquareIcon,
	CameraIcon,
	PlusIcon,
	PhotoIcon,
	ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useParams } from "next/navigation";

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
type MaintenanceStatus = "open" | "in_progress" | "closed";

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

// Schema BICOLORE per i pin nella vista 3D: due soli colori con significato
// "normale vs. attenzione" invece della tavolozza severity + categoria.
const PIN_BICOLOR = {
	normal: "#5B8AF5", // info / maintenance — blu brand
	alert: "#E24B4A", // warning / critical — rosso allerta
};
const getPinBicolor = (severity?: Severity | null) =>
	severity === "warning" || severity === "critical"
		? PIN_BICOLOR.alert
		: PIN_BICOLOR.normal;

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
	maintenanceStatus?: MaintenanceStatus | null;
	maintenanceDueDate?: string | null;
	maintenanceDoneDate?: string | null;
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

interface CoreSplatEditorProps {
	url: string;
	modelId: string;
	format?: string | null;
}

// Mappa il formato del modello (dal DB) all'enum SceneFormat di
// @mkkellogg/gaussian-splats-3d. I file .sog vengono convertiti a monte in PLY
// binario dal backend, quindi vanno letti come SceneFormat.Ply.
function resolveSceneFormat(format?: string | null) {
	switch ((format || "").toLowerCase()) {
		case "ply":
		case "sog": // convertito in PLY binario dal backend
			return GaussianSplats3D.SceneFormat.Ply;
		case "ksplat":
			return GaussianSplats3D.SceneFormat.KSplat;
		case "splat":
		default:
			return GaussianSplats3D.SceneFormat.Splat;
	}
}

export default function CoreSplatEditor({
	url,
	modelId,
	format,
}: CoreSplatEditorProps) {
	const { id: siteId } = useParams();
	const mountRef = useRef<HTMLDivElement>(null);
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [pending, setPending] = useState<PendingAnnotation>(null);
	const [annTitle, setAnnTitle] = useState("");
	const [annDescription, setAnnDescription] = useState("");
	const [annSeverity, setAnnSeverity] = useState<Severity>("info");
	const [annCategory, setAnnCategory] = useState<Category>("generic");
	const [annMaintenanceStatus, setAnnMaintenanceStatus] =
		useState<MaintenanceStatus>("open");
	const [annMaintenanceDueDate, setAnnMaintenanceDueDate] = useState("");
	const [annMaintenanceDoneDate, setAnnMaintenanceDoneDate] = useState("");
	const [tool, setTool] = useState<Tool>("navigate");
	const [loading, setLoading] = useState(true);
	const [panelOpen, setPanelOpen] = useState(true);

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

	// 🔥 STATI GESTIONE TICKET, FOTO E MODIFICHE POI (Aggiunti come in plyViewer)
	const [selectedPoi, setSelectedPoi] = useState<Annotation | null>(null);
	const [poiTickets, setPoiTickets] = useState<any[]>([]);
	const [poiPhotos, setPoiPhotos] = useState<any[]>([]);
	const [isLoadingTickets, setIsLoadingTickets] = useState(false);
	const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
	const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
	const [isEditingPoi, setIsEditingPoi] = useState(false);
	const [isCreatingTicketInline, setIsCreatingTicketInline] = useState(false);

	// Dettaglio / modifica del singolo ticket
	const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
	const [isEditingTicket, setIsEditingTicket] = useState(false);
	const [isSavingTicket, setIsSavingTicket] = useState(false);

	const [editPoiForm, setEditPoiForm] = useState({
		title: "",
		description: "",
		severity: "info" as Severity,
		category: "generic" as Category,
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

	const toolRef = useRef<Tool>("navigate");
	toolRef.current = tool;

	const interactionPointsRef = useRef<THREE.Vector3[]>([]);
	const geometryPreviewRef = useRef<THREE.Group | null>(null);

	const savedGeomCountRef = useRef(0);
	savedGeomCountRef.current = savedGeometries.length;

	const [contacts, setContacts] = useState<any[]>([]);
	const [ticketEditForm, setTicketEditForm] = useState({
		title: "",
		description: "",
		status: "open",
		priority: "medium",
		contact_id: "",
	});

	const [inlineTicketForm, setInlineTicketForm] = useState({
		title: "",
		description: "",
		priority: "medium",
		contact_id: "",
	});

	useEffect(() => {
		const fetchContacts = async () => {
			try {
				// Sostituisci con l'URL corretto della tua API dei contatti
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
		if (controlsRef.current) {
			console.log(
				`[SPLAT DEBUG] Tool cambiato in: ${tool}. OrbitControls enabled: ${tool === "navigate"}`,
			);
			controlsRef.current.enabled = tool === "navigate";
		}
	}, [tool]);

	const drawPersistentGeometry = useCallback((geom: SavedGeometry): string => {
		const persistentGroup = geometryPersistentGroupRef.current;
		const cam = cameraRef.current;
		const ctl = controlsRef.current;
		if (!persistentGroup || !mountRef.current || !cam || !ctl) return "";

		const singleGeomGroup = new THREE.Group();
		singleGeomGroup.userData = { id: geom.id };

		// Misura più piccola per non essere invadente
		const dist = cam.position.distanceTo(ctl.target);
		const r = dist * 0.0035;

		const color =
			geom.type === "Misura"
				? 0x378add
				: geom.type === "Arco"
					? 0xef9f27
					: 0xe24b4a;

		geom.points.forEach((p) => {
			const sphere = new THREE.Mesh(
				new THREE.SphereGeometry(r, 16, 16),
				new THREE.MeshBasicMaterial({
					color,
					depthTest: false,
					transparent: true,
				}),
			);
			sphere.position.copy(p);
			sphere.renderOrder = 999;
			singleGeomGroup.add(sphere);
		});

		let pointsToDraw: THREE.Vector3[] = [];
		if (geom.type === "Misura") {
			pointsToDraw = geom.points;
		} else if (geom.type === "Area") {
			pointsToDraw = [...geom.points, geom.points[0]];
		} else if (geom.type === "Arco" && geom.points.length === 3) {
			const curve = new THREE.CatmullRomCurve3(
				[geom.points[0], geom.points[1], geom.points[2]],
				false,
				"centripetal",
			);
			pointsToDraw = curve.getPoints(40);
		}

		if (pointsToDraw.length >= 2) {
			const flatPoints = pointsToDraw.flatMap((p) => [p.x, p.y, p.z]);
			const lineGeo = new LineGeometry();
			lineGeo.setPositions(flatPoints);
			const lineMat = new LineMaterial({
				color,
				linewidth: 8,
				depthTest: false,
				transparent: true,
			});
			lineMat.resolution.set(
				mountRef.current.clientWidth,
				mountRef.current.clientHeight,
			);
			const line = new Line2(lineGeo, lineMat);
			line.renderOrder = 999;
			singleGeomGroup.add(line);
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
		interactionPointsRef.current = [];
		geometryPreviewRef.current?.clear();
		setPendingGeom(null);
		setGeomName("");
		setCalculatedArea(null);
		setTool("navigate");
	};

	const discardGeometry = () => {
		interactionPointsRef.current = [];
		geometryPreviewRef.current?.clear();
		setPendingGeom(null);
		setGeomName("");
		setCalculatedArea(null);
		setTool("navigate");
	};

	const removeGeometry = (id: string, uuid?: string) => {
		setSavedGeometries((prev) => prev.filter((g) => g.id !== id));
		const persistentGroup = geometryPersistentGroupRef.current;
		if (persistentGroup && uuid) {
			const meshObject = persistentGroup.children.find(
				(child) => child.uuid === uuid,
			);
			if (meshObject) persistentGroup.remove(meshObject);
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
		const rows = savedGeometries.map((g) => [
			`"${g.name.replace(/"/g, '""')}"`,
			g.type,
			`"${g.value}"`,
		]);
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

	// 🔥 METODO ROBUSTO PER IL CALCOLO COORDINATE
	const getPoiCoordinates = (ann: Annotation) => ({
		x: ann.position?.x ?? ann.x ?? 0,
		y: ann.position?.y ?? ann.y ?? 0,
		z: ann.position?.z ?? ann.z ?? 0,
	});

	// 🔥 LOGICA DI SELEZIONE DEL POI, FOTO E TICKET
	const handlePoiSelect = useCallback(async (poi: Annotation) => {
		setSelectedPoi(poi);
		setIsEditingPoi(false);
		setIsCreatingTicketInline(false);

		setEditPoiForm({
			title: poi.title,
			description: poi.description || "",
			severity: poi.severity,
			category: poi.category,
		});

		setIsLoadingTickets(true);
		setIsLoadingPhotos(true);

		try {
			const [ticketsRes, photosRes] = await Promise.all([
				fetch(`${API_BASE}/api/tickets/site/${siteId}`).catch(
					() => null,
				),
				fetch(`${API_BASE}/api/photos?poi_id=${poi.id}`).catch(
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
		} catch (err) {
			console.error("Errore recupero logistica POI:", err);
		} finally {
			setIsLoadingTickets(false);
			setIsLoadingPhotos(false);
		}
	}, []);

	const handlePoiSelectRef = useRef(handlePoiSelect);
	useEffect(() => {
		handlePoiSelectRef.current = handlePoiSelect;
	}, [handlePoiSelect]);

	const addAnnotationToScene = useCallback((ann: Annotation) => {
		const group = annotGroupRef.current;
		if (!group) return;
		const cam = cameraRef.current;
		const ctl = controlsRef.current;

		// Calcoliamo la distanza per scalare proporzionalmente i pin
		const dist = cam && ctl ? cam.position.distanceTo(ctl.target) : 10;

		const coords = getPoiCoordinates(ann);
		const container = new THREE.Group();
		container.userData.annId = ann.id;
		// Schema bicolore: un solo colore per pin (blu = normale, rosso = allerta)
		const pinColor = getPinBicolor(ann.severity);

		const labelDiv = document.createElement("div");
		labelDiv.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
			background: rgba(28, 30, 33, 0.95);
			backdrop-filter: blur(4px);
			color: #f4f4f5;
			font-family: -apple-system, BlinkMacSystemFont, sans-serif;
			font-size: 11px;
			font-weight: 600;
			padding: 5px 12px;
			border-radius: 99px;
			white-space: nowrap;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
			border: 1px solid ${pinColor}40;
			transform: translateY(-8px);
			pointer-events: auto;
			cursor: pointer;
		`;

		labelDiv.innerHTML = `
			<style>
				@keyframes ledPulse {
					0% { transform: scale(0.8); opacity: 1; }
					50% { transform: scale(1.6); opacity: 0.3; }
					100% { transform: scale(0.8); opacity: 1; }
				}
			</style>
			<span style="position: relative; display: flex; width: 8px; height: 8px; margin-right: 2px;">
				<span style="position: absolute; display: inline-flex; height: 100%; width: 100%; border-radius: 50%; background-color: ${pinColor}; animation: ledPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></span>
				<span style="position: relative; display: inline-flex; border-radius: 50%; width: 8px; height: 8px; background-color: ${pinColor};"></span>
			</span>
			<span>${ann.title}</span>
		`;

		labelDiv.addEventListener("click", (e) => {
			e.stopPropagation();
			if (handlePoiSelectRef.current) {
				handlePoiSelectRef.current(ann);
				focusAnnotation(ann);
			}
		});

		const labelObj = new CSS2DObject(labelDiv);

		// Altezza del gambetto
		const stalkHeight = dist * 0.08;

		// Sfera alla base (ridotti i segmenti da 16 a 8 per ottimizzare il lag)
		const sphere = new THREE.Mesh(
			new THREE.SphereGeometry(1, 8, 8),
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(pinColor),
				depthTest: false,
			}),
		);
		sphere.scale.setScalar(dist * 0.005);
		sphere.position.set(coords.x, coords.y, coords.z);
		sphere.renderOrder = 999;
		container.add(sphere);

		// Cilindro (gambetto) - ridotti i segmenti a 6
		const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
		const cylinderMat = new THREE.MeshBasicMaterial({
			color: new THREE.Color(pinColor),
			depthTest: false,
			transparent: true,
			opacity: 0.6,
		});
		const stalk = new THREE.Mesh(cylinderGeo, cylinderMat);
		stalk.scale.set(dist * 0.0006, stalkHeight, dist * 0.0006);
		stalk.position.set(coords.x, coords.y + stalkHeight / 2, coords.z);
		stalk.renderOrder = 999;
		container.add(stalk);

		// Posiziona l'etichetta testuale in cima al gambetto
		labelObj.position.set(coords.x, coords.y + stalkHeight, coords.z);
		container.add(labelObj);

		group.add(container);
	}, []);

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
			alert("Impossibile salvare le modifiche apportate al POI.");
		}
	};

	const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file || !selectedPoi) return;

		const formData = new FormData();
		formData.append("image", file);
		formData.append("site_id", modelId);
		formData.append("poi_id", selectedPoi.id);

		setIsUploadingPhoto(true);
		try {
			const res = await fetch(`${API_BASE}/api/photos`, {
				method: "POST",
				body: formData,
			});

			if (res.ok) {
				const newPhoto = await res.json();
				setPoiPhotos((prev) => [newPhoto, ...prev]);
			} else {
				alert("Errore del server durante il caricamento.");
			}
		} catch (err) {
			console.error("Upload error:", err);
			alert("Impossibile caricare la foto.");
		} finally {
			setIsUploadingPhoto(false);
			e.target.value = "";
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
				// Il backend potrebbe non restituire poi_id: lo forziamo lato client
				// così il ticket appena creato compare subito sotto questo POI.
				setPoiTickets((prev) => [
					{ ...newTicket, poi_id: selectedPoi.id },
					...prev,
				]);
				setIsCreatingTicketInline(false);
				setInlineTicketForm({
					title: "",
					description: "",
					priority: "medium",
					contact_id: "",
				});
			}
		} catch (err) {
			alert("Errore durante l'apertura del ticket.");
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
			contact_id: ticket.contact_id || "",
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
			} else {
				const msg = await res.text().catch(() => "");
				console.error("Update ticket fallito:", res.status, msg);
				alert("Errore durante l'aggiornamento del ticket.");
			}
		} catch (err) {
			console.error("Update ticket error:", err);
			alert("Impossibile aggiornare il ticket.");
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
				alert("Impossibile eliminare il ticket.");
			}
		} catch (err) {
			console.error("Delete ticket error:", err);
			alert("Impossibile eliminare il ticket.");
		}
	};

	const handleViewPhoto = (img: any) => {
		if (!img.file_path) return;
		const streamUrl = `${API_BASE}/api/photos/stream?path=${encodeURIComponent(img.file_path)}`;
		window.open(streamUrl, "_blank");
	};

	// === MAIN INITIALIZATION SCENE ===
	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		mount.innerHTML = "";

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x0d0f12);

		const camera = new THREE.PerspectiveCamera(
			60,
			mount.clientWidth / mount.clientHeight,
			0.1,
			15000,
		);
		cameraRef.current = camera;

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		mount.appendChild(renderer.domElement);

		const labelRenderer = new CSS2DRenderer();
		labelRenderer.setSize(mount.clientWidth, mount.clientHeight);
		labelRenderer.domElement.style.position = "absolute";
		labelRenderer.domElement.style.top = "0";
		labelRenderer.domElement.style.left = "0";
		labelRenderer.domElement.style.pointerEvents = "none";
		mount.appendChild(labelRenderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;
		controls.mouseButtons = {
			LEFT: THREE.MOUSE.ROTATE,
			MIDDLE: THREE.MOUSE.PAN,
			RIGHT: THREE.MOUSE.PAN,
		};
		controlsRef.current = controls;

		scene.add(new THREE.AmbientLight(0xffffff, 0.65));

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

		const viewer = new GaussianSplats3D.DropInViewer({
			sharedMemoryForWorkers: false,
			dynamicScene: false,
		});
		scene.add(viewer);

		let dsmMesh: THREE.Mesh | null = null;
		let floorLimitY = 0;

		viewer
			.addSplatScene(url, {
				showLoadingUI: false,
				format: resolveSceneFormat(format), // dedotto dal formato del modello
			})
			.then(() => {
				console.log("[SPLAT DEBUG] Splat caricato nella scena!");
				viewer.rotation.x = Math.PI;
				viewer.updateMatrixWorld(true);

				const splatMesh = viewer.viewer?.splatMesh;
				if (splatMesh) {
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

						const centerY = sizeY / 2;
						controls.target.set(0, centerY, 0);

						const fitDistance = maxDim * 1.0;
						camera.position.set(0, centerY + maxDim * 0.25, fitDistance);
						camera.near = 0.1;
						camera.far = 15000;
						camera.updateProjectionMatrix();
						controls.update();
						// Salva questa inquadratura come stato di "Reset vista":
						// senza saveState() il reset tornerebbe alla camera pre-caricamento.
						controls.saveState();

						console.log("[SPLAT DEBUG] Generazione Proxy Mesh in corso...");
						const { mesh, error } = createDSMMesh(
							rawCenters,
							viewer.matrixWorld,
						);
						if (error) {
							console.error(
								"[SPLAT DEBUG] Errore generazione Proxy Mesh:",
								error,
							);
						} else if (mesh) {
							dsmMesh = mesh;
							scene.add(dsmMesh);
							console.log("[SPLAT DEBUG] Proxy Mesh creata con successo!");
						}
					}
				}

				setLoading(false);

				fetch(`${API_BASE}/api/pois?model_id=${modelId}`)
					.then((r) => r.json())
					.then((data: Annotation[]) => {
						setAnnotations(data);
						data.forEach((ann) => addAnnotationToScene(ann));
					})
					.catch((err) => console.error("Errore fetch annotations:", err));
			});

		const raycaster = new THREE.Raycaster();
		const mouse = new THREE.Vector2();
		let downX = 0,
			downY = 0;

		function onPointerDown(e: PointerEvent) {
			downX = e.clientX;
			downY = e.clientY;
		}

		function onPointerUp(e: PointerEvent) {
			if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
			const t = toolRef.current;
			if (t === "navigate") return;

			if (!dsmMesh) {
				console.warn(
					"[SPLAT DEBUG] Proxy Mesh non disponibile, impossibile piazzare annotazioni.",
				);
				return;
			}

			const rect = renderer.domElement.getBoundingClientRect();
			mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
			mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

			raycaster.setFromCamera(mouse, camera);
			const hits = raycaster.intersectObject(dsmMesh, false);

			if (hits.length > 0) {
				const hit = hits[0];

				if (t === "pin") {
					setPending({ type: "pin", position: hit.point.clone() });
					return;
				}

				const mPoints = interactionPointsRef.current;
				const previewGroup = geometryPreviewRef.current;
				if (!previewGroup || !controlsRef.current) return;
				const dist = camera.position.distanceTo(controlsRef.current.target);
				const r = dist * 0.0035;

				if (t === "measure") {
					if (mPoints.length >= 2) {
						mPoints.length = 0;
						previewGroup.clear();
						setMeasureDistance(null);
						setSlopeStats(null);
					}

					mPoints.push(hit.point.clone());
					const sphere = new THREE.Mesh(
						new THREE.SphereGeometry(r, 16, 16),
						new THREE.MeshBasicMaterial({
							color: 0x378add,
							depthTest: false,
							transparent: true,
						}),
					);
					sphere.position.copy(hit.point);
					sphere.renderOrder = 999;
					previewGroup.add(sphere);

					if (mPoints.length === 2) {
						const pointsArray = [
							mPoints[0].x,
							mPoints[0].y,
							mPoints[0].z,
							mPoints[1].x,
							mPoints[1].y,
							mPoints[1].z,
						];
						const lineGeo = new LineGeometry();
						lineGeo.setPositions(pointsArray);

						const lineMat = new LineMaterial({
							color: 0x378add,
							linewidth: 10,
							depthTest: false,
							transparent: true,
						});
						lineMat.resolution.set(
							renderer.domElement.clientWidth,
							renderer.domElement.clientHeight,
						);

						const line = new Line2(lineGeo, lineMat);
						line.renderOrder = 999;
						previewGroup.add(line);

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
					const sphere = new THREE.Mesh(
						new THREE.SphereGeometry(r, 16, 16),
						new THREE.MeshBasicMaterial({
							color: 0xef9f27,
							depthTest: false,
							transparent: true,
						}),
					);
					sphere.position.copy(hit.point);
					sphere.renderOrder = 999;
					previewGroup.add(sphere);

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

						const arcGeo = new LineGeometry();
						const flatPoints = curvePoints.flatMap((p) => [p.x, p.y, p.z]);
						arcGeo.setPositions(flatPoints);

						const arcMat = new LineMaterial({
							color: 0xef9f27,
							linewidth: 10,
							depthTest: false,
							transparent: true,
						});
						arcMat.resolution.set(
							renderer.domElement.clientWidth,
							renderer.domElement.clientHeight,
						);

						const arcLine = new Line2(arcGeo, arcMat);
						arcLine.renderOrder = 999;
						previewGroup.add(arcLine);

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
					const sphere = new THREE.Mesh(
						new THREE.SphereGeometry(r, 16, 16),
						new THREE.MeshBasicMaterial({
							color: 0xe24b4a,
							depthTest: false,
							transparent: true,
						}),
					);
					sphere.position.copy(hit.point);
					sphere.renderOrder = 999;
					previewGroup.add(sphere);

					const existingLines = previewGroup.children.filter(
						(c) => (c as any).isLine2,
					);
					existingLines.forEach((l) => previewGroup.remove(l));

					if (mPoints.length >= 2) {
						const linePoints = [...mPoints, mPoints[0]];
						const flatPoints = linePoints.flatMap((p) => [p.x, p.y, p.z]);
						const lineGeo = new LineGeometry();
						lineGeo.setPositions(flatPoints);

						const perimeterMat = new LineMaterial({
							color: 0xe24b4a,
							linewidth: 10,
							depthTest: false,
							transparent: true,
						});
						perimeterMat.resolution.set(
							renderer.domElement.clientWidth,
							renderer.domElement.clientHeight,
						);

						const perimeterLine = new Line2(lineGeo, perimeterMat);
						perimeterLine.renderOrder = 999;
						previewGroup.add(perimeterLine);
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

				if (camera.position.y < floorLimitY) {
					camera.position.y = floorLimitY;
				}
			}

			renderer.render(scene, camera);
			labelRenderer.render(scene, camera);
		}
		animate();

		const ro = new ResizeObserver(() => {
			if (!mountRef.current) return;
			camera.aspect =
				mountRef.current.clientWidth / mountRef.current.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(
				mountRef.current.clientWidth,
				mountRef.current.clientHeight,
			);
			labelRenderer.setSize(
				mountRef.current.clientWidth,
				mountRef.current.clientHeight,
			);

			scene.traverse((child: any) => {
				if (child.isLine2 && child.material) {
					child.material.resolution.set(
						mountRef.current.clientWidth,
						mountRef.current.clientHeight,
					);
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
				setTool("navigate");
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [tool]);

	const confirmAnnotation = useCallback(async () => {
		if (!pending || !annTitle.trim()) return;
		const p = pending.position;
		const isMaintenance = annSeverity === "maintenance";

		// Aggiunti i parametri "piatti" x, y, z per robustezza del backend
		const payload = {
			model_id: modelId,
			site_id: modelId,
			position: { x: p.x, y: p.y, z: p.z },
			x: p.x,
			y: p.y,
			z: p.z,
			title: annTitle.trim(),
			description: annDescription.trim() || null,
			severity: annSeverity,
			category: annCategory,
			maintenance_due_date: isMaintenance
				? annMaintenanceDueDate || null
				: null,
			maintenance_done_date: isMaintenance
				? annMaintenanceDoneDate || null
				: null,
		};

		try {
			const res = await fetch(`${API_BASE}/api/pois`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (res.ok) {
				const savedPoi: Annotation = await res.json();
				addAnnotationToScene(savedPoi);
				setAnnotations((prev) => [...prev, savedPoi]);
			}
		} catch (err) {
			console.error("Errore salvataggio POI:", err);
		}
		cancelAnnotation();
	}, [
		pending,
		annTitle,
		annDescription,
		annSeverity,
		annCategory,
		annMaintenanceDueDate,
		annMaintenanceDoneDate,
		modelId,
		addAnnotationToScene,
	]);

	const cancelAnnotation = useCallback(() => {
		setPending(null);
		setAnnTitle("");
		setAnnDescription("");
		setAnnSeverity("info");
		setAnnCategory("generic");
		setAnnMaintenanceStatus("open");
		setAnnMaintenanceDueDate("");
		setAnnMaintenanceDoneDate("");
		setTool("navigate");
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
			console.error("Errore eliminazione:", err);
		}
	}

	function focusAnnotation(ann: Annotation) {
		const ctl = controlsRef.current;
		if (!ctl) return;
		const coords = getPoiCoordinates(ann);
		ctl.target.set(coords.x, coords.y, coords.z);
		ctl.update();
	}

	const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
		<button
			onClick={() => setTool(t)}
			title={label}
			className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
				tool === t
					? "bg-[#378ADD] text-white"
					: "text-gray-600 hover:bg-gray-100"
			}`}
		>
			<span className='text-[16px] leading-none'>{icon}</span>
			{label}
		</button>
	);

	return (
		<div className='fixed inset-0 bg-[#0d0f12] select-none overflow-hidden w-screen h-screen'>
			<div ref={mountRef} className='absolute inset-0 w-full h-full' />

			{/* TOP BAR */}
			<div className='absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none'>
				<div className='flex items-center gap-2.5 bg-white/95 backdrop-blur rounded-xl px-4 py-2.5 shadow-lg border border-black/5 pointer-events-auto'>
					<span className='text-[16px]'>🛰️</span>
					<span className='text-[13px] font-semibold text-gray-900'>
						Smart O&M
					</span>
					<span className='text-gray-300'>·</span>
					<span className='text-[12px] text-gray-500'>Splat 3D (Gaussian)</span>
				</div>
				<div className='flex items-center gap-2 pointer-events-auto'>
					<button
						onClick={toggleAltitudeLock}
						title='Blocca la quota: navighi mantenendo la stessa altezza'
						className={`backdrop-blur rounded-xl px-3.5 py-2.5 text-[12px] font-medium shadow-lg border border-black/5 transition-colors ${
							altitudeLock
								? "bg-[#378ADD] text-white hover:bg-[#2f79c4]"
								: "bg-white/95 text-gray-700 hover:bg-white"
						}`}
					>
						{altitudeLock ? "🔒 Quota bloccata" : "🔓 Blocca quota"}
					</button>
					<div className='flex items-center gap-2 bg-white/95 backdrop-blur rounded-xl px-3 py-2.5 shadow-lg border border-black/5'>
						<span className='text-[11px] font-medium text-gray-600'>
							🏃 Velocità
						</span>
						<input
							type='range'
							min={0.1}
							max={2}
							step={0.1}
							value={navSpeed}
							onChange={(e) => setNavSpeed(parseFloat(e.target.value))}
							className='w-24 accent-[#378ADD] cursor-pointer'
						/>
						<span className='text-[11px] font-semibold text-gray-700 tabular-nums w-8 text-right'>
							{navSpeed.toFixed(1)}×
						</span>
					</div>
					<button
						onClick={() => controlsRef.current?.reset()}
						className='bg-white/95 backdrop-blur rounded-xl px-3.5 py-2.5 text-[12px] font-medium text-gray-700 shadow-lg border border-black/5 hover:bg-white'
					>
						⟲ Reset vista
					</button>
					<button
						onClick={() => {
							setSelectedPoi(null);
							setPanelOpen((v) => !v);
						}}
						className='bg-white/95 backdrop-blur rounded-xl px-3.5 py-2.5 text-[12px] font-medium text-gray-700 shadow-lg border border-black/5 hover:bg-white'
					>
						📍 Annotazioni ({annotations.length})
					</button>
				</div>
			</div>

			{/* TOOLBAR */}
			<div className='absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-white/95 backdrop-blur rounded-2xl p-1.5 shadow-lg border border-black/5 pointer-events-auto z-10'>
				{toolBtn("navigate", <HandRaisedIcon className='h-4 w-4' />, "Naviga")}
				{toolBtn("pin", <MapPinIcon className='h-4 w-4' />, "Pin")}
				{toolBtn(
					"measure",
					<span className='font-bold text-xs'>📐</span>,
					"Misura",
				)}{" "}
				{toolBtn("area", <StopIcon className='h-4 w-4 text-red-500' />, "Area")}
				{toolBtn("arc", <ArrowPathIcon className='h-4 w-4' />, "Arco")}
			</div>

			{/* STORICO RILIEVI */}
			<div className='absolute left-24 top-1/2 -translate-y-1/2 bg-white/95 backdrop-blur rounded-2xl p-4 shadow-xl border border-black/5 max-h-[400px] w-64 flex flex-col gap-3 pointer-events-auto z-10'>
				<div className='flex items-center justify-between border-b border-gray-100 pb-2'>
					<span className='text-[12px] font-bold text-gray-900'>
						Storico RILIEVI
					</span>
					<span className='bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-md font-bold'>
						{savedGeometries.length}
					</span>
				</div>

				<div className='flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1 max-h-[260px] text-[11px]'>
					{savedGeometries.length === 0 ? (
						<div className='text-gray-400 text-center py-6 italic'>
							Nessun rilievo salvato
						</div>
					) : (
						savedGeometries.map((g) => (
							<div
								key={g.id}
								className='group bg-gray-50 p-2 rounded-lg border border-gray-100 flex flex-col gap-0.5 relative'
							>
								<div className='flex items-center justify-between font-semibold text-gray-800 pr-5'>
									<span className='truncate max-w-[110px]'>{g.name}</span>
									<span
										className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider text-white font-bold ${
											g.type === "Misura"
												? "bg-blue-500"
												: g.type === "Arco"
													? "bg-amber-500"
													: "bg-red-500"
										}`}
									>
										{g.type}
									</span>
								</div>
								<div className='text-gray-500 text-[10px] truncate'>
									{g.value}
								</div>

								<button
									onClick={() => removeGeometry(g.id, g.meshGroupUuid)}
									title='Elimina Rilievo'
									className='absolute top-2 right-2 text-gray-300 hover:text-red-500 font-bold text-[12px] opacity-0 group-hover:opacity-100 transition-opacity'
								>
									✕
								</button>
							</div>
						))
					)}
				</div>

				<button
					onClick={exportToCSV}
					disabled={savedGeometries.length === 0}
					className='w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-[12px] py-2 px-3 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5'
				>
					<DocumentArrowDownIcon className='h-6 w-6' /> Esporta CSV
				</button>
			</div>

			{/* OVERLAY IN BASSO */}
			<div className='absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3.5 pointer-events-none z-10'>
				{tool === "measure" && measureDistance !== null && (
					<div className='bg-blue-600 text-white px-5 py-2.5 rounded-full font-semibold shadow-2xl text-sm flex flex-wrap items-center gap-4 justify-center'>
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
						<div className='bg-red-600 text-white px-5 py-2.5 rounded-full font-semibold shadow-2xl text-sm flex items-center gap-2 justify-center'>
							<span>Superficie provvisoria:</span>
							<span className='bg-white/20 px-2.5 py-0.5 rounded-md font-bold'>
								{calculatedArea.toFixed(2)} m²
							</span>
						</div>

						{interactionPointsRef.current.length >= 3 && (
							<button
								onClick={triggerAreaConfirmation}
								className='bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px] px-6 py-2.5 rounded-xl shadow-2xl border border-black/10 transition-colors flex items-center gap-1.5'
							>
								Conferma Area 🟢
							</button>
						)}
					</div>
				)}

				{tool === "arc" && calculatedArc !== null && (
					<div className='bg-amber-500 text-white px-5 py-2.5 rounded-full font-semibold shadow-2xl text-sm flex flex-wrap items-center gap-4 justify-center'>
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

			{/* LOADING SPINNER */}
			{loading && (
				<div className='absolute inset-0 flex flex-col items-center justify-center bg-[#0d0f12] z-50 pointer-events-auto'>
					<div className='w-12 h-12 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin mb-4' />
					<span className='text-white/80 text-[13px] font-medium tracking-wide'>
						Elaborazione Gaussian Splats in corso…
					</span>
				</div>
			)}

			{/* MODALE SALVATAGGIO NOME GEOMETRIA */}
			{pendingGeom && (
				<div className='absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-auto'>
					<div
						className='w-80 bg-white rounded-2xl shadow-2xl border border-black/5 p-5'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='text-[14px] font-semibold text-gray-900 mb-1'>
							Salva Geometria ({pendingGeom.type})
						</div>
						<div className='text-[11px] text-gray-400 mb-4'>
							Inserisci un identificativo per l'esportazione CSV
						</div>

						<label className='block text-[11px] font-medium text-gray-500 mb-1.5'>
							Nome Rilievo *
						</label>
						<input
							autoFocus
							type='text'
							value={geomName}
							onChange={(e) => setGeomName(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && confirmGeometry()}
							className='w-full mb-3 px-3.5 py-2.5 text-[13px] bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#378ADD] focus:bg-white'
						/>

						<div className='text-[11px] bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-gray-600 mb-4 break-words'>
							<span className='font-semibold block text-gray-700 mb-0.5'>
								Valore registrato:
							</span>
							{pendingGeom.value}
						</div>

						<div className='flex gap-2'>
							<button
								onClick={discardGeometry}
								className='flex-1 px-3 py-2.5 text-[12px] font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50'
							>
								Scarta
							</button>
							<button
								onClick={confirmGeometry}
								className='flex-1 px-3 py-2.5 text-[12px] font-medium rounded-xl text-white font-semibold transition-colors bg-emerald-600 hover:bg-emerald-700'
							>
								Conferma e Salva
							</button>
						</div>
					</div>
				</div>
			)}

			{/* MODALE CREAZIONE NUOVO PIN */}
			{pending && (
				<div className='absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-auto'>
					<div
						className='w-80 bg-white rounded-2xl shadow-2xl border border-black/5 p-5 max-h-[90vh] overflow-y-auto'
						onClick={(e) => e.stopPropagation()}
					>
						<div className='text-[14px] font-semibold text-gray-900 mb-1'>
							Nuovo punto di interesse
						</div>
						<div className='text-[11px] text-gray-400 mb-4'>
							Salva un marker su Smart O&M
						</div>

						<label className='block text-[11px] font-medium text-gray-500 mb-1.5'>
							Titolo *
						</label>
						<input
							autoFocus
							type='text'
							placeholder='es. Estintore Co2, Quadro, Crepa…'
							value={annTitle}
							onChange={(e) => setAnnTitle(e.target.value)}
							className='w-full mb-3 px-3.5 py-2.5 text-[13px] bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#378ADD] focus:bg-white'
						/>

						<label className='block text-[11px] font-medium text-gray-500 mb-1.5'>
							Descrizione
						</label>
						<textarea
							placeholder='Dettagli aggiuntivi opzionali…'
							value={annDescription}
							onChange={(e) => setAnnDescription(e.target.value)}
							rows={2}
							className='w-full mb-3 px-3.5 py-2.5 text-[12px] bg-gray-50 border border-gray-200 rounded-xl outline-none resize-none focus:border-[#378ADD] focus:bg-white'
						/>

						<label className='block text-[11px] font-medium text-gray-500 mb-2'>
							Severità
						</label>
						<div className='grid grid-cols-2 gap-2 mb-5'>
							{SEVERITIES.map((s) => (
								<button
									key={s.type}
									type='button'
									onClick={() => setAnnSeverity(s.type)}
									className={`py-2 rounded-xl text-[11px] font-medium border transition-all ${
										annSeverity === s.type
											? "bg-gray-900 text-white border-gray-900 shadow-sm"
											: "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
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

						<label className='block text-[11px] font-medium text-gray-500 mb-2'>
							Categoria
						</label>
						<div className='grid grid-cols-2 gap-2 mb-5'>
							{CATEGORIES.map((c) => (
								<button
									key={c.type}
									type='button'
									onClick={() => setAnnCategory(c.type)}
									className={`py-2 px-2 rounded-xl text-[11px] font-medium border transition-all flex items-center gap-1.5 ${
										annCategory === c.type
											? "bg-gray-900 text-white border-gray-900 shadow-sm"
											: "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
									}`}
								>
									<span>{c.icon}</span>
									<span className='truncate'>{c.name}</span>
								</button>
							))}
						</div>

						{annSeverity === "maintenance" && (
							<div className='mb-5 p-3 rounded-xl bg-purple-50 border border-purple-100 flex flex-col gap-3'>
								<div className='text-[11px] font-semibold text-purple-700'>
									Piano di Manutenzione
								</div>

								<div>
									<label className='block text-[11px] font-medium text-gray-500 mb-1.5'>
										Periodicità *
									</label>
									<div className='grid grid-cols-2 gap-1.5'>
										{MAINTENANCE_PERIODICITIES.map((per) => (
											<button
												key={per.value}
												type='button'
												onClick={() => {
													setAnnMaintenancePeriodicity(per.value);
													// Ricalcolo la scadenza da ultima manutenzione + periodicità
													setAnnMaintenanceDueDate(
														addMonthsToDate(annMaintenanceLastDone, per.months),
													);
												}}
												className={`py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
													annMaintenancePeriodicity === per.value
														? "bg-purple-600 text-white border-purple-600"
														: "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
												}`}
											>
												{per.name}
											</button>
										))}
									</div>
								</div>

								<div>
									<label className='block text-[11px] font-medium text-gray-500 mb-1.5'>
										Ultima manutenzione effettuata
									</label>
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
										className='w-full px-3 py-2 text-[12px] bg-white border border-gray-200 rounded-lg outline-none focus:border-purple-400'
									/>
								</div>

								<div>
									<label className='block text-[11px] font-medium text-gray-500 mb-1.5'>
										Scadenza prevista
									</label>
									<input
										type='date'
										value={annMaintenanceDueDate}
										onChange={(e) => setAnnMaintenanceDueDate(e.target.value)}
										className='w-full px-3 py-2 text-[12px] bg-white border border-gray-200 rounded-lg outline-none focus:border-purple-400'
									/>
									<p className='text-[10px] text-gray-400 mt-1'>
										Calcolata da ultima manutenzione + periodicità.
										Modificabile.
									</p>
								</div>
							</div>
						)}

						<div className='flex gap-2'>
							<button
								onClick={cancelAnnotation}
								className='flex-1 px-3 py-2.5 text-[12px] font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50'
							>
								Annulla
							</button>
							<button
								onClick={confirmAnnotation}
								disabled={!annTitle.trim()}
								className='flex-1 px-3 py-2.5 text-[12px] font-medium rounded-xl text-white disabled:opacity-40 transition-opacity'
								style={{ background: SEVERITY_COLORS[annSeverity] }}
							>
								Salva Pin
							</button>
						</div>
					</div>
				</div>
			)}

			{/* PANNELLO LATERALE ELENCO GENERALE PIN */}
			<div
				className={`absolute top-20 right-4 bottom-4 w-72 transition-transform duration-300 z-10 pointer-events-auto ${panelOpen && !selectedPoi ? "translate-x-0" : "translate-x-[120%]"}`}
			>
				<div className='h-full bg-white/95 backdrop-blur rounded-2xl shadow-xl border border-black/5 flex flex-col overflow-hidden'>
					<div className='flex items-center justify-between px-5 py-4 border-b border-gray-100'>
						<div>
							<div className='text-[14px] font-semibold text-gray-900'>
								Punti d'Interesse
							</div>
							<div className='text-[11px] text-gray-400'>
								{annotations.length} annotati
							</div>
						</div>
						<button
							onClick={() => setPanelOpen(false)}
							className='text-gray-300 hover:text-gray-500 text-[18px]'
						>
							✕
						</button>
					</div>

					{/* FILTRI PER CATEGORIA */}
					<div className='px-3 py-2.5 border-b border-gray-100'>
						<div className='flex items-center justify-between mb-2'>
							<span className='text-[10px] font-bold text-gray-400 uppercase tracking-wider'>
								Filtra per categoria
							</span>
							<button
								onClick={() =>
									setActiveCategories((prev) =>
										prev.size === CATEGORIES.length
											? new Set()
											: new Set(CATEGORIES.map((c) => c.type)),
									)
								}
								className='text-[10px] font-semibold text-[#378ADD] hover:underline'
							>
								{activeCategories.size === CATEGORIES.length
									? "Nascondi tutti"
									: "Mostra tutti"}
							</button>
						</div>
						<div className='flex flex-wrap gap-1.5'>
							{CATEGORIES.map((c) => {
								const active = activeCategories.has(c.type);
								const color = CATEGORY_COLORS[c.type];
								const count = annotations.filter(
									(a) => ((a.category as Category) || "generic") === c.type,
								).length;
								return (
									<button
										key={c.type}
										onClick={() => toggleCategory(c.type)}
										title={
											active
												? `Nascondi ${c.name}`
												: `Mostra ${c.name}`
										}
										style={
											active
												? { backgroundColor: color, borderColor: color }
												: { borderColor: `${color}55` }
										}
										className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
											active
												? "text-white"
												: "bg-white text-gray-500 hover:bg-gray-50"
										}`}
									>
										<span
											className='flex'
											style={active ? undefined : { color }}
										>
											{c.icon}
										</span>
										<span>{c.name}</span>
										<span
											className={`ml-0.5 tabular-nums ${
												active ? "text-white/80" : "text-gray-400"
											}`}
										>
											{count}
										</span>
									</button>
								);
							})}
						</div>
					</div>

					<div className='flex-1 overflow-y-auto px-3 py-2'>
						{annotations.filter((ann) =>
							activeCategories.has((ann.category as Category) || "generic"),
						).length === 0 && (
							<div className='text-center py-8 text-[11px] text-gray-400 italic'>
								{annotations.length === 0
									? "Nessun punto d'interesse salvato."
									: "Nessun POI per le categorie selezionate."}
							</div>
						)}
						{annotations
							.filter((ann) =>
								activeCategories.has((ann.category as Category) || "generic"),
							)
							.map((ann) => (
							<div
								key={ann.id}
								className='group flex items-start gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-gray-50'
								onClick={() => {
									focusAnnotation(ann);
									handlePoiSelect(ann);
								}}
							>
								<span
									className='mt-1.5 shrink-0 w-2 h-2 rounded-full'
									style={{ background: SEVERITY_COLORS[ann.severity] }}
								/>
								<div className='min-w-0 flex-1'>
									<div className='text-[13px] font-medium text-gray-900 truncate flex items-center gap-1.5'>
										{ann.title}
										{ann.category && (
											<span
												className='inline-flex items-center gap-1 text-[9px] font-medium shrink-0'
												style={{ color: getCategoryColor(ann.category) }}
											>
												<span
													className='w-2.5 h-2.5 rounded-sm shrink-0'
													style={{
														backgroundColor: getCategoryColor(ann.category),
													}}
												/>
												{CATEGORIES.find((c) => c.type === ann.category)?.name}
											</span>
										)}
									</div>
									{ann.description && (
										<div className='text-[10px] text-gray-400 truncate'>
											{ann.description}
										</div>
									)}
								</div>
								<button
									onClick={(e) => {
										e.stopPropagation();
										removeAnnotation(ann.id);
									}}
									className='text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 text-[13px] transition-opacity'
								>
									✕
								</button>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* SCHEDA DEFINITIVA: DETTAGLI AVANZATI DEL PIN E TICKET MULTIMEDIALI */}
			{selectedPoi && (
				<div className='absolute top-20 right-4 bottom-4 w-[340px] bg-[#141619]/95 backdrop-blur-md text-zinc-100 border border-zinc-800 rounded-3xl p-5 shadow-2xl flex flex-col gap-4 pointer-events-auto z-20 animate-in fade-in slide-in-from-right-5 duration-200'>
					{/* Header Scheda */}
					<div className='flex justify-between items-start border-b border-zinc-800 pb-3 shrink-0'>
						<div className='min-w-0 flex-1'>
							<span
								style={{
									backgroundColor: SEVERITY_COLORS[selectedPoi.severity],
								}}
								className='text-[9px] font-bold px-2 py-0.5 rounded text-white uppercase tracking-wider'
							>
								{selectedPoi.severity}
							</span>
							<h3 className='text-base font-semibold truncate mt-1.5 text-white pr-2 flex items-center gap-2'>
								{selectedPoi.title}
								{!isEditingPoi && (
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
								className='bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-2xl space-y-3'
							>
								<span className='text-[10px] font-bold text-blue-400 uppercase tracking-wider block'>
									Modifica Marcatore
								</span>
								<div>
									<label className='text-[10px] text-zinc-400 block mb-1'>
										Titolo *
									</label>
									<input
										required
										type='text'
										value={editPoiForm.title}
										onChange={(e) =>
											setEditPoiForm({ ...editPoiForm, title: e.target.value })
										}
										className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-blue-500'
									/>
								</div>
								<div>
									<label className='text-[10px] text-zinc-400 block mb-1'>
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
										className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-blue-500 resize-none'
									/>
								</div>
								<div>
									<label className='text-[10px] text-zinc-400 block mb-1'>
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
										className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none'
									>
										{SEVERITIES.map((s) => (
											<option key={s.type} value={s.type}>
												{s.name}
											</option>
										))}
									</select>
								</div>
								<div className='flex gap-2 pt-1'>
									<button
										type='button'
										onClick={() => setIsEditingPoi(false)}
										className='flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium'
									>
										Annulla
									</button>
									<button
										type='submit'
										className='flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium'
									>
										Salva
									</button>
								</div>
							</form>
						) : (
							selectedPoi.description && (
								<div className='bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/50'>
									<span className='text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1'>
										Descrizione Marcatore
									</span>
									<p className='text-xs text-zinc-300 leading-relaxed font-medium'>
										{selectedPoi.description}
									</p>
								</div>
							)
						)}

						<div className='space-y-2.5 border-t border-zinc-900 pt-4'>
							<div className='flex justify-between items-center text-zinc-400 font-bold uppercase tracking-widest pl-1'>
								<span className='flex items-center gap-1.5'>
									<CameraIcon className='h-4 w-4' /> Galleria Foto
								</span>
								<label className='cursor-pointer text-[10px] text-blue-400 hover:underline flex items-center gap-1 normal-case font-semibold'>
									<input
										type='file'
										accept='image/*'
										className='hidden'
										onChange={handlePhotoUpload}
										disabled={isUploadingPhoto}
									/>
									<PlusIcon className='h-3 w-3' /> Aggiungi
								</label>
							</div>

							{isLoadingPhotos ? (
								<div className='text-center py-4 text-zinc-600'>
									Caricamento archivio...
								</div>
							) : isUploadingPhoto ? (
								<div className='text-center py-4 text-blue-400 animate-pulse font-medium'>
									Fase di caricamento foto...
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
												src={
													img.file_path
														? `${API_BASE}/api/photos/stream?path=${encodeURIComponent(img.file_path)}`
														: img.url
												}
												alt={img.name || "Foto"}
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

						<div className='space-y-2.5 border-t border-zinc-900 pt-4'>
							<div className='flex justify-between items-center text-zinc-400 font-bold uppercase tracking-widest pl-1'>
								<span className='flex items-center gap-1.5'>
									<ClipboardDocumentCheckIcon className='h-4 w-4' /> Ticket
									Correlati
								</span>
								{!isCreatingTicketInline && (
									<button
										onClick={() => setIsCreatingTicketInline(true)}
										className='text-[10px] text-amber-500 hover:underline flex items-center gap-1 normal-case font-semibold'
									>
										<PlusIcon className='h-3 w-3' /> Apri Ticket
									</button>
								)}
							</div>

							{isCreatingTicketInline && (
								<form
									onSubmit={handleCreateInlineTicket}
									className='bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150'
								>
									<span className='text-[10px] font-bold text-amber-500 uppercase tracking-wider block'>
										Apri Nuova Segnalazione
									</span>

									<div>
										<label className='text-[10px] text-zinc-400 block mb-1'>
											Titolo Ticket *
										</label>
										<input
											required
											type='text'
											placeholder='es. Sostituzione cablaggio...'
											value={inlineTicketForm.title}
											onChange={(e) =>
												setInlineTicketForm({
													...inlineTicketForm,
													title: e.target.value,
												})
											}
											className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none text-xs focus:border-amber-500'
										/>
									</div>

									<div>
										<label className='text-[10px] text-zinc-400 block mb-1'>
											Cosa bisogna fare? *
										</label>
										<textarea
											placeholder='Operazioni da svolgere...'
											value={inlineTicketForm.description}
											onChange={(e) =>
												setInlineTicketForm({
													...inlineTicketForm,
													description: e.target.value,
												})
											}
											rows={2}
											className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none text-xs focus:border-amber-500 resize-none'
										/>
									</div>

									<div>
										<label className='text-[10px] text-zinc-400 block mb-1'>
											Livello Priorità
										</label>
										<div className='grid grid-cols-4 gap-2'>
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
														className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[10px] font-bold tracking-wide border transition-colors ${
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
										<label className='text-[10px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
											Contatto di Riferimento (Opzionale)
										</label>
										<select
											value={inlineTicketForm.contact_id}
											onChange={(e) =>
												setInlineTicketForm({
													...inlineTicketForm,
													contact_id: e.target.value,
												})
											}
											className='w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white outline-none text-xs focus:border-blue-500'
										>
											<option value=''>-- Nessun contatto --</option>
											{contacts.map((c) => (
												<option key={c.id} value={c.id}>
													{c.company} ({c.service_type})
												</option>
											))}
										</select>
									</div>

									<div className='flex gap-2 pt-1.5 mt-1 border-t border-zinc-800/60'>
										<button
											type='button'
											onClick={() => setIsCreatingTicketInline(false)}
											className='flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium'
										>
											Annulla
										</button>
										<button
											type='submit'
											className='flex-1 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium'
										>
											Crea Ticket
										</button>
									</div>
								</form>
							)}

							{isLoadingTickets ? (
								<div className='flex flex-col items-center justify-center py-6 gap-2'>
									<div className='w-4 h-4 border-2 border-zinc-700 border-t-amber-500 rounded-full animate-spin' />
									<span className='text-[9px] text-zinc-500 uppercase tracking-wider font-bold'>
										Caricamento flussi...
									</span>
								</div>
							) : poiTickets.length === 0 ? (
								<div className='text-center py-6 bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-800 text-zinc-500 font-medium px-4'>
									Nessun intervento registrato per questa posizione.
								</div>
							) : (
								<div className='space-y-2'>
									{poiTickets.map((ticket: any) => (
										<div
											key={ticket.id}
											onClick={() => handleSelectTicket(ticket)}
											className='bg-zinc-900/80 border border-zinc-800/60 p-3.5 rounded-2xl flex flex-col gap-2 hover:border-zinc-700/60 hover:bg-zinc-800 transition-colors cursor-pointer'>
											<div className='flex justify-between items-start gap-2'>
												<h4 className='font-bold text-white leading-tight truncate flex-1'>
													{ticket.title}
												</h4>
												<span
													className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest shrink-0 ${
														ticket.status === "open"
															? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
															: ticket.status === "in_progress"
																? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
																: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
													}`}
												>
													{ticket.status}
												</span>
											</div>
											{ticket.description && (
												<p className='text-[10px] text-zinc-400 line-clamp-2 leading-relaxed'>
													{ticket.description}
												</p>
											)}
											<div className='flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 border-t border-zinc-800/60 pt-2 text-[9px] text-zinc-500 font-bold uppercase tracking-wider'>
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
												{ticket.assigned_to && (
													<span className='w-full text-blue-400 truncate mt-1 break-words block'>
														👤 {ticket.assigned_to}
													</span>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Footer Scheda */}
					<div className='shrink-0 border-t border-zinc-800 pt-3 flex gap-2'>
						<button
							onClick={() => removeAnnotation(selectedPoi.id)}
							className='flex-1 py-2 rounded-xl bg-red-950/30 hover:bg-red-950/60 border border-red-900/40 text-red-400 font-semibold transition-colors shadow-sm'
						>
							Elimina POI
						</button>
						<button
							onClick={() => setSelectedPoi(null)}
							className='px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold transition-colors'
						>
							Chiudi
						</button>
					</div>
				</div>
			)}

			{selectedTicket && (
				<div
					className='absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto'
					onClick={() => setSelectedTicket(null)}
				>
					<div
						className='w-[360px] max-h-[85vh] overflow-y-auto bg-[#141619] border border-zinc-800 rounded-3xl p-5 text-zinc-100 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150'
						onClick={(e) => e.stopPropagation()}
					>
						{/* Header */}
						<div className='flex justify-between items-start border-b border-zinc-800 pb-3'>
							<div className='min-w-0 flex-1'>
								<span className='text-[10px] font-bold text-amber-500 uppercase tracking-wider block mb-1'>
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
									<label className='text-[10px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
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
									<label className='text-[10px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
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
									<label className='text-[10px] text-zinc-400 block mb-1.5 uppercase tracking-wider font-bold'>
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
													className={`py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide border transition-colors ${
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
									<label className='text-[10px] text-zinc-400 block mb-1.5 uppercase tracking-wider font-bold'>
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
													className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[10px] font-bold tracking-wide border transition-colors ${
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
									<label className='text-[10px] text-zinc-400 block mb-1 uppercase tracking-wider font-bold'>
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
												{c.company} ({c.service_type})
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
										className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-widest ${
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
										className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-widest border ${
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
									<span className='text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1'>
										Cosa bisogna fare
									</span>
									<p className='text-xs text-zinc-300 leading-relaxed font-medium whitespace-pre-wrap break-words'>
										{selectedTicket.description ||
											"Nessuna descrizione fornita."}
									</p>
								</div>

								{selectedTicket.contact_id && (
									<div className='bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/50 mt-3'>
										<span className='text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1'>
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
									<div className='text-[10px] text-zinc-500 font-medium'>
										Creato il{" "}
										<span className='text-zinc-300'>
											{new Date(selectedTicket.created_at).toLocaleString()}
										</span>
									</div>
								)}

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
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
