"use client";

// Catalogo Servizi Smart O&M — ex pagina /[id]/services, portata dentro
// l'editor 3D come modale glass (stessa estetica di plyViewer).
// Nessuna chiamata API: catalogo statico + prenotazione mockup, come l'originale.

import React, { useState } from "react";
import Image from "next/image";
import {
	WrenchScrewdriverIcon,
	XMarkIcon,
	CheckCircleIcon,
	ChevronLeftIcon,
} from "@heroicons/react/24/outline";
import TermographyImage from "@/images/services/thermography.jpg";
import DroneCleaningImage from "@/images/services/drone_cleaning.jpg";
import Drone3dImage from "@/images/services/drone_3d.jpg";

interface Bullet {
	label: string;
	text: string;
}

interface Service {
	num: string;
	tag: string;
	title: string;
	subtitle: string;
	description: string;
	bullets: Bullet[];
	price: string;
	imgSrc: any;
	imgAlt: string;
}

const SERVICES: Service[] = [
	{
		num: "01",
		tag: "Rilievo & Digital Twin",
		title: "Rilievo 3D e digitalizzazione",
		subtitle: "Dalla nuvola di punti al digital twin navigabile in browser",
		description:
			"Rilievo completo di edifici, impianti e infrastrutture con precisione millimetrica: dalla geometria strutturale all'involucro esterno. Il risultato finale è un modello 3D fotorealistico ad alta definizione, navigabile direttamente in browser senza software aggiuntivi.",
		price: "€ 499",
		bullets: [
			{
				label: "Consegne incluse",
				text: "BIM as-built, nuvola di punti georeferenziata, ortofoto misurabili, restituzione vettoriale CAD.",
			},
			{
				label: "Applicazioni",
				text: "Perizie tecniche, monitoraggio strutturale, base per progettisti, rilievi di infrastrutture civili e reti.",
			},
		],
		imgSrc: Drone3dImage,
		imgAlt: "Rilievo 3D e digitalizzazione",
	},
	{
		num: "02",
		tag: "Diagnostica termica",
		title: "Ispezione termografica",
		subtitle: "Diagnostica radiometrica certificata ISO 9712 e IEC 62446-3",
		description:
			"Individuazione di anomalie termiche su impianti fotovoltaici e diagnostica di coperture ed involucri edilizi. Eseguita da tecnici con certificazione ISO 9712 II Livello, in conformità allo standard internazionale IEC 62446-3.",
		price: "€ 299",
		bullets: [
			{
				label: "Su impianti FV",
				text: "Celle difettose, bypass attivi, cortocircuiti, perdite di rendimento non visibili a occhio nudo.",
			},
			{
				label: "Su edifici",
				text: "Ricerca infiltrazioni, dispersioni termiche, ponti termici su coperture e involucri.",
			},
			{
				label: "Report tecnico certificato",
				text: "Classificato per gravità, pronto per assicurazioni, garanzie, contenziosi e audit.",
			},
		],
		imgSrc: TermographyImage,
		imgAlt: "Ispezione termografica",
	},
	{
		num: "03",
		tag: "Pulizia & Manutenzione",
		title: "Pulizia e manutenzione facciate",
		subtitle: "Drone cleaning senza ponteggi, senza operatori in quota",
		description:
			"Pulizia professionale di facciate vetrate, coperture e impianti fotovoltaici con sistema dedicato a bordo drone. Costi e tempi sensibilmente inferiori rispetto a ponteggi e piattaforme aeree tradizionali, con zero rischio operatori in altezza.",
		price: "€ 899",
		bullets: [
			{
				label: "Recupero rendimento misurabile",
				text: "Rimozione di sporco, depositi e guano per ripristinare la produzione energetica.",
			},
			{
				label: "Nessun operatore in quota",
				text: "Zero rischi per il personale, nessun danno alle superfici, nessun ponteggio da montare.",
			},
			{
				label: "Adatto a",
				text: "Facciate vetrate, coperture, pannelli FV, capannoni industriali e strutture difficili da raggiungere.",
			},
		],
		imgSrc: DroneCleaningImage,
		imgAlt: "Pulizia e manutenzione impianti",
	},
];

interface ServicesModalProps {
	open: boolean;
	onClose: () => void;
}

export default function ServicesModal({ open, onClose }: ServicesModalProps) {
	// Servizio in fase di prenotazione (null = griglia catalogo)
	const [bookingService, setBookingService] = useState<Service | null>(null);
	const [bookingSuccess, setBookingSuccess] = useState(false);
	const [bookingForm, setBookingForm] = useState({ name: "", email: "", date: "", notes: "" });

	if (!open) return null;

	const close = () => {
		setBookingService(null);
		setBookingSuccess(false);
		onClose();
	};

	// Prenotazione mockup: mostra conferma e torna al catalogo (come la vecchia pagina)
	const handleFakeSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setBookingSuccess(true);
		setTimeout(() => {
			setBookingSuccess(false);
			setBookingService(null);
			setBookingForm({ name: "", email: "", date: "", notes: "" });
		}, 1500);
	};

	return (
		<div
			className='absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-[12px] pointer-events-auto'
			onClick={close}
		>
			<div
				className='w-[880px] max-w-[94vw] max-h-[82vh] bg-[#161618] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 border border-white/[0.06] flex flex-col overflow-hidden'
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className='px-[18px] py-[14px] border-b border-white/[0.05] flex items-center justify-between shrink-0'>
					<div className='flex items-center gap-2.5'>
						{bookingService && (
							<button
								onClick={() => setBookingService(null)}
								className='w-7 h-7 rounded-[7px] flex items-center justify-center text-[#a1a19d] hover:bg-white/[0.04] hover:text-[#f0f0ec] transition-colors'
								title='Torna al catalogo'
							>
								<ChevronLeftIcon className='h-4 w-4' />
							</button>
						)}
						<div className='w-7 h-7 rounded-[7px] bg-[rgba(6,57,222,0.12)] flex items-center justify-center text-[#5B8AF5]'>
							<WrenchScrewdriverIcon className='h-3.5 w-3.5' />
						</div>
						<div>
							<span className='text-[13px] font-semibold text-[#f0f0ec] block leading-tight'>
								{bookingService ? `Prenota — ${bookingService.title}` : "Catalogo Servizi"}
							</span>
							<span className='text-[10px] text-[#a1a19d] leading-tight'>
								{bookingService
									? bookingService.subtitle
									: "Digitalizzazione, diagnostica e pulizia per impianti ed infrastrutture"}
							</span>
						</div>
					</div>
					<button
						onClick={close}
						className='flex items-center justify-center h-7 w-7 rounded-[7px] text-white/[0.28] hover:text-[#f0f0ec] hover:bg-white/[0.04] transition-colors'
					>
						<XMarkIcon className='h-4 w-4' />
					</button>
				</div>

				{/* Corpo */}
				<div className='flex-1 overflow-y-auto p-4 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/[0.08] [&::-webkit-scrollbar-thumb]:rounded'>
					{bookingService ? (
						/* ---- FORM PRENOTAZIONE (mockup) ---- */
						bookingSuccess ? (
							<div className='flex flex-col items-center justify-center py-16 gap-3'>
								<CheckCircleIcon className='h-12 w-12 text-[#22C55E]' />
								<span className='text-[14px] font-semibold text-[#f0f0ec]'>Richiesta inviata!</span>
								<span className='text-[11px] text-[#a1a19d]'>Verrai ricontattato al più presto.</span>
							</div>
						) : (
							<form onSubmit={handleFakeSubmit} className='max-w-[420px] mx-auto py-4 space-y-3'>
								<div className='flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-[10px] p-3'>
									<span className='text-[11px] text-[#a1a19d]'>{bookingService.tag}</span>
									<span className='text-[14px] font-bold text-[#f0f0ec]'>{bookingService.price}</span>
								</div>
								<div>
									<label className='text-[9px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Nome e Cognome *</label>
									<input
										required
										value={bookingForm.name}
										onChange={(e) => setBookingForm({ ...bookingForm, name: e.target.value })}
										placeholder='Mario Rossi'
										className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-2 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
									/>
								</div>
								<div>
									<label className='text-[9px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Email *</label>
									<input
										required
										type='email'
										value={bookingForm.email}
										onChange={(e) => setBookingForm({ ...bookingForm, email: e.target.value })}
										placeholder='mario@azienda.it'
										className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-2 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors'
									/>
								</div>
								<div>
									<label className='text-[9px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Data preferita</label>
									<input
										type='date'
										value={bookingForm.date}
										onChange={(e) => setBookingForm({ ...bookingForm, date: e.target.value })}
										className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-2 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] transition-colors [color-scheme:dark]'
									/>
								</div>
								<div>
									<label className='text-[9px] text-[#a1a19d] uppercase tracking-[0.06em] font-bold block mb-1'>Note</label>
									<textarea
										rows={2}
										value={bookingForm.notes}
										onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })}
										placeholder='Dettagli aggiuntivi sulla richiesta…'
										className='w-full bg-black/30 border border-white/[0.04] rounded-[6px] px-2.5 py-2 text-[12px] text-[#f0f0ec] outline-none focus:border-[rgba(6,57,222,0.4)] resize-none transition-colors'
									/>
								</div>
								<button
									type='submit'
									className='w-full py-2.5 rounded-[8px] bg-[#0639DE] hover:bg-[#0530B8] text-white text-[12px] font-semibold border border-[#0639DE] transition-colors'
								>
									Invia richiesta di prenotazione
								</button>
							</form>
						)
					) : (
						/* ---- GRIGLIA CATALOGO ---- */
						<div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
							{SERVICES.map((service) => (
								<div
									key={service.num}
									className='group bg-white/[0.02] border border-white/[0.04] rounded-[12px] overflow-hidden flex flex-col hover:bg-white/[0.03] hover:border-white/[0.08] transition-all'
								>
									<div className='relative aspect-[4/3] w-full overflow-hidden bg-black/30'>
										<Image
											src={service.imgSrc}
											alt={service.imgAlt}
											fill
											sizes='300px'
											className='object-cover transition-transform duration-300 group-hover:scale-105'
										/>
										<span className='absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-[#f0f0ec] uppercase tracking-wider'>
											{service.tag}
										</span>
									</div>
									<div className='p-3.5 flex flex-col gap-2 flex-1'>
										<div>
											<div className='text-[13px] font-semibold text-[#f0f0ec] leading-snug'>{service.title}</div>
											<div className='text-[10px] text-[#a1a19d] mt-0.5 leading-snug'>{service.subtitle}</div>
										</div>
										<p className='text-[10px] text-[#a1a19d]/80 leading-relaxed line-clamp-3'>{service.description}</p>
										<div className='space-y-1.5 mt-auto pt-1'>
											{service.bullets.map((b) => (
												<div key={b.label} className='text-[9px] leading-snug'>
													<span className='font-bold text-[#f0f0ec]/80'>{b.label}: </span>
													<span className='text-[#a1a19d]/70'>{b.text}</span>
												</div>
											))}
										</div>
										<div className='flex items-center justify-between pt-2 border-t border-white/[0.04]'>
											<div className='text-[13px] font-bold text-[#f0f0ec]'>
												{service.price}
												<span className='text-[9px] font-medium text-[#a1a19d] ml-1'>a partire da</span>
											</div>
											<button
												onClick={() => setBookingService(service)}
												className='px-3 py-1.5 rounded-[7px] bg-[#0639DE] hover:bg-[#0530B8] text-white text-[10px] font-semibold border border-[#0639DE] transition-colors'
											>
												Prenota
											</button>
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
