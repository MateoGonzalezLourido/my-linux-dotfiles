import AstalBluetooth from "gi://AstalBluetooth"
console.log("Device properties:", Object.getOwnPropertyNames(AstalBluetooth.Device.prototype).filter(p => !p.startsWith('get_') && !p.startsWith('set_')))
console.log("Device methods:", Object.getOwnPropertyNames(AstalBluetooth.Device.prototype).filter(p => typeof AstalBluetooth.Device.prototype[p] === 'function'))
