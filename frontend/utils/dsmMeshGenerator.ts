import * as THREE from "three";
import {
	computeBoundsTree,
	disposeBoundsTree,
	acceleratedRaycast,
} from "three-mesh-bvh";

// Attiva l'accelerazione BVH su Three.js per i calcoli del mouse ultraveloci
if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
	THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
	THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
	THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

export function createDSMMesh(
	floatCenters: Float32Array | null | undefined,
	matrixWorld: THREE.Matrix4,
	gridResolution: number = 256,
): { mesh: THREE.Mesh | null; error: string | null } {
	if (!floatCenters || floatCenters.length === 0)
		return { mesh: null, error: "floatCenters vuoto" };

	const step = 3;
	const vec = new THREE.Vector3();
	let minX = Infinity,
		minZ = Infinity;
	let maxX = -Infinity,
		maxZ = -Infinity;

	// 1. Trova i confini (Bounding Box)
	for (let i = 0; i < floatCenters.length; i += step) {
		vec.set(floatCenters[i], floatCenters[i + 1], floatCenters[i + 2]);
		vec.applyMatrix4(matrixWorld);
		if (vec.x < minX) minX = vec.x;
		if (vec.x > maxX) maxX = vec.x;
		if (vec.z < minZ) minZ = vec.z;
		if (vec.z > maxZ) maxZ = vec.z;
	}

	const marginX = (maxX - minX) * 0.05;
	const marginZ = (maxZ - minZ) * 0.05;
	minX -= marginX;
	maxX += marginX;
	minZ -= marginZ;
	maxZ += marginZ;

	const width = maxX - minX;
	const depth = maxZ - minZ;
	const cols = gridResolution;
	const rows = gridResolution;
	const grid = new Float32Array(cols * rows).fill(-Infinity);

	// 2. Popola la griglia con l'altezza (Y) massima di ogni cella
	for (let i = 0; i < floatCenters.length; i += step) {
		vec.set(floatCenters[i], floatCenters[i + 1], floatCenters[i + 2]);
		vec.applyMatrix4(matrixWorld);

		const nx = (vec.x - minX) / width;
		const nz = (vec.z - minZ) / depth;
		const col = Math.max(0, Math.min(cols - 1, Math.floor(nx * cols)));
		const row = Math.max(0, Math.min(rows - 1, Math.floor(nz * rows)));

		const idx = row * cols + col;
		if (vec.y > grid[idx]) grid[idx] = vec.y;
	}

	// 3. Tappa i buchi per creare una coperta liscia
	const smoothedGrid = new Float32Array(grid);
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const idx = r * cols + c;
			if (grid[idx] === -Infinity) {
				let maxFound = -Infinity;
				for (let dr = -2; dr <= 2; dr++) {
					for (let dc = -2; dc <= 2; dc++) {
						const nr = r + dr,
							nc = c + dc;
						if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
							const nIdx = nr * cols + nc;
							if (grid[nIdx] !== -Infinity && grid[nIdx] > maxFound)
								maxFound = grid[nIdx];
						}
					}
				}
				smoothedGrid[idx] = maxFound !== -Infinity ? maxFound : 0;
			}
		}
	}

	// 4. Crea la geometria 3D invisibile
	const customGeo = new THREE.BufferGeometry();
	const vertices = new Float32Array(cols * rows * 3);
	const indices = [];

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const idx = r * cols + c;
			const vIdx = idx * 3;
			vertices[vIdx] = minX + (c / (cols - 1)) * width;
			vertices[vIdx + 1] = smoothedGrid[idx];
			vertices[vIdx + 2] = minZ + (r / (rows - 1)) * depth;
		}
	}

	for (let r = 0; r < rows - 1; r++) {
		for (let c = 0; c < cols - 1; c++) {
			const a = r * cols + c;
			const b = r * cols + (c + 1);
			const c1 = (r + 1) * cols + c;
			const d = (r + 1) * cols + (c + 1);
			indices.push(a, c1, b, b, c1, d);
		}
	}

	customGeo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
	customGeo.setIndex(indices);
	customGeo.computeVertexNormals();
	customGeo.computeBoundsTree(); // Ottimizzazione calcoli

	// Materiale completamente invisibile
	const mat = new THREE.MeshBasicMaterial({
		transparent: true,
		opacity: 0.0,
		depthWrite: false,
		side: THREE.DoubleSide,
	});

	const dsmMesh = new THREE.Mesh(customGeo, mat);
	dsmMesh.name = "dsm-mesh";
	return { mesh: dsmMesh, error: null };
}
