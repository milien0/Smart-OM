// Base URL dell'API backend, lato client.
// In sviluppo locale punta a localhost:4000; in Docker/produzione si
// configura con NEXT_PUBLIC_API_URL (vedi CLAUDE.md e Dockerfile).
export const API_BASE =
	process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
