"use client";

import dynamic from "next/dynamic";

// Qui dentro l'opzione ssr: false è perfettamente lecita perché siamo già in un Client Component
const PlyViewerDynamic = dynamic(
	() => import("@/features/models/components/plyViewer"),
	{ ssr: false },
);

interface PlyViewerClientProps {
	url: string;
	modelId: string;
}

export default function PlyViewerClient({
	url,
	modelId,
}: PlyViewerClientProps) {
	return <PlyViewerDynamic url={url} modelId={modelId} />;
}
