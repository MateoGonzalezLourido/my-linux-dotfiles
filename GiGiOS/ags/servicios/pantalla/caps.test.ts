import { test } from "node:test"
import assert from "node:assert/strict"
import { parseModetestCaps, parseEdidHdr } from "./caps.ts"

const MODETEST = `Connectors:
id	encoder	status	name	size (mm)	modes	encoders
508	507	connected	eDP-1          	340x220		2	507
  props:
	513 max bpc:
		flags: range
		values: 6 12
		value: 8
	514 Colorspace:
		flags: enum
		enums: Default=0 BT2020_RGB=9
		value: 0
	515 vrr_capable:
		flags: immutable range
		values: 0 1
		value: 0
1211	0	disconnected	HDMI-A-1       	0x0		0	1210
  props:
	613 max bpc:
		flags: range
		values: 8 10
		value: 8
	615 vrr_capable:
		flags: immutable range
		values: 0 1
		value: 1
`

test("parseModetestCaps lee vrr_capable y max bpc por conector", () => {
  const caps = parseModetestCaps(MODETEST)
  assert.equal(caps["eDP-1"].vrr, false)       // value: 0
  assert.equal(caps["eDP-1"].bitdepth10, true) // max bpc 12 >= 10
  assert.equal(caps["HDMI-A-1"].vrr, true)     // value: 1
  assert.equal(caps["HDMI-A-1"].bitdepth10, true) // max 10 >= 10
})

test("parseModetestCaps: max bpc < 10 => bitdepth10 false", () => {
  const caps = parseModetestCaps(`33	0	connected	DP-1	0x0		1	32
  props:
	1 max bpc:
		values: 6 8
		value: 8
	2 vrr_capable:
		values: 0 1
		value: 0
`)
  assert.equal(caps["DP-1"].bitdepth10, false)
  assert.equal(caps["DP-1"].vrr, false)
})

test("parseModetestCaps: sin datos => objeto vacío", () => {
  assert.deepEqual(parseModetestCaps(""), {})
})

test("parseEdidHdr detecta metadatos HDR por conector", () => {
  const scan = `###EDID eDP-1
###EDID HDMI-A-1
    HDR Static Metadata Data Block
      Electro optical transfer functions: SMPTE ST 2084
`
  const hdr = parseEdidHdr(scan)
  assert.equal(hdr.has("HDMI-A-1"), true)
  assert.equal(hdr.has("eDP-1"), false)
})
