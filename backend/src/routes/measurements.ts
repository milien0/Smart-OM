import { Router } from "express";
import { z } from "zod";
import { pool } from "../db"; // Il file di connessione PostgreSQL nativo (Pool)
import { asyncHandler, HttpError } from "../middleware/error";
import { computeMeasurement, minPointsFor } from "../lib/geometry";

const router = Router();

const point = z.object({ x: z.number(), y: z.number(), z: z.number() });

// Il client invia type + points (+ label opzionale).
const measurementInput = z.object({
	model_id: z.string().uuid(),
	type: z.enum(["distance", "height", "area", "coordinate"]),
	points: z.array(point).min(1),
	label: z.string().optional().nullable(),
});

/**
 * GET /api/measurements
 * Recupera l'elenco delle misurazioni, opzionalmente filtrato per model_id
 */
router.get(
	"/",
	asyncHandler(async (req, res) => {
		const { model_id } = req.query;

		let result;

		if (typeof model_id === "string") {
			// Validazione rapida dell'UUID se presente
			if (!z.string().uuid().safeParse(model_id).success) {
				throw new HttpError(
					400,
					"L'identificativo model_id fornito non è un UUID valido",
				);
			}

			// Query filtrata per modello
			result = await pool.query(
				"SELECT * FROM measurements WHERE model_id = $1 ORDER BY created_at DESC",
				[model_id],
			);
		} else {
			// Query globale di fallback
			result = await pool.query(
				"SELECT * FROM measurements ORDER BY created_at DESC",
			);
		}

		res.json(result.rows);
	}),
);

/**
 * POST /api/measurements
 * Calcola i dati geometrici lato server e registra la misurazione in Postgres
 */
router.post(
	"/",
	asyncHandler(async (req: any, res) => {
		// 1. Validazione del body in ingresso con Zod
		const body = measurementInput.parse(req.body);

		// 2. Controllo dei vincoli geometrici minimi
		const minPts = minPointsFor(body.type);
		if (body.points.length < minPts) {
			throw new HttpError(
				400,
				`La misura "${body.type}" richiede almeno ${minPts} punto/i`,
			);
		}

		// 3. Calcolo del risultato e dell'unità di misura (Logica geometrica invariata)
		const { result: calculatedResult, unit } = computeMeasurement(
			body.type,
			body.points,
		);

		// Recuperiamo l'ID utente dal token JWT locale (compatibile sia con req.user.id che req.userId)
		const userId = req.user?.id || req.userId || null;

		try {
			// 4. Inserimento in PostgreSQL nativo
			// NOTA: Convertiamo l'array di punti in stringa JSON per il corretto inserimento nel campo JSONB
			const dbResult = await pool.query(
				`INSERT INTO measurements (model_id, type, points, label, result, unit, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
				[
					body.model_id,
					body.type,
					JSON.stringify(body.points), // Serializzazione JSONB obbligatoria per il driver 'pg'
					body.label ?? null,
					calculatedResult,
					unit,
					userId,
				],
			);

			res.status(201).json(dbResult.rows[0]);
		} catch (dbError: any) {
			throw new HttpError(
				500,
				`Errore salvataggio misurazione a DB: ${dbError.message}`,
			);
		}
	}),
);

/**
 * DELETE /api/measurements/:id
 * Elimina una misurazione tramite ID
 */
router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		const { id } = req.params;

		if (!z.string().uuid().safeParse(id).success) {
			throw new HttpError(
				400,
				"ID misurazione non valido (formato UUID richiesto)",
			);
		}

		try {
			await pool.query("DELETE FROM measurements WHERE id = $1", [id]);
			res.status(204).end();
		} catch (dbError: any) {
			throw new HttpError(
				500,
				`Errore eliminazione dal DB Postgres: ${dbError.message}`,
			);
		}
	}),
);

export default router;
