import { useNavigate } from "@tanstack/react-router"
import { CircleStopIcon, VideoIcon } from "lucide-react"
import { toast } from "sonner"
import { useRecordings, useSessionRecording } from "@/api/queries"
import { RailButton } from "@/components/session/rail-item"
import { useNow } from "@/hooks/use-now"
import { formatDuration } from "@/lib/format"

/** Starts and stops the server's recording of the session (decision #96). */
export function RecordButton({
  provider,
  id,
  recording,
  since,
  manage,
}: {
  provider: string
  id: string
  recording?: string
  since?: string
  manage: boolean
}) {
  const recordings = useRecordings()
  const toggle = useSessionRecording()
  const navigate = useNavigate()
  const now = useNow()
  if (!recordings.data?.enabled) return null

  const watch = (rid: string) => ({
    label: "Watch",
    onClick: () => void navigate({ to: "/recordings/$id", params: { id: rid } }),
  })

  if (recording) {
    const elapsed = since ? now - new Date(since).getTime() : 0
    return (
      <RailButton
        text="Stop recording"
        label={`Stop recording (${formatDuration(elapsed)})`}
        disabled={!manage || toggle.isPending}
        className="text-red-600 dark:text-red-400"
        onClick={() =>
          toggle.mutate(
            { provider, id, on: false },
            {
              onSuccess: () => toast("Recording saved", { action: watch(recording) }),
              onError: (e) => toast.error("Could not stop the recording", { description: e.message }),
            },
          )
        }
      >
        <CircleStopIcon className="animate-pulse" />
      </RailButton>
    )
  }

  return (
    <RailButton
      text="Record"
      label="Record the session on the server"
      disabled={!manage || toggle.isPending}
      onClick={() =>
        toggle.mutate(
          { provider, id, on: true },
          { onError: (e) => toast.error("Could not start recording", { description: e.message }) },
        )
      }
    >
      <VideoIcon />
    </RailButton>
  )
}
