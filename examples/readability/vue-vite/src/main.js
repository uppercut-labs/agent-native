import { createApp, h } from 'vue';
import { createRouter, createWebHistory, RouterView } from 'vue-router';
import Catalog from './Catalog.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: ['/', '/guides/:slug', '/parts/:slug'].map((path) => ({ path, component: Catalog })),
});
createApp({ render: () => h(RouterView) })
  .use(router)
  .mount('#app');
