/*!
 * config.js — site-wide settings. Loaded before analytics.js and admin.html.
 *
 * endpoint — the Google Apps Script web app that collects visits.
 *            Leave it empty and visit logs stay in each visitor's own browser,
 *            which means the admin page can only ever show that one device.
 *
 * token    — the WRITE token, and it is public on purpose. Every visitor's
 *            browser needs it to log its own visit, so it ships in this file
 *            and anyone reading the page source can see it. The worst that
 *            buys them is pushing junk rows into the sheet.
 *
 *            It does NOT open the visit log. Reading the log requires
 *            READ_KEY, which exists only inside the Apps Script and is typed
 *            at the admin login — it is never committed here.
 *
 * Both secrets are set in assets/collector.gs.
 */
window.PJA_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbwaHNty6qgIq7HoRmkER_VTOOrfvMUxCMuImuFnPZPkpvgSLXo4z2dkd729u3By9Qt-4Q/exec',
  token: 'pja_T9lwsFX1SRGDBeL7s6ODCeXjVvmchrX7VruUO6Fe'
};
