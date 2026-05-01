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

.connected-row {
    border-radius: 6px;
    transition: background-color 0.2s ease;
    padding: 4px 6px;
    min-height: 26px;
}

.connected-row:hover {
    background-color: rgba(243, 139, 168, 0.08);
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

def get_current(rescan=False):
    rescan_arg = "yes" if rescan else "no"
    for line in run("nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL", "dev", "wifi", "list", "--rescan", rescan_arg).splitlines():
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

def get_networks(rescan=False):
    current = get_current(rescan=False)
    current_ssid = current[0] if current else None

    rescan_arg = "yes" if rescan else "no"
    out = run("nmcli", "--fields", "SSID,SECURITY,SIGNAL,IN-USE", "-t", "dev", "wifi", "list", "--rescan", rescan_arg)
    nets = []
    seen = set()
    if current_ssid:
        seen.add(current_ssid)

    for line in out.splitlines():
        p = line.split(":")
        if len(p) < 4: continue
        ssid, sec, sig_s, active = p[0], p[1], p[2], p[3]
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
        self._scan_anim_id = None
        self._scan_phase = 0.0

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
        def on_focus_lost(w, p):
            if not self.is_active():
                try:
                    import time
                    with open("/tmp/wifi-panel-close.ts", "w") as f:
                        f.write(str(time.time()))
                except:
                    pass
                self.close()
        self.connect("notify::is-active", on_focus_lost)

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
        from gi.repository import Pango, PangoCairo
        import math

        overlay = Gtk.Overlay()
        self.set_child(overlay)

        self._root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self._root.add_css_class("panel-box")
        overlay.set_child(self._root)

        # DrawingArea para el borde animado
        self._border_da = Gtk.DrawingArea()
        self._border_da.set_visible(False)
        self._border_da.set_can_target(False)  # no intercepta clicks
        self._border_da.set_halign(Gtk.Align.FILL)
        self._border_da.set_valign(Gtk.Align.FILL)

        def draw_border(widget, cr, w, h):
            import math
            import cairo
            phase = self._scan_phase
            radius = 12
            lw = 2.0

            # Trazar el contorno redondeado
            cr.new_path()
            cr.arc(w - radius, radius, radius, -math.pi/2, 0)
            cr.arc(w - radius, h - radius, radius, 0, math.pi/2)
            cr.arc(radius, h - radius, radius, math.pi/2, math.pi)
            cr.arc(radius, radius, radius, math.pi, 3*math.pi/2)
            cr.close_path()

            # Longitud total aproximada del perímetro
            perimeter = 2*(w + h) - (8 - 2*math.pi)*radius

            cr.set_line_width(lw)

            # Gradiente que rota: colores azul/violeta/cyan
            colors = [
                (0.537, 0.706, 0.980),  # #89b4fa azul
                (0.792, 0.651, 0.969),  # #cba6f7 violeta
                (0.604, 0.871, 0.855),  # #99d1db cyan
                (0.537, 0.706, 0.980),  # cierre
            ]

            # Dibujar el borde con dash animado
            dash_len = perimeter * 0.35
            gap_len  = perimeter * 0.65
            offset   = -phase * perimeter

            cr.set_dash([dash_len, gap_len], offset)

            # Gradiente lineal azul -> violeta -> cyan rotando con phase
            grad = cairo.LinearGradient(phase * w - w, 0, phase * w, h)
            grad.add_color_stop_rgba(0.0,  0.537, 0.706, 0.980, 0.9)  # #89b4fa azul
            grad.add_color_stop_rgba(0.5,  0.792, 0.651, 0.969, 0.9)  # #cba6f7 violeta
            grad.add_color_stop_rgba(1.0,  0.537, 0.706, 0.980, 0.9)  # cierre azul
            cr.set_source(grad)
            cr.stroke()

        self._border_da.set_draw_func(draw_border)
        overlay.add_overlay(self._border_da)

        self._header_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self._header_box.add_css_class("header-box")
        self._root.append(self._header_box)

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

    def _rebuild_header(self, current_info=None):
        while c := self._header_box.get_first_child():
            self._header_box.remove(c)

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

            gesture = Gtk.GestureClick()
            gesture.connect("released", lambda g, n, x, y: self._disconnect(None))
            row.add_controller(gesture)
            row.add_css_class("connected-row")
            row.set_cursor(Gdk.Cursor.new_from_name("pointer"))
        else:
            l = Gtk.Label(label="sin conexión")
            l.add_css_class("disconnected-label")
            l.set_xalign(0)
            l.set_hexpand(True)
            row.append(l)

        btn_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        btn_row.set_spacing(2)
        btn_row.set_valign(Gtk.Align.CENTER)

        r = self._icon_button("󰑐", "btn-footer")
        r.connect("clicked", lambda _: self._load_networks(rescan=True))
        btn_row.append(r)

        a = self._icon_button("󰒓", "btn-footer")
        a.connect("clicked", self._open_nmtui)
        btn_row.append(a)

        outer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        outer.set_spacing(6)
        row.set_hexpand(False)
        row.set_size_request(140, -1)
        row.set_valign(Gtk.Align.FILL)
        btn_row.set_valign(Gtk.Align.FILL)
        row.set_valign(Gtk.Align.FILL)
        btn_row.set_valign(Gtk.Align.FILL)
        outer.set_valign(Gtk.Align.FILL)
        outer.append(row)
        outer.append(btn_row)
        self._header_box.append(outer)

    def _show_spinner(self):
        if self._spinner_row.get_parent() is None:
            self._list.prepend(self._spinner_row)
            self._spinner.start()
        return False

    def _start_scan_anim(self):
        self._scan_phase = 0.0
        if hasattr(self, '_scan_anim_id') and self._scan_anim_id:
            return
        self._border_da.set_visible(True)
        def tick():
            self._scan_phase = (self._scan_phase + 0.03) % 1.0
            self._border_da.queue_draw()
            return True  # continuar
        self._scan_anim_id = GLib.timeout_add(30, tick)

    def _stop_scan_anim(self):
        if hasattr(self, '_scan_anim_id') and self._scan_anim_id:
            GLib.source_remove(self._scan_anim_id)
            self._scan_anim_id = None
        self._border_da.set_visible(False)

    def _load_networks(self, rescan=False):
        if rescan:
            self._show_spinner()
            self._start_scan_anim()

        def worker():
            current_info = get_current(rescan)
            nets = get_networks(rescan)
            
            if not nets and not rescan:
                GLib.idle_add(self._show_spinner)
                current_info = get_current(rescan=True)
                nets = get_networks(rescan=True)

            GLib.idle_add(self._stop_scan_anim)
            GLib.idle_add(self._rebuild_header, current_info)
            GLib.idle_add(self._populate, nets)
        threading.Thread(target=worker, daemon=True).start()
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

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        sl = Gtk.Label(label=net["ssid"])
        sl.add_css_class("net-ssid")
        sl.set_xalign(0)
        sl.set_ellipsize(3)
        header.append(sl)

        spinner = Gtk.Spinner()
        spinner.set_margin_start(6)
        spinner.set_visible(False)
        header.append(spinner)

        info.append(header)

        if net["security"]:
            sec = Gtk.Label(label="󰌾")
            sec.add_css_class("net-security-icon")
            sec.set_xalign(0)
            info.append(sec)

        row.append(info)
        row._spinner = spinner

        gesture = Gtk.GestureClick()
        gesture.connect("released", lambda g, n, x, y, s=net["ssid"], h=bool(net["security"]), r=row: self._cancel_pass() if self._pending_ssid == s else self._connect(s, h, r))
        row.add_controller(gesture)
        row.set_cursor(Gdk.Cursor.new_from_name("pointer"))

        return row

    def _connect(self, ssid, has_security, row=None):
        if row and hasattr(row, '_spinner'):
            row._spinner.set_visible(True)
            row._spinner.start()
            self._connecting_spinner = row._spinner

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
        if hasattr(self, '_connecting_spinner') and self._connecting_spinner:
            self._connecting_spinner.stop()
            self._connecting_spinner.set_visible(False)
            self._connecting_spinner = None

        self._pending_ssid = ssid
        self._pending_row = anchor_row

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
        row = getattr(self, '_pending_row', None)
        self._cancel_pass()

        if row and hasattr(row, '_spinner'):
            row._spinner.set_visible(True)
            row._spinner.start()
            self._connecting_spinner = row._spinner

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
        self._pending_row = None

    def _disconnect(self, _):
        def do():
            for line in run("nmcli", "-t", "-f", "device,type", "dev", "status").splitlines():
                if "wifi" in line:
                    subprocess.run(["nmcli", "dev", "disconnect", line.split(":")[0]])
                    break
            GLib.idle_add(self._refresh)
        threading.Thread(target=do, daemon=True).start()

    def _refresh(self):
        self._load_networks(rescan=False)

    def _on_ok(self, ssid):
        if hasattr(self, '_connecting_spinner') and self._connecting_spinner:
            self._connecting_spinner.stop()
            self._connecting_spinner.set_visible(False)
            self._connecting_spinner = None

        subprocess.Popen(["notify-send", "WiFi", f"✓ Conectado a {ssid}", "--expire-time=3000"])
        self.close()

    def _on_err(self, ssid):
        if hasattr(self, '_connecting_spinner') and self._connecting_spinner:
            self._connecting_spinner.stop()
            self._connecting_spinner.set_visible(False)
            self._connecting_spinner = None

        subprocess.Popen(["notify-send", "WiFi", f"✕ Error conectando a {ssid}", "--expire-time=3000"])

    def _open_nmtui(self, _):
        subprocess.Popen(["kitty", "--title", "nmtui", "--class", "floating_term", "nmtui"])
        self.close()


class App(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="com.waybar.wifipanel")

    def do_activate(self):
        windows = self.get_windows()
        if windows:
            # Si ya hay una ventana (panel abierto), la cerramos (Flip-Flop)
            for win in windows:
                win.close()
        else:
            win = WifiPanel(self)
            win.present()


if __name__ == "__main__":
    import time, os
    try:
        with open("/tmp/wifi-panel-close.ts", "r") as f:
            last_closed = float(f.read().strip())
        if time.time() - last_closed < 0.3:
            # Evita que el botón de Waybar reabra el panel instantáneamente si fue él quien causó la pérdida de foco
            os.remove("/tmp/wifi-panel-close.ts")
            sys.exit(0)
    except:
        pass

    App().run(sys.argv)
