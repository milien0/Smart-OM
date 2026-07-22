import { Router } from "express";
import { z } from "zod";
import { pool } from "../db"; // Il file di connessione PostgreSQL nativo (Pool)
import { asyncHandler, HttpError } from "../middleware/error";

const router = Router();

// Schema di validazione Zod per la creazione e modifica del contatto (Invariato)
const contactSchema = z.object({
	site_id: z.string().uuid({ message: "ID sede deve essere un UUID valido" }),
	name: z.string().min(1, { message: "Il nome del referente è obbligatorio" }),
	company: z.string().optional().nullable(),
	service_type: z
		.string()
		.min(1, { message: "Il tipo di lavoro/servizio è obbligatorio" }),
	phone: z.string().optional().nullable(),
	email: z
		.string()
		.email({ message: "Formato email non valido" })
		.optional()
		.or(z.literal(""))
		.nullable(),
	notes: z.string().optional().nullable(),
});

/**
 * GET /api/contacts/site/:site_id
 * Recupera la rubrica dei contatti di una specifica sede tramite Postgres SQL
 */
router.get(
	"/site/:site_id",
	asyncHandler(async (req, res) => {
		const { site_id } = req.params;

		// Validazione UUID della sede
		const uuidValidation = z.string().uuid().safeParse(site_id);
		if (!uuidValidation.success) {
			throw new HttpError(400, "ID sede non valido (formato UUID richiesto)");
		}

		// Query SQL nativa ordinata alfabeticamente per tipo di servizio
		const result = await pool.query(
			`SELECT * FROM contacts 
             WHERE site_id = $1 
             ORDER BY service_type ASC`,
			[site_id],
		);

		res.json(result.rows);
	}),
);

/**
 * POST /api/contacts
 * Crea un nuovo contatto in rubrica associato a una sede usando Postgres
 */
router.post(
	"/",
	asyncHandler(async (req, res) => {
		// Valido il body inviato dal frontend rispetto allo schema Zod
		const validation = contactSchema.safeParse(req.body);

		if (!validation.success) {
			const firstError =
				validation.error.errors[0]?.message || "Dati non validi";
			throw new HttpError(400, firstError);
		}

		const { site_id, name, company, service_type, phone, email, notes } =
			validation.data;

		try {
			// Query di inserimento con clausola RETURNING * per estrarre il record appena creato
			const result = await pool.query(
				`INSERT INTO contacts (site_id, name, company, service_type, phone, email, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
				[
					site_id,
					name,
					company || null,
					service_type,
					phone || null,
					email || null,
					notes || null,
				],
			);

			res.status(201).json(result.rows[0]);
		} catch (dbError: any) {
			throw new HttpError(
				500,
				`Errore salvataggio DB Postgres: ${dbError.message}`,
			);
		}
	}),
);

/**
 * PUT /api/contacts/:id
 * Aggiorna un contatto esistente in rubrica tramite Postgres SQL
 */
router.put(
	"/:id",
	asyncHandler(async (req, res) => {
		const { id } = req.params;

		// Valida l'ID del contatto passato nell'URL
		const idValidation = z.string().uuid().safeParse(id);
		if (!idValidation.success) {
			throw new HttpError(
				400,
				"ID contatto non valido (formato UUID richiesto)",
			);
		}

		// Valida i campi modificati inviati nel body rispetto allo schema
		const validation = contactSchema.safeParse(req.body);
		if (!validation.success) {
			const firstError =
				validation.error.errors[0]?.message || "Dati non validi";
			throw new HttpError(400, firstError);
		}

		const { name, company, service_type, phone, email, notes } =
			validation.data;

		try {
			// Query di aggiornamento parametrizzata su ID specifico
			const result = await pool.query(
				`UPDATE contacts 
                 SET name = $2, company = $3, service_type = $4, phone = $5, email = $6, notes = $7
                 WHERE id = $1
                 RETURNING *`,
				[
					id,
					name,
					company || null,
					service_type,
					phone || null,
					email || null,
					notes || null,
				],
			);

			// Se l'array rows è vuoto significa che l'ID passato non corrisponde a nessun contatto esistente
			if (result.rows.length === 0) {
				throw new HttpError(404, "Contatto non trovato");
			}

			res.json(result.rows[0]);
		} catch (dbError: any) {
			if (dbError instanceof HttpError) throw dbError;
			throw new HttpError(
				500,
				`Errore aggiornamento DB Postgres: ${dbError.message}`,
			);
		}
	}),
);

/**
 * DELETE /api/contacts/:id
 * Elimina un contatto dalla rubrica
 */
router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		const { id } = req.params;

		// Valida l'ID del contatto
		const idValidation = z.string().uuid().safeParse(id);
		if (!idValidation.success) {
			throw new HttpError(
				400,
				"ID contatto non valido (formato UUID richiesto)",
			);
		}

		try {
			// Esegue la cancellazione nativa
			await pool.query("DELETE FROM contacts WHERE id = $1", [id]);
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
