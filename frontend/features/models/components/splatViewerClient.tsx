"use client";

import dynamic from "next/dynamic";

// Qui dentro l'opzione ssr: false è perfettamente lecita perché siamo già in un Client Component
const SplatViewerDynamic = dynamic(
	() => import("@/features/models/components/splatViewer"),
	{ ssr: false },
);

interface SplatViewerClientProps {
	url: string;
	modelId: string;
	format?: string | null;
}

export default function SplatViewerClient({
	url,
	modelId,
	format,
}: SplatViewerClientProps) {
	return <SplatViewerDynamic url={url} modelId={modelId} format={format} />;
}
