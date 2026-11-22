import { route } from '@react-router/dev/routes';
export default [
  route('lines/:line', 'routes/line.jsx', [route('stops/:stop', 'routes/stop.jsx')]),
  route('account/settings', 'routes/restricted.js'),
  route('*', 'routes/reference.jsx'),
];
