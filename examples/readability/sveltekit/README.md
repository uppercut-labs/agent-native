# SvelteKit workshop calendar

This adapter-node application serves the shared guide and a public scheduling showcase. The finite workshop source in `showcase.mjs` supplies the reviewed projection. The dynamic `events/[slug]` server load reads the approved model. The attendee endpoint returns 403 and the public mirror reads the same for anonymous and signed-in clients.

Build the root package first. From this directory, start the production server with the following commands.

```sh
npm ci
SITE_URL=http://127.0.0.1:4173 npm run build
HOST=127.0.0.1 PORT=4173 ORIGIN=http://127.0.0.1:4173 npm start
```

In another terminal run `SITE_URL=http://127.0.0.1:4173 npm test`. Open `/events/lanterns` and press **Save workshop** to add it to the displayed schedule. Set `WORKSHOP_OPENS` at build and test time to exercise an updated public fact. Build and restart to install or withdraw a projection.
