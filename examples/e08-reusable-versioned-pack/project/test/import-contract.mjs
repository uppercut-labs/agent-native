const contract = await import('@example/e08-album-contracts');
if (contract.albumLookupV1.identity.name !== 'album.lookup') process.exitCode = 1;
