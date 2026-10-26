import * as THREE from 'three';
import { Cubie } from './cubie';
import { CubeLogic, MoveAxis } from '../logic/cube-state';
import { RubiksSolver } from '../logic/solver';

export class RubiksCube {
  mesh = new THREE.Group();
  private cubies: Cubie[] = [];
  private logic = new CubeLogic();
  private isRotating = false;
  private rotationGroup = new THREE.Group();

  constructor() {
    this.init();
    this.mesh.add(this.rotationGroup);
  }

  private init() {
    this.logic.cubies.forEach(state => {
      const cubie = new Cubie(state.originalPos, state.colors);
      this.cubies.push(cubie);
      this.mesh.add(cubie.mesh);
    });
  }

  /**
   * Animates a slice rotation.
   */
  async rotate(axis: MoveAxis, slice: number, direction: 1 | -1) {
    if (this.isRotating) return;
    this.isRotating = true;

    const angle = (Math.PI / 2) * direction;
    const rotationAxis = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0
    );

    // Find cubies in this slice using local positions relative to the cube group
    const sliceCubies = this.cubies.filter(c => {
      const pos = c.mesh.position[axis];
      return Math.abs(pos - slice) < 0.1;
    });

    // Move cubies to the temporary rotation group using attach()
    // attach() handles the coordinate transformations automatically
    sliceCubies.forEach(c => this.rotationGroup.attach(c.mesh));

    return new Promise<void>(resolve => {
        const duration = 300;
        const start = performance.now();
        
        const animate = (time: number) => {
            const elapsed = time - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = this.easeInOutCubic(progress);
            
            this.rotationGroup.setRotationFromAxisAngle(rotationAxis, angle * eased);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Finalize logic state
                this.logic.rotateSlice(axis, slice, angle);
                
                // Move cubies back to the main mesh group using attach()
                sliceCubies.forEach(c => {
                    this.mesh.attach(c.mesh);
                    
                    // Perfect Snap Position: Round to nearest integer coordinates
                    c.mesh.position.x = Math.round(c.mesh.position.x);
                    c.mesh.position.y = Math.round(c.mesh.position.y);
                    c.mesh.position.z = Math.round(c.mesh.position.z);
                    
                    // Perfect Snap Rotation: Normalize quaternion and snap to nearest axis
                    // We can also snap to the nearest 90-degree orientation
                    // by converting to euler, rounding to multiples of half-PI, and back to quaternion
                    const euler = new THREE.Euler().setFromQuaternion(c.mesh.quaternion);
                    euler.x = Math.round(euler.x / (Math.PI / 2)) * (Math.PI / 2);
                    euler.y = Math.round(euler.y / (Math.PI / 2)) * (Math.PI / 2);
                    euler.z = Math.round(euler.z / (Math.PI / 2)) * (Math.PI / 2);
                    c.mesh.quaternion.setFromEuler(euler);
                });
                
                // Reset rotation group for next move
                this.rotationGroup.rotation.set(0, 0, 0);
                this.rotationGroup.quaternion.set(0, 0, 0, 1);
                this.isRotating = false;
                resolve();
            }
        };
        requestAnimationFrame(animate);
    });
  }

  private easeInOutCubic(x: number): number {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  private solver = new RubiksSolver();

  async scramble(steps = 20) {
    const sequence = this.solver.generateScramble(steps);
    for (const move of sequence) {
        await this.rotate(move.axis, move.slice, move.direction);
    }
  }

  async solve() {
    const sequence = this.solver.getSolveSequence();
    for (const move of sequence) {
        await this.rotate(move.axis, move.slice, move.direction);
    }
  }

  explode() {
    this.isRotating = true; // Block other moves
    this.cubies.forEach((c, i) => {
        const direction = c.mesh.position.clone().normalize();
        const velocity = direction.multiplyScalar(0.2 + Math.random() * 0.3);
        
        // Simple animation loop for each cubie
        const start = performance.now();
        const animate = (time: number) => {
            const elapsed = time - start;
            if (elapsed < 1500) {
                c.mesh.position.add(velocity);
                c.mesh.rotation.x += 0.1;
                c.mesh.rotation.y += 0.1;
                c.mesh.scale.multiplyScalar(0.95);
                requestAnimationFrame(animate);
            } else {
                c.mesh.visible = false;
            }
        };
        requestAnimationFrame(animate);
    });
  }

  update(delta: number) {
    // Global cube drift if not rotating
    if (!this.isRotating) {
        this.mesh.rotation.y += delta * 0.2;
        this.mesh.rotation.x += delta * 0.1;
    }
  }

  dispose() {
    this.cubies.forEach(c => c.dispose());
  }
}
