import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs'; // Note: map not strictly needed if we just return the stream

export interface ContentItem {
  Department: string;
  Activity: string;
}

@Injectable({
  providedIn: 'root'
})
export class ContentService {
  constructor(private http: HttpClient) { }

  getStructure(): Observable<ContentItem[]> {
    return this.http.get<ContentItem[]>('/site-content/structure.json');
  }

  getContent(department: string, activity: string): Observable<string> {
    const filename = `${department}${activity}.html`;
    return this.http.get(`/site-content/${filename}`, { responseType: 'text' });
  }
}
