import AstalWp from "gi://AstalWp"
import GObject from "gi://GObject"
const wp = AstalWp.get_default()
console.log("audio signals:", GObject.signal_list_ids(wp.audio.constructor.$gtype).map(id => GObject.signal_name(id)))
