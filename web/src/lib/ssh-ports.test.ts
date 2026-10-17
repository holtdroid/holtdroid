import { expect, test } from "bun:test"
import { sshCommand } from "@/lib/ssh-ports"

const base = { user: "fake-1", host: "android.example.com", port: 2222, skipHostKeyCheck: false, adb: true }

test.each([
  [false, "ssh -N -p 2222 -L 5555:adb:5555 -R 3000:localhost:3000 fake-1@android.example.com"],
  [
    true,
    "while true; do ssh -N -p 2222 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 5555:adb:5555 -R 3000:localhost:3000 fake-1@android.example.com; sleep 1 || break; done",
  ],
])("sshCommand reconnect=%p", (reconnect, want) => {
  expect(sshCommand({ ...base, forwards: [{ device: 3000, local: 3000 }], reconnect })).toBe(want)
})
