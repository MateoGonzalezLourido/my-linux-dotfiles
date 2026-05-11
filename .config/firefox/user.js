// ============================================================
//  Firefox user.js — optimización completa
//  Ruta: ~/.config/mozilla/firefox/81m85rc5.default-release/user.js
//  Firefox aplica este archivo en cada arranque.
//  Para revertir un valor: elimina la línea y reinicia Firefox.
// ============================================================


// ── PROCESOS ─────────────────────────────────────────────────
user_pref("dom.ipc.processCount", 4);
user_pref("dom.ipc.processPrelaunch.enabled", false);
user_pref("dom.ipc.processPriorityManager.enabled", true);
user_pref("dom.ipc.processPriorityManager.backgroundUsesEcoQoS", true);


// ── MEMORIA / JS ENGINE ──────────────────────────────────────
user_pref("javascript.options.mem.max", 512);
user_pref("javascript.options.gc_on_memory_pressure", true);
user_pref("memory.free_dirty_pages", true);
user_pref("image.mem.gc_threshold_factor", 4);


// ── CACHÉ ────────────────────────────────────────────────────
user_pref("browser.cache.disk.enable", false);
user_pref("browser.cache.memory.enable", true);
user_pref("browser.cache.memory.capacity", 262144);        // 256 MB en KB
user_pref("browser.cache.jsbc_compression_level", 3);
user_pref("image.cache.size", 33554432);                   // 32 MB en bytes


// ── TABS ─────────────────────────────────────────────────────
user_pref("browser.tabs.unloadOnLowMemory", true);
user_pref("browser.tabs.min_inactive_duration_before_unload", 300000);
user_pref("browser.tabs.loadInBackground", true);
user_pref("browser.tabs.firefox-view", false);
user_pref("browser.newtab.preload", false);
user_pref("browser.sessionhistory.max_entries", 10);
user_pref("browser.sessionhistory.max_total_viewers", 2);


// ── SESIÓN ───────────────────────────────────────────────────
user_pref("browser.startup.page", 1);
user_pref("browser.sessionstore.resume_from_crash", true);
user_pref("browser.sessionstore.interval", 60000);         // 60s
user_pref("browser.sessionstore.privacy_level", 2);


// ── HISTORIAL ────────────────────────────────────────────────
user_pref("places.history.enabled", true);
user_pref("places.history.expiration.max_pages", 1000);
user_pref("places.history.expiration.transient_current_max_pages", 100);
user_pref("places.database.lastMaintenance", 604800);      // 7 días


// ── FORMULARIOS ──────────────────────────────────────────────
user_pref("browser.formfill.enable", true);
user_pref("browser.formfill.expire_days", 3);


// ── DESCARGAS ────────────────────────────────────────────────
user_pref("browser.download.manager.retention", 20);


// ── URLBAR / SUGERENCIAS ─────────────────────────────────────
user_pref("browser.urlbar.maxRichResults", 5);
user_pref("browser.urlbar.maxHistoricalSearchSuggestions", 2);
user_pref("browser.urlbar.suggest.searches", false);
user_pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.urlbar.trending.featureGate", false);
user_pref("browser.urlbar.firefox-suggest.featureGate", false);
user_pref("browser.urlbar.sponsoredTopSites", false);
user_pref("browser.search.suggest.enabled", false);
user_pref("browser.search.separatePrivateDefault.ui.enabled", false);


// ── RENDERING / GPU ──────────────────────────────────────────
user_pref("gfx.webrender.all", true);
user_pref("gfx.canvas.accelerated", true);
user_pref("gfx.vsync.enabled", true);
user_pref("media.hardware-video-decoding.force-enabled", true);
user_pref("general.smoothScroll", false);


// ── FPS EN BACKGROUND ────────────────────────────────────────
user_pref("dom.min_background_timeout_value", 1000);
user_pref("dom.timeout.throttling_delay", 1000);
user_pref("dom.min_background_wake_interval", 1000);


// ── RED / DNS ────────────────────────────────────────────────
user_pref("network.trr.mode", 2);
user_pref("network.trr.uri", "https://cloudflare-dns.com/dns-query");
user_pref("network.dnsCacheEntries", 1000);
user_pref("network.dnsCacheExpiration", 3600);
user_pref("network.dns.disablePrefetch", true);
user_pref("network.dns.disablePrefetchFromHTTPS", true);
user_pref("network.prefetch-next", false);
user_pref("network.predictor.enabled", false);
user_pref("network.http.speculative-parallel-limit", 0);
user_pref("network.http.max-connections", 1800);
user_pref("network.http.max-persistent-connections-per-server", 10);
user_pref("network.captive-portal-service.enabled", false);
user_pref("network.connectivity-service.enabled", false);
user_pref("network.cookie.lifetime.days", 90);


// ── ESCRITURAS EN DISCO ──────────────────────────────────────
user_pref("browser.pagethumbnails.capturing_disabled", true);


// ── FEATURES NO USADAS ───────────────────────────────────────
user_pref("extensions.pocket.enabled", false);
user_pref("media.peerconnection.enabled", false);          // WebRTC
user_pref("dom.gamepad.enabled", false);
user_pref("dom.bluetooth.enabled", false);
user_pref("device.sensors.enabled", false);
user_pref("reader.parse-on-load.enabled", false);
user_pref("sidebar.revamp", false);
user_pref("sidebar.verticalTabs", false);


// ── ANUNCIOS / TRACKING ──────────────────────────────────────
user_pref("dom.private-attribution.submission.enabled", false);
user_pref("dom.browsingTopics.enabled", false);
user_pref("dom.privateAttribution.enabled", false);
user_pref("dom.fencedframes.enabled", false);
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.newtabpage.activity-stream.improvesearch.sponsored", false);
user_pref("browser.topsites.contile.enabled", false);


// ── TELEMETRÍA ───────────────────────────────────────────────
user_pref("toolkit.telemetry.enabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.healthreport.service.enabled", false);
user_pref("browser.ping-centre.telemetry", false);
user_pref("app.normandy.enabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
user_pref("browser.newtabpage.activity-stream.telemetry", false);


// ── ACTUALIZACIONES ──────────────────────────────────────────
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("extensions.update.enabled", true);
user_pref("extensions.update.interval", 604800);           // 7 días
user_pref("extensions.getAddons.cache.enabled", false);


// ── SEGURIDAD ────────────────────────────────────────────────
user_pref("privacy.resistFingerprinting", false);
user_pref("security.OCSP.enabled", 0);
user_pref("browser.safebrowsing.malware.enabled", false);
user_pref("browser.safebrowsing.phishing.enabled", false);
user_pref("browser.safebrowsing.downloads.enabled", true);


// ── COMPROBACIONES DEL SISTEMA ───────────────────────────────
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.integrity.enabled", false);
user_pref("browser.search.region", "ES");
user_pref("browser.aboutHomeSnippets.updateUrl", "");


// ── SYNC ─────────────────────────────────────────────────────
user_pref("services.sync.scheduler.syncInterval", 1800);   // 30 min activo
user_pref("services.sync.scheduler.idleInterval", 86400);  // 24h inactivo
user_pref("services.sync.engine.passwords", true);
user_pref("services.sync.engine.history", true);
user_pref("services.sync.engine.bookmarks", true);
user_pref("services.sync.engine.tabs", true);
user_pref("services.sync.engine.addons", true);
user_pref("services.sync.engine.prefs", true);
user_pref("services.sync.engine.addresses", false);
user_pref("services.sync.engine.creditcards", false);


// ── LINUX / WAYLAND ──────────────────────────────────────────
user_pref("widget.use-xdg-desktop-portal.file-picker", 1);
