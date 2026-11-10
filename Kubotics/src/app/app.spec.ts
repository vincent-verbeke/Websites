import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app';

// Repaired 2026-11-10: this scaffold spec still imported a non-existent `App`
// export and asserted the "Hello, Kubotics" template of an earlier scaffold, so
// `ng test` failed to even BUILD (which blocked every other spec). It now covers
// what the root component actually is: the shell (header + outlet), created
// without rendering the three.js intro cube.
describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('creates the shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('injects the router-driven shell state', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(typeof fixture.componentInstance.onIntroDone).toBe('function');
  });
});
