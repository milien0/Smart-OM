// routes/tickets.ts
import { Router } from "express";
import { pool } from "../db";
import { asyncHandler, HttpError } from "../middleware/error";

const router = Router();

/**
 * GET /api/tickets/site/:siteId
 * Recupera tutti i ticket di una specifica sede, ordinati dal più recente
 */
router.get(
    "/site/:siteId",
    asyncHandler(async (req, res) => {
        const { siteId } = req.params;

        const queryText = `
            SELECT id, site_id, poi_id, contact_id, title, description, status, priority, created_at, updated_at
            FROM tickets
            WHERE site_id = $1
            ORDER BY created_at DESC
        `;

        const result = await pool.query(queryText, [siteId]);

        res.json(result.rows);
    }),
);

/**
 * GET /api/tickets/:id
 * Recupera i dettagli di un singolo ticket tramite il suo ID
 */
router.get(
    "/:id",
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        const queryText = `
            SELECT id, site_id, poi_id, contact_id, title, description, status, priority, created_at, updated_at
            FROM tickets
            WHERE id = $1
        `;

        const result = await pool.query(queryText, [id]);

        if (result.rows.length === 0) {
            throw new HttpError(404, "Ticket non trovato nel database");
        }

        res.json(result.rows[0]);
    }),
);

/**
 * POST /api/tickets
 * Crea un nuovo ticket di manutenzione per una sede
 */
router.post(
    "/",
    asyncHandler(async (req, res) => {
        // Aggiunto contact_id al destructuring
        const { site_id, poi_id, contact_id, title, description, priority } = req.body;

        // Validazione minima dei dati obbligatori
        if (!site_id || !title || !description) {
            throw new HttpError(
                400,
                "I campi site_id, title e description sono obbligatori",
            );
        }

        // Imposta un valore di default per la priorità se non viene passata
        const ticketPriority = priority || "medium"; // LOW, MEDIUM, HIGH, CRITICAL

        const queryText = `
            INSERT INTO tickets (site_id, poi_id, contact_id, title, description, priority, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'open')
            RETURNING id, site_id, poi_id, contact_id, title, description, status, priority, created_at
        `;

        try {
            const result = await pool.query(queryText, [
                site_id,
                poi_id,
                contact_id, // Nuovo parametro $3
                title.trim(),
                description.trim(),
                ticketPriority,
            ]);

            res.status(201).json(result.rows[0]);
        } catch (dbError: any) {
            console.error("[Tickets Service] Errore creazione ticket:", dbError);
            throw new HttpError(
                500,
                `Errore durante il salvataggio del ticket: ${dbError.message}`,
            );
        }
    }),
);

/**
 * PUT /api/tickets/:id
 * Aggiorna lo stato, la priorità o i dettagli di un ticket esistente
 */
router.put(
    "/:id",
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        // Aggiunto contact_id ai possibili campi aggiornabili
        const { title, description, status, priority, contact_id } = req.body;

        // 1. Controlliamo se il ticket esiste prima di aggiornarlo
        const checkResult = await pool.query(
            "SELECT id FROM tickets WHERE id = $1",
            [id],
        );
        if (checkResult.rows.length === 0) {
            throw new HttpError(404, "Impossibile aggiornare: Ticket inesistente");
        }

        // 2. Costruiamo la query di aggiornamento parziale dinamica
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (title !== undefined) {
            fields.push(`title = $${paramIndex++}`);
            values.push(title.trim());
        }
        if (description !== undefined) {
            fields.push(`description = $${paramIndex++}`);
            values.push(description.trim());
        }
        if (status !== undefined) {
            fields.push(`status = $${paramIndex++}`);
            values.push(status);
        } 
        if (priority !== undefined) {
            fields.push(`priority = $${paramIndex++}`);
            values.push(priority);
        }
        // Nuova condizione per l'aggiornamento del contact_id
        if (contact_id !== undefined) {
            fields.push(`contact_id = $${paramIndex++}`);
            values.push(contact_id);
        }

        if (fields.length === 0) {
            throw new HttpError(
                400,
                "Nessun campo valido fornito per l'aggiornamento",
            );
        }

        // Aggiungiamo l'id come ultimo parametro per il WHERE
        values.push(id);
        const queryText = `
            UPDATE tickets
            SET ${fields.join(", ")}, updated_at = NOW()
            WHERE id = $${paramIndex}
            RETURNING id, site_id, poi_id, contact_id, title, description, status, priority, updated_at
        `;

        try {
            const result = await pool.query(queryText, values);
            res.json(result.rows[0]);
        } catch (dbError: any) {
            console.error("[Tickets Service] Errore aggiornamento ticket:", dbError);
            throw new HttpError(
                500,
                `Errore database aggiornamento ticket: ${dbError.message}`,
            );
        }
    }),
);

/**
 * DELETE /api/tickets/:id
 * Elimina definitivamente un ticket dal database
 */
router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await pool.query(
            "DELETE FROM tickets WHERE id = $1 RETURNING id",
            [id],
        );

        if (result.rows.length === 0) {
            throw new HttpError(404, "Ticket non trovato, impossibile eliminare");
        }

        res.json({ success: true, message: `Ticket ${id} eliminato con successo` });
    }),
);

export default router;