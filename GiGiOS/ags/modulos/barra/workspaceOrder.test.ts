import assert from "node:assert/strict"
import test from "node:test"

import {
  orderWorkspaceClients,
  rememberRecentWorkspace,
  selectRecentWorkspaces,
} from "./workspaceOrder.ts"

test("orders workspace clients top-to-bottom and left-to-right", () => {
  const clients = [
    { address: "right-bottom", x: 100, y: 100 },
    { address: "right-top", x: 100, y: 0 },
    { address: "left-top", x: 0, y: 0 },
  ]

  assert.deepEqual(
    orderWorkspaceClients(clients).map((client) => client.address),
    ["left-top", "right-top", "right-bottom"],
  )
  assert.deepEqual(clients.map((client) => client.address), ["right-bottom", "right-top", "left-top"])
})

test("uses the address as a stable tie-break for overlapping clients", () => {
  const clients = [
    { address: "0xbbb", x: 20, y: 20 },
    { address: "0xaaa", x: 20, y: 20 },
  ]

  assert.deepEqual(
    orderWorkspaceClients(clients).map((client) => client.address),
    ["0xaaa", "0xbbb"],
  )
})

test("places clients without coordinates after positioned clients", () => {
  const clients = [
    { address: "unknown" },
    { address: "positioned", x: 10, y: 10 },
  ]

  assert.deepEqual(
    orderWorkspaceClients(clients).map((client) => client.address),
    ["positioned", "unknown"],
  )
})

test("moves a visited workspace to the front of the recent history", () => {
  assert.deepEqual(rememberRecentWorkspace([4, 2, 1], 2), [2, 4, 1])
  assert.deepEqual(rememberRecentWorkspace([4, 2, 1], 7), [7, 4, 2, 1])
})

test("keeps the most recently visited workspaces", () => {
  const workspaces = [1, 2, 4, 7, 9].map((id) => ({ id }))

  assert.deepEqual(
    selectRecentWorkspaces(workspaces, [9, 2, 7, 1, 4], 9, 3).map((workspace) => workspace.id),
    [2, 7, 9],
  )
})

test("always includes the focused workspace even if the history is stale", () => {
  const workspaces = [1, 2, 3, 4].map((id) => ({ id }))

  assert.deepEqual(
    selectRecentWorkspaces(workspaces, [1, 2, 3], 4, 2).map((workspace) => workspace.id),
    [1, 4],
  )
})

test("shows only the focused workspace when the limit is one", () => {
  const workspaces = [1, 2, 3].map((id) => ({ id }))
  assert.deepEqual(selectRecentWorkspaces(workspaces, [1, 3], 2, 1).map((workspace) => workspace.id), [2])
})

test("fills an incomplete history with available workspaces", () => {
  const workspaces = [1, 2, 3, 4].map((id) => ({ id }))
  assert.deepEqual(
    selectRecentWorkspaces(workspaces, [3], 3, 3).map((workspace) => workspace.id),
    [1, 2, 3],
  )
})
