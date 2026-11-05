<script setup>
import publication from '../../generated/publication.json';
import { exhibits, withdrawn } from '../../exhibits.mjs';

definePageMeta({ key: (route) => route.path });
const route = useRoute();
const current = computed(() =>
  publication.pages.find((page) => page.route.replace(/\/$/, '') === route.path.replace(/\/$/, '')),
);
const isHome = route.path === '/';
if (route.path === withdrawn || (!isHome && !current.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Entry unavailable' });
}
const canonical = computed(
  () => current.value?.canonical ?? new URL('/', publication.siteUrl).href,
);
useHead(() => ({
  title: current.value?.title ?? 'Harbor Museum',
  htmlAttrs: { lang: exhibits.find((entry) => entry.route === route.path)?.locale ?? 'en' },
  link: [{ rel: 'canonical', href: canonical.value }],
  script: current.value?.jsonld
    ? [
        {
          type: 'application/ld+json',
          innerHTML:
            typeof current.value.jsonld === 'string'
              ? current.value.jsonld
              : JSON.stringify(current.value.jsonld).replaceAll('<', '\\u003c'),
        },
      ]
    : [],
}));
</script>

<template>
  <main>
    <h1>{{ current?.title ?? 'Harbor Museum' }}</h1>
    <p v-if="current">{{ current.markdown }}</p>
    <nav aria-label="Museum collection">
      <NuxtLink v-for="item in publication.pages" :key="item.id" :to="item.route">{{ item.title }}</NuxtLink>
      <a href="/llms.txt">Machine-readable guide</a>
    </nav>
  </main>
</template>
