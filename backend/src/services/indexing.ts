import { Ollama } from "ollama";
import { pool } from "../db";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ollama = new Ollama({
	host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
});

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
	if (mimeType === "application/pdf") {
		const uint8 = new Uint8Array(buffer);
		const doc = await getDocument({ data: uint8 }).promise;
		const pages: string[] = [];

		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			pages.push(content.items.map((item: any) => item.str).join(" "));
		}

		return pages.join("\n");
	}

	if (mimeType.startsWith("text/")) {
		return buffer.toString("utf-8");
	}

	throw new Error(`Tipo non supportato: ${mimeType}`);
}

// --- Chunking con overlap (Invariato) ---
function chunkText(text: string, maxChars = 1000, overlap = 200): string[] {
	const cleaned = text
		.replace(/\n{3,}/g, "\n\n")
		.replace(/ {2,}/g, " ")
		.trim();
	const chunks: string[] = [];
	let start = 0;

	while (start < cleaned.length) {
		let end = start + maxChars;

		if (end < cleaned.length) {
			const slice = cleaned.slice(start, end);
			const lastBreak = Math.max(
				slice.lastIndexOf(". "),
				slice.lastIndexOf(".\n"),
				slice.lastIndexOf("\n\n"),
			);
			if (lastBreak > maxChars * 0.5) {
				end = start + lastBreak + 1;
			}
		}

		const chunk = cleaned.slice(start, end).trim();
		if (chunk.length > 0) chunks.push(chunk);
		start = end - overlap;
	}

	return chunks;
}

// --- Embedding via Ollama (Invariato, ora usa l'istanza configurata) ---
async function getEmbedding(text: string): Promise<number[]> {
	const response = await ollama.embed({
		model: "nomic-embed-text",
		input: text,
	});
	return response.embeddings[0];
}

// --- Funzione principale per Postgres Nativo ---
export async function indexDocument(
	documentId: string,
	siteId: string,
	fileBuffer: Buffer,
	mimeType: string,
): Promise<{ chunksCount: number }> {
	const text = await extractText(fileBuffer, mimeType);
	const chunks = chunkText(text);

	if (chunks.length === 0) {
		return { chunksCount: 0 };
	}

	// Genera tutti gli embedding in parallelo via Ollama
	const embeddings = await Promise.all(
		chunks.map((chunk) => getEmbedding(chunk)),
	);

	// --- COSTRUZIONE QUERY MULTI-ROW PER POSTGRES ---
	const values: any[] = [];
	const valueStrings: string[] = [];
	let paramIndex = 1;

	for (let i = 0; i < chunks.length; i++) {
		const content = chunks[i];
		const embeddingString = `[${embeddings[i].join(",")}]`;

		values.push(documentId, siteId, content, i, embeddingString);
		valueStrings.push(
			`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`,
		);

		paramIndex += 5;
	}

	const queryText = `
        INSERT INTO document_chunks (document_id, site_id, content, chunk_index, embedding)
        VALUES ${valueStrings.join(", ")}
    `;

	try {
		await pool.query(queryText, values);
	} catch (dbError: any) {
		console.error(
			"[RAG Indexing] Errore scrittura chunk su Postgres:",
			dbError,
		);
		throw new Error(
			`Errore inserimento chunk a database locale: ${dbError.message}`,
		);
	}

	return { chunksCount: chunks.length };
}
