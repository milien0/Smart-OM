import { Router } from "express";
import { z } from "zod";
import { pool } from "../db"; // Il file di connessione PostgreSQL nativo (Pool)
import { asyncHandler, HttpError } from "../middleware/error";

const router = Router();

const point = z.object({ x: z.number(), y: z.number(), z: z.number() });

const severityEnum = z.enum(["info", "warning", "critical", "maintenance"]);
const categoryEnum = z.enum([
	"fotovoltaic",
	"surveilance",
	"green_maintenance",
	"roof",
	"facade",
	"pest_control",
	"generic",
]);

// Periodicità del piano di manutenzione
const periodicityEnum = z.enum(["monthly", "quarterly", "biannual", "annual"]);

// Converte stringhe vuote in null (le colonne DATE non accettano "")
const emptyToNull = (v: unknown) =>
	v === "" || v === undefined ? null : (v as string | null);

// Schema "base": solo forma dei campi, nessuna logica incrociata
const poiBase = z.object({
	model_id: z.string().uuid(),
	position: point,
	title: z.string().min(1),
	description: z.string().optional().nullable(),
	severity: severityEnum.default("info"),
	category: categoryEnum,
	subcategory_id: z.string().uuid().optional().nullable(),
	// --- Campi del piano di manutenzione ---
	maintenance_periodicity: periodicityEnum.optional().nullable(),
	maintenance_last_done: z.string().optional().nullable(),
	maintenance_due_date: z.string().optional().nullable(),
});

type PoiBaseShape = z.infer<typeof poiBase>;

// Azzera i campi manutenzione quando la severity non è 'maintenance'
function normalizeMaintenanceFields(
	data: PoiBaseShape,
	effectiveSeverity: z.infer<typeof severityEnum>,
): PoiBaseShape {
	if (effectiveSeverity !== "maintenance") {
		return {
			...data,
			maintenance_periodicity: null,
			maintenance_last_done: null,
			maintenance_due_date: null,
		};
	}
	return { ...data };
}

// ---------- Schema per la creazione (POST) ----------
const poiCreateInput = poiBase
	.superRefine((data, ctx) => {
		if (
			data.severity !== "maintenance" &&
			(data.maintenance_periodicity != null ||
				data.maintenance_last_done != null ||
				data.maintenance_due_date != null)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"I campi manutenzione (periodicity/lastDone/dueDate) sono validi solo se severity è 'maintenance'",
				path: ["severity"],
			});
		}
	})
	.transform((data) => normalizeMaintenanceFields(data, data.severity));

// ---------- Schema per l'update (PATCH / PUT) ----------
// partial() rende tutti i campi opzionali; sovrascriviamo severity per NON
// applicare il default "info" durante gli aggiornamenti parziali.
const poiUpdateInput = poiBase.partial().extend({
	severity: severityEnum.optional(),
});

/**
 * GET /api/pois?model_id=...
 * Recupera l'elenco dei marker associati a un modello 3D specifico
 */
router.get(
	"/",
	asyncHandler(async (req, res) => {
		const { model_id } = req.query;
		let result;

		if (typeof model_id === "string") {
			if (!z.string().uuid().safeParse(model_id).success) {
				throw new HttpError(
					400,
					"L'identificativo model_id fornito non è un UUID valido",
				);
			}
			result = await pool.query(
				"SELECT * FROM pois WHERE model_id = $1 ORDER BY created_at DESC",
				[model_id],
			);
		} else {
			result = await pool.query("SELECT * FROM pois ORDER BY created_at DESC");
		}

		res.json(result.rows);
	}),
);

/**
 * GET /api/pois/:id
 * Recupera un singolo marker iniettando al suo interno l'array delle sue foto allegate
 */
router.get(
	"/:id",
	asyncHandler(async (req, res) => {
		const poiId = req.params.id;

		if (!z.string().uuid().safeParse(poiId).success) {
			throw new HttpError(400, "ID marker non valido (formato UUID richiesto)");
		}

		// 1. Recuperiamo i dettagli del POI principale
		const poiResult = await pool.query("SELECT * FROM pois WHERE id = $1", [
			poiId,
		]);
		if (poiResult.rows.length === 0) {
			throw new HttpError(404, "Marker non trovato");
		}
		const poi = poiResult.rows[0];

		// 2. Recuperiamo tutti gli allegati fotografici legati a questo POI
		const photosResult = await pool.query(
			"SELECT * FROM poi_photos WHERE poi_id = $1 ORDER BY created_at DESC",
			[poiId],
		);

		poi.poi_photos = photosResult.rows;

		res.json(poi);
	}),
);

/**
 * POST /api/pois
 * Crea un marker a DB associando l'utente loggato (dal token JWT locale)
 */
router.post(
	"/",
	asyncHandler(async (req: any, res) => {
		// Applica le validazioni e le trasformazioni di Zod
		const body = poiCreateInput.parse(req.body);
		const userId = req.user?.id || req.userId || null;

		try {
			// position è un oggetto {x,y,z}: lo serializziamo per la colonna jsonb
			const result = await pool.query(
				`INSERT INTO pois
                    (model_id, position, title, description, severity, category, subcategory_id,
                     maintenance_periodicity, maintenance_last_done, maintenance_due_date, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
				[
					body.model_id,
					JSON.stringify(body.position),
					body.title,
					body.description ?? null,
					body.severity,
					body.category,
					body.subcategory_id ?? null,
					body.maintenance_periodicity ?? null,
					emptyToNull(body.maintenance_last_done),
					emptyToNull(body.maintenance_due_date),
					userId,
				],
			);

			res.status(201).json(result.rows[0]);
		} catch (dbError: any) {
			console.log(dbError);
			throw new HttpError(
				500,
				`Errore salvataggio marker a DB: ${dbError.message}`,
			);
		}
	}),
);

/**
 * Handler condiviso per l'aggiornamento parziale (PATCH e PUT).
 * Il frontend usa PUT; manteniamo entrambe le rotte per compatibilità.
 */
const updatePoiHandler = asyncHandler(async (req, res) => {
	const poiId = req.params.id;

	if (!z.string().uuid().safeParse(poiId).success) {
		throw new HttpError(400, "ID marker non valido (formato UUID richiesto)");
	}

	const body = poiUpdateInput.parse(req.body);

	// Recuperiamo la severity attuale per determinare quella "effettiva" post-merge
	const currentResult = await pool.query(
		"SELECT severity FROM pois WHERE id = $1",
		[poiId],
	);
	if (currentResult.rows.length === 0) {
		throw new HttpError(404, "Marker non trovato");
	}
	const current = currentResult.rows[0];

	const effectiveSeverity = body.severity ?? current.severity;

	// Coerenza: i campi manutenzione hanno senso solo con severity 'maintenance'
	if (
		effectiveSeverity !== "maintenance" &&
		(body.maintenance_periodicity != null ||
			body.maintenance_last_done != null ||
			body.maintenance_due_date != null)
	) {
		throw new HttpError(
			400,
			"I campi manutenzione (periodicity/lastDone/dueDate) sono validi solo se severity è 'maintenance'",
		);
	}

	// Se la severity non è (più) 'maintenance', ripuliamo il piano di manutenzione
	const patch =
		effectiveSeverity !== "maintenance"
			? {
					...body,
					maintenance_periodicity: null,
					maintenance_last_done: null,
					maintenance_due_date: null,
				}
			: body;

	const keys = Object.keys(patch);
	if (keys.length === 0) {
		const fresh = await pool.query("SELECT * FROM pois WHERE id = $1", [poiId]);
		return res.json(fresh.rows[0]);
	}

	// Generazione al volo della query SET parametrizzata per Postgres
	const setClause = keys.map((key, i) => `"${key}" = $${i + 2}`).join(", ");
	const values = keys.map((key) => {
		const val = (patch as any)[key];
		if (key === "position" && val) {
			return JSON.stringify(val);
		}
		// Le date vuote vanno normalizzate a null
		if (key === "maintenance_last_done" || key === "maintenance_due_date") {
			return emptyToNull(val);
		}
		return val ?? null;
	});

	const updateResult = await pool.query(
		`UPDATE pois
             SET ${setClause}
             WHERE id = $1
             RETURNING *`,
		[poiId, ...values],
	);

	if (updateResult.rows.length === 0) {
		throw new HttpError(404, "Marker non trovato");
	}

	res.json(updateResult.rows[0]);
});

// Il frontend chiama PUT /api/pois/:id; supportiamo anche PATCH.
router.patch("/:id", updatePoiHandler);
router.put("/:id", updatePoiHandler);

/**
 * DELETE /api/pois/:id
 * Elimina un marker (le foto collegate saltano via CASCADE come da file init.sql)
 */
router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		if (!z.string().uuid().safeParse(req.params.id).success) {
			throw new HttpError(400, "ID marker non valido (formato UUID richiesto)");
		}

		await pool.query("DELETE FROM pois WHERE id = $1", [req.params.id]);
		res.status(204).end();
	}),
);

// ---------- Foto di un marker ----------

const photoInput = z.object({
	file_path: z.string().min(1),
	caption: z.string().optional().nullable(),
});

/**
 * POST /api/pois/:id/photos
 * Associa un tracciato fotografico a un marker esistente
 */
router.post(
	"/:id/photos",
	asyncHandler(async (req, res) => {
		const poiId = req.params.id;
		const body = photoInput.parse(req.body);

		if (!z.string().uuid().safeParse(poiId).success) {
			throw new HttpError(
				400,
				"ID marker nell'URL non valido (formato UUID richiesto)",
			);
		}

		try {
			const result = await pool.query(
				`INSERT INTO poi_photos (file_path, caption, poi_id)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
				[body.file_path, body.caption ?? null, poiId],
			);

			res.status(201).json(result.rows[0]);
		} catch (dbError: any) {
			throw new HttpError(
				500,
				`Errore salvataggio allegato foto a DB: ${dbError.message}`,
			);
		}
	}),
);

export default router;
