<script>
import { onMount } from 'svelte';
let { page, workshop = false } = $props();
let saved = $state(false);
let isReady = $state(false);
onMount(() => {
  isReady = true;
});
const script = (value) =>
  '<script type="application/ld+json">' +
  JSON.stringify(value).replaceAll('<', '\\u003c') +
  '<' +
  '/script>';
</script>
<svelte:head>
  <title>{page.title}</title><link rel="canonical" href={page.canonical}/>{#if page.mirror}<link rel="alternate" type="text/markdown" href={page.mirror}/>{/if}
  {#if page.jsonld}{@html script(page.jsonld)}{/if}
</svelte:head>
<main><nav><a href="/guides/getting-started">Public guide</a></nav><h1>{page.title}</h1><p>{page.markdown}</p>
  {#if page.facts?.length}<section aria-label="Key facts"><h2>Key facts</h2><ul>{#each page.facts as fact}<li>{fact.label}: {fact.value}</li>{/each}</ul></section>{/if}
  {#each page.links ?? [] as link}<a href={link.route}>{link.title}</a>{/each}
  {#if workshop}<button type="button" disabled={!isReady} onclick={()=>saved=!saved}>{saved?'Saved to schedule':'Save workshop'}</button>{/if}
</main>
