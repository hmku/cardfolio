import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cardfolio",
    short_name: "Cardfolio",
    description: "Household credit card tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1f4",
    theme_color: "#17202a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
