"use client";

import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db"; // Connessione PostgreSQL nativa locale (Pool)
import { asyncHandler, HttpError } from "../middleware/error";
import {
	isSogArchive,
	isSogFolder,
	convertSogFolderToPly,
	convertSogArchiveToPly,
	type UploadedFile,
} from "../utils/sogConverter";

const router = Router();

// Directory principale degli upload definita dall'ambiente Docker o fallback locale
const UPLOADS_DIR =
	process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

// Configurazione di Multer in memoria per gestire il flusso dei file multipart pesanti
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 1000 * 1024 * 1024, // Limite massimo impostato a 1000MB per i modelli 3D
	},
});

const point = z.object({ x: z.number(), y: z.number(), z: z.number() });

const modelInput = z.object({
	site_id: z.string().uuid(),
	name: z.string().min(1),
	file_path: z.string().optional().nullable(),
	format: z.string().optional().nullable(),
	default_camera: z
		.object({ position: point, target: point })
		.optional()
		.nullable(),
});

/**
 * GET /api/models
 * Elenco modelli (filtrabile opzionalmente per site_id) via Postgres SQL
 */
router.get(
	"/",
	asyncHandler(async (req, res) => {
		const { site_id } = req.query;
		let result;

		if (typeof site_id === "string") {
			if (!z.string().uuid().safeParse(site_id).success) {
				throw new HttpError(
					400,
					"L'identificativo site_id fornito non è un UUID valido",
				);
			}
			result = await pool.query(
				"SELECT * FROM models WHERE site_id = $1 ORDER BY created_at DESC",
				[site_id],
			);
		} else {
			result = await pool.query(
				"SELECT * FROM models ORDER BY created_at DESC",
			);
		}

		res.json(result.rows);
	}),
);

/**
 * GET /api/models/:id/file
 * Serve il file binario del modello (.ply, .glb, .splat) direttamente a Three.js
 */
router.get(
    "/:id/file",
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        // 1. Recuperiamo il percorso assoluto dal database Postgres
        const result = await pool.query(
            "SELECT file_path FROM models WHERE id = $1",
            [id],
        );

        if (result.rows.length === 0) {
            throw new HttpError(404, "Modello non trovato a database");
        }

        const model = result.rows[0];

        // 2. Controlliamo che il file esista fisicamente sul server
        if (!fs.existsSync(model.file_path)) {
            throw new HttpError(
                404,
                "Il file 3D non è presente sul disco del server",
            );
        }

        const ext = path.extname(model.file_path).toLowerCase();
        
        // Oggetto per le opzioni di sendFile
        const options: any = {};

        // Impostiamo gli header custom direttamente nelle opzioni
        if (ext === ".splat") {
            options.headers = {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": "inline",
                // Decommenta la riga sotto se il frontend è su un'altra porta/dominio
					"Access-Control-Allow-Origin": "*" 
            };
        }

        // 3. Spediamo il file al client
        res.sendFile(model.file_path, options, (err: any) => {
            if (err) {
                // Gestione graziosa dell'errore EPIPE per non intasare i log o crashare
                if (err.code === 'EPIPE' || err.code === 'ECONNABORTED') {
                    console.warn(`[Stream Interrotto] Il client ha chiuso la connessione prima di finire il download del file ${id}`);
                } else {
                    console.error("Errore imprevisto durante l'invio del file:", err);
                }
            }
        });
    }),
);

/**
 * GET /api/models/:id
 * Recupero di un singolo modello tramite ID
 */
router.get(
	"/:id",
	asyncHandler(async (req, res) => {
		const result = await pool.query("SELECT * FROM models WHERE id = $1", [
			req.params.id,
		]);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Modello non trovato");
		}

		res.json(result.rows[0]);
	}),
);

/**
 * POST /api/models
 * Creazione record a DB + Salvataggio del file binario 3D su File System locale
 */
router.post(
	"/",
	upload.any(), // Accetta un singolo file (.ply/.splat/.sog) o più file (cartella SOG)
	asyncHandler(async (req, res) => {
		// Trattandosi di un invio form-data, gli oggetti complessi arrivano serializzati come stringhe.
		if (typeof req.body.default_camera === "string") {
			try {
				req.body.default_camera = JSON.parse(req.body.default_camera);
			} catch (e) {
				throw new HttpError(
					400,
					"Il formato di default_camera non è un JSON valido",
				);
			}
		}

		const body = modelInput.parse(req.body);

		// Con upload.any() i file arrivano in req.files (array). Supportiamo sia
		// il singolo file (.ply/.splat/.sog/.zip) sia l'upload dell'intera cartella
		// SOG (meta.json + più .webp) senza obbligare l'utente a zippare.
		const allFiles = (req.files as Express.Multer.File[]) || [];

		if (allFiles.length === 0) {
			throw new HttpError(
				400,
				'Nessun file 3D caricato. Il campo "file" è obbligatorio.',
			);
		}

		const uploaded: UploadedFile[] = allFiles.map((f) => ({
			name: f.originalname,
			buffer: f.buffer,
		}));
		// File "principale" per il flusso standard single-file (per nome/estensione).
		const primary = allFiles[0];

		// Inizializzazione della sottocartella "models" dentro la cartella specifica del sito
		const siteModelsDir = path.join(UPLOADS_DIR, body.site_id, "models");
		if (!fs.existsSync(siteModelsDir)) {
			fs.mkdirSync(siteModelsDir, { recursive: true });
		}

		// Base del nome file unica per prevenire sovrascritture accidentali
		const fileExtension = primary.originalname.split(".").pop();
		const uniqueBase = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

		let fullStoragePath: string;
		let computedFormat: string | null;

		if (allFiles.length > 1 || isSogFolder(uploaded)) {
			// FLUSSO SOG (cartella): più file (meta.json + .webp) selezionati
			// direttamente dall'utente. Li decodifichiamo in un PLY binario
			// (letto dal viewer via SceneFormat.Ply), servito al posto dei sorgenti.
			const destPath = path.join(siteModelsDir, `${uniqueBase}.ply`);
			await convertSogFolderToPly(uploaded, destPath);
			fullStoragePath = destPath;
			// Tag "sog": preserva l'origine, mostra badge SOG e — non essendo "ply" —
			// instrada al viewer splat (non al viewer mesh PLY).
			computedFormat = "sog";
		} else if (isSogArchive(primary.originalname)) {
			// FLUSSO SOG (archivio single-file .sog/.zip): estrai e decodifica.
			const destPath = path.join(siteModelsDir, `${uniqueBase}.ply`);
			await convertSogArchiveToPly(primary.buffer, destPath);
			fullStoragePath = destPath;
			computedFormat = "sog";
		} else {
			// FLUSSO STANDARD (.ply mesh / .splat / .ksplat): salvataggio diretto
			const uniqueFileName = `${uniqueBase}.${fileExtension}`;
			fullStoragePath = path.join(siteModelsDir, uniqueFileName);

			try {
				fs.writeFileSync(fullStoragePath, primary.buffer);
			} catch (storageError: any) {
				console.error("Errore scrittura file 3D su disco:", storageError);
				throw new HttpError(
					500,
					`Errore caricamento file nello storage locale: ${storageError.message}`,
				);
			}

			computedFormat = fileExtension ? fileExtension.toLowerCase() : null;
		}

		const computedPath = fullStoragePath;

		// 2. REGISTRAZIONE DEI METADATI NEL DATABASE POSTGRES
		try {
			// NOTA: default_camera viene passata come stringa JSON per soddisfare il tipo JSONB di Postgres
			const dbResult = await pool.query(
				`INSERT INTO models (site_id, name, file_path, format, default_camera)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
				[
					body.site_id,
					body.name,
					computedPath,
					computedFormat,
					body.default_camera ? JSON.stringify(body.default_camera) : null,
				],
			);

			res.status(201).json(dbResult.rows[0]);
		} catch (dbError: any) {
			// Logica di Rollback: se il database fallisce, rimuoviamo il file su disco per evitare orfani
			if (fs.existsSync(fullStoragePath)) {
				fs.unlinkSync(fullStoragePath);
			}
			throw new HttpError(
				500,
				`Errore persistenza dati nel DB locale: ${dbError.message}`,
			);
		}
	}),
);

/**
 * PATCH /api/models/:id
 * Aggiornamento parziale dinamico dei metadati o parametri di camera
 */
router.patch(
	"/:id",
	asyncHandler(async (req, res) => {
		if (typeof req.body.default_camera === "string") {
			try {
				req.body.default_camera = JSON.parse(req.body.default_camera);
			} catch (e) {
				throw new HttpError(
					400,
					"Il formato di default_camera non è un JSON valido",
				);
			}
		}

		const body = modelInput.partial().parse(req.body);
		const keys = Object.keys(body);

		if (keys.length === 0) {
			const current = await pool.query("SELECT * FROM models WHERE id = $1", [
				req.params.id,
			]);
			if (current.rows.length === 0)
				throw new HttpError(404, "Modello non trovato");
			return res.json(current.rows[0]);
		}

		// Costruiamo la query dinamicamente convertendo opportunamente gli oggetti in JSON stringhe per Postgres
		const setClause = keys.map((key, i) => `"${key}" = $${i + 2}`).join(", ");
		const values = keys.map((key) => {
			if (key === "default_camera" && (body as any)[key]) {
				return JSON.stringify((body as any)[key]);
			}
			return (body as any)[key];
		});

		const result = await pool.query(
			`UPDATE models 
             SET ${setClause} 
             WHERE id = $1 
             RETURNING *`,
			[req.params.id, ...values],
		);

		if (result.rows.length === 0) {
			throw new HttpError(404, "Modello non trovato");
		}

		res.json(result.rows[0]);
	}),
);

/**
 * DELETE /api/models/:id
 * Rimozione del record a DB e pulizia dei file fisici sul server localmente
 */
router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		// 1. Recupero dei metadati per identificare il file_path assoluto su disco
		const fetchResult = await pool.query(
			"SELECT file_path FROM models WHERE id = $1",
			[req.params.id],
		);

		if (fetchResult.rows.length === 0) {
			throw new HttpError(404, "Modello non trovato");
		}

		const model = fetchResult.rows[0];

		// 2. Rimozione fisica del file 3D se presente sul server
		if (model.file_path && fs.existsSync(model.file_path)) {
			try {
				fs.unlinkSync(model.file_path);
				console.log(
					`[Storage Locale] Rimosso file modello 3D: ${model.file_path}`,
				);
			} catch (fsError) {
				console.error(
					`Impossibile eliminare il file fisico ${model.file_path}:`,
					fsError,
				);
			}
		}

		// 3. Rimozione definitiva della riga dal database locale
		// (Nota: i POI e le misurazioni collegate saltano via CASCADE come da file init.sql)
		await pool.query("DELETE FROM models WHERE id = $1", [req.params.id]);

		res.status(204).end();
	}),
);

export default router;
