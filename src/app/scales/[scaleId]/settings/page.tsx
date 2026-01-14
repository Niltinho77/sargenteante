// src/app/scales/[scaleId]/settings/page.tsx
import ScaleSettings from "@/components/admin/ScaleSettings";

export default async function ScaleSettingsPage({
  params,
}: {
  params: Promise<{ scaleId: string }>;
}) {
  const { scaleId } = await params;

  return (
    <div className="p-4">
      <ScaleSettings scaleId={scaleId} />
    </div>
  );
}
