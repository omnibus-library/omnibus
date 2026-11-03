import "react";

declare module "react" {
  // Lets a style object set the custom properties theme.css reads (--accent, --i).
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
