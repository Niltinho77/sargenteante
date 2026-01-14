// src/app/scales/[scaleId]/page.tsx
import ScaleGrid from "@/components/sheet/ScaleGrid";

export default async function ScaleSheetPage({
  params,
}: {
  params: Promise<{ scaleId: string }>;
}) {
  const { scaleId } = await params;

  return (
    <div className="p-4 space-y-4">
      <ScaleGrid scaleId={scaleId} />
    </div>
  );
}
