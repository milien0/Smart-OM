export type UserRole = 'admin' | 'technician' | 'viewer';
export type Severity = 'info' | 'warning' | 'critical';
export type MeasurementType = 'distance' | 'height' | 'area' | 'coordinate';

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Site {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface Model {
  id: string;
  site_id: string;
  name: string;
  file_path: string | null;
  format: string | null;
  default_camera: { position: Point; target: Point } | null;
  created_at: string;
}

export interface Poi {
  id: string;
  model_id: string;
  position: Point;
  title: string;
  description: string | null;
  severity: Severity;
  created_by: string | null;
  created_at: string;
}

export interface Measurement {
  id: string;
  model_id: string;
  type: MeasurementType;
  points: Point[];
  result: number | null;
  unit: string | null;
  label: string | null;
  created_by: string | null;
  created_at: string;
}
