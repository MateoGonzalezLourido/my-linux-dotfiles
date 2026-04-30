#!/usr/bin/env python3
"""
wifi-panel — Panel WiFi con gtk4-layer-shell
Se comporta como un layer surface (como waybar)
Requiere: python-gobject, gtk4, gtk4-layer-shell
"""

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Gtk4LayerShell", "1.0")
from gi.repository import Gtk, GLib, Gdk, Gtk4LayerShell as LayerShell
import subprocess
import threading
import sysCSS = """
* {
    font-family: "JetBrains Mono", "Symbols Nerd Font Mono", monospace;
    font-weight: 700;
}

window {
    background-color: rgba(0, 0, 0, 0.95);
    border: 2px solid #ffffff;
    border-radius: 4px;
}

.panel-box {
    padding: 8px;
}

.header-box {
    padding: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.connected-ssid {
    font-size: 14px;
    color: #ffffff;
}

.connected-ip {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
}

.disconnected-label {
    font-size: 12px;
    color: #ff0000;
}

.dot-on {
    background-color: #00ff00;
    border-radius: 99px;
    min-width: 8px;
    min-height: 8px;
    margin-right: 10px;
}

.dot-off {
    background-color: #ff0000;
    border-radius: 99px;
    min-width: 8px;
    min-height: 8px;
    margin-right: 10px;
}

.section-title {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
    letter-spacing: 2px;
    padding: 12px 12px 4px 12px;
}

.network-row {
    padding: 8px 12px;
    transition: all 0.2s ease;
}

.network-row:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

.net-ssid {
    font-size: 13px;
    color: #ffffff;
}

.net-ssid-active {
    font-size: 13px;
    color: #000000;
    background-color: #ffffff;
    padding: 0 4px;
}

.signal {
    font-size: 12px;
    margin-right: 10px;
}

.signal-strong { color: #ffffff; }
.signal-good   { color: rgba(255, 255, 255, 0.6); }
.signal-weak   { color: rgba(255, 255, 255, 0.3); }

.btn-connect, .btn-confirm {
    background-color: #ffffff;
    color: #000000;
    border: none;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 800;
}

.btn-connect:hover, .btn-confirm:hover {
    background-color: rgba(255, 255, 255, 0.8);
}

.btn-disconnect, .btn-footer {
    background-color: transparent;
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
}

.btn-disconnect:hover, .btn-footer:hover {
    background-color: #ffffff;
    color: #000000;
}

.password-box {
    padding: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.password-entry {
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid #ffffff;
    border-radius: 4px;
    color: #ffffff;
    padding: 6px;
    font-size: 13px;
}

tooltip {
    background-color: #000000;
    border: 1px solid #ffffff;
    color: #ffffff;
}
"""
""

def run(*args):
    return subprocess.run(list(args), capture_output=True, text=True).stdout.strip()

def get_current():
    for line in run("nmcli", "-t", "-f", "active,ssid", "dev", "wifi").splitlines():
        if line.startswith("yes:"):
            return line.split(":", 1)[1]
    return None

def get_ip():
    for line in run("nmcli", "-t", "-f", "IP4.ADDRESS", "dev", "show").splitlines():
        if "IP4.ADDRESS" in line:
            return line.split(":", 1)[1].split("/")[0]
    return ""

def get_networks():
    out = run("nmcli", "--fields", "SSID,SECURITY,SIGNAL,IN-USE", "-t", "dev", "wifi", "list")
    nets, seen = [], set()
    for line in out.splitlines():
        p = line.split(":")
        if len(p) < 4: continue
        ssid, sec, sig_s, active = p[0], p[1], p[2], p[3]
        if not ssid or ssid in seen: continue
        seen.add(ssid)
        try: sig = int(sig_s)
        except: sig = 0
        nets.append({"ssid": ssid, "security": sec if sec != "--" else "", "signal": sig, "active": active == "*"})
    return sorted(nets, key=lambda x: x["signal"], reverse=True)

def signal_icon(s):
    if s >= 75: return "▂▄▆█", "signal-strong"
    if s >= 50: return "▂▄▆░", "signal-good"
    if s >= 25: return "▂▄░░", "signal-weak"
    return "▂░░░", "signal-weak"


class WifiPanel(Gtk.Window):
    def __init__(self, app):
        super().__init__(application=app)
        LayerShell.init_for_window(self)
        LayerShell.set_layer(self, LayerShell.Layer.TOP)
        LayerShell.set_anchor(self, LayerShell.Edge.TOP, True)
        LayerShell.set_anchor(self, LayerShell.Edge.RIGHT, True)
        LayerShell.set_margin(self, LayerShell.Edge.TOP, 44)
        LayerShell.set_margin(self, LayerShell.Edge.RIGHT, 8)
        LayerShell.set_keyboard_mode(self, LayerShell.KeyboardMode.EXCLUSIVE)
        LayerShell.set_exclusive_zone(self, -1)
        self.set_decorated(False)
        self.set_resizable(False)
        self.set_size_request(320, -1)
        self._pending_ssid = None
        self._pass_box = None

        # CSS
        p = Gtk.CssProvider()
        p.load_from_string(CSS)
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), p,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

        # Escape cierra
        key = Gtk.EventControllerKey()
        key.connect("key-pressed", lambda c, k, *a: self.close() or True if k == Gdk.KEY_Escape else False)
        self.add_controller(key)

        # Foco: cierra si se pierde
        self.connect("notify::is-active", lambda w, p: self.close() if not self.is_active() else None)


        self._build()
        self._load_networks()



    def _build(self):
        self._root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self._root.add_css_class("panel-box")
        self.set_child(self._root)

        self._header_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self._header_box.add_css_class("header-box")
        self._root.append(self._header_box)
        self._rebuild_header()

        sec = Gtk.Label(label="REDES DISPONIBLES")
        sec.add_css_class("section-title")
        sec.set_xalign(0)
        self._root.append(sec)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.set_max_content_height(260)
        scroll.set_propagate_natural_height(True)
        self._root.append(scroll)

        self._list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        scroll.set_child(self._list)

        # spinner inicial
        self._spinner_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        self._spinner_row.set_halign(Gtk.Align.CENTER)
        self._spinner_row.set_margin_top(14)
        self._spinner_row.set_margin_bottom(14)
        self._spinner = Gtk.Spinner()
        self._spinner.start()
        self._spinner_row.append(self._spinner)
        lbl = Gtk.Label(label="  escaneando...")
        lbl.add_css_class("net-security")
        self._spinner_row.append(lbl)
        self._list.append(self._spinner_row)

        footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        footer.add_css_class("footer-box")
        footer.set_spacing(4)
        self._root.append(footer)

        r = Gtk.Button(label="↻ actualizar")
        r.add_css_class("btn-footer")
        r.connect("clicked", lambda _: self._load_networks())
        footer.append(r)

        a = Gtk.Button(label="ajustes avanzados")
        a.add_css_class("btn-footer")
        a.connect("clicked", self._open_nmtui)
        footer.append(a)

    def _rebuild_header(self):
        while c := self._header_box.get_first_child():
            self._header_box.remove(c)

        current = get_current()
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)

        dot = Gtk.Label(label="")
        dot.add_css_class("dot-on" if current else "dot-off")
        row.append(dot)

        info = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        info.set_hexpand(True)

        if current:
            s = Gtk.Label(label=current)
            s.add_css_class("connected-ssid")
            s.set_xalign(0)
            info.append(s)
            ip = get_ip()
            if ip:
                i = Gtk.Label(label=ip)
                i.add_css_class("connected-ip")
                i.set_xalign(0)
                info.append(i)
            row.append(info)
            btn = Gtk.Button(label="desconectar")
            btn.add_css_class("btn-disconnect")
            btn.set_valign(Gtk.Align.CENTER)
            btn.connect("clicked", self._disconnect)
            row.append(btn)
        else:
            l = Gtk.Label(label="sin conexión")
            l.add_css_class("disconnected-label")
            l.set_xalign(0)
            info.append(l)
            row.append(info)

        self._header_box.append(row)

    def _load_networks(self):
        while c := self._list.get_first_child():
            self._list.remove(c)
        self._list.append(self._spinner_row)
        self._spinner.start()
        threading.Thread(target=lambda: GLib.idle_add(self._populate, get_networks()), daemon=True).start()

    def _populate(self, nets):
        while c := self._list.get_first_child():
            self._list.remove(c)
        if not nets:
            e = Gtk.Label(label="no se encontraron redes")
            e.add_css_class("net-security")
            e.set_margin_top(16); e.set_margin_bottom(16)
            self._list.append(e)
            return False
        for n in nets:
            self._list.append(self._make_row(n))
        return False

    def _make_row(self, net):
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        row.add_css_class("network-row")

        bar, cls = signal_icon(net["signal"])
        sig = Gtk.Label(label=bar)
        sig.add_css_class("signal")
        sig.add_css_class(cls)
        row.append(sig)

        info = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        info.set_hexpand(True)

        sl = Gtk.Label(label=net["ssid"])
        sl.add_css_class("net-ssid-active" if net["active"] else "net-ssid")
        sl.set_xalign(0)
        sl.set_ellipsize(3)
        info.append(sl)

        if net["security"]:
            sec = Gtk.Label(label=net["security"])
            sec.add_css_class("net-security")
            sec.set_xalign(0)
            info.append(sec)

        row.append(info)

        if not net["active"]:
            btn = Gtk.Button(label="conectar")
            btn.add_css_class("btn-connect")
            btn.set_valign(Gtk.Align.CENTER)
            btn.connect("clicked", lambda _, s=net["ssid"], h=bool(net["security"]): self._connect(s, h))
            row.append(btn)

        return row

    def _connect(self, ssid, has_security):
        def try_it():
            r = subprocess.run(["nmcli", "dev", "wifi", "connect", ssid], capture_output=True, text=True)
            if r.returncode == 0:
                GLib.idle_add(self._on_ok, ssid)
            elif has_security:
                GLib.idle_add(self._show_pass, ssid)
            else:
                GLib.idle_add(self._on_err, ssid)
        threading.Thread(target=try_it, daemon=True).start()

    def _show_pass(self, ssid):
        self._pending_ssid = ssid
        if self._pass_box:
            self._root.remove(self._pass_box)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.add_css_class("password-box")
        self._pass_box = box

        lbl = Gtk.Label(label=f"contraseña — {ssid}")
        lbl.add_css_class("password-label")
        lbl.set_xalign(0)
        box.append(lbl)

        entry = Gtk.Entry()
        entry.set_visibility(False)
        entry.set_placeholder_text("••••••••")
        entry.add_css_class("password-entry")
        entry.connect("activate", lambda e: self._confirm_pass(e.get_text()))
        box.append(entry)

        btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        btns.set_spacing(8)
        btns.set_margin_top(6)
        box.append(btns)

        cancel = Gtk.Button(label="cancelar")
        cancel.add_css_class("btn-footer")
        cancel.connect("clicked", lambda _: self._cancel_pass())
        btns.append(cancel)

        ok = Gtk.Button(label="conectar →")
        ok.add_css_class("btn-confirm")
        ok.connect("clicked", lambda _: self._confirm_pass(entry.get_text()))
        btns.append(ok)

        # Insertar antes del footer
        footer = self._root.get_last_child()
        self._root.insert_child_after(box, footer.get_prev_sibling())
        entry.grab_focus()

    def _confirm_pass(self, pw):
        if not pw or not self._pending_ssid: return
        ssid = self._pending_ssid
        self._cancel_pass()
        def do():
            r = subprocess.run(["nmcli", "dev", "wifi", "connect", ssid, "password", pw], capture_output=True, text=True)
            if r.returncode == 0: GLib.idle_add(self._on_ok, ssid)
            else: GLib.idle_add(self._on_err, ssid)
        threading.Thread(target=do, daemon=True).start()

    def _cancel_pass(self):
        if self._pass_box:
            self._root.remove(self._pass_box)
            self._pass_box = None
        self._pending_ssid = None

    def _disconnect(self, _):
        def do():
            for line in run("nmcli", "-t", "-f", "device,type", "dev", "status").splitlines():
                if "wifi" in line:
                    subprocess.run(["nmcli", "dev", "disconnect", line.split(":")[0]])
                    break
            GLib.idle_add(self._refresh)
        threading.Thread(target=do, daemon=True).start()

    def _refresh(self):
        self._rebuild_header()
        self._load_networks()

    def _on_ok(self, ssid):
        subprocess.Popen(["notify-send", "WiFi", f"✓ Conectado a {ssid}", "--expire-time=3000"])
        self._refresh()

    def _on_err(self, ssid):
        subprocess.Popen(["notify-send", "WiFi", f"✕ Error conectando a {ssid}", "--expire-time=3000"])

    def _open_nmtui(self, _):
        subprocess.Popen(["kitty", "--title", "nmtui", "--class", "floating_term", "nmtui"])
        self.close()


class App(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="com.waybar.wifipanel")

    def do_activate(self):
        win = WifiPanel(self)
        win.present()


if __name__ == "__main__":
    App().run(sys.argv)
