const contract = await import('@example/e08-distance-contracts');
if (contract.distanceConversion.identity.name !== 'distance.convert') process.exitCode = 1;
