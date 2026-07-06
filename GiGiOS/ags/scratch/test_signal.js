import AstalBluetooth from "gi://AstalBluetooth"
import GObject from "gi://GObject"

const bt = AstalBluetooth.get_default()
console.log("bt signals:", GObject.signal_list_ids(bt.constructor.$gtype).map(id => GObject.signal_name(id)))
if (bt.adapter) {
    console.log("adapter signals:", GObject.signal_list_ids(bt.adapter.constructor.$gtype).map(id => GObject.signal_name(id)))
}
