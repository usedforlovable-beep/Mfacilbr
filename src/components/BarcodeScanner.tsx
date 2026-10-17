import { useEffect, useRef, useState } from 'react'
import { Flashlight, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = { onDetected: (code: string) => void; onClose: () => void; onError: (msg: string) => void }

// Live rear-camera scanner using ZXing (runs fully in the browser).
export function BarcodeScanner({ onDetected, onClose, onError }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const controls = useRef<{ stop: () => void; switchTorch?: (on: boolean) => Promise<void> } | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceIdx, setDeviceIdx] = useState(-1)
  const [torch, setTorch] = useState(false)
  const [hint, setHint] = useState('Aponte para o código de barras')
  const done = useRef(false)

  useEffect(() => {
    let cancelled = false
    done.current = false
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.ITF])
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
        const deviceId = deviceIdx >= 0 ? devices[deviceIdx]?.deviceId : undefined
        const constraints: MediaStreamConstraints = { audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } } }
        const c = await reader.decodeFromConstraints(constraints, video.current!, (result) => {
          if (!result || done.current) return
          const text = result.getText()
          if (!/^\d{8,14}$/.test(text)) { setHint('Código lido não é de produto. Tente novamente.'); return }
          done.current = true
          navigator.vibrate?.(80)
          onDetected(text)
        })
        if (cancelled) { c.stop(); return }
        controls.current = c
        if (!devices.length) {
          const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
          if (!cancelled) setDevices(list)
        }
      } catch (e) {
        const name = (e as { name?: string })?.name
        onError(name === 'NotAllowedError' ? 'Permissão da câmera negada. Digite o código manualmente.' : name === 'NotFoundError' ? 'Nenhuma câmera encontrada. Digite o código manualmente.' : 'Não foi possível abrir a câmera neste navegador. Digite o código manualmente.')
      }
    })()
    return () => { cancelled = true; controls.current?.stop(); controls.current = null; setTorch(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdx])

  const toggleTorch = async () => {
    try { await controls.current?.switchTorch?.(!torch); setTorch(t => !t) } catch { setHint('Lanterna não suportada neste aparelho.') }
  }

  return <div className="live-scanner" role="dialog" aria-label="Scanner de código de barras">
    <video ref={video} playsInline muted autoPlay />
    <div className="scan-guide"><span className="scan-line" /></div>
    <p className="scan-hint">{hint}</p>
    <div className="scan-controls">
      {controls.current?.switchTorch && <Button variant="secondary" size="icon" aria-label="Lanterna" onClick={toggleTorch}><Flashlight /></Button>}
      {devices.length > 1 && <Button variant="secondary" size="icon" aria-label="Trocar câmera" onClick={() => setDeviceIdx(i => (i + 1) % devices.length)}><RefreshCw /></Button>}
      <Button variant="secondary" size="icon" aria-label="Fechar scanner" onClick={onClose}><X /></Button>
    </div>
  </div>
}

// Optional fallback: decode a barcode from a photo (real ZXing decoding, no AI guessing).
export async function decodeImageFile(file: File): Promise<string | null> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const url = URL.createObjectURL(file)
  try { const r = await new BrowserMultiFormatReader().decodeFromImageUrl(url); return r.getText() } catch { return null } finally { URL.revokeObjectURL(url) }
}
