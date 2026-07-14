// Portátil: menos RAM, procesos ociosos, escrituras y trabajo especulativo.

user_pref("dom.ipc.processCount", 4);
user_pref("dom.ipc.processCount.webIsolated", 2);
user_pref("dom.ipc.processPrelaunch.enabled", false);

user_pref("browser.cache.disk.enable", true);
user_pref("browser.cache.memory.enable", true);
user_pref("browser.cache.memory.capacity", 65536);
user_pref("image.cache.size", 33554432);

user_pref("browser.tabs.unloadOnLowMemory", true);
user_pref("browser.tabs.min_inactive_duration_before_unload", 300000);
user_pref("browser.newtab.preload", false);
user_pref("browser.pagethumbnails.capturing_disabled", true);
user_pref("browser.sessionhistory.max_entries", 25);
user_pref("browser.sessionhistory.max_total_viewers", 2);
user_pref("browser.sessionstore.interval", 60000);

user_pref("network.prefetch-next", false);
user_pref("network.dns.disablePrefetch", true);
user_pref("network.dns.disablePrefetchFromHTTPS", true);
user_pref("network.http.speculative-parallel-limit", 0);

user_pref("general.smoothScroll", false);
