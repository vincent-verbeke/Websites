import { Routes } from '@angular/router';
import { Hero } from './components/hero/hero';
import { Services } from './components/services/services';
import { Department } from './components/department/department';
import { Contact } from './components/contact/contact';
import { About } from './components/about/about';

export const routes: Routes = [
    { path: '', component: Hero },
    { path: 'home', component: Services },
    { path: 'about', component: About },
    { path: 'contact', component: Contact },
    { path: 'service/:id', component: Department },
    { path: '**', redirectTo: '' }
];
