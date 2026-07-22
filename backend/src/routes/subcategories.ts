import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { asyncHandler, HttpError } from "../middleware/error";

const router = Router();

const subcategoryInput = z.object({
	site_id: z.string().uuid(),
	category: z.string().min(1),
	name: z.string().min(1).max(100),
});

router.get(
	"/",
	asyncHandler(async (req, res) => {
		const { site_id } = req.query;
		if (!site_id || !z.string().uuid().safeParse(site_id).success) {
			throw new HttpError(400, "site_id UUID richiesto");
		}
		const result = await pool.query(
			"SELECT * FROM subcategories WHERE site_id = $1 ORDER BY category, name",
			[site_id],
		);
		res.json(result.rows);
	}),
);

router.post(
	"/",
	asyncHandler(async (req, res) => {
		const body = subcategoryInput.parse(req.body);
		const result = await pool.query(
			`INSERT INTO subcategories (site_id, category, name)
			 VALUES ($1, $2, $3) RETURNING *`,
			[body.site_id, body.category, body.name],
		);
		res.status(201).json(result.rows[0]);
	}),
);

router.delete(
	"/:id",
	asyncHandler(async (req, res) => {
		const { id } = req.params;
		if (!z.string().uuid().safeParse(id).success) {
			throw new HttpError(400, "ID non valido");
		}
		await pool.query("DELETE FROM subcategories WHERE id = $1", [id]);
		res.status(204).end();
	}),
);

export default router;
