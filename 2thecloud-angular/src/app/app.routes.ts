import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Contact } from './pages/contact/contact';
import { Proposition } from './pages/proposition/proposition';

export const routes: Routes = [
    { path: '', component: Home },
    { path: 'contact', component: Contact },
    { path: 'proposition/:id', component: Proposition },
    { path: 'services', redirectTo: '', pathMatch: 'full' },
    { path: 'migration', redirectTo: '', pathMatch: 'full' },
    { path: 'about', redirectTo: '', pathMatch: 'full' },
    { path: '**', redirectTo: '' }
];
