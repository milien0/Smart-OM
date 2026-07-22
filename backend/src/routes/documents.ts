import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db"; // Connessione Postgres nativa locale
import { asyncHandler, HttpError } from "../middleware/error";
import { indexDocument } from "../services/indexing";
import { Ollama } from "ollama";

const ollama = new Ollama({
	host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
});

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Directory principale degli upload definita dalle env di Docker
const UPLOADS_DIR =
	process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

/**
 * GET /api/documents/site/:site_id
 * Recupera l'elenco dei documenti di una specifica sede tramite Postgres SQL
 */
router.get(
	"/site/:site_id",
	asyncHandler(async (req, res) => {
		const { site_id } = req.params;

		const uuidValidation = z.string().uuid().safeParse(site_id);
		if (!uuidValidation.success) {
			throw new HttpError(400, "ID sede non valido (formato UUID richiesto)");
		}

		const result = await pool.query(
			"SELECT * FROM documents WHERE site_id = $1 ORDER BY created_at DESC",
			[site_id],
		);

		res.json(result.rows);
	}),
);

/**
 * GET /api/documents/poi/:poi_id
 * Recupera i documenti collegati a un POI specifico
 */
router.get(
	"/poi/:poi_id",
	asyncHandler(async (req, res) => {
		const { poi_id } = req.params;

		const uuidValidation = z.string().uuid().safeParse(poi_id);
		if (!uuidValidation.success) {
			throw new HttpError(400, "ID POI non valido (formato UUID richiesto)");
		}

		const result = await pool.query(
			"SELECT * FROM documents WHERE poi_id = $1 ORDER BY created_at DESC",
			[poi_id],
		);

		res.json(result.rows);
	}),
);

/**
 * POST /api/documents/upload
 * Carica il file nella cartella locale della sede ed esegue l'indicizzazione in background
 */
router.post(
	"/upload",
	upload.single("file"),
	asyncHandler(async (req, res) => {
		const file = req.file;
		const siteId = req.body.site_id;
		const poiId = req.body.poi_id || null;

		if (!file) throw new HttpError(400, "Nessun file caricato");
		if (!siteId) throw new HttpError(400, "ID sede non specificato");

		// Organizziamo i file isolandoli nella sottocartella "documents" all'interno del sito
		const siteDocsDir = path.join(UPLOADS_DIR, siteId, "documents");
		if (!fs.existsSync(siteDocsDir)) {
			fs.mkdirSync(siteDocsDir, { recursive: true });
		}

		const fileName = `${Date.now()}_${file.originalname}`;
		const fullStoragePath = path.join(siteDocsDir, fileName);

		// 1. SALVATAGGIO SUL DISCO LOCALE (Sostituisce Supabase Storage)
		try {
			fs.writeFileSync(fullStoragePath, file.buffer);
		} catch (storageError: any) {
			console.error(storageError);
			throw new HttpError(
				500,
				`Errore scrittura file su disco: ${storageError.message}`,
			);
		}

		// 2. REGISTRAZIONE RECORD IN POSTGRES
		let dbData;
		try {
			const dbResult = await pool.query(
				`INSERT INTO documents (site_id, name, file_path, size, mime_type, poi_id)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
				[siteId, file.originalname, fullStoragePath, file.size, file.mimetype, poiId],
			);
			dbData = dbResult.rows[0];
		} catch (dbError: any) {
			// Rollback: Rimuoviamo il file se il database fallisce
			if (fs.existsSync(fullStoragePath)) fs.unlinkSync(fullStoragePath);
			throw new HttpError(500, `Errore database: ${dbError.message}`);
		}

		// 3. INDICIZZAZIONE IN BACKGROUND (Invariata)
		indexDocument(dbData.id, siteId, file.buffer, file.mimetype)
			.then((result) =>
				console.log(
					`[RAG] Indicizzato ${file.originalname}: ${result.chunksCount} chunk`,
				),
			)
			.catch((err) =>
				console.error(`[RAG] Errore indicizzazione ${file.originalname}:`, err),
			);

		res.status(201).json(dbData);
	}),
);

router.post(
	"/ask",
	asyncHandler(async (req, res) => {
		const { question, site_id, model_context, image, mode } = req.body;
		if (!question || !site_id)
			throw new HttpError(400, "Servono question e site_id");

		const effectiveMode: string = mode || "tutto";
		const needsDocs = effectiveMode === "documenti" || effectiveMode === "tutto";
		const needsPoi = effectiveMode === "poi" || effectiveMode === "tutto";
		const needsVision = effectiveMode === "modello3d" || effectiveMode === "tutto";

		let docContext = "";
		let sources: any[] = [];

		if (needsDocs) {
			try {
				const embedResponse = await ollama.embed({
					model: "nomic-embed-text",
					input: question,
				});
				if (embedResponse.embeddings?.[0]) {
					const embeddingString = `[${embedResponse.embeddings[0].join(",")}]`;
					const queryResult = await pool.query(
						`SELECT dc.content, d.name as doc_name, (1 - (dc.embedding <=> $1::vector)) as similarity
						 FROM document_chunks dc
						 JOIN documents d ON dc.document_id = d.id
						 WHERE d.site_id = $2
						 ORDER BY dc.embedding <=> $1::vector
						 LIMIT $3`,
						[embeddingString, site_id, 5],
					);
					if (queryResult.rows.length > 0) {
						docContext = queryResult.rows
							.map((c: any) => `[Documento: ${c.doc_name}]\n${c.content}`)
							.join("\n---\n");
						sources = queryResult.rows.map((c: any) => ({
							document: c.doc_name,
							excerpt: c.content.slice(0, 200) + "...",
							similarity: c.similarity,
						}));
					}
				}
			} catch (ragError: any) {
				console.warn("[RAG Ask] Embedding/ricerca non disponibile:", ragError.message);
			}
		}

		const SYSTEM_PROMPTS: Record<string, string> = {
			documenti:
				"Sei l'assistente tecnico di Smart O&M. Rispondi in italiano basandoti sui documenti forniti. " +
				"Cita sempre il nome del documento da cui estrai le informazioni. " +
				"Se non trovi la risposta nei documenti, dillo chiaramente.",
			poi:
				"Sei l'assistente tecnico di Smart O&M. Rispondi in italiano basandoti sui dati dell'impianto: punti di interesse (pin), ticket, misure e categorie. " +
				"Cita i nomi specifici dei pin e dei ticket. " +
				"Puoi analizzare criticità, suggerire priorità di manutenzione e aiutare con la pianificazione degli interventi.",
			modello3d:
				"Sei l'assistente tecnico di Smart O&M con capacità di visione e analisi geometrica. " +
				"Ti viene fornita un'immagine della vista corrente del modello 3D (point cloud PLY) di un impianto industriale/fotovoltaico, " +
				"insieme ai metadati geometrici estratti dal modello (bounding box, numero vertici, dimensioni, colore medio, posizione camera). " +
				"Rispondi in italiano. Usa l'immagine per l'analisi visiva (strutture, pannelli, danni, anomalie di colore) " +
				"e i metadati geometrici per risposte quantitative (dimensioni, volumi, distanze). " +
				"Quando dai misure, specifica che sono in unità del modello (che tipicamente corrispondono a metri nei modelli fotogrammetrici).",
			tutto:
				"Sei l'assistente tecnico di Smart O&M con accesso completo all'impianto. Rispondi in italiano. " +
				"Hai accesso a: (1) l'immagine live del modello 3D, (2) i dati strutturati dei pin/ticket/misure, (3) i documenti tecnici caricati. " +
				"Usa tutte le fonti disponibili per dare la risposta più completa. Cita le fonti (nome documento, nome pin, ecc.).",
		};

		let userPromptParts: string[] = [];
		if (needsPoi && model_context) {
			userPromptParts.push(`Stato attuale dell'impianto:\n${model_context}`);
		}
		if (needsDocs && docContext) {
			userPromptParts.push(`Contesto documenti:\n${docContext}`);
		}
		if (needsVision && image) {
			userPromptParts.push("Ti è stata allegata un'immagine della vista corrente del modello 3D. Analizzala per rispondere.");
		}
		userPromptParts.push(`Domanda: ${question}`);

		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");
		res.flushHeaders();

		if (sources.length > 0) {
			res.write(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`);
		}

		try {
			const userMessage: any = {
				role: "user",
				content: userPromptParts.join("\n\n"),
			};

			if (needsVision && image) {
				const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
				userMessage.images = [base64Data];
			}

			const stream = await ollama.chat({
				model: "gemma4",
				stream: true,
				messages: [
					{
						role: "system",
						content: SYSTEM_PROMPTS[effectiveMode] || SYSTEM_PROMPTS.tutto,
					},
					userMessage,
				],
			});

			for await (const chunk of stream) {
				const token = chunk.message.content;
				if (token) {
					res.write(`data: ${JSON.stringify({ type: "token", token })}\n\n`);
				}
			}

			res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
		} catch (streamError: any) {
			console.error("[RAG Ask] Errore critico durante lo streaming:", streamError);
			res.write(
				`data: ${JSON.stringify({ type: "error", message: "Il motore AI locale ha interrotto la generazione della risposta." })}\n\n`,
			);
		} finally {
			res.end();
		}
	}),
);

router.get(
	"/:id/view",
	asyncHandler(async (req, res) => {
		const { id } = req.params;

		// 1. Recuperiamo file_path e mime_type reali dal database
		const result = await pool.query(
			"SELECT file_path, mime_type FROM documents WHERE id = $1",
			[id],
		);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Documento non trovato nel database");
		}

		const document = result.rows[0];

		// 2. Calcoliamo il percorso assoluto dentro il container di Docker
		const uploadsBaseDir = process.env.UPLOADS_DIR || "/app/uploads";
		const absolutePath = path.isAbsolute(document.file_path)
			? document.file_path
			: path.join(uploadsBaseDir, document.file_path);

		// 3. Verifichiamo che il file esista sul disco
		if (!fs.existsSync(absolutePath)) {
			throw new HttpError(404, "Il file non è presente fisicamente sul server");
		}

		// 4. 🔥 IL SEGRETO: Forziamo la visualizzazione INLINE e il Mime Type corretto
		res.setHeader("Content-Type", document.mime_type || "application/pdf");
		res.setHeader("Content-Disposition", "inline"); // inline dice al browser di aprirlo a schermo!

		// Spediamo il file integro
		res.sendFile(absolutePath, (err) => {
			if (err) {
				console.error("[Document View Service] Errore invio file:", err);
			}
		});
	}),
);

/**
 * GET /api/documents/:id/download
 * Consente lo scaricamento diretto e sicuro del file dal server locale
 */
router.get(
	"/:id/download",
	asyncHandler(async (req, res) => {
		const result = await pool.query(
			"SELECT file_path, name FROM documents WHERE id = $1",
			[req.params.id],
		);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Documento non trovato");
		}

		const doc = result.rows[0];

		if (!fs.existsSync(doc.file_path)) {
			throw new HttpError(
				404,
				"Il file fisico non è presente sul disco del server",
			);
		}

		// Express si occupa di fare il pipe del file binario in modo performante ed efficiente
		res.download(doc.file_path, doc.name);
	}),
);

/**
 * DELETE /api/documents/:id
 * Elimina il file dal disco fisso e ripulisce le tabelle correlate nel DB locale
 */
router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		const result = await pool.query(
			"SELECT file_path FROM documents WHERE id = $1",
			[req.params.id],
		);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Documento non trovato");
		}

		const doc = result.rows[0];

		// 1. Rimozione fisica del documento su disco
		if (fs.existsSync(doc.file_path)) {
			fs.unlinkSync(doc.file_path);
		}

		// 2. Cancellazione del record dal DB (i chunk collegati saltano in automatico via CASCADE)
		await pool.query("DELETE FROM documents WHERE id = $1", [req.params.id]);

		res.status(204).end();
	}),
);

export default router;
