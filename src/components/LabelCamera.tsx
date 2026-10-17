import { useEffect, useRef, useState } from "react";

type Props = {
  onScan: (image: string) => Promise<boolean>;
  onError: (message: string) => void;
};

const scanIntervalMs = 7_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function LabelCamera({ onScan, onError }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Iniciando câmera…");

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const scanContinuously = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Este aparelho ou navegador não oferece acesso à câmera.");
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const preview = video.current;
        if (!preview) throw new Error("A visualização da câmera está indisponível.");
        preview.srcObject = stream;
        await preview.play();

        while (!cancelled && (preview.videoWidth === 0 || preview.videoHeight === 0)) {
          await wait(100);
        }

        while (!cancelled) {
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 1280 / Math.max(preview.videoWidth, preview.videoHeight));
          canvas.width = Math.round(preview.videoWidth * scale);
          canvas.height = Math.round(preview.videoHeight * scale);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Não foi possível processar a imagem da câmera.");

          context.drawImage(preview, 0, 0, canvas.width, canvas.height);
          setStatus("Analisando a etiqueta automaticamente…");
          const readable = await onScan(canvas.toDataURL("image/jpeg", 0.82));
          if (cancelled || readable) break;

          setStatus(
            "Mantenha a etiqueta enquadrada. Toque novamente em ESCANEAR ETIQUETA para parar.",
          );
          await wait(scanIntervalMs);
        }
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof Error ? error.name : "";
        onError(
          name === "NotAllowedError"
            ? "Permita o acesso à câmera para escanear a etiqueta."
            : name === "NotFoundError"
              ? "Nenhuma câmera foi encontrada neste aparelho."
              : error instanceof Error
                ? error.message
                : "Não foi possível iniciar o escaneamento.",
        );
      }
    };

    void scanContinuously();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onError, onScan]);

  return (
    <div className="label-camera" role="dialog" aria-label="Escaneamento automático de etiqueta">
      <video ref={video} data-on="true" playsInline muted autoPlay />
      <div className="scan-guide">
        <span className="scan-line" />
      </div>
      <p className="scan-hint" role="status">
        {status}
      </p>
    </div>
  );
}
