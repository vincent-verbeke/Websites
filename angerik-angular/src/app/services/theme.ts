import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  isDarkMode = signal<boolean>(true);

  constructor() {
    effect(() => {
      const isDark = this.isDarkMode();
      if (isDark) {
        document.body.classList.remove('light-mode');
      } else {
        document.body.classList.add('light-mode');
      }
    });
  }

  toggleTheme() {
    this.isDarkMode.update(curr => !curr);
  }
}
