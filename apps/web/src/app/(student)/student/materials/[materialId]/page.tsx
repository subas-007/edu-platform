import { FlashcardDeck } from '@/components/student/FlashcardDeck';
import { StartExamPanel } from '@/components/student/StartExamPanel';
import { StudyRoadmapTracker } from '@/components/student/StudyRoadmapTracker';

export default async function StudentMaterialPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <FlashcardDeck materialId={materialId} />
        <StartExamPanel materialId={materialId} />
      </div>
      <StudyRoadmapTracker materialId={materialId} />
    </div>
  );
}
