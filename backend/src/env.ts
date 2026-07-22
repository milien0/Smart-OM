require("dotenv").config();

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`Variabile d'ambiente mancante: ${name}. Controlla il file .env`,
		);
	}
	return value;
}

export const env = {
	databaseUrl: required("DATABASE_URL"),
	port: Number(process.env.PORT ?? 4000),
};
