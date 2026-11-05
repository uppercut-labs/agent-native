import { DOCUMENT, NgComponentOutlet } from '@angular/common';
import { Component, inject, signal, Type } from '@angular/core';
import { ActivatedRoute, ResolveFn, RouterLink, RouterOutlet, Routes } from '@angular/router';
import publication from '../generated/publication.json';

type Page = (typeof publication.pages)[number];

@Component({
  selector: 'equipment-desk',
  imports: [RouterLink, RouterOutlet],
  template: `<header><nav aria-label="Desk"><a routerLink="/">Equipment desk</a> ·
    <a routerLink="/guides/getting-started">Field guide</a> · <a href="/llms.txt">Site index</a></nav></header>
    <main><router-outlet /></main>`,
})
export class App {}

@Component({
  imports: [RouterLink],
  template: `<h1>Equipment desk</h1><p>Operator handbooks and harbor guides</p>
    <ul>@for (p of pages; track p.id) { <li><a [routerLink]="p.route">{{p.title}}</a></li> }</ul>`,
})
class Home {
  readonly pages = publication.pages;
}

@Component({
  imports: [NgComponentOutlet, RouterLink],
  template: `@if (page(); as p) {
    <article [attr.lang]="p.locale"><h1>{{p.title}}</h1><p>{{p.markdown}}</p>
      <ul>@for (link of p.links; track link.route) {
        <li><a [routerLink]="link.route">{{link.title}}</a></li>
      }</ul>
      <a [href]="p.mirror">Read as Markdown</a>
      @if (p.route.startsWith('/equipment/')) {
        <section><h2>Before use</h2><button type="button" (click)="start()">Start checklist</button>
          <ng-container *ngComponentOutlet="checklist()" />
        </section>
      }
    </article>
  } @else { <h1>Page unavailable</h1> }`,
})
class Detail {
  readonly page = signal<Page | undefined>(undefined);
  readonly checklist = signal<Type<unknown> | null>(null);
  private readonly doc = inject(DOCUMENT);
  constructor() {
    inject(ActivatedRoute).data.subscribe(({ page }) => {
      this.page.set(page);
      this.checklist.set(null);
      if (!page) return;
      this.doc.title = page.title;
      this.doc.documentElement.lang = page.locale;
      this.addHead('link', 'canonical', page.canonical);
      this.addHead('link', 'alternate', page.mirror);
      this.doc.getElementById('content-schema')?.remove();
      if (page.jsonld) {
        const block = this.doc.createElement('script');
        block.id = 'content-schema';
        block.type = 'application/ld+json';
        block.textContent = JSON.stringify(page.jsonld).replace(/</g, '\\u003c');
        this.doc.head.appendChild(block);
      }
    });
  }
  ngOnDestroy() {
    for (const id of ['desk-canonical', 'desk-alternate', 'content-schema']) {
      this.doc.getElementById(id)?.remove();
    }
    this.doc.title = 'Equipment desk';
  }
  private addHead(tag: 'link', rel: string, url: string) {
    const id = 'desk-' + rel;
    const link =
      (this.doc.getElementById(id) as HTMLLinkElement | null) ?? this.doc.createElement(tag);
    link.id = id;
    link.rel = rel;
    link.href = url;
    if (rel === 'alternate') link.type = 'text/markdown';
    this.doc.head.appendChild(link);
  }
  async start() {
    this.checklist.set((await import('./checklist')).Checklist);
  }
}

const resolvePage: ResolveFn<Page | undefined> = (route) =>
  publication.pages.find((p) => p.route === '/' + route.url.map((s) => s.path).join('/'));

export const routes: Routes = [
  { path: '', component: Home, pathMatch: 'full' },
  { path: 'guides/:slug', component: Detail, resolve: { page: resolvePage } },
  { path: 'equipment/:slug', component: Detail, resolve: { page: resolvePage } },
];
