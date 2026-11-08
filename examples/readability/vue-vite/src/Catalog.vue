<script setup>
import { computed, watch } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { setPageHead } from '../../shared/browser.mjs';
import model from '../generated/publication.json';

const route = useRoute();
const router = useRouter();
const page = computed(() =>
  model.pages.find((entry) => entry.route === route.path.replace(/\/$/, '')),
);
const parts = computed(() =>
  model.pages.filter(
    (entry) =>
      entry.route.startsWith('/parts/') &&
      entry.title.toLowerCase().includes(String(route.query.q || '').toLowerCase()),
  ),
);
watch(page, (value) => setPageHead(value), { immediate: true });
const filter = (event) =>
  router.replace({ path: '/', query: event.target.value ? { q: event.target.value } : {} });
</script>
<template>
  <main><nav><RouterLink to="/">Parts catalog</RouterLink> · <RouterLink to="/guides/getting-started">Field guide</RouterLink></nav>
    <article v-if="page"><h1>{{page.title}}</h1><p>{{page.markdown}}</p>
      <section v-if="page.facts?.length" aria-label="Key facts"><h2>Key facts</h2><ul><li v-for="fact in page.facts" :key="fact.label">{{fact.label}}: {{fact.value}}</li></ul></section>
      <p v-for="link in page.links" :key="link.route"><RouterLink :to="link.route">{{link.title}}</RouterLink></p>
    </article>
    <section v-else-if="route.path === '/'"><h1>Parts catalog</h1><label>Filter parts <input :value="route.query.q || ''" @input="filter"></label>
      <p v-for="entry in parts" :key="entry.id"><RouterLink :to="entry.route">{{entry.title}}</RouterLink></p>
      <p v-if="!parts.length">No matching parts</p>
    </section><h1 v-else>Page not found</h1>
  </main>
</template>
