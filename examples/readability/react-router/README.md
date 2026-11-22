# React Router transit guide

This framework-mode SSR application serves the shared guide and a transit stop directory. The `lines/:line` route has a nested `stops/:stop` route with a server loader. Its finite timetable supplies the approved projection. The old wharf stop redirects to Quay, and unknown stops return the application's 404 boundary.

Build the root package first. From this directory, start the production server with the following commands.

```sh
npm ci
SITE_URL=http://127.0.0.1:4173 npm run build
HOST=127.0.0.1 PORT=4173 npm start
```

In another terminal run `SITE_URL=http://127.0.0.1:4173 npm test`. Open `/lines/river/stops/quay` and press **Save stop** to mark the current stop. Set `STOP_INTERVAL` at build and test time to change the service interval. Build and restart to install or withdraw a projection.
