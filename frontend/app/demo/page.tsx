// TEMPORARY demo page — lets you see the PLY viewer + View/Edit mode toggle
// without the backend. Safe to delete. Uses /public/sample.ply.
import PlyViewerClient from "@/features/models/components/plyViewerClient";

export default function DemoPage() {
	return (
		<main className='w-screen h-screen bg-[#0c0c0e] overflow-hidden relative'>
			<PlyViewerClient url='/sample.ply' modelId='demo' />
		</main>
	);
}
