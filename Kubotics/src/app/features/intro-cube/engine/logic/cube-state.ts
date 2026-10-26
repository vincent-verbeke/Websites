import * as THREE from 'three';

/**
 * Represents a single cubie in the 3x3x3 grid.
 */
export interface CubieState {
  originalPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  quaternion: THREE.Quaternion;
  colors: string[]; // [Front, Back, Right, Left, Top, Bottom]
}

export type MoveAxis = 'x' | 'y' | 'z';

export class CubeLogic {
  cubies: CubieState[] = [];
  private readonly size = 3;

  constructor() {
    this.init();
  }

  private init() {
    this.cubies = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue; // Center cubie doesn't exist technically or isn't visible
          
          this.cubies.push({
            originalPos: new THREE.Vector3(x, y, z),
            currentPos: new THREE.Vector3(x, y, z),
            quaternion: new THREE.Quaternion(),
            colors: this.getInitialColors(x, y, z)
          });
        }
      }
    }
  }

  private getInitialColors(x: number, y: number, z: number): string[] {
    // [Front (+z), Back (-z), Right (+x), Left (-x), Top (+y), Bottom (-y)]
    return [
      z === 1 ? '#e63946' : '#000000',
      z === -1 ? '#2a9d8f' : '#000000',
      x === 1 ? '#457b9d' : '#000000',
      x === -1 ? '#e9c46a' : '#000000',
      y === 1 ? '#f1faee' : '#000000',
      y === -1 ? '#f4a261' : '#000000'
    ];
  }

  /**
   * Rotates a slice of the cube.
   * axis: 'x', 'y' or 'z'
   * slice: -1, 0, or 1
   * amount: rotation in radians (usually PI/2 or -PI/2)
   */
  rotateSlice(axis: MoveAxis, slice: number, amount: number) {
    const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0
      ),
      amount
    );

    this.cubies.forEach(cubie => {
      const posValue = cubie.currentPos[axis];
      // Due to floating point precision, we use a small epsilon
      if (Math.abs(posValue - slice) < 0.1) {
        // Rotate position
        cubie.currentPos.applyQuaternion(rotationQuaternion);
        
        // Rotate orientation
        cubie.quaternion.multiplyQuaternions(rotationQuaternion, cubie.quaternion);
        
        // Snap to nearest integer positions
        cubie.currentPos.x = Math.round(cubie.currentPos.x);
        cubie.currentPos.y = Math.round(cubie.currentPos.y);
        cubie.currentPos.z = Math.round(cubie.currentPos.z);
      }
    });
  }

  reset() {
    this.init();
  }
}
