import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/audit-by-design", "/pricing", "/about"],
        disallow: ["/dashboard/", "/api/", "/sign-in", "/sign-up", "/onboarding"],
      },
    ],
    sitemap: "https://stratus.finance/sitemap.xml",
  };
}
