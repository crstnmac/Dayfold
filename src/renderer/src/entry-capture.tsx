import { CaptureBar } from '@renderer/components/dash/capture-bar'

/** The quick-capture window loads only this: no router, no motion, none of the main app. */
export default function CaptureEntry(): React.JSX.Element {
  return <CaptureBar />
}
