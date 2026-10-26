import * as THREE from 'three';
import { SceneManager } from './scene-manager';

export class WebGLRenderer {
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private sceneManager!: SceneManager;
  private canvas!: HTMLCanvasElement;
  private frameId: number | null = null;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.init(container);
  }

  private init(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    this.sceneManager = new SceneManager(this.renderer, this.camera);
    
    window.addEventListener('resize', this.onResize.bind(this));
    this.start();
  }

  private onResize() {
    const width = this.canvas.parentElement?.clientWidth || window.innerWidth;
    const height = this.canvas.parentElement?.clientHeight || window.innerHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private start() {
    const loop = () => {
      const delta = this.clock.getDelta();
      this.update(delta);
      this.render();
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private update(delta: number) {
    this.sceneManager.update(delta);
  }

  private render() {
    this.sceneManager.render();
  }

  async scramble() {
    await this.sceneManager.getCube().scramble();
  }

  async solve() {
    await this.sceneManager.getCube().solve();
  }

  explode() {
    this.sceneManager.getCube().explode();
  }

  dispose() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.sceneManager.dispose();
  }
}
