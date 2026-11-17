// Capability identities shared by the server contracts and the browser view. Kept free of
// schema code so the view bundle does not carry the schema library.
export const identities = {
  reviewOpen: { namespace: 'ui.fixture', name: 'review.open', majorVersion: 1 },
  exploreOpen: { namespace: 'ui.fixture', name: 'explore.open', majorVersion: 1 },
  mediaOpen: { namespace: 'ui.fixture', name: 'media.open', majorVersion: 1 },
  reviewSave: { namespace: 'ui.fixture', name: 'review.save', majorVersion: 1 },
  annotationsSave: { namespace: 'ui.fixture', name: 'annotations.save', majorVersion: 1 },
};
