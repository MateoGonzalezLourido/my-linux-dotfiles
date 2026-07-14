// Preferencias comunes: privacidad razonable sin romper seguridad ni webs.

// Inicio y comportamiento.
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 1);
user_pref("browser.sessionstore.resume_from_crash", true);
user_pref("browser.sessionstore.privacy_level", 2);
user_pref("browser.tabs.loadInBackground", true);
user_pref("browser.tabs.firefox-view", false);
user_pref("sidebar.revamp", false);
user_pref("sidebar.verticalTabs", false);

// Sugerencias y contenido patrocinado.
user_pref("browser.search.suggest.enabled", false);
user_pref("browser.urlbar.suggest.searches", false);
user_pref("browser.urlbar.suggest.trending", false);
user_pref("browser.urlbar.quicksuggest.enabled", false);
user_pref("browser.urlbar.quicksuggest.online.enabled", false);
user_pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.urlbar.sponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.topsites.contile.enabled", false);

// Privacidad y telemetría.
user_pref("dom.private-attribution.submission.enabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.healthreport.service.enabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("browser.newtabpage.activity-stream.telemetry", false);

// Seguridad y compatibilidad. El archivo antiguo desactivaba estas protecciones
// y rompía videollamadas, lectores y APIs que ya tienen permisos por sitio.
user_pref("security.OCSP.enabled", 1);
user_pref("browser.safebrowsing.malware.enabled", true);
user_pref("browser.safebrowsing.phishing.enabled", true);
user_pref("browser.safebrowsing.downloads.enabled", true);
user_pref("media.peerconnection.enabled", true);
user_pref("reader.parse-on-load.enabled", true);
user_pref("dom.gamepad.enabled", true);
user_pref("device.sensors.enabled", true);
user_pref("network.captive-portal-service.enabled", true);
user_pref("network.connectivity-service.enabled", true);

// Valores portables. Se permite que Firefox y su lista de compatibilidad
// decidan la GPU y la decodificación de vídeo; false significa "no forzar".
user_pref("gfx.webrender.all", false);
user_pref("media.hardware-video-decoding.force-enabled", false);
user_pref("widget.use-xdg-desktop-portal.file-picker", 1);

// Deshace los límites extremos (1200/1800 y 10) del archivo antiguo y usa los
// valores actuales de Firefox 152.
user_pref("network.http.max-connections", 900);
user_pref("network.http.max-persistent-connections-per-server", 6);
user_pref("dom.ipc.processPriorityManager.enabled", true);
