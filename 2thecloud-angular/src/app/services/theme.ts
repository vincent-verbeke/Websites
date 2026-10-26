import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    isDarkMode = signal(true);

    constructor() {
        // Apply default dark mode on initialization
        if (typeof document !== 'undefined') {
            document.body.classList.add('dark-mode');
        }
    }

    toggleTheme() {
        this.isDarkMode.update(v => !v);
        if (this.isDarkMode()) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }

    setTheme(isDark: boolean) {
        this.isDarkMode.set(isDark);
        if (isDark) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }
}
