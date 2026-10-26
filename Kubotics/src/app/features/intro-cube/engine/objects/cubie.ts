import * as THREE from 'three';

export class Cubie {
  mesh: THREE.Group;
  private readonly size = 0.95; // Slightly smaller for spacing
  private materials: THREE.MeshStandardMaterial[] = [];

  constructor(public originalPos: THREE.Vector3, colors: string[]) {
    this.mesh = new THREE.Group();
    this.init(colors);
    this.mesh.position.copy(originalPos);
  }

  private init(colors: string[]) {
    // Front, Back, Right, Left, Top, Bottom
    const geometry = new THREE.BoxGeometry(this.size, this.size, this.size);
    
    // Create materials for each face
    // 0: Right (+x), 1: Left (-x), 2: Top (+y), 3: Bottom (-y), 4: Front (+z), 5: Back (-z)
    // Order in Three.js BoxGeometry: [PX, NX, PY, NY, PZ, NZ]
    
    // Mapping our colors [F, B, R, L, T, Bot] to Three.js [R, L, T, Bot, F, B]
    const mapping = [2, 3, 4, 5, 0, 1]; // R, L, T, Bot, F, B
    
    for (let i = 0; i < 6; i++) {
        const color = colors[mapping[i]];
        const material = new THREE.MeshStandardMaterial({
            color: color === '#000000' ? '#111111' : color,
            roughness: 0.1,
            metalness: 0.8,
            emissive: color === '#000000' ? '#000000' : color,
            emissiveIntensity: 0.05
        });
        this.materials.push(material);
    }

    const box = new THREE.Mesh(geometry, this.materials);
    this.mesh.add(box);

    // Add subtle edge glow (emissive wireframe or inner glow)
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x0071e3, transparent: true, opacity: 0.2 })
    );
    this.mesh.add(wireframe);
  }

  update(quaternion: THREE.Quaternion, position: THREE.Vector3) {
    this.mesh.quaternion.copy(quaternion);
    this.mesh.position.copy(position);
  }

  dispose() {
    this.mesh.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material[]).forEach(m => m.dispose());
      }
    });
  }
}
