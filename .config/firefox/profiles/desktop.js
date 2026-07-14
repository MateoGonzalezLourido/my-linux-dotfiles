// Sobremesa: respuesta rápida sin disparar el consumo en un equipo de 16 GiB.

user_pref("dom.ipc.processCount", 6);
user_pref("dom.ipc.processCount.webIsolated", 3);
user_pref("dom.ipc.processPrelaunch.enabled", true);

user_pref("browser.cache.disk.enable", true);
user_pref("browser.cache.memory.enable", true);
user_pref("browser.cache.memory.capacity", 131072);
user_pref("image.cache.size", 67108864);

user_pref("browser.tabs.unloadOnLowMemory", true);
user_pref("browser.tabs.min_inactive_duration_before_unload", 900000);
user_pref("browser.newtab.preload", true);
user_pref("browser.pagethumbnails.capturing_disabled", false);
user_pref("browser.sessionhistory.max_entries", 50);
user_pref("browser.sessionhistory.max_total_viewers", 4);
user_pref("browser.sessionstore.interval", 30000);

user_pref("network.prefetch-next", true);
user_pref("network.dns.disablePrefetch", false);
user_pref("network.dns.disablePrefetchFromHTTPS", false);
user_pref("network.http.speculative-parallel-limit", 10);

user_pref("general.smoothScroll", true);
