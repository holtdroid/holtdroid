import { CalendarClockIcon } from "lucide-react"
import { useState } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { browserTimeZone } from "@/lib/format"

function offsetTo(at: number) {
  return at - Date.now()
}

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function toLocalInput(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function TimeDialog({
  state,
  disabled,
  onSubmit,
}: {
  state: DeviceState
  disabled: boolean
  onSubmit: (patch: DeviceSettings) => Promise<unknown>
}) {
  const mine = browserTimeZone()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [useMyZone, setUseMyZone] = useState(false)
  const [saving, setSaving] = useState(false)

  const onOpenChange = (next: boolean) => {
    if (next) {
      setValue(toLocalInput(Date.now() + state.timeOffset))
      setUseMyZone(false)
    }
    setOpen(next)
  }

  const submit = async () => {
    const at = new Date(value).getTime()
    if (Number.isNaN(at)) return
    const patch: DeviceSettings = { timeOffset: offsetTo(at) }
    if (useMyZone && mine) patch.timeZone = mine
    setSaving(true)
    const ok = await onSubmit(patch).then(
      () => true,
      () => false,
    )
    setSaving(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={disabled}>
          <CalendarClockIcon />
          Set date and time…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Set date and time</DialogTitle>
            <DialogDescription>
              Enter the moment the device should show, in your time zone ({mine.replaceAll("_", " ")}). The device keeps
              its own time zone and turns real-time sync off.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            step={1}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono tabular-nums"
          />
          {mine && mine !== state.timeZone && (
            <Label className="flex items-center justify-between gap-3 font-normal">
              <span className="text-sm">Also switch the device to {mine.replaceAll("_", " ")}</span>
              <Switch checked={useMyZone} onCheckedChange={setUseMyZone} />
            </Label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!value || saving}>
              Set time
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
