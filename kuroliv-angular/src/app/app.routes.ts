import { Routes } from '@angular/router';
import { Hero } from './components/hero/hero';
import { Services } from './components/services/services';
import { Department } from './components/department/department';
import { Contact } from './components/contact/contact';
import { About } from './components/about/about';
import { AiTradingComponent } from './components/ai-trading/ai-trading.component';

export const routes: Routes = [
    { path: 'home', component: Services },
    { path: 'about', component: About },
    { path: 'contact', component: Contact },
    { path: 'service/:id', component: Department },
    { path: 'aitrading', component: AiTradingComponent },
    { path: '', component: Hero, pathMatch: 'full' },
    { path: '**', redirectTo: '' }
];
