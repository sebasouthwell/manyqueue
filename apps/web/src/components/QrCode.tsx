import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Colors mirror tokens.css --color-bg (dark modules) and --color-accent-100 (light ground).
const DARK = "#161826";
const LIGHT = "#ebe9f6";

export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
      width: size,
      color: { dark: DARK, light: LIGHT },
    }).then((str) => {
      if (!cancelled) setSvg(str);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
