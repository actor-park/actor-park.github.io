/*!
 * config.js — site-wide settings. Loaded before analytics.js and admin.html.
 *
 * endpoint: leave EMPTY to keep visit logs in each visitor's own browser
 *           (fine for a demo, but the admin page then only sees this device).
 *           Paste a Google Apps Script Web App URL here to collect real
 *           cross-device stats — see assets/collector.gs for the 2-minute setup.
 * token:    must match SHARED_TOKEN inside collector.gs.
 */
window.PJA_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbwaHNty6qgIq7HoRmkER_VTOOrfvMUxCMuImuFnPZPkpvgSLXo4z2dkd729u3By9Qt-4Q/exec',
  token: 'pja_T9lwsFX1SRGDBeL7s6ODCeXjVvmchrX7VruUO6Fe'
};
