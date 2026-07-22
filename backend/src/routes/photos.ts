import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db"; // Connessione PostgreSQL nativa locale (Pool)
import { asyncHandler, HttpError } from "../middleware/error";

const router = Router();

// Directory principale degli upload definita dall'ambiente Docker o fallback locale
const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

// Configurazione di Multer in memoria per gestire il flusso dei file
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // Limite multer a 15MB
});

const photoInput = z.object({
  site_id: z.string().uuid(),
  poi_id: z.string().uuid().optional().nullable().or(z.literal("")),
  caption: z.string().optional().nullable(),
});

// ==========================================
// 1. GET /api/photos — Recupero foto via SQL
// ==========================================
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { poi_id } = req.query;
    let result;

    try {
      if (poi_id) {
        if (
          typeof poi_id === "string" &&
          !z.string().uuid().safeParse(poi_id).success
        ) {
          throw new HttpError(
            400,
            "L'identificativo poi_id fornito non è un UUID valido"
          );
        }

        result = await pool.query(
          "SELECT * FROM poi_photos WHERE poi_id = $1 ORDER BY created_at DESC",
          [poi_id]
        );
      } else {
        result = await pool.query(
          "SELECT * FROM poi_photos ORDER BY created_at DESC"
        );
      }

      res.json(result.rows);
    } catch (error: any) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        `Errore nel recupero delle foto da database locale: ${error.message}`
      );
    }
  })
);

// ==========================================
// 2. GET /api/photos/stream — Streaming file da Docker
// ==========================================
router.get(
  "/stream",
  asyncHandler(async (req, res) => {
    const filePath = req.query.path as string;

    if (!filePath) {
      throw new HttpError(400, "Path dell'immagine mancante.");
    }

    // Risolviamo il percorso assoluto nel container
    const absolutePath = path.resolve(filePath);

    // DIAGNOSI 1: Verifica se il file esiste davvero dentro al container Docker
    if (!fs.existsSync(absolutePath)) {
      console.error(`[DOCKER STREAM ERROR] Il file NON esiste in questo percorso del container: ${absolutePath}`);
      throw new HttpError(404, "L'immagine non esiste fisicamente sul disco del container.");
    }

    // DIAGNOSI 2: IL COLPEVOLE PRINCIPALE (Helmet / Sicurezza del Browser)
    // Se nel tuo progetto usi il middleware 'helmet', i browser moderni bloccano il caricamento di immagini 
    // provenienti da porte diverse (es. il frontend è su localhost:3000 e il backend su localhost:4000).
    // Questo header sblocca il caricamento cross-origin dell'immagine.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    // Sfruttiamo res.sendFile nativo di Express: gestisce da solo i MIME-type (.png, .jpg, ecc.),
    // i pesi dei file (Content-Length) e le richieste parziali del browser.
    res.sendFile(absolutePath, (err) => {
      if (err) {
        console.error("[DOCKER STREAM ERROR] Errore durante l'invio del file tramite res.sendFile:", err);
        if (!res.headersSent) {
          res.status(500).send("Errore nel caricamento del file.");
        }
      }
    });
  })
);
// ==========================================
// 3. POST /api/photos — Caricamento foto su disco e DB
// ==========================================
router.post(
  "/",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    // Validazione dei dati con Zod
    const parsed = photoInput.parse(req.body);
    const file = req.file;

    if (!file) throw new HttpError(400, "Immagine mancante.");

    // Organizzazione strutturale delle directory locali basandoci su site_id e poi_id
    const relativeFolder =
      parsed.poi_id && parsed.poi_id !== ""
        ? path.join("photos", "pois", parsed.poi_id)
        : path.join("photos", "general");

    // Percorso assoluto completo della directory in cui salvare l'immagine
    const targetDirectoryPath = path.join(
      UPLOADS_DIR,
      parsed.site_id,
      relativeFolder
    );

    // Ci assicuriamo che l'albero di cartelle esista sul server
    if (!fs.existsSync(targetDirectoryPath)) {
      fs.mkdirSync(targetDirectoryPath, { recursive: true });
    }

    const fileExtension = file.originalname.split(".").pop();
    const uniqueFileName = `photo-${Date.now()}.${fileExtension}`;

    // Percorso assoluto finale del file sul disco rigido
    const fullStoragePath = path.join(targetDirectoryPath, uniqueFileName);

    // 1. SALVATAGGIO DELL'IMMAGINE BINARIA SU DISCO LOCALE
    try {
      fs.writeFileSync(fullStoragePath, file.buffer);
      console.log(
        `[Storage Locale] Foto salvata correttamente in: ${fullStoragePath}`
      );
    } catch (storageError: any) {
      console.error("Errore scrittura file immagine su disco:", storageError);
      throw new HttpError(
        500,
        `Errore di caricamento su Storage locale: ${storageError.message}`
      );
    }

    const targetPoiId =
      parsed.poi_id && parsed.poi_id !== "" ? parsed.poi_id : null;
    const caption = parsed.caption || null;

    // 2. INSERIMENTO DEI METADATI NEL DATABASE POSTGRES
    try {
      const dbResult = await pool.query(
        `INSERT INTO poi_photos (poi_id, file_path, caption)
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [targetPoiId, fullStoragePath, caption]
      );

      res.status(201).json(dbResult.rows[0]);
    } catch (dbError: any) {
      console.error(
        "Errore database durante il salvataggio dei metadati foto:",
        dbError
      );

      // LOGICA DI ROLLBACK
      if (fs.existsSync(fullStoragePath)) {
        fs.unlinkSync(fullStoragePath);
        console.log(
          `[Rollback Storage] File rimosso a causa del fallimento della query a DB: ${fullStoragePath}`
        );
      }

      throw new HttpError(
        500,
        `Errore nel salvataggio su database Postgres: ${dbError.message}`
      );
    }
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      if (!z.string().uuid().safeParse(id).success) {
        throw new HttpError(
          400,
          "L'identificativo id fornito non è un UUID valido"
        );
      }

      // Recupera il file_path prima di cancellare
      const photoResult = await pool.query(
        "SELECT file_path FROM poi_photos WHERE id = $1",
        [id]
      );

      if (photoResult.rows.length === 0) {
        throw new HttpError(404, "Foto non trovata");
      }

      const { file_path } = photoResult.rows[0];

      // Cancella dal database
      await pool.query("DELETE FROM poi_photos WHERE id = $1", [id]);

      // Cancella il file fisico
      const filePath = path.join(process.cwd(), file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      res.status(204).end();
    } catch (error: any) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        `Errore nella cancellazione della foto: ${error.message}`
      );
    }
  })
);
export default router;