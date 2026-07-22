import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Le vecchie pagine di sede (foto, documenti, rubrica, servizi, punti, AI)
	// sono state consolidate dentro l'editor 3D: i vecchi URL portano alla
	// scelta del modello, da cui si apre il viewer che contiene tutto.
	async redirects() {
		return ["photos", "documents", "contacts", "services", "pois", "ask"].map(
			(old) => ({
				source: `/:id/${old}`,
				destination: "/:id/models",
				permanent: false,
			}),
		);
	},
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: [
					{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
					{ key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
				],
			},
		];
	},
	reactStrictMode: false,
};

export default nextConfig;
