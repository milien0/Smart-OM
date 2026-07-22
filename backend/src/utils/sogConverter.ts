import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { HttpError } from "../middleware/error";

/**
 * Decoder SOG (Self-Organizing Gaussians di PlayCanvas) → PLY binario.
 *
 * Il formato SOG è una cartella con un meta.json + immagini .webp che
 * impacchettano gli attributi per-gaussiana come texture quantizzate. Non
 * esiste un convertitore CLI utilizzabile sulle piattaforme target (Windows
 * dev + Alpine/musl prod: `@playcanvas/splat-transform` dipende dal binario
 * nativo `webgpu`/Dawn non distribuito per esse), quindi decodifichiamo qui.
 *
 * Le formule di dequantizzazione replicano fedelmente il reader V2 di
 * riferimento di splat-transform (`readSogSourceV2`): i valori delle colonne
 * decodificate SONO lo schema PLY (x,y,z / f_dc / opacity / scale / rot),
 * perciò la scrittura PLY è un dump diretto senza re-encoding rischioso.
 *
 * Output: PLY binario "degree 0" (senza coefficienti SH di ordine superiore
 * f_rest), coerente col comportamento attuale del viewer (che forzava il
 * formato .splat, privo anch'esso di SH) e molto più leggero.
 */

const SOG_ARCHIVE_EXTENSIONS = new Set([".sog", ".zip"]);

/** Un singolo file caricato (nome + contenuto), per l'upload della cartella SOG. */
export interface UploadedFile {
	name: string;
	buffer: Buffer;
}

/** True se il file caricato è un archivio SOG single-file (.sog/.zip). */
export function isSogArchive(originalName: string): boolean {
	const ext = path.extname(originalName).toLowerCase();
	return SOG_ARCHIVE_EXTENSIONS.has(ext);
}

/** True se l'insieme dei file caricati è una cartella SOG (contiene meta.json). */
export function isSogFolder(files: UploadedFile[]): boolean {
	return files.some((f) => path.basename(f.name).toLowerCase() === "meta.json");
}

// --- Helper di dequantizzazione (identici alla reference splat-transform V2) ---

// Inversa di logTransform(x) = sign(x) * ln(|x| + 1)
const invLogTransform = (v: number): number => {
	const e = Math.exp(Math.abs(v)) - 1;
	return v < 0 ? -e : e;
};

// Inversa della sigmoide: dall'alpha [0..1] al logit memorizzato nel PLY
const sigmoidInv = (y: number): number => {
	const e = Math.min(1 - 1e-6, Math.max(1e-6, y));
	return Math.log(e / (1 - e));
};

const SQRT2 = Math.sqrt(2);
// Ordine delle 3 componenti "piccole" per ciascuna componente massima
const QUAT_IDX = [1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];

/**
 * Decodifica un quaternione "smallest-three" impacchettato in 3 byte + tag.
 * Scrive in `out` come [w, x, y, z]. Il tag (252-255) indica la componente
 * massima ricostruita per rendere il quaternione unitario e positivo.
 */
function unpackQuat(
	px: number,
	py: number,
	pz: number,
	tag: number,
	out: Float32Array,
): void {
	const maxComp = tag - 252;
	const a = ((px / 255) * 2 - 1) / SQRT2;
	const b = ((py / 255) * 2 - 1) / SQRT2;
	const c = ((pz / 255) * 2 - 1) / SQRT2;
	out[0] = 0;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	const base = maxComp * 3;
	out[QUAT_IDX[base]] = a;
	out[QUAT_IDX[base + 1]] = b;
	out[QUAT_IDX[base + 2]] = c;
	const t = 1 - (a * a + b * b + c * c);
	out[maxComp] = Math.sqrt(Math.max(0, t));
}

/** Decodifica un buffer WebP (lossless) in RGBA grezzo via sharp. */
async function decodeWebpRGBA(
	buf: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
	const { data, info } = await sharp(buf)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

// Cerca ricorsivamente il primo file meta.json in una directory.
function findMetaJson(dir: string): string | null {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isFile() && entry.name.toLowerCase() === "meta.json") {
			return path.join(dir, entry.name);
		}
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			const found = findMetaJson(path.join(dir, entry.name));
			if (found) return found;
		}
	}
	return null;
}

// Ordine canonico delle proprietà PLY (3DGS INRIA, degree 0). Le normali
// nx/ny/nz sono sempre 0 ma incluse per compatibilità coi parser standard.
const PLY_FLOATS_PER_VERTEX = 17;
const PLY_HEADER_PROPS = [
	"x",
	"y",
	"z",
	"nx",
	"ny",
	"nz",
	"f_dc_0",
	"f_dc_1",
	"f_dc_2",
	"opacity",
	"scale_0",
	"scale_1",
	"scale_2",
	"rot_0",
	"rot_1",
	"rot_2",
	"rot_3",
];

/**
 * Decodifica una scena SOG v2 (già estratta su disco) e scrive un PLY binario
 * little-endian in `destPath`, scrivendo a blocchi per non tenere in RAM
 * l'intera scena espansa.
 */
async function decodeSogV2ToPly(
	metaJsonPath: string,
	meta: any,
	destPath: string,
): Promise<void> {
	const baseDir = path.dirname(metaJsonPath);
	const count: number = meta.count;

	const loadTexture = async (name: string) => {
		const filePath = path.join(baseDir, name);
		if (!fs.existsSync(filePath)) {
			throw new HttpError(
				400,
				`Texture SOG mancante nell'archivio: ${name}`,
			);
		}
		return decodeWebpRGBA(fs.readFileSync(filePath));
	};

	// means: due texture (byte basso + byte alto) → lerp 16-bit fra mins/maxs
	// delle posizioni log-trasformate.
	const meansLo = await loadTexture(meta.means.files[0]);
	const meansHi = await loadTexture(meta.means.files[1]);
	const lo = meansLo.data;
	const hi = meansHi.data;
	if (meansLo.width * meansLo.height < count) {
		throw new HttpError(422, "Texture means SOG troppo piccola per il count.");
	}
	const mins = meta.means.mins;
	const maxs = meta.means.maxs;
	const xMin = mins[0],
		xScale = maxs[0] - mins[0] || 1;
	const yMin = mins[1],
		yScale = maxs[1] - mins[1] || 1;
	const zMin = mins[2],
		zScale = maxs[2] - mins[2] || 1;

	// quats: 4 byte/splat, l'alpha è il tag della componente massima (252-255)
	const quats = await loadTexture(meta.quats.files[0]);
	const qr = quats.data;
	if (quats.width * quats.height < count) {
		throw new HttpError(422, "Texture quats SOG troppo piccola per il count.");
	}

	// scales: 3 byte indicizzano un codebook condiviso di 256 valori (log-scala)
	const scales = await loadTexture(meta.scales.files[0]);
	const sl = scales.data;
	if (scales.width * scales.height < count) {
		throw new HttpError(422, "Texture scales SOG troppo piccola per il count.");
	}
	const sCode: number[] = meta.scales.codebook;

	// sh0: 3 byte colore indicizzano il codebook; il 4° byte è l'opacità (alpha)
	const sh0 = await loadTexture(meta.sh0.files[0]);
	const c0 = sh0.data;
	if (sh0.width * sh0.height < count) {
		throw new HttpError(422, "Texture sh0 SOG troppo piccola per il count.");
	}
	const cCode: number[] = meta.sh0.codebook;

	// --- Scrittura PLY binario a blocchi ---
	const header =
		`ply\n` +
		`format binary_little_endian 1.0\n` +
		`comment converted from SOG v2 by Smart O&M backend\n` +
		`element vertex ${count}\n` +
		PLY_HEADER_PROPS.map((p) => `property float ${p}`).join("\n") +
		`\nend_header\n`;

	const out = fs.createWriteStream(destPath);
	const writeAsync = (chunk: Buffer): Promise<void> =>
		new Promise((resolve, reject) => {
			out.write(chunk, (err) => (err ? reject(err) : resolve()));
		});

	try {
		await writeAsync(Buffer.from(header, "ascii"));

		const BATCH = 50_000;
		const batch = new Float32Array(BATCH * PLY_FLOATS_PER_VERTEX);
		const quat = new Float32Array(4);
		let inBatch = 0;

		const flush = async () => {
			if (inBatch === 0) return;
			// Copia del solo tratto valido del batch (LE su tutte le piattaforme
			// target x64/arm64); copiamo perché il batch verrà riusato subito.
			const bytes = Buffer.from(
				batch.buffer.slice(0, inBatch * PLY_FLOATS_PER_VERTEX * 4),
			);
			await writeAsync(bytes);
			inBatch = 0;
		};

		for (let i = 0; i < count; i++) {
			const o4 = i * 4;

			// posizione (16-bit lo|hi per canale)
			const xv = lo[o4] | (hi[o4] << 8);
			const yv = lo[o4 + 1] | (hi[o4 + 1] << 8);
			const zv = lo[o4 + 2] | (hi[o4 + 2] << 8);

			// rotazione
			const tag = qr[o4 + 3];
			if (tag < 252 || tag > 255) {
				quat[0] = 1;
				quat[1] = 0;
				quat[2] = 0;
				quat[3] = 0;
			} else {
				unpackQuat(qr[o4], qr[o4 + 1], qr[o4 + 2], tag, quat);
			}

			const b = inBatch * PLY_FLOATS_PER_VERTEX;
			batch[b] = invLogTransform(xMin + xScale * (xv / 65535));
			batch[b + 1] = invLogTransform(yMin + yScale * (yv / 65535));
			batch[b + 2] = invLogTransform(zMin + zScale * (zv / 65535));
			batch[b + 3] = 0; // nx
			batch[b + 4] = 0; // ny
			batch[b + 5] = 0; // nz
			batch[b + 6] = cCode[c0[o4]]; // f_dc_0
			batch[b + 7] = cCode[c0[o4 + 1]]; // f_dc_1
			batch[b + 8] = cCode[c0[o4 + 2]]; // f_dc_2
			batch[b + 9] = sigmoidInv(c0[o4 + 3] / 255); // opacity (logit)
			batch[b + 10] = sCode[sl[o4]]; // scale_0 (log)
			batch[b + 11] = sCode[sl[o4 + 1]]; // scale_1
			batch[b + 12] = sCode[sl[o4 + 2]]; // scale_2
			batch[b + 13] = quat[0]; // rot_0 (w)
			batch[b + 14] = quat[1]; // rot_1 (x)
			batch[b + 15] = quat[2]; // rot_2 (y)
			batch[b + 16] = quat[3]; // rot_3 (z)

			inBatch++;
			if (inBatch === BATCH) await flush();
		}
		await flush();

		await new Promise<void>((resolve, reject) => {
			out.end((err?: Error | null) => (err ? reject(err) : resolve()));
		});
	} catch (err) {
		out.destroy();
		throw err;
	}
}

/**
 * Core condiviso: dato un workDir contenente meta.json + le texture .webp
 * (già scritti su disco), trova/valida il meta.json e scrive il PLY.
 */
async function decodeSogWorkDir(
	workDir: string,
	destPath: string,
): Promise<void> {
	const metaJsonPath = findMetaJson(workDir);
	if (!metaJsonPath) {
		throw new HttpError(
			400,
			"meta.json non trovato tra i file SOG caricati. Seleziona l'intera cartella (meta.json + immagini .webp).",
		);
	}

	let meta: any;
	try {
		meta = JSON.parse(fs.readFileSync(metaJsonPath, "utf8"));
	} catch (e) {
		throw new HttpError(400, "Il meta.json del SOG non è un JSON valido.");
	}

	if (meta.version !== 2) {
		throw new HttpError(
			422,
			`Versione SOG non supportata: ${meta.version ?? "V1/legacy"}. È supportato solo il formato SOG v2.`,
		);
	}
	if (!meta.count || !meta.means || !meta.quats || !meta.scales || !meta.sh0) {
		throw new HttpError(422, "meta.json SOG incompleto o malformato.");
	}

	try {
		await decodeSogV2ToPly(metaJsonPath, meta, destPath);
	} catch (e) {
		try {
			if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
		} catch {
			/* ignore */
		}
		if (e instanceof HttpError) throw e;
		console.error("[SOG] Decodifica fallita:", e);
		throw new HttpError(
			422,
			"Conversione del file SOG fallita. Il file potrebbe essere corrotto o in un formato SOG non supportato.",
		);
	}

	if (!fs.existsSync(destPath)) {
		throw new HttpError(500, "La conversione SOG non ha prodotto alcun output.");
	}
}

/**
 * Converte una cartella SOG caricata come insieme di file (meta.json + .webp)
 * in un PLY binario, senza richiedere all'utente di zippare nulla.
 *
 * @param files    File caricati (nome + buffer). Gli entry vengono scritti in
 *                 una cartella temporanea usando il loro basename, così il
 *                 meta.json ritrova le texture come file fratelli.
 * @param destPath Path finale del PLY (deve terminare con `.ply`).
 */
export async function convertSogFolderToPly(
	files: UploadedFile[],
	destPath: string,
): Promise<{ outputPath: string }> {
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sog-convert-"));
	try {
		for (const f of files) {
			// Solo il basename: meta.json referenzia le texture per nome semplice,
			// e questo neutralizza eventuali prefissi di path o tentativi di
			// path-traversal presenti in webkitRelativePath.
			const safeName = path.basename(f.name);
			if (!safeName || safeName === "." || safeName === "..") continue;
			fs.writeFileSync(path.join(workDir, safeName), f.buffer);
		}
		await decodeSogWorkDir(workDir, destPath);
		return { outputPath: destPath };
	} finally {
		try {
			fs.rmSync(workDir, { recursive: true, force: true });
		} catch (cleanupErr) {
			console.warn("[SOG] Impossibile ripulire la cartella temporanea:", cleanupErr);
		}
	}
}

/**
 * Converte un archivio SOG single-file (.sog/.zip) in un PLY binario.
 * (Percorso alternativo all'upload cartella, per chi carica un bundle zippato.)
 *
 * @param uploadBuffer Buffer del file .sog/.zip caricato.
 * @param destPath     Path finale del PLY (deve terminare con `.ply`).
 */
export async function convertSogArchiveToPly(
	uploadBuffer: Buffer,
	destPath: string,
): Promise<{ outputPath: string }> {
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sog-convert-"));
	try {
		let zip: AdmZip;
		try {
			zip = new AdmZip(uploadBuffer);
			zip.extractAllTo(workDir, /* overwrite */ true);
		} catch (e) {
			throw new HttpError(
				400,
				"L'archivio SOG non è un file zip valido.",
			);
		}
		await decodeSogWorkDir(workDir, destPath);
		return { outputPath: destPath };
	} finally {
		try {
			fs.rmSync(workDir, { recursive: true, force: true });
		} catch (cleanupErr) {
			console.warn("[SOG] Impossibile ripulire la cartella temporanea:", cleanupErr);
		}
	}
}
