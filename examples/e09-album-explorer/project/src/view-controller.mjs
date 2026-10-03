const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function decodeResult(result, outputSchema) {
  if (!isRecord(result) || result.isError === true) return { kind: 'denied' };
  let candidate = result.structuredContent;
  if (!isRecord(candidate) || !Object.hasOwn(candidate, 'result')) {
    const text = Array.isArray(result.content)
      ? result.content.find((item) => isRecord(item) && item.type === 'text')?.text
      : undefined;
    if (typeof text !== 'string') return { kind: 'unavailable' };
    try {
      candidate = JSON.parse(text);
    } catch {
      return { kind: 'unavailable' };
    }
  }
  if (!isRecord(candidate) || !Object.hasOwn(candidate, 'result')) return { kind: 'unavailable' };
  try {
    return outputSchema.parse(candidate.result);
  } catch {
    return { kind: 'unavailable' };
  }
}

export function createAlbumExplorerController({ app, toolName, outputSchema, render }) {
  let disposed = false;
  const show = (state) => {
    if (!disposed) render(state);
  };
  app.ontoolinput = (params) => {
    const args = params?.arguments;
    if (!isRecord(args) || typeof args.slug !== 'string') {
      show({ kind: 'unavailable', message: 'The host supplied invalid album input.' });
      return;
    }
    show({ kind: 'loading', slug: args.slug });
  };
  app.ontoolresult = (params) => {
    show(decodeResult(params, outputSchema));
  };

  return {
    receiveResult: (result) => show(decodeResult(result, outputSchema)),
    async lookup(slug) {
      if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        show({ kind: 'unavailable', message: 'Enter a valid album slug.' });
        return { kind: 'unavailable' };
      }
      show({ kind: 'loading', slug });
      try {
        const result = await app.callServerTool({ name: toolName, arguments: { slug } });
        const outcome = decodeResult(result, outputSchema);
        show(outcome);
        return outcome;
      } catch {
        const outcome = {
          kind: 'denied',
          message: 'The host denied or could not complete this request.',
        };
        show(outcome);
        return outcome;
      }
    },
    dispose() {
      disposed = true;
      app.ontoolinput = undefined;
      app.ontoolresult = undefined;
    },
  };
}
