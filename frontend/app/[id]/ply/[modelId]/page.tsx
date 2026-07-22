import { notFound } from "next/navigation";
import PlyViewerClient from "@/features/models/components/plyViewerClient";

interface DronePageProps {
	params: Promise<{ modelId: string }>;
}

export default async function Page({ params }: DronePageProps) {
	const { modelId } = await params;

	// 1. Determina l'URL per la chiamata LATO SERVER (Dentro Docker usa http://backend:4000)
	const serverApiUrl = process.env.API_URL || "http://localhost:4000";

	// 2. Determina l'URL che userà il BROWSER del cliente (Sempre http://localhost:4000)
	const clientApiUrl =
		process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

	let modelUrl = "";
	try {
		// Interroghiamo il backend usando l'URL interno del network Docker
		const res = await fetch(`${serverApiUrl}/api/models/${modelId}`, {
			cache: "no-store",
		});

		if (!res.ok) {
			console.error(`Errore API Backend. Stato: ${res.status}`);
			return notFound();
		}

		const modelData = await res.json();
		console.log("Metadati modello ricevuti da DB:", modelData);

		// Generiamo l'URL definitivo per il client browser
		modelUrl = `${clientApiUrl}/api/models/${modelId}/file`;
	} catch (error) {
		console.error(
			"Errore di rete nel recupero del modello lato Server:",
			error,
		);
		return notFound();
	}

	return (
		<main className='w-screen h-screen bg-[#0c0c0e] overflow-hidden relative'>
			<PlyViewerClient url={modelUrl} modelId={modelId} />
		</main>
	);
}
