import { describe, expect, test } from "bun:test"
import { crashOwner } from "@/lib/logcat"

describe("crashOwner", () => {
  const cases: { name: string; tag: string; message: string; uid?: number; want: boolean | undefined }[] = [
    { name: "java crash of the app", tag: "AndroidRuntime", message: "Process: com.example, PID: 4242", want: true },
    {
      name: "java crash of a subprocess",
      tag: "AndroidRuntime",
      message: "Process: com.example:remote, PID: 1",
      want: true,
    },
    { name: "java crash of another app", tag: "AndroidRuntime", message: "Process: com.other, PID: 1", want: false },
    { name: "package prefix only", tag: "AndroidRuntime", message: "Process: com.example2, PID: 1", want: false },
    { name: "java header", tag: "AndroidRuntime", message: "FATAL EXCEPTION: main", want: undefined },
    {
      name: "tombstone of the app",
      tag: "DEBUG",
      message: "pid: 4242, tid: 4242, name: com.example  >>> com.example <<<",
      want: true,
    },
    {
      name: "tombstone of another process",
      tag: "DEBUG",
      message: "pid: 77, tid: 80, name: surfaceflinger  >>> /system/bin/surfaceflinger <<<",
      want: false,
    },
    { name: "tombstone uid of the app", tag: "DEBUG", message: "uid: 10123", uid: 10123, want: true },
    { name: "tombstone uid of another app", tag: "DEBUG", message: "uid: 1000", uid: 10123, want: false },
    { name: "tombstone uid, app uid unknown", tag: "DEBUG", message: "uid: 1000", want: undefined },
    { name: "uid line from AndroidRuntime", tag: "AndroidRuntime", message: "uid: 10123", uid: 10123, want: undefined },
  ]
  for (const c of cases) {
    test(c.name, () => {
      expect(crashOwner({ tag: c.tag, message: c.message }, "com.example", c.uid)).toBe(c.want)
    })
  }
})
