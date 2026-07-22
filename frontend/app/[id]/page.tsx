import { redirect } from "next/navigation";

// Flusso: schermata Admin (aziende) -> galleria modelli 3D dell'azienda
// -> dashboard/viewer del modello selezionato.
export default async function SitePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	redirect(`/${id}/models`);
}
