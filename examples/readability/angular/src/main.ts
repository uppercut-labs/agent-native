import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { App, routes } from './app';

bootstrapApplication(App, { providers: [provideRouter(routes), provideClientHydration()] }).catch(
  console.error,
);
