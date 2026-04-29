import type { AppModule } from "@/types/terminal";

const appModules = import.meta.glob("../apps/*.tsx", { eager: false });

export async function loadApp(name: string): Promise<AppModule | null> {
  const path = `../apps/${name}.tsx`;
  const loader = appModules[path];
  if (!loader) return null;

  try {
    const mod = (await loader()) as { app?: AppModule };
    return mod.app ?? null;
  } catch {
    // Chunk load failed — stale assets after deploy. Reload to get fresh bundle.
    window.location.reload();
    return null;
  }
}

export function listAppNames(): string[] {
  return Object.keys(appModules)
    .map((p) => {
      const m = p.match(/\/([^/]+)\.tsx$/);
      return m?.[1] ?? "";
    })
    .filter(Boolean);
}
