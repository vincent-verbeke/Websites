import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgxParticlesModule } from "@tsparticles/angular";
import { loadSlim } from "@tsparticles/slim";
// Note: @tsparticles/engine is the new core package in v3+.

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [NgxParticlesModule],
  templateUrl: './hero.html',
  styleUrl: './hero.scss',
})
export class Hero implements OnInit {
  id = "tsparticles";
  particlesUrl = "";

  particlesOptions: any = {
    background: {
      color: {
        value: "#000000", // Black background
      },
    },
    fpsLimit: 120,
    interactivity: {
      events: {
        onClick: {
          enable: true,
          mode: "push",
        },
        onHover: {
          enable: true,
          mode: "grab", // connected lines to mouse
        },
        resize: { enable: true },
      },
      modes: {
        push: {
          quantity: 4,
        },
        grab: {
          distance: 140,
          links: {
            opacity: 1
          }
        },
      },
    },
    particles: {
      color: {
        value: "#cccccc", // Light Grey particles
      },
      links: {
        color: "#cccccc", // Light Grey links
        distance: 150,
        enable: true,
        opacity: 0.5,
        width: 1,
      },
      move: {
        direction: "none",
        enable: true,
        outModes: {
          default: "bounce",
        },
        random: false,
        speed: 2,
        straight: false,
      },
      number: {
        density: {
          enable: true,
        },
        value: 80,
      },
      opacity: {
        value: 0.5,
      },
      shape: {
        type: "circle",
      },
      size: {
        value: { min: 1, max: 5 },
      },
    },
    detectRetina: true,
  };

  constructor(private router: Router) { }

  ngOnInit(): void {
    console.log('HeroComponent initialized');
  }

  particlesLoaded = async (container: any): Promise<void> => {
    console.log(container);
  };

  particlesInit = async (engine: any): Promise<void> => {
    await loadSlim(engine);
  };

  scrollToServices(): void {
    this.router.navigate(['/home']);
  }
}
