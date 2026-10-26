import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, map } from 'rxjs';

export interface BlogContentBlock {
  type: 'paragraph' | 'heading' | 'image';
  text?: string;
  src?: string;
  caption?: string;
}

export interface BlogPost {
  id: string;
  title: string;
  date: string;
  author: string;
  excerpt: string;
  heroImage: string;
  tags: string[];
  content: BlogContentBlock[];
}

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  emoji: string;
  image: string;
  bio: string;
  quote: string;
}

export interface BoatSpec {
  label: string;
  value: string;
}

export interface BoatInfo {
  name: string;
  make: string;
  model: string;
  type: string;
  image: string;
  description: string;
  specs: BoatSpec[];
  gallery: string[];
  drawing: string;
  upgrades: { year: string; description: string }[];
  blueWaterEquipment: { name: string; description: string; link?: string }[];
}

export interface HistoryStoryItem {
  image: string;
  caption: string;
}

export interface TimelineEvent {
  year: string;
  title: string;
  description: string;
  image?: string;
  images?: string[];
}

export interface HistoryData {
  makingOf: {
    title: string;
    subtitle: string;
    description: string;
    mapsLink?: string;
    story: HistoryStoryItem[];
  };
  timeline: TimelineEvent[];
}

@Injectable({ providedIn: 'root' })
export class ContentService {
  private http = inject(HttpClient);

  private blogPosts$ = this.http.get<BlogPost[]>('/content/blog-posts.json').pipe(shareReplay(1));
  private crew$ = this.http.get<CrewMember[]>('/content/crew.json').pipe(shareReplay(1));
  private boat$ = this.http.get<BoatInfo>('/content/boat.json').pipe(shareReplay(1));
  private history$ = this.http.get<HistoryData>('/content/history.json').pipe(shareReplay(1));

  getBlogPosts(): Observable<BlogPost[]> {
    return this.blogPosts$;
  }

  getBlogPost(id: string): Observable<BlogPost | undefined> {
    return this.blogPosts$.pipe(map(posts => posts.find(p => p.id === id)));
  }

  getCrew(): Observable<CrewMember[]> {
    return this.crew$;
  }

  getBoat(): Observable<BoatInfo> {
    return this.boat$;
  }

  getHistory(): Observable<HistoryData> {
    return this.history$;
  }
}
