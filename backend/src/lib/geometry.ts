import { MeasurementType, Point } from '../types';

function distance3D(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Lunghezza cumulativa del percorso (somma dei segmenti consecutivi).
function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance3D(points[i - 1], points[i]);
  }
  return total;
}

// Perimetro di un poligono chiuso (ultimo punto -> primo).
function polygonPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;
  return pathLength(points) + distance3D(points[points.length - 1], points[0]);
}

// Area di un poligono planare nello spazio 3D — metodo di Newell.
// Funziona anche se il poligono non giace su un piano assi-allineato.
function polygonArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const cur = points[i];
    const nxt = points[(i + 1) % n];
    nx += (cur.y - nxt.y) * (cur.z + nxt.z);
    ny += (cur.z - nxt.z) * (cur.x + nxt.x);
    nz += (cur.x - nxt.x) * (cur.y + nxt.y);
  }
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

export interface MeasurementResult {
  result: number | null;
  unit: string | null;
  // info extra (es. perimetro per le aree); non salvato in colonna, ritornato per comodità
  meta?: Record<string, number>;
}

/**
 * Calcola il risultato di una misura a partire dal tipo e dai punti.
 * Il client invia solo type + points; il server è l'unica fonte di verità sul valore.
 */
export function computeMeasurement(type: MeasurementType, points: Point[]): MeasurementResult {
  switch (type) {
    case 'distance':
      return { result: pathLength(points), unit: 'm' };
    case 'height': {
      const dy = Math.abs(points[points.length - 1].y - points[0].y);
      return { result: dy, unit: 'm' };
    }
    case 'area':
      return {
        result: polygonArea(points),
        unit: 'm²',
        meta: { perimeter: polygonPerimeter(points) },
      };
    case 'coordinate':
      return { result: null, unit: null };
    default:
      return { result: null, unit: null };
  }
}

// Numero minimo di punti richiesto per ciascun tipo di misura.
export function minPointsFor(type: MeasurementType): number {
  switch (type) {
    case 'distance':
      return 2;
    case 'height':
      return 2;
    case 'area':
      return 3;
    case 'coordinate':
      return 1;
    default:
      return 1;
  }
}
