"use client";

import { useEffect, useState, useCallback } from "react";
import { API_BASE } from "@/utils/api";
import axios from "axios";
import { useParams, useRouter } from "next/navigation";

// --- IMPORT HEROICONS ---
import {
	ArrowUpTrayIcon,
	CubeIcon,
	CalendarDaysIcon,
	TrashIcon,
	XMarkIcon,
	VideoCameraIcon,
	EyeIcon,
	ArrowLeftIcon,
	Squares2X2Icon,
} from "@heroicons/react/24/outline";

// --- INTERFACCE DATI ---
type Model3DType = {
	id: string;
	site_id: string;
	name: string;
	file_path: string;
	format: string | null;
	created_at: string;
	default_camera?: {
		position: { x: number; y: number; z: number };
		target: { x: number; y: number; z: number };
	} | null;
};

export default function ModelsPage() {
	const params = useParams();
	const router = useRouter();
	const siteId = params?.id || params?.siteId;

	// Stati Dati
	const [models, setModels] = useState<Model3DType[]>([]);
	const [siteName, setSiteName] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	// Anteprime 3D catturate dal viewer (localStorage, per browser).
	// Lette dopo il mount per evitare mismatch di idratazione SSR.
	const [thumbs, setThumbs] = useState<Record<string, string>>({});
	useEffect(() => {
		const map: Record<string, string> = {};
		models.forEach((m) => {
			try {
				const t = localStorage.getItem(`smartom_thumb_${m.id}`);
				if (t) map[m.id] = t;
			} catch {}
		});
		setThumbs(map);
	}, [models]);

	// Stati Form
	const [modelName, setModelName] = useState("");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	// File di una cartella SOG selezionata (meta.json + .webp), upload multi-file
	const [folderFiles, setFolderFiles] = useState<File[]>([]);

	// Coordinate di default per la telecamera virtuale
	const [camera, setCamera] = useState({
		posX: 0,
		posY: 5,
		posZ: 10,
		tarX: 0,
		tarY: 0,
		tarZ: 0,
	});

	// --- RECUPERO MODELLI ---
	const fetchModels = useCallback(async () => {
		if (!siteId) return;
		try {
			setIsLoading(true);
			const res = await axios.get(
				`${API_BASE}/api/models?site_id=${siteId}`,
			);
			setModels(res.data || []);
		} catch (err) {
			console.error("Errore nel recupero dei modelli 3D:", err);
		} finally {
			setIsLoading(false);
		}
	}, [siteId]);

	useEffect(() => {
		fetchModels();
	}, [fetchModels]);

	// Nome dell'azienda per l'intestazione.
	useEffect(() => {
		if (!siteId) return;
		axios
			.get(`${API_BASE}/api/sites/${siteId}`)
			.then((res) => setSiteName(res.data?.name || null))
			.catch(() => {});
	}, [siteId]);

	// --- INVIO E CARICAMENTO MODELLO ---
	const handleUploadModel = async (e: React.FormEvent) => {
		e.preventDefault();
		const hasFolder = folderFiles.length > 0;
		if (!modelName.trim() || (!selectedFile && !hasFolder) || !siteId) {
			alert("Inserisci un nome e seleziona un file o una cartella SOG.");
			return;
		}

		setIsSaving(true);
		try {
			const formData = new FormData();
			formData.append("site_id", siteId as string);
			formData.append("name", modelName.trim());
			if (hasFolder) {
				// Upload cartella SOG: tutti i file (meta.json + .webp) sotto "files"
				folderFiles.forEach((f) => formData.append("files", f, f.name));
			} else if (selectedFile) {
				formData.append("file", selectedFile);
			}

			const defaultCamera = {
				position: {
					x: Number(camera.posX),
					y: Number(camera.posY),
					z: Number(camera.posZ),
				},
				target: {
					x: Number(camera.tarX),
					y: Number(camera.tarY),
					z: Number(camera.tarZ),
				},
			};
			formData.append("default_camera", JSON.stringify(defaultCamera));

			const response = await axios.post(
				`${API_BASE}/api/models`,
				formData,
				{
					headers: {
						"Content-Type": "multipart/form-data",
					},
				},
			);

			setModels((prev) => [response.data, ...prev]);

			setIsModalOpen(false);
			setModelName("");
			setSelectedFile(null);
			setFolderFiles([]);
			setCamera({ posX: 0, posY: 5, posZ: 10, tarX: 0, tarY: 0, tarZ: 0 });
		} catch (err: any) {
			console.error("Errore durante l'upload del modello:", err);
			alert(
				err.response?.data?.message || "Impossibile caricare il modello 3D.",
			);
		} finally {
			setIsSaving(false);
		}
	};

	// --- CANCELLAZIONE MODELLO ---
	const handleDeleteModel = async (id: string) => {
		if (
			!confirm(
				"Sei sicuro di voler eliminare definitivamente questo modello 3D e il suo file?",
			)
		)
			return;
		try {
			await axios.delete(`${API_BASE}/api/models/${id}`);
			setModels((prev) => prev.filter((m) => m.id !== id));
		} catch (err) {
			console.error("Errore durante la cancellazione del modello:", err);
			alert("Impossibile eliminare il modello.");
		}
	};

	if (isLoading) {
		return (
			<div className='flex-1 flex items-center justify-center bg-white h-screen'>
				<div className='flex flex-col items-center gap-4'>
					<div className='w-12 h-12 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin' />
					<p className='text-xs font-bold text-zinc-400 uppercase tracking-widest'>
						Caricamento modelli 3D...
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className='flex-1 p-8 bg-gradient-to-b from-[#f7f9fc] to-[#eef2f8] overflow-y-auto'>
			{/* HEADER */}
			<div className='flex flex-col md:flex-row justify-between items-start gap-4 mb-10'>
				<div className='space-y-2'>
					<a
						href='/'
						className='inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-blue-600 transition-colors'
					>
						<ArrowLeftIcon className='h-3.5 w-3.5' /> Tutte le aziende
					</a>
					<h1 className='text-3xl font-semibold text-[#1f1f1f] tracking-tight'>
						{siteName || "Modelli Digital Twin 3D"}
					</h1>
					<p className='text-sm text-zinc-500'>
						Seleziona un modello 3D per aprire la dashboard della sede.
					</p>
				</div>

				<button
					onClick={() => setIsModalOpen(true)}
					className='px-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-full text-sm font-semibold transition-all shadow-xl shadow-blue-200/80 ring-1 ring-white/20 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]'
				>
					<ArrowUpTrayIcon className='h-4 w-4' /> Carica Modello 3D
				</button>
			</div>

			{/* GRIGLIA MODELLI */}
			{models.length === 0 ? (
				<div className='p-20 border-2 border-dashed border-zinc-100 rounded-[3rem] text-center text-zinc-400 text-sm flex flex-col items-center justify-center gap-3'>
					<CubeIcon className='h-10 w-10 text-zinc-300' />
					Nessun modello 3D caricato per questa sede.
				</div>
			) : (
				<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
					{models.map((model) => (
						<div
							key={model.id}
							onClick={() =>
								router.push(`/${siteId}/dashboard?model=${model.id}`)
							}
							className='bg-white border border-zinc-200/60 hover:border-blue-300/70 rounded-[2rem] p-6 flex flex-col justify-between transition-all duration-200 group cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-16px_rgba(16,24,40,0.10)] hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_24px_48px_-24px_rgba(37,99,235,0.30)] hover:-translate-y-1'
						>
							<div>
								{thumbs[model.id] ? (
									<div className='relative w-full h-40 rounded-2xl mb-4 overflow-hidden border border-zinc-100/80 shadow-sm bg-[#0c0c0e]'>
										{/* Anteprima 3D catturata dal viewer */}
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src={thumbs[model.id]}
											alt={`Anteprima 3D di ${model.name}`}
											className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-105'
										/>
										<div className='absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none' />
										<span className='absolute top-2 right-2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-black/55 backdrop-blur text-white uppercase tracking-wider flex items-center gap-1'>
											<CubeIcon className='h-2.5 w-2.5' /> 3D
										</span>
									</div>
								) : (
									<div className='w-full h-40 rounded-2xl mb-4 flex flex-col items-center justify-center gap-2 border border-zinc-100/80 shadow-sm bg-gradient-to-br from-[#f1f5fb] via-white to-[#eef2f8] group-hover:from-blue-50 group-hover:to-white transition-colors'>
										<CubeIcon className='h-12 w-12 text-zinc-300 group-hover:text-blue-500 transition-colors' />
										<span className='text-[10px] text-zinc-400 font-medium'>
											Apri il modello per generare l'anteprima
										</span>
									</div>
								)}
								<h3 className='text-base font-semibold text-[#1f1f1f] truncate'>
									{model.name}
								</h3>
								<div className='flex items-center gap-3 mt-2'>
									<span className='text-[10px] font-bold uppercase px-2.5 py-1 bg-zinc-200/60 rounded-md text-zinc-600 tracking-wider'>
										{model.format || "unknown"}
									</span>
									<span className='text-[10px] font-medium text-zinc-400 flex items-center gap-1'>
										<CalendarDaysIcon className='h-3 w-3 text-zinc-400' />
										{new Date(model.created_at).toLocaleDateString()}
									</span>
								</div>
							</div>

							<div className='flex gap-2 mt-6 pt-4 border-t border-zinc-200/50'>
								<a
									href={`/${siteId}/dashboard?model=${model.id}`}
									onClick={(e) => e.stopPropagation()}
									className='flex-1 text-center py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center justify-center gap-1.5'
								>
									<Squares2X2Icon className='h-3.5 w-3.5' /> Dashboard
								</a>
								<a
									href={`${model.format === "ply" ? "ply" : "splat"}/${model.id}`}
									target='_blank'
									rel='noreferrer'
									onClick={(e) => e.stopPropagation()}
									className='flex-1 text-center py-2.5 bg-white border border-zinc-200 text-zinc-700 hover:text-blue-600 hover:border-blue-300 rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center justify-center gap-1.5'
								>
									<EyeIcon className='h-3.5 w-3.5' /> Apri 3D
								</a>
								<button
									onClick={(e) => {
										e.stopPropagation();
										handleDeleteModel(model.id);
									}}
									className='px-3 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 hover:border-red-200 rounded-xl text-xs transition-colors'
									title='Elimina Modello'
								>
									<TrashIcon className='h-4 w-4' />
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{/* MODALE DI CARICAMENTO FILE */}
			{isModalOpen && (
				<div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm'>
					<div className='relative bg-white border border-zinc-100 w-full max-w-lg rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150'>
						<div className='p-6 border-b border-zinc-100 flex justify-between items-center bg-[#f8fafd]'>
							<h3 className='text-base font-semibold text-zinc-900'>
								Carica file Modello 3D
							</h3>
							<button
								onClick={() => setIsModalOpen(false)}
								className='w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-zinc-600 shadow-sm transition-colors'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>

						<form
							onSubmit={handleUploadModel}
							className='p-6 space-y-4 max-h-[75vh] overflow-y-auto'
						>
							{/* Nome Modello */}
							<div>
								<label className='block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1'>
									Nome del Modello *
								</label>
								<input
									required
									type='text'
									placeholder='Es: Planimetria Piano Terra, Render Impianto...'
									value={modelName}
									onChange={(e) => setModelName(e.target.value)}
									className='w-full px-4 py-2.5 bg-[#f8fafd] border border-zinc-200 rounded-xl text-sm font-medium focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all'
								/>
							</div>

							{/* Input File singolo (.ply / .splat) */}
							<div>
								<label className='block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1'>
									File 3D (.ply / .splat)
								</label>
								<input
									type='file'
									accept='.ply, .splat, .sog, .zip'
									onChange={(e) => {
										if (e.target.files && e.target.files[0]) {
											setSelectedFile(e.target.files[0]);
											setFolderFiles([]); // esclude la selezione cartella
										}
									}}
									className='w-full px-4 py-2.5 bg-[#f8fafd] border border-zinc-200 border-dashed rounded-xl text-sm font-medium file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer'
								/>
							</div>

							{/* Input Cartella SOG (meta.json + .webp) */}
							<div>
								<label className='block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1'>
									…oppure cartella SOG
								</label>
								<input
									type='file'
									multiple
									{...({ webkitdirectory: "", directory: "" } as any)}
									onChange={(e) => {
										const files = e.target.files
											? Array.from(e.target.files)
											: [];
										setFolderFiles(files);
										if (files.length > 0) setSelectedFile(null); // esclude il file singolo
									}}
									className='w-full px-4 py-2.5 bg-[#f8fafd] border border-zinc-200 border-dashed rounded-xl text-sm font-medium file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer'
								/>
								<p className='mt-1.5 text-[10px] text-zinc-400 leading-snug'>
									Seleziona la cartella <span className='font-semibold'>.sog</span>{" "}
									(contenente <span className='font-semibold'>meta.json</span> +
									file <span className='font-semibold'>.webp</span>): verrà
									convertita automaticamente al caricamento.
									{folderFiles.length > 0 && (
										<span className='block mt-1 font-semibold text-emerald-600'>
											{folderFiles.length} file selezionati dalla cartella.
										</span>
									)}
								</p>
							</div>

							{/* Impostazioni Camera Virtuale */}
							<div className='bg-[#f8fafd] p-4 rounded-2xl border border-zinc-100 space-y-3'>
								<h4 className='text-xs font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-1.5'>
									<VideoCameraIcon className='h-4 w-4 text-zinc-500' />{" "}
									Inquadratura Camera Iniziale (Opzionale)
								</h4>

								<div className='grid grid-cols-3 gap-2'>
									<div className='col-span-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider'>
										Posizione Camera (X, Y, Z)
									</div>
									<input
										type='number'
										step='any'
										placeholder='X'
										value={camera.posX}
										onChange={(e) =>
											setCamera({
												...camera,
												posX: parseFloat(e.target.value) || 0,
											})
										}
										className='px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors'
									/>
									<input
										type='number'
										step='any'
										placeholder='Y'
										value={camera.posY}
										onChange={(e) =>
											setCamera({
												...camera,
												posY: parseFloat(e.target.value) || 0,
											})
										}
										className='px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors'
									/>
									<input
										type='number'
										step='any'
										placeholder='Z'
										value={camera.posZ}
										onChange={(e) =>
											setCamera({
												...camera,
												posZ: parseFloat(e.target.value) || 0,
											})
										}
										className='px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors'
									/>
								</div>

								<div className='grid grid-cols-3 gap-2 pt-2'>
									<div className='col-span-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider'>
										Target / Fuoco Mirino (X, Y, Z)
									</div>
									<input
										type='number'
										step='any'
										placeholder='X'
										value={camera.tarX}
										onChange={(e) =>
											setCamera({
												...camera,
												tarX: parseFloat(e.target.value) || 0,
											})
										}
										className='px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors'
									/>
									<input
										type='number'
										step='any'
										placeholder='Y'
										value={camera.tarY}
										onChange={(e) =>
											setCamera({
												...camera,
												tarY: parseFloat(e.target.value) || 0,
											})
										}
										className='px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors'
									/>
									<input
										type='number'
										step='any'
										placeholder='Z'
										value={camera.tarZ}
										onChange={(e) =>
											setCamera({
												...camera,
												tarZ: parseFloat(e.target.value) || 0,
											})
										}
										className='px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors'
									/>
								</div>
							</div>

							{/* Bottoni Azione */}
							<div className='flex justify-end gap-3 pt-4 border-t border-zinc-100'>
								<button
									type='button'
									onClick={() => setIsModalOpen(false)}
									className='px-5 py-2.5 rounded-full border border-zinc-200 text-zinc-600 font-semibold hover:bg-zinc-50 transition-colors text-xs'
								>
									Annulla
								</button>
								<button
									type='submit'
									disabled={isSaving}
									className='px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full text-xs shadow-md shadow-blue-100 transition-all disabled:opacity-50'
								>
									{isSaving ? "Upload in corso..." : "Salva Modello"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
