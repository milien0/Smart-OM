import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { pool } from "../db";
import { asyncHandler, HttpError } from "../middleware/error";

const router = Router();

// Configurazione cartella uploads (ereditata dall'ambiente Docker o fallback locale)
const UPLOADS_DIR =
	process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

const siteInput = z.object({
	name: z.string().min(1),
	address: z.string().optional().nullable(),
	notes: z.string().optional().nullable(),
});

/**
 * GET /api/sites
 * Recupera l'elenco completo di tutte le sedi mappato in camelCase
 */
router.get(
	"/",
	asyncHandler(async (_req, res) => {
		// Query SQL nativa con ordinamento temporale decrescente
		const result = await pool.query(
			`SELECT id, name, address, notes, created_at AS "createdAt" 
             FROM sites 
             ORDER BY created_at DESC`,
		);

		res.json({
			status: 200,
			data: result.rows,
		});
	}),
);

/**
 * GET /api/sites/:id
 * Recupera i dettagli di una singola sede
 */
router.get(
	"/:id",
	asyncHandler(async (req, res) => {
		const result = await pool.query(
			`SELECT id, name, address, notes, created_at AS "createdAt" 
             FROM sites 
             WHERE id = $1`,
			[req.params.id],
		);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Sede non trovata");
		}

		res.json(result.rows[0]);
	}),
);

/**
 * POST /api/sites
 * Creazione record della Sede a DB + Creazione cartella locale dedicata ("Bucket unico locale")
 */
router.post(
	"/",
	asyncHandler(async (req, res) => {
		// 1. Validazione dei dati con Zod
		const body = siteInput.parse(req.body);

		// 2. Inserimento del record nel database Postgres locale
		let newSite;
		try {
			const dbResult = await pool.query(
				`INSERT INTO sites (name, address, notes) 
                 VALUES ($1, $2, $3) 
                 RETURNING id, name, address, notes, created_at AS "createdAt"`,
				[body.name, body.address || null, body.notes || null],
			);
			newSite = dbResult.rows[0];
		} catch (dbError: any) {
			console.error("Errore salvataggio sito a DB:", dbError);
			throw new HttpError(500, `Errore database: ${dbError.message}`);
		}

		// 3. Creazione del "Bucket Locale" (Cartella fisica dedicata sul disco con nome = UUID del sito)
		const siteFolderPath = path.join(UPLOADS_DIR, newSite.id);

		try {
			if (!fs.existsSync(siteFolderPath)) {
				// Genera la cartella principale del sito (es: /app/uploads/UUID_SITO)
				fs.mkdirSync(siteFolderPath, { recursive: true });

				// Opzionale: Creiamo subito la sottocartella "documents" per l'upload dei file
				fs.mkdirSync(path.join(siteFolderPath, "documents"), {
					recursive: true,
				});
				console.log(
					`[Storage Locale] Inizializzata cartella unica per la sede: ${siteFolderPath}`,
				);
			}
		} catch (storageException) {
			console.error("Errore creazione directory locale:", storageException);

			// ROLLBACK: Eliminiamo il sito dal DB se il File System fallisce per evitare dati inconsistenti
			await pool.query("DELETE FROM sites WHERE id = $1", [newSite.id]);
			throw new HttpError(
				500,
				`Errore imprevisto durante la creazione dello storage locale della sede.`,
			);
		}

		// 4. Risposta di successo al client
		res.status(201).json(newSite);
	}),
);

/**
 * PATCH /api/sites/:id
 * Aggiornamento parziale dinamico di una sede tramite Postgres
 */
router.patch(
	"/:id",
	asyncHandler(async (req, res) => {
		const body = siteInput.partial().parse(req.body);
		const keys = Object.keys(body);

		// Se il corpo della richiesta è vuoto, restituiamo la sede senza aggiornare nulla
		if (keys.length === 0) {
			const current = await pool.query(
				`SELECT id, name, address, notes, created_at AS "createdAt" FROM sites WHERE id = $1`,
				[req.params.id],
			);
			if (current.rows.length === 0)
				throw new HttpError(404, "Sede non trovata");
			return res.json(current.rows[0]);
		}

		// Costruiamo dinamicamente la query SET di PostgreSQL ("name" = $2, "address" = $3, ...)
		const setClause = keys.map((key, i) => `"${key}" = $${i + 2}`).join(", ");
		const values = keys.map((key) => (body as any)[key]);

		const result = await pool.query(
			`UPDATE sites 
       SET ${setClause} 
       WHERE id = $1 
       RETURNING id, name, address, notes, created_at AS "createdAt"`,
			[req.params.id, ...values],
		);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Sede non trovata");
		}

		res.json(result.rows[0]);
	}),
);

/**
 * DELETE /api/sites/:id
 * Eliminazione della sede a DB + Rimozione di tutti i file fisici associati sul server
 */
router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		const siteId = req.params.id;

		// 1. Rimuoviamo la cartella fisica della sede per liberare spazio su disco (Rimozione ricorsiva forzata)
		const siteFolderPath = path.join(UPLOADS_DIR, siteId);
		if (fs.existsSync(siteFolderPath)) {
			try {
				fs.rmSync(siteFolderPath, { recursive: true, force: true });
				console.log(
					`[Storage Locale] Rimossa interamente la cartella della sede: ${siteFolderPath}`,
				);
			} catch (fsError) {
				console.error(
					`Impossibile rimuovere la cartella fisica ${siteFolderPath}:`,
					fsError,
				);
			}
		}

		// 2. Cancellazione dal DB (i modelli, i documenti e i chunk correlati a questa sede
		// verranno eliminati in automatico grazie al vincolo ON DELETE CASCADE impostato in Postgres)
		const result = await pool.query("DELETE FROM sites WHERE id = $1", [
			siteId,
		]);

		res.status(204).end();
	}),
);

export default router;
