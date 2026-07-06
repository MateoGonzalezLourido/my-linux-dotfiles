import AstalWp from "gi://AstalWp"

const wp = AstalWp.get_default()
if (wp.audio) {
    // @ts-ignore
    const endpoints = wp.audio.get_endpoints()
    endpoints.forEach(e => {
        console.log(`Endpoint: ${e.name} (${e.description}) - ID: ${e.id} - Type: ${e.direction}`)
    })
}
