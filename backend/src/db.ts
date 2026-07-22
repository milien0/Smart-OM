import { Pool } from "pg";
import { env } from "./env"; // Manteniamo il tuo import pulito

// Creazione del Pool di connessioni a PostgreSQL nativo
export const pool = new Pool({
	connectionString: env.databaseUrl,
	// Opzioni ottimali per un ambiente di produzione locale/on-premise:
	max: 20, // Massimo 20 connessioni simultanee nel pool
	idleTimeoutMillis: 30000, // Chiude le connessioni inattive dopo 30 secondi
	connectionTimeoutMillis: 2000, // Va in timeout se il DB non risponde entro 2 secondi
});

// Test della connessione immediato all'avvio del server
pool.query("SELECT NOW()", (err, res) => {
	if (err) {
		console.error(
			"❌ Errore critico di connessione a PostgreSQL:",
			err.message,
		);
	} else {
		console.log(
			"✅ Connessione a PostgreSQL stabilita con successo (Pool attivo).",
		);
	}
});
