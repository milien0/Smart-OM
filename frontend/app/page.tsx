"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { API_BASE } from "@/utils/api";
import Logo from "@/images/logo.svg";
import Image from "next/image";

import {
	BuildingOffice2Icon,
	PlusIcon,
	MagnifyingGlassIcon,
	ChevronRightIcon,
	XMarkIcon,
	MapPinIcon,
} from "@heroicons/react/24/outline";

type SiteType = {
	id: string;
	name: string;
	address: string | null;
	notes: string | null;
	createdAt: string;
};

export default function HomePage() {
	const router = useRouter();

	const [sites, setSites] = useState<SiteType[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [search, setSearch] = useState("");
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	// Form nuova sede
	const [form, setForm] = useState({ name: "", address: "", notes: "" });

	const fetchSites = useCallback(async () => {
		try {
			setIsLoading(true);
			const res = await axios.get(`${API_BASE}/api/sites`);
			// L'endpoint risponde con un wrapper { status, data }.
			setSites(res.data?.data || res.data || []);
		} catch (err) {
			console.error("Errore nel recupero delle sedi:", err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchSites();
	}, [fetchSites]);

	const handleCreateSite = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.name.trim()) return;
		setIsSaving(true);
		try {
			const res = await axios.post(`${API_BASE}/api/sites`, {
				name: form.name.trim(),
				address: form.address.trim() || null,
				notes: form.notes.trim() || null,
			});
			setIsModalOpen(false);
			setForm({ name: "", address: "", notes: "" });
			// Entriamo direttamente nella dashboard della nuova sede.
			router.push(`/${res.data.id}`);
		} catch (err: any) {
			console.error("Errore nella creazione della sede:", err);
			alert(err.response?.data?.message || "Impossibile creare la sede.");
		} finally {
			setIsSaving(false);
		}
	};

	const filteredSites = sites.filter(
		(s) =>
			s.name.toLowerCase().includes(search.toLowerCase()) ||
			(s.address || "").toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className='flex-1 min-h-screen bg-gradient-to-b from-[#f4f7fc] via-[#f0f4f9] to-[#e9eff8] flex flex-col items-center px-4 py-10'>
			<div className='w-full max-w-3xl flex flex-col flex-1'>
				{/* HEADER */}
				<div className='flex flex-col items-center gap-6 mb-10'>
					<Image src={Logo} alt='Logo' className='w-44' priority />
					<div className='text-center'>
						<span className='inline-block text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-3 py-1 mb-2'>
							Admin
						</span>
						<h1 className='text-2xl font-semibold text-[#1f1f1f] tracking-tight'>
							Le tue aziende
						</h1>
						<p className='text-sm text-zinc-500 mt-1'>
							Seleziona un'azienda per vedere i suoi modelli 3D.
						</p>
					</div>
				</div>

				{/* BARRA AZIONI */}
				<div className='flex items-center gap-3 mb-6'>
					<div className='relative flex-1'>
						<MagnifyingGlassIcon className='absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400' />
						<input
							type='text'
							placeholder='Cerca azienda per nome o indirizzo...'
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className='w-full pl-11 pr-4 py-3 bg-white border border-zinc-200 rounded-full text-sm font-medium focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm'
						/>
					</div>
					<button
						onClick={() => setIsModalOpen(true)}
						className='px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-full text-sm font-semibold transition-all shadow-lg shadow-blue-200/80 ring-1 ring-white/20 flex items-center gap-2 shrink-0 hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f4f9]'
					>
						<PlusIcon className='h-4 w-4' /> Nuova azienda
					</button>
				</div>

				{/* LISTA SEDI */}
				{isLoading ? (
					<div className='flex-1 flex items-center justify-center py-20'>
						<div className='flex flex-col items-center gap-4'>
							<div className='w-10 h-10 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin' />
							<p className='text-xs font-bold text-zinc-400 uppercase tracking-widest'>
								Caricamento sedi...
							</p>
						</div>
					</div>
				) : filteredSites.length === 0 ? (
					<div className='p-16 border-2 border-dashed border-zinc-200 rounded-[2.5rem] text-center text-zinc-400 text-sm flex flex-col items-center gap-3 bg-white/50'>
						<BuildingOffice2Icon className='h-10 w-10 text-zinc-300' />
						{sites.length === 0
							? "Nessuna azienda registrata. Crea la prima azienda per iniziare."
							: "Nessuna azienda corrisponde alla ricerca."}
					</div>
				) : (
					<div className='space-y-3'>
						{filteredSites.map((site) => (
							<button
								key={site.id}
								onClick={() => router.push(`/${site.id}`)}
								className='w-full bg-white border border-zinc-200/60 hover:border-blue-300/70 rounded-[1.75rem] px-6 py-5 flex items-center gap-4 transition-all duration-200 text-left group shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-16px_rgba(16,24,40,0.10)] hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_20px_40px_-20px_rgba(37,99,235,0.25)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500/40'
							>
								<div className='w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors'>
									<BuildingOffice2Icon className='h-6 w-6 text-blue-600' />
								</div>
								<div className='min-w-0 flex-1'>
									<h3 className='text-base font-semibold text-[#1f1f1f] truncate'>
										{site.name}
									</h3>
									{site.address ? (
										<p className='text-xs text-zinc-500 truncate flex items-center gap-1 mt-0.5'>
											<MapPinIcon className='h-3 w-3 shrink-0' />
											{site.address}
										</p>
									) : (
										<p className='text-xs text-zinc-400 italic mt-0.5'>
											Nessun indirizzo
										</p>
									)}
								</div>
								<ChevronRightIcon className='h-5 w-5 text-zinc-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0' />
							</button>
						))}
					</div>
				)}
			</div>

			{/* MODALE NUOVA SEDE */}
			{isModalOpen && (
				<div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm'>
					<div className='relative bg-white border border-zinc-100 w-full max-w-md rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150'>
						<div className='p-6 border-b border-zinc-100 flex justify-between items-center bg-[#f8fafd]'>
							<h3 className='text-base font-semibold text-zinc-900'>
								Crea nuova azienda
							</h3>
							<button
								onClick={() => setIsModalOpen(false)}
								className='w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-zinc-600 shadow-sm transition-colors'
							>
								<XMarkIcon className='h-4 w-4' />
							</button>
						</div>

						<form onSubmit={handleCreateSite} className='p-6 space-y-4'>
							<div>
								<label className='block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1'>
									Nome azienda *
								</label>
								<input
									required
									autoFocus
									type='text'
									placeholder='Es: AutoTorino, Pressiani...'
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									className='w-full px-4 py-2.5 bg-[#f8fafd] border border-zinc-200 rounded-xl text-sm font-medium focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all'
								/>
							</div>
							<div>
								<label className='block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1'>
									Indirizzo
								</label>
								<input
									type='text'
									placeholder='Via, città...'
									value={form.address}
									onChange={(e) =>
										setForm({ ...form, address: e.target.value })
									}
									className='w-full px-4 py-2.5 bg-[#f8fafd] border border-zinc-200 rounded-xl text-sm font-medium focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all'
								/>
							</div>
							<div>
								<label className='block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1'>
									Note
								</label>
								<textarea
									rows={3}
									placeholder='Note interne sulla sede (opzionale)'
									value={form.notes}
									onChange={(e) => setForm({ ...form, notes: e.target.value })}
									className='w-full px-4 py-2.5 bg-[#f8fafd] border border-zinc-200 rounded-xl text-sm font-medium focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all resize-none'
								/>
							</div>

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
									{isSaving ? "Creazione..." : "Crea azienda"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
