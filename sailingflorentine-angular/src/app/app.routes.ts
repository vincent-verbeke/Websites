import { Routes } from '@angular/router';
import { Home } from './components/home/home';
import { Blog } from './components/blog/blog';
import { BlogPostComponent } from './components/blog-post/blog-post';
import { Crew } from './components/crew/crew';
import { Boat } from './components/boat/boat';
import { TimelineComponent } from './components/timeline/timeline';
import { MakingOfComponent } from './components/making-of/making-of';
import { ContactComponent } from './components/contact/contact';

export const routes: Routes = [
    { path: '', component: Home },
    { path: 'blog', component: Blog },
    { path: 'blog/:id', component: BlogPostComponent },
    { path: 'crew', component: Crew },
    { path: 'boat', component: Boat },
    { path: 'timeline', component: TimelineComponent },
    { path: 'making-of', component: MakingOfComponent },
    { path: 'contact', component: ContactComponent },
    { path: '**', redirectTo: '' }
];
