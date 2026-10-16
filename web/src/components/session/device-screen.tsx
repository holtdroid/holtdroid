import { useDevice } from "@/components/session/use-device"
import { cn } from "@/lib/utils"

// The screen arrives in the panel's native portrait orientation, so a rotated
// device is turned back here; the browser maps input through the transform.
export function DeviceScreen({
  provider,
  id,
  src,
  frameRef,
}: {
  provider: string
  id: string
  src: string
  frameRef: (frame: HTMLIFrameElement | null) => void
}) {
  const rotation = useDevice(provider, id).data?.rotation ?? 0
  return (
    <div className="relative size-full overflow-hidden bg-neutral-950 [container-type:size]">
      <iframe
        ref={frameRef}
        title="Device screen"
        src={src}
        allow="clipboard-read; clipboard-write"
        className={cn(
          "absolute top-1/2 left-1/2 bg-neutral-950",
          rotation % 2 === 1 ? "h-[100cqw] w-[100cqh]" : "size-full",
        )}
        style={{ transform: `translate(-50%, -50%) rotate(${-90 * rotation}deg)` }}
      />
    </div>
  )
}
