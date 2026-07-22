import express from "express";
import cors from "cors";
import { env } from "./env";
import { errorHandler } from "./middleware/error";

import sitesRouter from "./routes/sites";
import modelsRouter from "./routes/models";
import poisRouter from "./routes/pois";
import measurementsRouter from "./routes/measurements";
import ticketsRouter from "./routes/tickets";
import documentsRouter from "./routes/documents";
import contactsRouter from "./routes/contacts";
import photosRouter from "./routes/photos";
import subcategoriesRouter from "./routes/subcategories";

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Popola req.userId se arriva un JWT valido. Non blocca (vedi middleware/auth.ts).
// app.use(optionalAuth);

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true }));

// Rotte
app.use("/api/sites", sitesRouter);
app.use("/api/models", modelsRouter);
app.use("/api/pois", poisRouter);
app.use("/api/measurements", measurementsRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/photos", photosRouter);
app.use("/api/subcategories", subcategoriesRouter);

// Gestore errori (sempre per ultimo)
app.use(errorHandler);

app.listen(env.port, () => {
	console.log(`Smart O&M API in ascolto su http://localhost:${env.port}`);
});
