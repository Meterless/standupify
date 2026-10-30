// Where the landing page sends people. `npm run landing:site` rewrites this
// file in dist-landing/ with relative links and the real installer files.
window.STANDUPIFY_LINKS = {
  demo: 'https://meterless.ai/Apps/Standupify/',
  github: 'https://github.com/meterless/standupify',
  downloads: null   // { version, exe: { href, size }, msi: { href, size } }; null sends Download to the demo
};
