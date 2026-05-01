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
import sys
CSS = """
* {
    font-family: "JetBrains Mono", "Symbols Nerd Font Mono", monospace;
    font-weight: 700;
    font-size: 11px;
}

window {
    background-color: rgba(15, 15, 20, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #cdd6f4;
}

.panel-box {
    padding: 4px 6px;
}

.header-box {
    padding-bottom: 4px;
    margin-bottom: 4px;
    padding-left: 4px;
    padding-right: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.connected-ssid {
    font-size: 12px;
    color: #a6e3a1;
    font-weight: 900;
}

.disconnected-label {
    font-size: 12px;
    color: #f38ba8;
}

.section-title {
    font-size: 10px;
    color: rgba(205, 214, 244, 0.5);
    letter-spacing: 1px;
    padding: 6px 10px 4px 10px;
}

.network-row {
    padding: 3px 6px;
    border-radius: 6px;
    transition: background-color 0.2s ease;
}

.network-row:hover {
    background-color: rgba(45, 45, 55, 0.6);
}

.net-ssid {
    font-size: 11px;
    color: #cdd6f4;
}

.net-ssid-active {
    font-size: 11px;
    color: #11111b;
    background: linear-gradient(45deg, #cba6f7, #89b4fa);
    border-radius: 4px;
    padding: 2px 6px;
}

.signal {
    font-size: 12px;
    margin-right: 8px;
}

.signal-strong { color: #cdd6f4; }
.signal-good   { color: rgba(205, 214, 244, 0.8); }
.signal-weak   { color: rgba(205, 214, 244, 0.5); }

button {
    background-color: transparent;
    background-image: none;
    box-shadow: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0;
    margin: 0;
    min-height: 0;
    min-width: 0;
}

button:hover, button:focus {
    background-image: none;
    box-shadow: none;
}

button > label {
    padding: 0;
    margin: 0;
    min-height: 0;
    -gtk-icon-size: 0;
}

.btn-icon > label {
    font-family: "Symbols Nerd Font Mono";
    font-size: 14px;
    line-height: 1;
}

.btn-connect, .btn-disconnect, .btn-footer, .btn-confirm {
    color: #cdd6f4;
    padding: 4px 6px;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.btn-connect:hover, .btn-disconnect:hover, .btn-confirm:hover, .btn-footer:hover {
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-connect:hover { color: #a6e3a1; }
.btn-disconnect:hover { color: #f38ba8; }
.btn-footer:hover { color: #cba6f7; }
.btn-confirm:hover { color: #a6e3a1; }

.btn-icon {
    font-family: "Symbols Nerd Font Mono";
    font-size: 14px;
    line-height: 1;
}

.net-security-icon {
    font-size: 10px;
    color: rgba(205, 214, 244, 0.4);
    margin-top: 2px;
}

.password-box {
    padding: 10px;
    margin-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.password-entry {
    background-color: rgba(45, 45, 55, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #cdd6f4;
    padding: 6px;
    font-size: 11px;
}

.password-entry:focus {
    border-color: #cba6f7;
}

tooltip {
    background: rgba(15, 15, 20, 0.95);
    border: 1px solid #cba6f7;
    border-radius: 8px;
}

tooltip label {
    color: #cdd6f4;
}

scrollbar {
    opacity: 0;
    min-width: 0;
    min-height: 0;
}
"""

def run(*args):
    return subprocess.run(list(args), capture_output=True, text=True).stdout.strip()

def get_current():
    for line in run("nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL", "dev", "wifi").splitlines():
        if line.startswith("*"):
            parts = line.split(":")
            if len(parts) >= 3:
                try: sig = int(parts[-1])
                except: sig = 0
                return parts[1], sig
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
        if active == "*": continue
        if not ssid or ssid in seen: continue
        seen.add(ssid)
        try: sig = int(sig_s)
        except: sig = 0
        nets.append({"ssid": ssid, "security": sec if sec != "--" else "", "signal": sig, "active": False})
    return sorted(nets, key=lambda x: x["signal"], reverse=True)

def signal_icon(s):
    if s >= 75: return "▂▄▆█", "signal-strong"
    if s >= 50: return "▂▄▆░", "signal-good"
    if s >= 25: return "▂▄░░", "signal-weak"
    return "▂░░░", "signal-weak"


class WifiPanel(Gtk.Window):
    def __init__(self, app):
        super().__init__()
        # Importante: inicializar layer-shell antes de cualquier otra cosa
        LayerShell.init_for_window(self)
        LayerShell.set_namespace(self, "wifi-panel")
        self.set_application(app)

        LayerShell.set_layer(self, LayerShell.Layer.TOP)
        LayerShell.set_anchor(self, LayerShell.Edge.TOP, True)
        LayerShell.set_anchor(self, LayerShell.Edge.RIGHT, True)
        LayerShell.set_margin(self, LayerShell.Edge.TOP, 44)
        LayerShell.set_margin(self, LayerShell.Edge.RIGHT, 210)
        LayerShell.set_keyboard_mode(self, LayerShell.KeyboardMode.ON_DEMAND)
        LayerShell.set_exclusive_zone(self, -1)
        self.set_decorated(False)
        self.set_resizable(False)
        self.set_size_request(220, -1)
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

    def _icon_button(self, icon, css_class):
        from gi.repository import Pango, PangoCairo
        SIZE = 18
        color_map = {
            "btn-disconnect": (0.953, 0.545, 0.659),
            "btn-footer":     (0.792, 0.651, 0.969),
            "btn-confirm":    (0.651, 0.890, 0.631),
            "btn-connect":    (0.804, 0.839, 0.957),
        }
        r, g, b = color_map.get(css_class, (0.804, 0.839, 0.957))

        btn = Gtk.Button()
        btn.add_css_class(css_class)
        btn.set_has_frame(False)
        btn.set_valign(Gtk.Align.CENTER)
        btn.set_halign(Gtk.Align.CENTER)
        btn.set_size_request(SIZE, SIZE)

        da = Gtk.DrawingArea()
        da.set_size_request(SIZE, SIZE)
        da.set_halign(Gtk.Align.FILL)
        da.set_valign(Gtk.Align.FILL)

        def draw(widget, cr, w, h):
            layout = PangoCairo.create_layout(cr)
            layout.set_text(icon, -1)
            fd = Pango.FontDescription.from_string("Symbols Nerd Font Mono 13")
            layout.set_font_description(fd)
            # Usar ink extents para centrado visual real (no bounding box)
            ink, _ = layout.get_pixel_extents()
            # ink.x, ink.y son el offset del glyph dentro del bounding box
            x = (w - ink.width) / 2 - ink.x
            y = (h - ink.height) / 2 - ink.y
            cr.set_source_rgba(r, g, b, 1.0)
            cr.move_to(x, y)
            PangoCairo.show_layout(cr, layout)

        da.set_draw_func(draw)
        btn.set_child(da)
        return btn

    def _build(self):
        self._root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self._root.add_css_class("panel-box")
        self.set_child(self._root)

        self._header_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self._header_box.add_css_class("header-box")
        self._root.append(self._header_box)
        self._rebuild_header()

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.set_max_content_height(200)
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

    def _rebuild_header(self):
        while c := self._header_box.get_first_child():
            self._header_box.remove(c)

        current_info = get_current()
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        row.set_spacing(2)
        row.set_valign(Gtk.Align.CENTER)

        if current_info:
            ssid, sig = current_info
            
            bar, cls = signal_icon(sig)
            sig_lbl = Gtk.Label(label=bar)
            sig_lbl.add_css_class("signal")
            sig_lbl.add_css_class(cls)
            row.append(sig_lbl)

            info = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            info.set_hexpand(True)
            info.set_valign(Gtk.Align.CENTER)

            s = Gtk.Label(label=ssid)
            s.add_css_class("connected-ssid")
            s.set_xalign(0)
            info.append(s)

            row.append(info)
            btn = self._icon_button("󰖪", "btn-disconnect")
            btn.connect("clicked", self._disconnect)
            row.append(btn)
        else:
            l = Gtk.Label(label="sin conexión")
            l.add_css_class("disconnected-label")
            l.set_xalign(0)
            l.set_hexpand(True)
            row.append(l)

        r = self._icon_button("󰑐", "btn-footer")
        r.connect("clicked", lambda _: self._load_networks())
        row.append(r)

        a = self._icon_button("󰒓", "btn-footer")
        a.connect("clicked", self._open_nmtui)
        row.append(a)

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
        info.set_valign(Gtk.Align.CENTER)

        sl = Gtk.Label(label=net["ssid"])
        sl.add_css_class("net-ssid")
        sl.set_xalign(0)
        sl.set_ellipsize(3)
        info.append(sl)

        if net["security"]:
            sec = Gtk.Label(label="󰌾")
            sec.add_css_class("net-security-icon")
            sec.set_xalign(0)
            info.append(sec)

        row.append(info)

        gesture = Gtk.GestureClick()
        gesture.connect("released", lambda g, n, x, y, s=net["ssid"], h=bool(net["security"]), r=row: self._cancel_pass() if self._pending_ssid == s else self._connect(s, h, r))
        row.add_controller(gesture)
        row.set_cursor(Gdk.Cursor.new_from_name("pointer"))

        return row

    def _connect(self, ssid, has_security, row=None):
        def try_it():
            r = subprocess.run(["nmcli", "dev", "wifi", "connect", ssid], capture_output=True, text=True)
            if r.returncode == 0:
                GLib.idle_add(self._on_ok, ssid)
            elif has_security:
                GLib.idle_add(self._show_pass, ssid, row)
            else:
                GLib.idle_add(self._on_err, ssid)
        threading.Thread(target=try_it, daemon=True).start()

    def _show_pass(self, ssid, anchor_row=None):
        self._pending_ssid = ssid
        if self._pass_box:
            try: self._list.remove(self._pass_box)
            except: pass

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.add_css_class("password-box")
        self._pass_box = box

        entry = Gtk.Entry()
        entry.set_visibility(False)
        entry.set_placeholder_text("contraseña")
        entry.add_css_class("password-entry")
        entry.connect("activate", lambda e: self._confirm_pass(e.get_text()))
        box.append(entry)

        if anchor_row:
            self._list.insert_child_after(box, anchor_row)
        else:
            self._list.append(box)
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
            try: self._list.remove(self._pass_box)
            except: pass
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
