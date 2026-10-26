import * as THREE from 'three';
import { RubiksCube } from '../objects/rubiks-cube';

export class SceneManager {
  private scene = new THREE.Scene();
  private cube!: RubiksCube;

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.Camera) {
    this.init();
  }

  private init() {
    // Background (minimal or particles)
    this.scene.background = null; // Transparent for Angular overlay if needed

    // Lighting System
    this.setupLights();

    // Cube
    this.cube = new RubiksCube();
    this.scene.add(this.cube.mesh);

    // Particles
    this.initParticles();
  }

  private particles!: THREE.Points;
  private particlePositions!: Float32Array;

  private initParticles() {
    const isMobile = window.innerWidth < 768;
    const count = isMobile ? 150 : 500;
    const geometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        this.particlePositions[i * 3] = (Math.random() - 0.5) * 20;
        this.particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 20;
        this.particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    
    const material = new THREE.PointsMaterial({
        color: 0x0071e3,
        size: 0.05,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  private setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    keyLight.position.set(5, 5, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x0071e3, 0.5);
    fillLight.position.set(-5, 2, 5);
    this.scene.add(fillLight);

    const rimLight = new THREE.SpotLight(0xffffff, 1);
    rimLight.position.set(0, 10, -10);
    this.scene.add(rimLight);
  }

  getCube() {
    return this.cube;
  }

  update(delta: number) {
    this.cube.update(delta);
    
    // Animate particles
    const positions = this.particles.geometry.attributes['position'].array as Float32Array;
    for (let i = 0; i < positions.length / 3; i++) {
        positions[i * 3 + 1] -= delta * 0.5; // Drift down
        if (positions[i * 3 + 1] < -10) positions[i * 3 + 1] = 10;
    }
    this.particles.geometry.attributes['position'].needsUpdate = true;
    this.particles.rotation.y += delta * 0.05;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.cube.dispose();
  }
}
