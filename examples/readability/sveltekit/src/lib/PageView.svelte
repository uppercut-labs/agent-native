<script>
let { page, workshop = false } = $props();
let saved = $state(false);
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
  {#each page.links ?? [] as link}<a href={link.route}>{link.title}</a>{/each}
  {#if workshop}<button type="button" onclick={()=>saved=!saved}>{saved?'Saved to schedule':'Save workshop'}</button>{/if}
</main>
